import type { GuardIssue, ReconstructResponse, SessionMode } from "@relaya/contracts";
import { copy } from "../../copy/en.js";
import { composeSentence } from "./compose.js";

/*
 * In-call panel state machine, written as a pure reducer.
 * Rules it enforces:
 *  - No English text is shown before the user releases push-to-talk.
 *  - Approve is the only path to delivery, and only with no open Context Guard issues.
 *  - Speak for me: approve also waits for prepared audio of the current text;
 *    any text change throws that audio away.
 */

export type Phase = "ready" | "recording" | "processing" | "review" | "unsure" | "delivering" | "done" | "error";
export type Resolution = "fixed" | "as_is";

export interface ActivityEntry { id: number; who: string; what: string; at: number }

export interface PanelContext { mode: SessionMode; firstName: string; agentName: string }

export interface PanelState {
  ctx: PanelContext;
  phase: Phase;
  recordingStartedAt: number | null;
  result: ReconstructResponse | null;
  /** The sentence that will be delivered. Changes with fixes and Use literal. */
  text: string;
  /** User corrections are local to this review and are never stored. */
  transcriptEdited: boolean;
  textEdited: boolean;
  editing: "transcript" | "output" | null;
  resolutions: Record<string, Resolution>;
  /** Speak for me only: prepared agent audio for `text`. */
  audio: { status: "none" | "preparing" | "ready" | "failed"; forText: string | null; textHash: string | null };
  /** Speak for me, this sentence only: the user reads it aloud because the agent's voice failed. */
  selfDelivery: boolean;
  error: { code: string; message: string; retryable: boolean } | null;
  notice: string | null;
  stopped: boolean;
  /** Speak for me: the agent dropped out of the call (removed, time limit, crashed). */
  agentGone: boolean;
  /** Sentences left on the plan, from the last result. null = not known yet or no limit. */
  quota: { left: number | null; windowLeft: number | null };
  /** For the session history: counts only, never text. */
  stats: { approved: number; edited: number; usedAsIs: number; rerecords: number };
  activity: ActivityEntry[];
}

export type PanelEvent =
  | { type: "PTT_DOWN"; at: number }
  | { type: "PTT_UP" }
  | { type: "CANCEL" }
  | { type: "TOO_SHORT" }
  | { type: "RESULT"; result: ReconstructResponse }
  | { type: "FAILED"; code: string; message: string; retryable: boolean }
  | { type: "OUT_OF_SENTENCES"; message: string }
  | { type: "RETRY" }
  | { type: "DISMISS" }
  | { type: "APPLY_FIX"; issueId: string }
  | { type: "USE_AS_IS"; issueId: string }
  | { type: "USE_LITERAL" }
  | { type: "BEGIN_EDIT"; target: "transcript" | "output" }
  | { type: "TRANSCRIPT_REBUILT"; result: ReconstructResponse }
  | { type: "EDIT_OUTPUT"; text: string }
  | { type: "CANCEL_EDIT" }
  | { type: "USE_DRAFT" }
  | { type: "RERECORD" }
  | { type: "AUDIO_PREPARING"; text: string }
  | { type: "AUDIO_READY"; text: string; textHash: string }
  | { type: "AUDIO_FAILED"; text: string }
  | { type: "AUDIO_RETRY" }
  | { type: "READ_MYSELF" }
  | { type: "APPROVE" }
  | { type: "DONE" }
  | { type: "STOP" }
  | { type: "PLAYBACK_ENDED" }
  | { type: "CLEAR_NOTICE" }
  | { type: "AGENT_LEFT" }
  | { type: "SWITCH_TO_SAY" };

const NO_AUDIO: PanelState["audio"] = { status: "none", forText: null, textHash: null };

export function initialPanelState(ctx: PanelContext, now = Date.now()): PanelState {
  const a = copy.panel.activity;
  const first = ctx.mode === "say" ? a.startedSay(ctx.firstName) : a.joinedSpeak(ctx.agentName);
  return {
    ctx, phase: "ready", recordingStartedAt: null, result: null, text: "", transcriptEdited: false, textEdited: false, editing: null, resolutions: {},
    audio: NO_AUDIO, selfDelivery: false, error: null, notice: null, stopped: false, agentGone: false,
    quota: { left: null, windowLeft: null },
    stats: { approved: 0, edited: 0, usedAsIs: 0, rerecords: 0 },
    activity: [{ id: 0, at: now, ...first }],
  };
}

export const openIssues = (s: PanelState): GuardIssue[] =>
  s.result ? s.result.guard.issues.filter((issue) => !s.resolutions[issue.id]) : [];

