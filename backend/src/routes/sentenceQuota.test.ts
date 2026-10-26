import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../app.js";

interface Db { left: number; used: number; windowLeft: number | null; oldest: string; consumeAllowed: boolean; sttText: string }
let db: Db;
let consumed: number;

const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
const draft = {
  sentence: "We will finish next week.", hedgedSentence: "We will finish next week.", languages: ["en"],
  facts: { numbers: [], dates: ["next week"], names: [], negations: [], hedges: [], commitments: [] },
  confidence: 0.95, unresolvedTerms: [],
};

function fakeUpstream(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const auth = new Headers(init?.headers).get("Authorization");
  if (url.pathname === "/auth/v1/user") return auth === "Bearer good-token" ? json({ id: "user-1" }) : json({}, 401);
  if (url.pathname === "/rest/v1/v_usage_current") {
    return json([{ plan_id: "free", period_end: "2026-11-03T00:00:00Z", reconstructions_used: db.used, reconstructions_left: db.left, window_reconstructions_left: db.windowLeft, window_hours: db.windowLeft === null ? null : 6 }]);
  }
  if (url.pathname === "/rest/v1/usage_ledger") return json([{ occurred_at: db.oldest }]);
  if (url.pathname === "/rest/v1/plans") return json([{ window_reconstructions: 15 }]);
  if (url.pathname === "/rest/v1/rpc/consume_usage") { if (db.consumeAllowed) consumed += 1; return json(db.consumeAllowed); }
  if (url.pathname.endsWith("/audio/transcriptions")) return json({ text: db.sttText });
  if (url.pathname.endsWith("/chat/completions")) return json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
  return json({ message: "unexpected" }, 500);
}

function record(languageMode?: string) {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array(2000)], "a.webm", { type: "audio/webm" }));
  form.set("durationMs", "2000");
  form.set("tone", "professional");
  form.set("names", "[]");
  if (languageMode !== undefined) form.set("languageMode", languageMode);
  return app.request("/api/reconstruct", { method: "POST", headers: { Authorization: "Bearer good-token" }, body: form });
}

function correctTranscript(transcript = "I meant the refund is not ready.") {
  return app.request("/api/reconstruct/text", {
    method: "POST",
    headers: { Authorization: "Bearer good-token", "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, tone: "professional", names: [] }),
  });
}

beforeEach(() => {
  db = { left: 40, used: 20, windowLeft: 10, oldest: new Date(Date.now() - 5 * 3_600_000).toISOString(), consumeAllowed: true, sttText: "Ma-finish namo next week." };
  consumed = 0;
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("GROQ_API_KEY", "groq-key");
  vi.stubGlobal("fetch", vi.fn(fakeUpstream));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sentence limits on /api/reconstruct", () => {
  it.each(["japanese_english", "mandarin_english", "spanish_english"])("accepts the %s preference through the HTTP endpoint", async (mode) => {
    const response = await record(mode);
    expect(response.status).toBe(200);
    expect(consumed).toBe(1);
  });

  it("rejects an unknown language preference before calling the pipeline or checking quota", async () => {
    const response = await record("unsupported_language");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(consumed).toBe(0);
  });

  it("overlaps Auth and the RLS quota read but waits for both before speech processing", async () => {
    let releaseAuth: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith("/auth/v1/user")
      ? new Promise<Response>((resolve) => { releaseAuth = resolve; }) : fakeUpstream(url, init));
    const pending = record();
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("v_usage_current"))).toBe(true));
    const quotaCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("v_usage_current"));
    expect(new Headers(quotaCall?.[1]?.headers).get("Authorization")).toBe("Bearer good-token");
    expect(String(quotaCall?.[0])).not.toContain("user_id=");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("groq"))).toBe(false);
    releaseAuth(new Response(JSON.stringify({ id: "user-1" }), { status: 200 }));
    expect((await pending).status).toBe(200);
    expect(consumed).toBe(1);
  });

  it("refuses an invalid token even if the concurrent quota lookup appears allowed", async () => {
    vi.mocked(fetch).mockImplementation((url, init) => String(url).endsWith("/auth/v1/user") ? json({}, 401) : fakeUpstream(url, init));
    const response = await record();
    expect(response.status).toBe(401);
    expect(consumed).toBe(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("groq"))).toBe(false);
  });

  it("does not process speech when the user-scoped quota read is unavailable", async () => {
    vi.mocked(fetch).mockImplementation((url, init) => String(url).includes("v_usage_current") ? json({}, 503) : fakeUpstream(url, init));
    const response = await record();
    expect(response.status).toBe(503);
    expect(consumed).toBe(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("groq"))).toBe(false);
  });

  it("counts a sentence and reports what's left", async () => {
    const response = await record();
    expect(response.status).toBe(200);
    expect((await response.json() as { quota: unknown }).quota).toEqual({ reconstructionsLeft: 39, windowLeft: 9 });
    expect(consumed).toBe(1);
    expect(response.headers.get("Server-Timing")).toMatch(/transcription;dur=\d+, rewrite;dur=\d+, guard;dur=\d+, pipeline;dur=\d+, request;dur=\d+/);
  });

  it("rebuilds a corrected transcript and counts the rebuilt sentence", async () => {
    const response = await correctTranscript();
    expect(response.status).toBe(200);
    const result = await response.json() as { transcript: string; sentence: { literal: string }; quota: unknown };
    expect(result.transcript).toBe("I meant the refund is not ready.");
    expect(result.sentence.literal).toBe(result.transcript);
    expect(result.quota).toEqual({ reconstructionsLeft: 39, windowLeft: 9 });
    expect(consumed).toBe(1);
    expect(response.headers.get("Server-Timing")).toContain("transcription;dur=0");
  });

  it("refuses before speech recognition when the month is used up", async () => {
    db.left = 0; db.used = 60;
    const response = await record();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED", retryable: false, message: "You've used all 60 sentences on your plan this month. They come back on Nov 3." } });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("groq"))).toBe(false);
    expect(consumed).toBe(0);
  });

  it("says when the next sentence opens after the 6-hour limit", async () => {
    db.windowLeft = 0;
    const response = await record();
    expect(response.status).toBe(429);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/^You've used 15 sentences in the last 6 hours, the most your plan allows\. Your next one opens in (59 min|1 h)\.$/);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(3500);
  });

  it("has no 6-hour limit on plans without one", async () => {
    db.windowLeft = null;
    const response = await record();
    expect((await response.json() as { quota: unknown }).quota).toEqual({ reconstructionsLeft: 39, windowLeft: null });
  });

  it("doesn't count a recording with no speech", async () => {
    db.sttText = " ";
    const response = await record();
    expect(response.status).toBe(422);
    expect(consumed).toBe(0);
  });

  it("refuses when another request took the last sentence first", async () => {
    db.left = 1; db.consumeAllowed = false;
    const response = await record();
    expect(response.status).toBe(429);
  });
});
