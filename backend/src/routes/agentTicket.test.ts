import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTicket } from "@relaya/agent-ticket";
import app from "../app.js";

const SECRET = "ticket-secret-for-tests-0123456789abcdef";
const MEET = "https://meet.google.com/abc-defg-hij";

interface Db { consentedAt: string | null; sessionsLeft: number | null; secondsLeft: number; consumeAllowed: boolean }
let db: Db;
let calls: { method: string; path: string; body: unknown }[];

function fakeSupabase(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const path = url.pathname + url.search;
  calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
  const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
  const auth = new Headers(init?.headers).get("Authorization");
  if (url.pathname === "/auth/v1/user") return auth === "Bearer good-token" ? json({ id: "user-1" }) : json({}, 401);
  if (url.pathname === "/rest/v1/user_settings" && method === "GET") return json([{ agent_consented_at: db.consentedAt }]);
  if (url.pathname === "/rest/v1/user_settings" && method === "PATCH") { db.consentedAt = "now"; return Promise.resolve(new Response(null, { status: 204 })); }
  if (url.pathname === "/rest/v1/v_usage_current") {
    return json([{ agent_sessions_left: db.sessionsLeft, agent_sessions_total: 8, agent_seconds_left: db.secondsLeft, max_agent_session_minutes: 30 }]);
  }
  if (url.pathname === "/rest/v1/rpc/consume_usage") return json(db.consumeAllowed);
  return json({ message: "unexpected" }, 500);
}

const ticketRequest = (body: unknown, token = "good-token") => app.request("/api/agent/ticket", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  db = { consentedAt: "2026-10-01T00:00:00Z", sessionsLeft: 8, secondsLeft: 14_400, consumeAllowed: true };
  calls = [];
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("AGENT_TICKET_SECRET", SECRET);
  vi.stubEnv("AGENT_SERVICE_KEY", "agent-key");
  vi.stubGlobal("fetch", vi.fn(fakeSupabase));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("POST /api/agent/ticket", () => {
  it("signs a ticket for the normalized link without spending a session", async () => {
    const response = await ticketRequest({ meetingUrl: "meet.google.com/abc-defg-hij?authuser=0" });
    expect(response.status).toBe(200);
    const body = await response.json() as { ticket: string; maxSeconds: number };
    expect(body.maxSeconds).toBe(1800);
    expect(await verifyTicket(body.ticket, SECRET)).toMatchObject({ sub: "user-1", meetingUrl: MEET, maxSeconds: 1800 });
    expect(calls.some((c) => c.path.includes("consume_usage"))).toBe(false);
  });

  it("caps the meeting at the minutes left this month", async () => {
    db.secondsLeft = 600;
    const body = await (await ticketRequest({ meetingUrl: MEET })).json() as { maxSeconds: number };
    expect(body.maxSeconds).toBe(600);
  });

  it("needs a signed-in user", async () => {
    expect((await ticketRequest({ meetingUrl: MEET }, "bad-token")).status).toBe(401);
    const noToken = await app.request("/api/agent/ticket", { method: "POST", body: "{}" });
    expect(noToken.status).toBe(401);
  });

  it("asks for consent once, then records it", async () => {
    db.consentedAt = null;
    const refused = await ticketRequest({ meetingUrl: MEET });
    expect(refused.status).toBe(409);
    expect(await ticketRequest({ meetingUrl: MEET, consent: true })).toHaveProperty("status", 200);
    expect(calls.find((c) => c.method === "PATCH")?.body).toHaveProperty("agent_consented_at");
  });

  it("refuses when the plan is used up", async () => {
    db.sessionsLeft = 0;
    const response = await ticketRequest({ meetingUrl: MEET });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED", message: "You've used all 8 Speak for me sessions this month." } });
    db.sessionsLeft = 3; db.secondsLeft = 0;
    expect((await ticketRequest({ meetingUrl: MEET })).status).toBe(429);
  });

  it("rejects links that aren't Google Meet", async () => {
    expect((await ticketRequest({ meetingUrl: "https://zoom.us/j/123456789" })).status).toBe(422);
    expect((await ticketRequest({ meetingUrl: "not a link" })).status).toBe(400);
    expect((await ticketRequest({})).status).toBe(400);
  });

  it("checks the plan but signs nothing when the agent runs without a secret", async () => {
    vi.stubEnv("AGENT_TICKET_SECRET", "");
    const body = await (await ticketRequest({ meetingUrl: MEET })).json() as { ticket: string | null };
    expect(body.ticket).toBeNull();
  });
});

describe("POST /api/internal/agent/admitted", () => {
  const admitted = (body: unknown, key = "agent-key") => app.request("/api/internal/agent/admitted", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  it("spends one session for the ticket's user", async () => {
    const { ticket } = await (await ticketRequest({ meetingUrl: MEET })).json() as { ticket: string };
    const response = await admitted({ ticket });
    expect(await response.json()).toEqual({ allowed: true });
    expect(calls.find((c) => c.path.includes("consume_usage"))?.body).toEqual({ p_user_id: "user-1", p_kind: "agent_session", p_quantity: 1 });
  });

  it("tells the agent to leave when the user ran out meanwhile", async () => {
    const { ticket } = await (await ticketRequest({ meetingUrl: MEET })).json() as { ticket: string };
    db.consumeAllowed = false;
    expect(await (await admitted({ ticket })).json()).toEqual({ allowed: false });
  });

  it("only answers the agent, and only for real tickets", async () => {
    expect((await admitted({ ticket: "x" }, "wrong-key")).status).toBe(403);
    expect((await admitted({ ticket: "forged.ticket" })).status).toBe(400);
  });
});