export function canApprove(s: PanelState): boolean {
  if (s.phase !== "review" || s.editing !== null || openIssues(s).length > 0) return false;
  return s.ctx.mode === "say" || (!s.agentGone && s.audio.status === "ready" && s.audio.forText === s.text);
}

/**
 * Speak for me: the controller should start preparing audio for `text`. Also
 * while unsure: the English is usually what gets said ("Looks right"), so
 * voicing it while the user reads saves the wait after they click.
 */
export const needsAudio = (s: PanelState): boolean =>
  s.ctx.mode === "speak" && !s.agentGone && (s.phase === "review" || s.phase === "unsure") && s.editing === null && openIssues(s).length === 0 && s.audio.forText !== s.text;

function log(s: PanelState, entry: { who: string; what: string }, at = Date.now()): ActivityEntry[] {
  return [...s.activity, { id: s.activity.length, at, ...entry }];
}

function clearSentence(s: PanelState): PanelState {
  return { ...s, result: null, text: "", transcriptEdited: false, textEdited: false, editing: null, resolutions: {}, audio: NO_AUDIO, selfDelivery: false, error: null, stopped: false };
}

/** Approve the sentence: by the agent, or (selfDelivery) read aloud by the user. */
function approve(s: PanelState, selfDelivery: boolean): PanelState {
  const a = copy.panel.activity, speak = s.ctx.mode === "speak" && !selfDelivery;
  const values = Object.values(s.resolutions);
  const fixed = values.includes("fixed"), asIs = !fixed && values.includes("as_is");
  const decision = fixed ? a.keptFix(s.ctx.firstName, speak) : asIs ? a.usedAsIs(s.ctx.firstName, speak) : a.approved(s.ctx.firstName);
  const stats = { ...s.stats, approved: s.stats.approved + 1, edited: s.stats.edited + (fixed ? 1 : 0), usedAsIs: s.stats.usedAsIs + (asIs ? 1 : 0) };
  return { ...s, phase: "delivering", selfDelivery, stats, activity: log(s, decision) };
}

