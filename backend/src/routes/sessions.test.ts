import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../app.js";

const SESSION_ID = "0b6f2c1e-1111-4222-8333-444455556666";
let calls: { method: string; path: string; body: Record<string, unknown> & { platform?: unknown } }[];
let stored: { mode: string; status: string; started_at: string } | null;

beforeEach(() => {
  calls = [];
  stored = { mode: "speak", status: "active", started_at: new Date(Date.now() - 600_000).toISOString() };
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: init.body ? JSON.parse(String(init.body)) : {} });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.pathname === "/auth/v1/user") return new Headers(init.headers).get("Authorization") === "Bearer good" ? json({ id: "user-1" }) : json({}, 401);
    if (url.pathname === "/rest/v1/call_sessions" && method === "POST") return json([{ id: SESSION_ID }], 201);
    if (url.pathname === "/rest/v1/call_sessions" && method === "GET") return json(stored ? [stored] : []);
    if (url.pathname === "/rest/v1/call_sessions" && method === "PATCH") return new Response(null, { status: 204 });
    if (method === "POST") return json([{ id: "x" }], 201);
    return json({}, 500);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const post = (path: string, body: unknown, token = "good") => app.request(`/api${path}`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const start = { mode: "speak", tone: "casual", title: "Speak for me · Oct 17, 9:00 AM", names: ["Ma. Cristina", "Davao"], meetingUrl: "https://meet.google.com/abc-defg-hij" };

describe("POST /api/sessions", () => {
  it("records the session for the signed-in user with a snapshot of the names", async () => {
    const response = await post("/sessions", start);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: SESSION_ID });
    expect(calls.find((c) => c.path.startsWith("/rest/v1/call_sessions"))?.body).toEqual({ user_id: "user-1", title: start.title, mode: "speak", tone: "casual", platform: "google_meet" });
    expect(calls.find((c) => c.path.startsWith("/rest/v1/session_names"))?.body).toEqual([
      { session_id: SESSION_ID, value: "Ma. Cristina", position: 0 }, { session_id: SESSION_ID, value: "Davao", position: 1 },
    ]);
  });

  it("validates the input and needs a sign-in", async () => {
    expect((await post("/sessions", { ...start, mode: "shout" })).status).toBe(400);
    expect((await post("/sessions", { ...start, names: Array(31).fill("x") })).status).toBe(400);
    expect((await post("/sessions", { ...start, title: "" })).status).toBe(400);
    expect((await post("/sessions", start, "bad")).status).toBe(401);
  });

  it("gives Say it yourself sessions no platform", async () => {
    await post("/sessions", { ...start, mode: "say", names: [] });
    expect(calls.find((c) => c.path.startsWith("/rest/v1/call_sessions"))?.body.platform).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/rest/v1/session_names"))).toBe(false);
  });
});

describe("POST /api/sessions/:id/end", () => {
  it("saves the counts and records Speak for me time as agent usage", async () => {
    const response = await post(`/sessions/${SESSION_ID}/end`, { approved: 4, edited: 2, usedAsIs: 1, rerecords: 3, extra: "ignored" });
    expect(response.status).toBe(200);
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toContain("user_id=eq.user-1");
    expect(patch.body).toMatchObject({ status: "ended", sentences_approved: 4, sentences_edited: 2, sentences_used_as_is: 1, rerecords: 3 });
    expect(patch.body.agent_seconds).toBeGreaterThanOrEqual(599);
    const usage = calls.find((c) => c.path.startsWith("/rest/v1/usage_ledger"))!;
    expect(usage.body).toMatchObject({ user_id: "user-1", session_id: SESSION_ID, kind: "agent_second" });
  });

  it("records no agent time for Say it yourself, and ignores bad counts", async () => {
    stored = { ...stored!, mode: "say" };
    await post(`/sessions/${SESSION_ID}/end`, { approved: -5, edited: "lots" });
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ agent_seconds: 0, sentences_approved: 0, sentences_edited: 0 });
    expect(calls.some((c) => c.path.startsWith("/rest/v1/usage_ledger"))).toBe(false);
  });

  it("is a no-op for an ended session and 404 for someone else's", async () => {
    stored = { ...stored!, status: "ended" };
    expect((await post(`/sessions/${SESSION_ID}/end`, {})).status).toBe(200);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    stored = null;
    expect((await post(`/sessions/${SESSION_ID}/end`, {})).status).toBe(404);
    expect((await post("/sessions/not-a-uuid/end", {})).status).toBe(404);
  });
});
