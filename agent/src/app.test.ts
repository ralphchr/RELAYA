import { afterEach, describe, expect, it, vi } from "vitest";
import { signTicket } from "@relaya/agent-ticket";
import { createApp } from "./app.js";
import type { AgentDeps, MeetingHandle } from "./server/sessions.js";
import type { SpeakResult } from "./meet/speak.js";

const speech = { samples: new Float32Array(10), sampleRate: 24000, durationMs: 1200 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeDeps(outcome: MeetingHandle["outcome"] = "admitted") {
  let admit: () => void = () => undefined;
  let finishSpeaking: (r: SpeakResult) => void = () => undefined;
  const meeting = {
    outcome,
    speak: vi.fn(() => new Promise<SpeakResult>((resolve) => { finishSpeaking = resolve; })),
    stop: vi.fn(async () => { finishSpeaking("stopped"); }),
    inCall: vi.fn(async () => true),
    leave: vi.fn(async () => undefined),
  };
  const deps: AgentDeps = {
    openMeeting: ({ onStatus }) => new Promise((resolve) => { onStatus("waiting_host"); admit = () => resolve(meeting); }),
    synthesize: vi.fn(async function* () { yield speech; }),
  };
  return { deps, meeting, admit: () => admit(), finish: (r: SpeakResult) => finishSpeaking(r) };
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const join = { agentSessionId: "s-123456789", meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Angel's Relaya (AI)" };

afterEach(() => vi.useRealTimers());

describe("agent API", () => {
  it("returns the identity failure and closes the meeting page", async () => {
    const f = fakeDeps("failed");
    Object.assign(f.meeting, { reason: "bot_name_mismatch", detail: "Change the bot's Google name." });
    const { app } = createApp(f.deps);
    await app.request("/sessions", json(join));
    f.admit(); await flush(); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "failed", reason: "bot_name_mismatch", detail: "Change the bot's Google name." });
    expect(f.meeting.leave).toHaveBeenCalled();
  });
  it("answers the health check", async () => {
    const { app } = createApp(fakeDeps().deps);
    expect(await (await app.request("/healthz")).json()).toMatchObject({ ok: true, service: "relaya-agent" });
  });

  it("joins, waits for the host, prepares, speaks, stops and leaves", async () => {
    const f = fakeDeps();
    const openMeeting = vi.spyOn(f.deps, "openMeeting");
    const { app } = createApp(f.deps);
    expect((await app.request("/sessions", json(join))).status).toBe(201);
    expect(openMeeting).toHaveBeenCalledWith(expect.objectContaining({ displayName: "RELAYA AI" }));
    await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "waiting_host" });

    f.admit(); await flush(); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "admitted" });

    const prepared = await (await app.request("/sessions/s-123456789/utterances", json({ text: "We'll probably finish next week." }))).json() as { utteranceId: string; durationMs: number };
    expect(prepared.durationMs).toBe(1200);

    expect((await app.request(`/sessions/s-123456789/utterances/${prepared.utteranceId}/play`, { method: "POST" })).status).toBe(202);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "speaking", playing: prepared.utteranceId });
    expect((await app.request(`/sessions/s-123456789/utterances/${prepared.utteranceId}/play`, { method: "POST" })).status).toBe(409);

    await app.request("/sessions/s-123456789/stop", { method: "POST" }); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "admitted", playing: null, lastPlayback: { utteranceId: prepared.utteranceId, result: "stopped" } });

    expect((await app.request("/sessions/s-123456789", { method: "DELETE" })).status).toBe(204);
    expect(f.meeting.leave).toHaveBeenCalled();
    expect((await app.request("/sessions/s-123456789")).status).toBe(404);
  });

  it("reports a declined join and leaves the page", async () => {
    const f = fakeDeps("declined");
    const { app } = createApp(f.deps);
    await app.request("/sessions", json(join));
    f.admit(); await flush(); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "declined" });
    expect(f.meeting.leave).toHaveBeenCalled();
  });

  it("refuses to speak before it is admitted", async () => {
    const { app } = createApp(fakeDeps().deps);
    await app.request("/sessions", json(join));
    expect((await app.request("/sessions/s-123456789/utterances", json({ text: "Hi" }))).status).toBe(409);
  });

  it("a new join replaces the previous session (one agent per laptop)", async () => {
    const f = fakeDeps();
    const { app } = createApp(f.deps);
    await app.request("/sessions", json(join));
    f.admit(); await flush(); await flush();
    await app.request("/sessions", json({ ...join, agentSessionId: "s-987654321" }));
    expect((await app.request("/sessions/s-123456789")).status).toBe(404);
    expect(f.meeting.leave).toHaveBeenCalled();
  });

  it("validates input and only accepts Google Meet", async () => {
    const { app } = createApp(fakeDeps().deps);
    expect((await app.request("/sessions", json({ meetingUrl: "x" }))).status).toBe(400);
    expect((await app.request("/sessions", json({ ...join, meetingUrl: "https://zoom.us/j/123456789" }))).status).toBe(422);
  });

  it("allows only the web app's origins, including from https (private network access)", async () => {
    const { app } = createApp(fakeDeps().deps, { allowedOrigins: ["http://127.0.0.1:5173"] });
    const ok = await app.request("/healthz", { headers: { Origin: "http://127.0.0.1:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(ok.headers.get("access-control-allow-private-network")).toBe("true");
    const preflight = await app.request("/sessions", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");
    const bad = await app.request("/healthz", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("leaving on its own", () => {
  it("closes the browser and reports why when the host removes it", async () => {
    vi.useFakeTimers();
    const f = fakeDeps();
    const { app } = createApp(f.deps);
    await app.request("/sessions", json(join));
    f.admit(); await vi.advanceTimersByTimeAsync(0);
    f.meeting.inCall.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "left", detail: expect.stringMatching(/removed/) });
    expect(f.meeting.leave).toHaveBeenCalled();
    expect((await app.request("/sessions/s-123456789/utterances", json({ text: "Hello" }))).status).toBe(409);
  });

  it("leaves when its time is up", async () => {
    vi.useFakeTimers();
    const f = fakeDeps();
    const { app } = createApp(f.deps, { defaultMaxSeconds: 60 });
    await app.request("/sessions", json(join));
    f.admit(); await vi.advanceTimersByTimeAsync(59_000);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "admitted" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "left", detail: expect.stringMatching(/time limit/) });
    expect(f.meeting.leave).toHaveBeenCalled();
  });
});

describe("tickets", () => {
  const SECRET = "agent-ticket-secret-for-tests-0123456789";
  const ticketFor = async (meetingUrl = join.meetingUrl, maxSeconds = 1800) =>
    (await signTicket({ sub: "user-1", meetingUrl, maxSeconds }, SECRET)).ticket;

  it("needs a valid ticket for this meeting, once", async () => {
    const { app } = createApp(fakeDeps().deps, { ticketSecret: SECRET });
    expect((await app.request("/sessions", json(join))).status).toBe(401);
    expect((await app.request("/sessions", json({ ...join, ticket: "forged.ticket" }))).status).toBe(401);
    expect((await app.request("/sessions", json({ ...join, ticket: await ticketFor("https://meet.google.com/xyz-abcd-efg") }))).status).toBe(403);

    const ticket = await ticketFor();
    // The same meeting written differently still matches.
    expect((await app.request("/sessions", json({ ...join, meetingUrl: "https://meet.google.com/abc-defg-hij?authuser=1", ticket }))).status).toBe(201);
    expect((await app.request("/sessions", json({ ...join, agentSessionId: "s-other-1234", ticket }))).status).toBe(409);
  });

  it("reports the admission and leaves if the user is out of sessions", async () => {
    const f = fakeDeps();
    const reportAdmission = vi.fn(async () => false);
    const { app } = createApp(f.deps, { ticketSecret: SECRET, reportAdmission });
    const ticket = await ticketFor();
    await app.request("/sessions", json({ ...join, ticket }));
    f.admit(); await flush(); await flush(); await flush();
    expect(reportAdmission).toHaveBeenCalledWith(ticket);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "left", detail: expect.stringMatching(/sessions/) });
    expect(f.meeting.leave).toHaveBeenCalled();
  });

  it("stays in the meeting if usage can't be reported", async () => {
    const f = fakeDeps();
    const { app } = createApp(f.deps, { ticketSecret: SECRET, reportAdmission: async () => { throw new Error("API down"); } });
    await app.request("/sessions", json({ ...join, ticket: await ticketFor() }));
    f.admit(); await flush(); await flush(); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "admitted" });
  });

  it("uses the ticket's time limit", async () => {
    vi.useFakeTimers();
    const f = fakeDeps();
    const { app } = createApp(f.deps, { ticketSecret: SECRET });
    await app.request("/sessions", json({ ...join, ticket: await ticketFor(join.meetingUrl, 30) }));
    f.admit(); await vi.advanceTimersByTimeAsync(31_000);
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "left" });
  });
});

