import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { ApiErrorSchema, HealthResponseSchema, LanguageModeSchema, type ApiErrorCode, type ReconstructResponse } from "@relaya/contracts";
import { reportError } from "./monitoring.js";
import { PipelineError, reconstruct, reconstructTranscript } from "./pipeline/reconstruct.js";
import { issueAgentTicket, recordAdmission } from "./routes/agentTicket.js";
import { checkSentenceAllowanceForToken, recordSentence } from "./routes/sentenceQuota.js";
import { endSession, startSession, type SessionResult } from "./routes/sessions.js";
import { SupabaseUnavailable, userFromToken } from "./supabase.js";

const app = new Hono().basePath("/api");

app.use("*", requestId());
app.use("*", async (c, next) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : ""),
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposeHeaders: ["Retry-After", "Server-Timing"],
  })(c, next);
});

app.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/api/reconstruct")) return next();
  const startedAt = performance.now();
  await next();
  const requestMs = Math.round(performance.now() - startedAt);
  const pipeline = c.res.headers.get("Server-Timing");
  c.header("Server-Timing", `${pipeline ? `${pipeline}, ` : ""}request;dur=${requestMs}`);
  console.info("Reconstruction request timing", { requestId: c.get("requestId"), status: c.res.status, requestMs });
});

function pipelineTiming(c: Context, timings: ReconstructResponse["timings"]) {
  c.header("Server-Timing", `transcription;dur=${timings.sttMs}, rewrite;dur=${timings.llmMs}, guard;dur=${timings.rulesMs}, pipeline;dur=${timings.totalMs}`, { append: true });
}

async function measured<T>(c: Context, stage: string, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try { return await work(); }
  finally {
    const durationMs = Math.round(performance.now() - startedAt);
    c.header("Server-Timing", `${stage};dur=${durationMs}`, { append: true });
    console.info("Reconstruction stage timing", { requestId: c.get("requestId"), stage, durationMs });
  }
}

app.get("/health", (c) => {
  const response = HealthResponseSchema.parse({ ok: true, version: process.env.APP_VERSION ?? "0.1.0" });
  return c.json(response);
});

app.post("/reconstruct", async (c) => {
  const requestId = c.get("requestId");
  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  if (contentLength > 2_200_000) return apiError(c, "TOO_LONG", "The recording must be 2 MB or smaller.", 413, false, requestId);

  if (!bearerToken(c)) return apiError(c, "UNAUTHORIZED", "Sign in to process a recording.", 401, false, requestId);

  let body: Record<string, string | File>;
  try { body = await c.req.parseBody(); }
  catch { return apiError(c, "INVALID_INPUT", "Send the recording as multipart form data.", 400, false, requestId); }

  const audio = body.audio;
  const durationMs = Number(body.durationMs);
  const tone = body.tone;
  const languageMode = LanguageModeSchema.safeParse(body.languageMode ?? "auto");
  if (!(audio instanceof File) || !Number.isFinite(durationMs) || (tone !== "casual" && tone !== "professional") || !languageMode.success) {
    return apiError(c, "INVALID_INPUT", "The recording details are incomplete.", 400, false, requestId);
  }
  if (!audio.type.startsWith("audio/")) return apiError(c, "INVALID_INPUT", "Upload a supported audio recording.", 415, false, requestId);
  if (audio.size > 2 * 1024 * 1024) return apiError(c, "TOO_LONG", "The recording must be 2 MB or smaller.", 413, false, requestId);
  let names: string[] = [];
  try {
    const parsed = JSON.parse(typeof body.names === "string" ? body.names : "[]") as unknown;
    if (Array.isArray(parsed) && parsed.every((name) => typeof name === "string" && name.length <= 60)) names = parsed.slice(0, 30);
    else return apiError(c, "INVALID_INPUT", "Names must be a list of up to 30 short text values.", 400, false, requestId);
  } catch {
    return apiError(c, "INVALID_INPUT", "Names must be valid JSON.", 400, false, requestId);
  }

  const access = await sentenceAccess(c);
  if (access instanceof Response) return access;
  const { auth, allowance } = access;

  let result;
  try {
    result = await reconstruct({ audio, durationMs, tone, languageMode: languageMode.data, names });
  } catch (error) {
    // Upstream and server failures are worth a look; a silent or too-short recording isn't.
    if (!(error instanceof PipelineError) || error.status >= 500) reportError(error, "reconstruct", requestId);
    if (error instanceof PipelineError) return apiError(c, error.code, error.message, error.status, error.retryable, requestId);
    return apiError(c, "INTERNAL", "The recording could not be processed.", 500, true, requestId);
  }

  // Only a sentence that came back counts. If counting fails the sentence is
  // still returned: it's already been made, and re-recording would cost more.
  try {
    if (!(await measured(c, "meter", () => recordSentence(auth.userId)))) return apiError(c, "QUOTA_EXCEEDED", "You've just used your last sentence on this plan.", 429, false, requestId);
  } catch (error) {
    if (!(error instanceof SupabaseUnavailable)) throw error;
    console.error("Sentence not counted", { requestId });
    reportError(error, "count-sentence", requestId);
  }
  result.quota = { reconstructionsLeft: Math.max(0, allowance.left - 1), windowLeft: allowance.windowLeft === null ? null : Math.max(0, allowance.windowLeft - 1) };
  pipelineTiming(c, result.timings);
  return c.json(result);
});

