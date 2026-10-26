import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { TicketError, verifyTicket } from "@relaya/agent-ticket";
import { AgentJoinRequestSchema, AgentUtteranceRequestSchema } from "@relaya/contracts";
import { LinkParseError, parseMeetingLink } from "@relaya/link-parser";
import { DEFAULT_VOICE, isVoiceId } from "./audio/tts.js";
import { AgentError, SessionManager, type AgentDeps } from "./server/sessions.js";

/*
 * The Speak for me agent's local API. It runs on the presenter's laptop and only listens on 127.0.0.1. The
 * web app polls GET /sessions/:id for status instead of using a WebSocket.
 *
 *   POST   /sessions                          join a meeting
 *   GET    /sessions/:id                      status, what's playing
 *   POST   /sessions/:id/utterances           prepare a sentence (audio ready)
 *   POST   /sessions/:id/utterances/:uid/play speak it
 *   POST   /sessions/:id/stop                 cut it off
 *   DELETE /sessions/:id                      leave the meeting
 *
 * With a ticket secret, every join needs a ticket from POST /api/agent/ticket
 * (signed-in user, plan checked) and the agent stays at most `maxSeconds`.
 */
export interface AgentAppOptions {
  allowedOrigins?: string[];
  /** AGENT_TICKET_SECRET. Unset on a single dev laptop: joins need no ticket. */
  ticketSecret?: string | undefined;
  /** Tells the API the host admitted the agent; false means the user is out of sessions. */
  reportAdmission?: (ticket: string) => Promise<boolean>;
  /** Longest stay without a ticket. */
  defaultMaxSeconds?: number;
  /** The bot's Google sign-in as last checked, for /healthz. */
  googleSignIn?: () => string;
}

export function createApp(deps: AgentDeps, options: AgentAppOptions = {}) {
  const sessions = new SessionManager(deps);
  const usedTickets = new Map<string, number>();
  const allowed = options.allowedOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
  const app = new Hono();

  app.use("*", async (c, next) => {
    // For a preflight (OPTIONS) the cors middleware returns the response itself; it must be returned.
    const preflight = await cors({ origin: (origin) => (allowed.includes(origin) ? origin : ""), allowMethods: ["GET", "POST", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type"] })(c, next);
    // Lets the hosted (https) web app reach this laptop-local server in Chrome.
    if (allowed.includes(c.req.header("Origin") ?? "")) (preflight ?? c.res).headers.set("Access-Control-Allow-Private-Network", "true");
    return preflight;
  });

  const fail = (c: Context, error: unknown) => {
    if (error instanceof AgentError) return c.json({ error: { code: error.status === 404 ? "NOT_FOUND" : error.status === 409 ? "CONFLICT" : "INVALID_INPUT", message: error.message } }, error.status);
    console.error("Agent request failed", error);
    return c.json({ error: { code: "AGENT_UNAVAILABLE", message: error instanceof Error ? error.message : "The agent ran into a problem." } }, 503);
  };

  app.get("/healthz", (c) => c.json({ ok: true, service: "relaya-agent", version: process.env.APP_VERSION ?? "0.1.0", googleSignIn: options.googleSignIn?.() ?? "unknown" }));

  app.post("/sessions", async (c) => {
    const parsed = AgentJoinRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_INPUT", message: "Send agentSessionId, meetingUrl and displayName." } }, 400);
    const { ticket, ...input } = parsed.data;
    const voice = input.voice && isVoiceId(input.voice) ? input.voice : DEFAULT_VOICE;
    let meetingUrl: string;
    try {
      const link = parseMeetingLink(input.meetingUrl);
      if (link.platform !== "google_meet") throw new LinkParseError("UNSUPPORTED_PLATFORM", "Not Google Meet.");
      meetingUrl = link.normalizedUrl;
    } catch {
      return c.json({ error: { code: "UNSUPPORTED_PLATFORM", message: "Only Google Meet links are supported for now." } }, 422);
    }

    let maxSeconds = options.defaultMaxSeconds ?? 2 * 60 * 60;
    let onAdmitted: (() => Promise<boolean>) | undefined;
    if (options.ticketSecret) {
      if (!ticket) return c.json({ error: { code: "UNAUTHORIZED", message: "Sign in to Relaya to use Speak for me." } }, 401);
      try {
        const claims = await verifyTicket(ticket, options.ticketSecret);
        if (claims.meetingUrl !== meetingUrl) return c.json({ error: { code: "FORBIDDEN", message: "This ticket is for a different meeting." } }, 403);
        const now = Date.now();
        for (const [jti, exp] of usedTickets) if (exp * 1000 < now) usedTickets.delete(jti);
        if (usedTickets.has(claims.jti)) return c.json({ error: { code: "CONFLICT", message: "This ticket was already used." } }, 409);
        usedTickets.set(claims.jti, claims.exp);
        maxSeconds = claims.maxSeconds;
        if (options.reportAdmission) onAdmitted = () => options.reportAdmission!(ticket);
      } catch (error) {
        if (error instanceof TicketError) return c.json({ error: { code: "UNAUTHORIZED", message: "This join request expired. Try again." } }, 401);
        return fail(c, error);
      }
    }
    try { return c.json(await sessions.join({ ...input, meetingUrl, voice, maxSeconds, onAdmitted }), 201); } catch (error) { return fail(c, error); }
  });

  app.get("/sessions/:id", (c) => { try { return c.json(sessions.view(c.req.param("id"))); } catch (error) { return fail(c, error); } });

  app.post("/sessions/:id/utterances", async (c) => {
    const parsed = AgentUtteranceRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: "INVALID_INPUT", message: "Send the sentence as { text }." } }, 400);
    try { return c.json(await sessions.prepare(c.req.param("id"), parsed.data.text), 201); } catch (error) { return fail(c, error); }
  });

  app.post("/sessions/:id/utterances/:uid/play", (c) => {
    try { sessions.play(c.req.param("id"), c.req.param("uid")); return c.json({ ok: true }, 202); } catch (error) { return fail(c, error); }
  });

  app.post("/sessions/:id/stop", async (c) => { try { await sessions.stop(c.req.param("id")); return c.json({ ok: true }, 202); } catch (error) { return fail(c, error); } });

  app.delete("/sessions/:id", async (c) => { await sessions.leave(c.req.param("id")); return c.body(null, 204); });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }, 404));

  return { app, sessions };
}