describe("voice", () => {
  it("speaks with the chosen voice and speed", async () => {
    const f = fakeDeps();
    const { app } = createApp(f.deps);
    await app.request("/sessions", json({ ...join, voice: "bm_george", speed: 1.1 }));
    f.admit(); await flush(); await flush();
    await app.request("/sessions/s-123456789/utterances", json({ text: "Hello" }));
    expect(f.deps.synthesize).toHaveBeenCalledWith("Hello", "bm_george", 1.1);
    expect((await app.request("/sessions", json({ ...join, agentSessionId: "s-fast-12345", speed: 3 }))).status).toBe(400);
  });
});

describe("turned away", () => {
  it("says when it's because the bot's Google sign-in expired", async () => {
    const f = fakeDeps("blocked");
    Object.assign(f.meeting, { reason: "bot_signed_out", detail: "The bot's Google sign-in expired." });
    const { app } = createApp(f.deps, { googleSignIn: () => "signed_out" });
    await app.request("/sessions", json(join));
    f.admit(); await flush(); await flush();
    expect(await (await app.request("/sessions/s-123456789")).json()).toMatchObject({ status: "blocked", reason: "bot_signed_out" });
    expect(await (await app.request("/healthz")).json()).toMatchObject({ googleSignIn: "signed_out" });
  });
});
