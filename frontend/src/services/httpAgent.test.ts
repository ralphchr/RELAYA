import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpAgent } from "./httpAgent.js";

const AGENT = "http://agent.test";
const API = { base: "http://api.test/api", token: () => "token" };
const join = { meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Angel's Relaya (AI)", consent: true };

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
let route: Route;
let calls: { url: string; body: unknown }[];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const view = (status: string) => json({ agentSessionId: "x", status, detail: null, playing: null, lastPlayback: null });

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    calls.push({ url: input, body: init.body ? JSON.parse(String(init.body)) : null });
    return route(input, init);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("http agent join", () => {
  it("gets a ticket, hands it to the agent and follows the status", async () => {
    let polls = 0;
    route = (url) => url.endsWith("/agent/ticket") ? json({ ticket: "T", maxSeconds: 1800 })
      : url.endsWith("/sessions") ? json({}, 201)
      : view(++polls < 2 ? "waiting_host" : "admitted");
    const statuses: string[] = [];
    createHttpAgent(AGENT, { api: API }).join(join, (s) => statuses.push(s));
    await vi.advanceTimersByTimeAsync(2500);
    expect(statuses).toEqual(["preparing", "waiting_host", "admitted"]);
    expect(calls[0]).toEqual({ url: "http://api.test/api/agent/ticket", body: { meetingUrl: join.meetingUrl, consent: true } });
    expect(calls[1]?.body).toMatchObject({ ticket: "T", meetingUrl: join.meetingUrl });
  });

  it("explains a used-up plan without asking the agent", async () => {
    route = () => json({ error: { code: "QUOTA_EXCEEDED", message: "You've used all 8 Speak for me sessions this month.", retryable: false, requestId: "r" } }, 429);
    const onStatus = vi.fn();
    createHttpAgent(AGENT, { api: API }).join(join, onStatus);
    await vi.advanceTimersByTimeAsync(10);
    expect(onStatus).toHaveBeenLastCalledWith("failed", { kind: "quota", message: "You've used all 8 Speak for me sessions this month." });
    expect(calls.some((c) => c.url.startsWith(AGENT))).toBe(false);
  });

  it("says when the agent isn't running", async () => {
    route = (url) => { if (url.startsWith(AGENT)) throw new TypeError("Failed to fetch"); return json({ ticket: null, maxSeconds: 60 }); };
    const onStatus = vi.fn();
    createHttpAgent(AGENT, { api: API }).join(join, onStatus);
    await vi.advanceTimersByTimeAsync(10);
    expect(onStatus).toHaveBeenLastCalledWith("failed", expect.objectContaining({ kind: "agent_offline" }));
  });

  it("asks for no ticket without an API", async () => {
    route = (url) => url.endsWith("/sessions") ? json({}, 201) : view("admitted");
    createHttpAgent(AGENT).join(join, () => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls[0]?.url).toBe(`${AGENT}/sessions`);
  });
});

describe("http agent turned away", () => {
  it.each(["bot_name_mismatch", "bot_name_unverified"])("preserves %s and its correction instructions", async (reason) => {
    route = (url) => url.endsWith("/sessions") ? json({}, 201)
      : json({ agentSessionId: "x", status: "failed", detail: "Check the bot profile.", playing: null, lastPlayback: null, reason });
    const onStatus = vi.fn();
    createHttpAgent(AGENT).join(join, onStatus);
    await vi.advanceTimersByTimeAsync(10);
    expect(onStatus).toHaveBeenLastCalledWith("failed", { kind: reason, message: "Check the bot profile." });
  });
  it("names an expired bot sign-in", async () => {
    route = (url) => url.endsWith("/sessions") ? json({}, 201)
      : json({ agentSessionId: "x", status: "blocked", detail: "expired", playing: null, lastPlayback: null, reason: "bot_signed_out" });
    const onStatus = vi.fn();
    createHttpAgent(AGENT).join(join, onStatus);
    await vi.advanceTimersByTimeAsync(10);
    expect(onStatus).toHaveBeenLastCalledWith("failed", expect.objectContaining({ kind: "bot_signed_out" }));
  });
});

describe("http agent watch", () => {
  it("reports once when the agent leaves the call", async () => {
    let status = "admitted";
    route = () => view(status);
    const onLeft = vi.fn();
    createHttpAgent(AGENT).watch("s-1", onLeft);
    await vi.advanceTimersByTimeAsync(3100);
    expect(onLeft).not.toHaveBeenCalled();
    status = "left";
    await vi.advanceTimersByTimeAsync(9000);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it("treats an unreachable agent as gone after a few tries", async () => {
    route = () => { throw new TypeError("Failed to fetch"); };
    const onLeft = vi.fn();
    createHttpAgent(AGENT).watch("s-1", onLeft);
    await vi.advanceTimersByTimeAsync(6100);
    expect(onLeft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it("stays quiet after the user leaves on purpose", async () => {
    route = (url, init) => init.method === "DELETE" ? new Response(null, { status: 204 }) : json({ error: { message: "No such session" } }, 404);
    const onLeft = vi.fn();
    const agent = createHttpAgent(AGENT);
    agent.watch("s-1", onLeft);
    agent.leave("s-1");
    await vi.advanceTimersByTimeAsync(9000);
    expect(onLeft).not.toHaveBeenCalled();
  });
});