app.post("/reconstruct/text", async (c) => {
  const requestId = c.get("requestId");
  if (!bearerToken(c)) return apiError(c, "UNAUTHORIZED", "Sign in to rebuild a corrected sentence.", 401, false, requestId);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  const tone = body?.tone;
  if (!transcript || transcript.length > 2000 || (tone !== "casual" && tone !== "professional")) {
    return apiError(c, "INVALID_INPUT", "Enter a transcript between 1 and 2,000 characters and choose a tone.", 400, false, requestId);
  }
  let names: string[] = [];
  if (body?.names !== undefined) {
    if (!Array.isArray(body.names) || !body.names.every((name) => typeof name === "string" && name.length <= 60) || body.names.length > 30) {
      return apiError(c, "INVALID_INPUT", "Names must be a list of up to 30 short text values.", 400, false, requestId);
    }
    names = body.names as string[];
  }

  const access = await sentenceAccess(c);
  if (access instanceof Response) return access;
  const { auth, allowance } = access;

  let result;
  try { result = await reconstructTranscript({ transcript, tone, names }); }
  catch (error) {
    if (!(error instanceof PipelineError) || error.status >= 500) reportError(error, "reconstruct-correction", requestId);
    if (error instanceof PipelineError) return apiError(c, error.code, error.message, error.status, error.retryable, requestId);
    return apiError(c, "INTERNAL", "The corrected sentence could not be rebuilt.", 500, true, requestId);
  }
  try {
    if (!(await measured(c, "meter", () => recordSentence(auth.userId)))) return apiError(c, "QUOTA_EXCEEDED", "You've just used your last sentence on this plan.", 429, false, requestId);
  } catch (error) {
    if (!(error instanceof SupabaseUnavailable)) throw error;
    console.error("Corrected sentence not counted", { requestId });
    reportError(error, "count-corrected-sentence", requestId);
  }
  result.quota = { reconstructionsLeft: Math.max(0, allowance.left - 1), windowLeft: allowance.windowLeft === null ? null : Math.max(0, allowance.windowLeft - 1) };
  pipelineTiming(c, result.timings);
  return c.json(result);
});

app.post("/agent/ticket", async (c) => {
  const auth = await authenticate(c, "Sign in to use Speak for me.");
  if (auth instanceof Response) return auth;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const result = await issueAgentTicket(auth.userId, body ?? {});
    if (!result.ok) return apiError(c, result.code, result.message, result.status, false, c.get("requestId"));
    return c.json({ ticket: result.ticket, maxSeconds: result.maxSeconds });
  } catch (error) {
    if (error instanceof SupabaseUnavailable) return apiError(c, "INTERNAL", "Your plan couldn't be checked. Try again.", 503, true, c.get("requestId"));
    throw error;
  }
});

app.post("/sessions", async (c) => {
  const auth = await authenticate(c, "Sign in to save your sessions.");
  if (auth instanceof Response) return auth;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  return sessionResponse(c, () => startSession(auth.userId, body ?? {}), 201);
});

app.post("/sessions/:id/end", async (c) => {
  const auth = await authenticate(c, "Sign in to save your sessions.");
  if (auth instanceof Response) return auth;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  return sessionResponse(c, () => endSession(auth.userId, c.req.param("id"), body ?? {}), 200);
});