export function panelReducer(s: PanelState, e: PanelEvent): PanelState {
  switch (e.type) {
    case "PTT_DOWN":
      if (s.phase !== "ready" && s.phase !== "done") return s;
      return { ...clearSentence(s), phase: "recording", recordingStartedAt: e.at, notice: null };
    case "PTT_UP":
      return s.phase === "recording" ? { ...s, phase: "processing", recordingStartedAt: null } : s;
    case "CANCEL":
      return s.phase === "recording" ? { ...s, phase: "ready", recordingStartedAt: null } : s;
    case "TOO_SHORT":
      return s.phase === "recording" || s.phase === "processing"
        ? { ...s, phase: "ready", recordingStartedAt: null, notice: copy.panel.tooShort } : s;
    case "RESULT":
      if (s.phase !== "processing") return s;
      return {
        ...s, result: e.result, text: e.result.sentence.text, transcriptEdited: false, textEdited: false, editing: null, resolutions: {}, audio: NO_AUDIO, phase: e.result.guard.status === "unsure" ? "unsure" : "review",
        quota: { left: e.result.quota.reconstructionsLeft, windowLeft: e.result.quota.windowLeft },
      };
    case "FAILED":
      return s.phase === "processing" || s.phase === "recording"
        ? { ...s, phase: "error", recordingStartedAt: null, error: { code: e.code, message: e.message, retryable: e.retryable } } : s;
    case "OUT_OF_SENTENCES":
      // Known before recording: nothing is recorded or sent.
      return s.phase === "ready" || s.phase === "done"
        ? { ...clearSentence(s), phase: "error", error: { code: "QUOTA_EXCEEDED", message: e.message, retryable: false } } : s;
    case "RETRY":
      return s.phase === "error" && s.error?.retryable ? { ...s, phase: "processing", error: null } : s;
    case "DISMISS":
      return s.phase === "error" ? { ...clearSentence(s), phase: "ready" } : s;

    case "APPLY_FIX": {
      const issue = s.phase === "review" ? openIssues(s).find((i) => i.id === e.issueId) : undefined;
      if (!issue || !s.result) return s;
      // Fixes are applied together to the original draft so they stack in any order.
      const resolutions = { ...s.resolutions, [issue.id]: "fixed" as const };
      return { ...s, text: composeSentence(s.result, resolutions).text, resolutions };
    }
    case "USE_AS_IS": {
      const issue = s.phase === "review" ? openIssues(s).find((i) => i.id === e.issueId) : undefined;
      return issue ? { ...s, resolutions: { ...s.resolutions, [issue.id]: "as_is" } } : s;
    }
    case "USE_DRAFT": {
      // Unsure, but the user read the English and it's what they meant.
      if (s.phase !== "unsure" || !s.result) return s;
      const all = Object.fromEntries(s.result.guard.issues.map((i) => [i.id, "as_is" as const]));
      return { ...s, phase: "review", text: s.result.sentence.text, textEdited: false, editing: null, resolutions: all };
    }
    case "USE_LITERAL": {
      if (s.phase !== "unsure" || !s.result) return s;
      const all = Object.fromEntries(s.result.guard.issues.map((i) => [i.id, "as_is" as const]));
      return { ...s, phase: "review", text: s.result.sentence.literal, textEdited: false, editing: null, resolutions: all };
    }
    case "BEGIN_EDIT":
      if (s.editing !== null) return s;
      if (e.target === "transcript" && s.result && (s.phase === "review" || s.phase === "unsure")) return { ...s, editing: e.target };
      if (e.target === "output" && s.phase === "review" && openIssues(s).length === 0) return { ...s, editing: e.target };
      return s;
    case "TRANSCRIPT_REBUILT":
      if (s.editing !== "transcript" || !s.result) return s;
      return { ...s, result: e.result, text: e.result.sentence.text, transcriptEdited: true, textEdited: false, editing: null, phase: e.result.guard.status === "unsure" ? "unsure" : "review", resolutions: {}, audio: NO_AUDIO, quota: { left: e.result.quota.reconstructionsLeft, windowLeft: e.result.quota.windowLeft } };
    case "EDIT_OUTPUT": {
      const text = e.text.trim();
      if (s.editing !== "output" || s.phase !== "review" || openIssues(s).length > 0 || !text || text.length > 2000) return s;
      return { ...s, text, textEdited: true, editing: null, audio: NO_AUDIO };
    }
    case "CANCEL_EDIT":
      return s.editing !== null ? { ...s, editing: null } : s;
    case "RERECORD":
      return s.phase === "review" || s.phase === "unsure"
        ? { ...clearSentence(s), phase: "ready", stats: { ...s.stats, rerecords: s.stats.rerecords + 1 } } : s;

    case "AUDIO_PREPARING":
      return e.text === s.text ? { ...s, audio: { status: "preparing", forText: e.text, textHash: null } } : s;
    case "AUDIO_READY":
      return e.text === s.text ? { ...s, audio: { status: "ready", forText: e.text, textHash: e.textHash } } : s;

    case "APPROVE":
      return canApprove(s) ? approve(s, false) : s;
    case "AUDIO_FAILED":
      return e.text === s.text ? { ...s, audio: { status: "failed", forText: e.text, textHash: null } } : s;
    case "AUDIO_RETRY":
      return s.audio.status === "failed" ? { ...s, audio: NO_AUDIO } : s;
    case "READ_MYSELF":
      return s.phase === "review" && s.ctx.mode === "speak" && openIssues(s).length === 0 ? approve(s, true) : s;
    case "DONE":
      if (s.phase !== "delivering" || (s.ctx.mode !== "say" && !s.selfDelivery)) return s;
      return { ...s, phase: "done", selfDelivery: false, activity: log(s, copy.panel.activity.saidIt(s.ctx.firstName)) };
    case "STOP":
      if (s.phase !== "delivering" || s.ctx.mode !== "speak") return s;
      return { ...s, phase: "done", stopped: true, activity: log(s, copy.panel.activity.stopped(s.ctx.firstName, s.ctx.agentName)) };
    case "PLAYBACK_ENDED":
      if (s.phase !== "delivering" || s.ctx.mode !== "speak") return s;
      return { ...s, phase: "done", activity: log(s, copy.panel.activity.spoke(s.ctx.agentName)) };
    case "CLEAR_NOTICE":
      return { ...s, notice: null };

    case "AGENT_LEFT": {
      if (s.ctx.mode !== "speak" || s.agentGone) return s;
      // Anything mid-sentence was cut off with the call.
      const cut = s.phase === "delivering" ? { phase: "done" as const, stopped: true } : {};
      return { ...s, ...cut, agentGone: true, audio: NO_AUDIO, activity: log(s, copy.panel.activity.agentLeft(s.ctx.agentName)) };
    }
    case "SWITCH_TO_SAY":
      if (s.ctx.mode !== "speak" || s.phase === "delivering") return s;
      return { ...s, ctx: { ...s.ctx, mode: "say" }, agentGone: false, audio: NO_AUDIO, activity: log(s, copy.panel.activity.switchedToSay(s.ctx.firstName)) };
  }
}
