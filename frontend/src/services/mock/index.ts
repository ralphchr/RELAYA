import type { AgentStatus } from "@relaya/contracts";
import type { AgentService, PipelineService, Services, SessionsService } from "../types.js";
import { ServiceError } from "../types.js";
import { scriptedReconstruction } from "./scenario.js";
import { account, userData } from "../account.js";
import { localSessions } from "../localData.js";
import { sessionTitle } from "../sessionTitle.js";
import { createRecorder } from "../../features/session/capture/recorder.js";

/*
 * Local stand-ins for the API and the agent service. They keep the same timing
 * shape as the real thing so every loading and waiting state is visible.
 *
 * Dev switch: open any page with ?mockAgent=declined|timeout|blocked|failed|
 * quota|offline to see that failure on the next Join Meeting, or
 * ?mockAgent=left to have the agent drop out of the call 8 s into the session,
 * or ?mockAgent=voicefail to have its voice fail to prepare.
 * The tab remembers it; ?mockAgent=off clears it.
 *
 * ?mockQuota=low shows the "few sentences left" warning, ?mockQuota=window
 * and ?mockQuota=month the free plan's 6-hour and monthly limits on the next
 * recording. ?mockQuota=off clears it.
 */

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const sessions: SessionsService = {
  async create(input) { await wait(150); return { id: localSessions.start({ ...input, title: sessionTitle(input.mode) }) }; },
  // Save first: when the tab is closing there's no time to wait.
  async end(id, stats) { localSessions.end(id, stats); await wait(100); },
};

/** A ?name= dev switch the tab remembers until ?name=off. */
function devSwitch(name: string): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(name);
    if (fromUrl) sessionStorage.setItem(`relaya.${name}`, fromUrl);
    const value = sessionStorage.getItem(`relaya.${name}`);
    return value === "off" ? null : value;
  } catch { return null; }
}
devSwitch("mockQuota");

const pipeline: PipelineService = {
  async reconstruct(input, signal) {
    if (input.durationMs < 400) throw new ServiceError("TOO_SHORT", "That was too short.");
    const quota = devSwitch("mockQuota");
    if (quota === "month") {
      await wait(300, signal);
      throw new ServiceError("QUOTA_EXCEEDED", "You've used all 60 sentences on your plan this month. They come back on Nov 1.", false, 12 * 24 * 3_600_000);
    }
    if (quota === "window") {
      await wait(300, signal);
      throw new ServiceError("QUOTA_EXCEEDED", "You've used 15 sentences in the last 6 hours, the most your plan allows. Your next one opens in 47 min.", false, 47 * 60_000);
    }
    await wait(1100, signal);
    const result = scriptedReconstruction(newId());
    return quota === "low" ? { ...result, quota: { reconstructionsLeft: 3, windowLeft: 14 } } : result;
  },
  async reconstructTranscript(input, signal) {
    await wait(500, signal);
    const result = scriptedReconstruction(newId());
    const transcript = input.transcript.trim();
    // Preview mode has no language model; return the corrected literal and
    // mark it unsure rather than implying that a mock rewrite was generated.
    return {
      ...result,
      transcript,
      sentence: { ...result.sentence, text: transcript, literal: transcript, wordCount: transcript.split(/\s+/).length },
      guard: { ...result.guard, status: "unsure", risk: "low", needsVerify: false, issues: [], kept: [] },
      quota: { reconstructionsLeft: result.quota.reconstructionsLeft === null ? null : Math.max(0, result.quota.reconstructionsLeft - 1), windowLeft: result.quota.windowLeft === null ? null : Math.max(0, result.quota.windowLeft - 1) },
    };
  },
};

let playback: ReturnType<typeof setTimeout> | undefined;
const FAIL_OUTCOMES: AgentStatus[] = ["declined", "timeout", "blocked", "failed"];

const mockAgentParam = () => devSwitch("mockAgent");
mockAgentParam();
/** The switch seen at join time; the session page's URL no longer has it. */
let joinedWith: string | null = null;

const agent: AgentService = {
  join(_input, onStatus) {
    const forced = mockAgentParam();
    joinedWith = forced;
    if (forced === "quota" || forced === "offline") {
      const problem = forced === "quota"
        ? { kind: "quota" as const, message: "You've used all 8 Speak for me sessions this month." }
        : { kind: "agent_offline" as const, message: "Relaya's meeting agent isn't running. Start it, then ask again." };
      const timer = setTimeout(() => onStatus("failed", problem), 900);
      return { agentSessionId: newId(), cancel: () => clearTimeout(timer) };
    }
    const outcome: AgentStatus = forced && FAIL_OUTCOMES.includes(forced as AgentStatus) ? forced as AgentStatus : "admitted";
    const timers = [
      setTimeout(() => onStatus("preparing"), 0),
      setTimeout(() => onStatus("waiting_host"), 1600),
      setTimeout(() => onStatus(outcome), 3400),
    ];
    return { agentSessionId: newId(), cancel: () => timers.forEach(clearTimeout) };
  },
  async prepare(_id, text) {
    await wait(700);
    if (joinedWith === "voicefail") throw new Error("Voice unavailable.");
    return { textHash: String(text.length) };
  },
  play(_id, _hash, onEnded) {
    playback = setTimeout(onEnded, 5200);
  },
  watch(_id, onLeft) {
    if (joinedWith !== "left") return () => undefined;
    const timer = setTimeout(onLeft, 8000);
    return () => clearTimeout(timer);
  },
  stop() { clearTimeout(playback); },
  leave() { clearTimeout(playback); },
};
export const mockServices: Services = {
  createRecorder,
  account,
  data: userData,
  sessions,
  pipeline,
  agent,
};