app.post("/internal/agent/admitted", async (c) => {
  const serviceKey = process.env.AGENT_SERVICE_KEY;
  const given = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!serviceKey || given !== serviceKey) return apiError(c, "FORBIDDEN", "Agents only.", 403, false, c.get("requestId"));
  const body = (await c.req.json().catch(() => null)) as { ticket?: unknown } | null;
  try {
    const result = await recordAdmission(body?.ticket);
    if (!result.ok) return apiError(c, "INVALID_INPUT", result.message, 400, false, c.get("requestId"));
    return c.json({ allowed: result.allowed });
  } catch (error) {
    if (error instanceof SupabaseUnavailable) return apiError(c, "INTERNAL", "Usage couldn't be recorded.", 503, true, c.get("requestId"));
    throw error;
  }
});

app.notFound((c) => {
  const body = ApiErrorSchema.parse({
    error: { code: "NOT_FOUND", message: "The requested resource was not found.", retryable: false, requestId: c.get("requestId") },
  });
  return c.json(body, 404);
});

app.onError((error, c) => {
  const body = ApiErrorSchema.parse({
    error: { code: "INTERNAL", message: "The request could not be completed.", retryable: false, requestId: c.get("requestId") },
  });
  console.error("Unhandled API error", { requestId: c.get("requestId"), name: error.name });
  reportError(error, "api", c.get("requestId"));
  return c.json(body, 500);
});

export default app;

async function sessionResponse<T>(c: Context, run: () => Promise<SessionResult<T>>, okStatus: 200 | 201) {
  try {
    const result = await run();
    if (!result.ok) return apiError(c, result.status === 404 ? "NOT_FOUND" : "INVALID_INPUT", result.message, result.status, false, c.get("requestId"));
    return c.json(result.value, okStatus);
  } catch (error) {
    if (error instanceof SupabaseUnavailable) return apiError(c, "INTERNAL", "Your session history couldn't be saved.", 503, true, c.get("requestId"));
    throw error;
  }
}

/** Extract the bearer token without trusting its claims. */
function bearerToken(c: Context) { return c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]; }

/** Auth and user-scoped quota reads overlap; neither can authorize speech by itself. */
async function sentenceAccess(c: Context) {
  const token = bearerToken(c)!;
  const [auth, quota] = await Promise.allSettled([
    measured(c, "auth", () => authenticate(c, "Sign in to process speech.")),
    measured(c, "quota", () => checkSentenceAllowanceForToken(token)),
  ]);
  if (auth.status === "rejected") throw auth.reason;
  if (auth.value instanceof Response) return auth.value;
  if (quota.status === "rejected") {
    if (quota.reason instanceof SupabaseUnavailable) return apiError(c, "INTERNAL", "Your plan couldn't be checked. Try again.", 503, true, c.get("requestId"));
    throw quota.reason;
  }
  const allowance = quota.value;
  if (!allowance.ok) {
    if (allowance.code === "CONFLICT") return apiError(c, "CONFLICT", allowance.message, 409, false, c.get("requestId"));
    c.header("Retry-After", String(allowance.retryAfterSeconds));
    return apiError(c, "QUOTA_EXCEEDED", allowance.message, 429, false, c.get("requestId"));
  }
  return { auth: auth.value, allowance };
}

/** The signed-in user, or the error response to return. */
async function authenticate(c: Context, signedOutMessage: string): Promise<{ userId: string } | Response> {
  const requestId = c.get("requestId");
  const token = bearerToken(c);
  if (!token) return apiError(c, "UNAUTHORIZED", signedOutMessage, 401, false, requestId);
  try {
    const user = await userFromToken(token);
    if (!user) return apiError(c, "UNAUTHORIZED", "Your sign-in session expired. Sign in again.", 401, false, requestId);
    return { userId: user.id };
  } catch (error) {
    if (error instanceof SupabaseUnavailable) return apiError(c, "INTERNAL", "Authentication service is temporarily unavailable.", 503, true, requestId);
    throw error;
  }
}

function apiError(c: Context, code: ApiErrorCode, message: string, status: number, retryable: boolean, requestId: string) {
  const body = ApiErrorSchema.parse({ error: { code, message, retryable, requestId } });
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504);
}
