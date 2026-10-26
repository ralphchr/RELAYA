import { describe, expect, it } from "vitest";
import { scriptedReconstruction } from "../../services/mock/scenario.js";
import { quotaWarning } from "./components/ReadyView.js";
import { canApprove, initialPanelState, needsAudio, openIssues, panelReducer, type PanelEvent, type PanelState } from "./machine.js";

const say = () => initialPanelState({ mode: "say", firstName: "Dana", agentName: "Dana's Relaya (AI)" }, 0);
const speak = () => initialPanelState({ mode: "speak", firstName: "Dana", agentName: "Dana's Relaya (AI)" }, 0);
const run = (s: PanelState, ...events: PanelEvent[]) => events.reduce(panelReducer, s);
const result = scriptedReconstruction("s1");
const recorded = (s: PanelState) => run(s, { type: "PTT_DOWN", at: 1 }, { type: "PTT_UP" }, { type: "RESULT", result });

describe("panel machine", () => {
  it("when unsure, shows the English and lets the user take it or their own words", () => {
    const unsure = { ...result, guard: { ...result.guard, status: "unsure" as const } };
    const s = run(say(), { type: "PTT_DOWN", at: 1 }, { type: "PTT_UP" }, { type: "RESULT", result: unsure });
    expect(s.phase).toBe("unsure");
    const draft = run(s, { type: "USE_DRAFT" });
    expect(draft.phase).toBe("review");
    expect(draft.text).toBe(result.sentence.text);
    expect(canApprove(draft)).toBe(true);
    expect(run(s, { type: "USE_LITERAL" }).text).toBe(result.sentence.literal);
  });

  it("Speak for me voices the English while the user decides an unsure draft", () => {
    const unsure = { ...result, guard: { ...result.guard, status: "unsure" as const, issues: [] } };
    const s = run(speak(), { type: "PTT_DOWN", at: 1 }, { type: "PTT_UP" }, { type: "RESULT", result: unsure });
    expect(needsAudio(s)).toBe(true);
    const ready = run(s, { type: "AUDIO_PREPARING", text: s.text }, { type: "AUDIO_READY", text: s.text, textHash: "h1" }, { type: "USE_DRAFT" });
    expect(canApprove(ready)).toBe(true);
  });

  it("shows no sentence until release, then flags the dropped hedge", () => {
    const recording = run(say(), { type: "PTT_DOWN", at: 1 });
    expect(recording.phase).toBe("recording");
    expect(recording.text).toBe("");
    const flagged = recorded(say());
    expect(flagged.phase).toBe("review");
    expect(openIssues(flagged)).toHaveLength(1);
    expect(canApprove(flagged)).toBe(false);
  });

  it("blocks approve until the issue is resolved, then delivers", () => {
    const flagged = recorded(say());
    expect(run(flagged, { type: "APPROVE" }).phase).toBe("review");
    const fixed = run(flagged, { type: "APPLY_FIX", issueId: "certainty-1" });
    expect(fixed.text).toContain("might be safer");
    expect(canApprove(fixed)).toBe(true);
    const done = run(fixed, { type: "APPROVE" }, { type: "DONE" });
    expect(done.phase).toBe("done");
    expect(done.activity.map((a) => a.what)).toEqual(["started Relaya", "kept the Context Guard fix", "said the sentence in their own voice"]);
  });

  it("Speak for me waits for audio of the current text", () => {
    const fixed = run(recorded(speak()), { type: "USE_AS_IS", issueId: "certainty-1" });
    expect(needsAudio(fixed)).toBe(true);
    expect(canApprove(fixed)).toBe(false);
    const stale = run(fixed, { type: "AUDIO_READY", text: "old text", textHash: "h0" });
    expect(canApprove(stale)).toBe(false);
    const ready = run(fixed, { type: "AUDIO_PREPARING", text: fixed.text }, { type: "AUDIO_READY", text: fixed.text, textHash: "h1" });
    expect(canApprove(ready)).toBe(true);
    const stopped = run(ready, { type: "APPROVE" }, { type: "STOP" });
    expect(stopped.phase).toBe("done");
    expect(stopped.stopped).toBe(true);
  });

  it("updates the generated sentence when the corrected transcript is rebuilt", () => {
    const flagged = recorded(say());
    const editing = run(flagged, { type: "BEGIN_EDIT", target: "transcript" });
    expect(canApprove(editing)).toBe(false);
    const rebuiltResult = {
      ...result,
      transcript: "I meant their new office.",
      sentence: { ...result.sentence, text: "Their new office is ready.", literal: "I meant their new office." },
    };
    const corrected = run(editing, { type: "TRANSCRIPT_REBUILT", result: rebuiltResult });
    expect(corrected.result?.transcript).toBe("I meant their new office.");
    expect(corrected.result?.sentence.literal).toBe("I meant their new office.");
    expect(corrected.text).toBe("Their new office is ready.");
    expect(corrected.transcriptEdited).toBe(true);
    expect(corrected.phase).toBe("review");
  });

  it("allows a discreet output correction after Context Guard issues are resolved", () => {
    const flagged = recorded(speak());
    expect(run(flagged, { type: "BEGIN_EDIT", target: "output" }).editing).toBe(null);
    const clear = run(flagged, { type: "APPLY_FIX", issueId: "certainty-1" });
    const editing = run(clear, { type: "BEGIN_EDIT", target: "output" });
    expect(canApprove(editing)).toBe(false);
    const edited = run(editing, { type: "EDIT_OUTPUT", text: "We haven't tested the refund flow yet." });
    expect(edited.text).toBe("We haven't tested the refund flow yet.");
    expect(edited.textEdited).toBe(true);
    expect(needsAudio(edited)).toBe(true);
  });

  it("ignores events that are out of order", () => {
    expect(run(say(), { type: "APPROVE" }).phase).toBe("ready");
    expect(run(say(), { type: "PTT_UP" }).phase).toBe("ready");
    expect(run(say(), { type: "RESULT", result }).phase).toBe("ready");
  });

  it("recovers from errors and short recordings", () => {
    const failed = run(say(), { type: "PTT_DOWN", at: 1 }, { type: "PTT_UP" }, { type: "FAILED", code: "STT_FAILED", message: "x", retryable: true });
    expect(failed.phase).toBe("error");
    expect(run(failed, { type: "RETRY" }).phase).toBe("processing");
    expect(run(failed, { type: "DISMISS" }).phase).toBe("ready");
    const short = run(say(), { type: "PTT_DOWN", at: 1 }, { type: "TOO_SHORT" });
    expect(short.phase).toBe("ready");
    expect(short.notice).toBeTruthy();
  });

  it("blocks Speak for me once the agent leaves the call, and can carry on in Say it yourself", () => {
    const ready = run(recorded(speak()), { type: "APPLY_FIX", issueId: "certainty-1" });
    const prepared = run(ready, { type: "AUDIO_PREPARING", text: ready.text }, { type: "AUDIO_READY", text: ready.text, textHash: "u1" });
    expect(canApprove(prepared)).toBe(true);

    const gone = run(prepared, { type: "AGENT_LEFT" });
    expect(gone.agentGone).toBe(true);
    expect(canApprove(gone)).toBe(false);
    expect(needsAudio(gone)).toBe(false);
    expect(gone.activity.at(-1)?.what).toBe("left the meeting");
    expect(run(gone, { type: "AGENT_LEFT" }).activity).toHaveLength(gone.activity.length);

    const say = run(gone, { type: "SWITCH_TO_SAY" });
    expect(say.ctx.mode).toBe("say");
    expect(say.agentGone).toBe(false);
    expect(canApprove(say)).toBe(true);
    expect(run(say, { type: "APPROVE" }, { type: "DONE" }).phase).toBe("done");
  });

  it("ends a sentence that was cut off when the agent left", () => {
    const ready = run(recorded(speak()), { type: "APPLY_FIX", issueId: "certainty-1" });
    const speaking = run(ready, { type: "AUDIO_PREPARING", text: ready.text }, { type: "AUDIO_READY", text: ready.text, textHash: "u1" }, { type: "APPROVE" });
    expect(speaking.phase).toBe("delivering");
    const gone = run(speaking, { type: "AGENT_LEFT" });
    expect(gone.phase).toBe("done");
    expect(gone.stopped).toBe(true);
    expect(run(say(), { type: "AGENT_LEFT" }).agentGone).toBe(false);
  });

  it("counts approvals, fixes, as-is and re-records for the history", () => {
    const fixed = run(recorded(say()), { type: "APPLY_FIX", issueId: "certainty-1" }, { type: "APPROVE" }, { type: "DONE" });
    const asIs = run(recorded(fixed), { type: "USE_AS_IS", issueId: "certainty-1" }, { type: "APPROVE" }, { type: "DONE" });
    const redo = run(recorded(asIs), { type: "RERECORD" });
    expect(redo.stats).toEqual({ approved: 2, edited: 1, usedAsIs: 1, rerecords: 1 });
  });

  it("lets the user read the sentence themselves when the agent's voice fails", () => {
    const ready = run(recorded(speak()), { type: "APPLY_FIX", issueId: "certainty-1" });
    const failed = run(ready, { type: "AUDIO_PREPARING", text: ready.text }, { type: "AUDIO_FAILED", text: ready.text });
    expect(failed.audio.status).toBe("failed");
    expect(canApprove(failed)).toBe(false);
    expect(needsAudio(failed)).toBe(false);
    expect(needsAudio(run(failed, { type: "AUDIO_RETRY" }))).toBe(true);

    const reading = run(failed, { type: "READ_MYSELF" });
    expect(reading.phase).toBe("delivering");
    expect(reading.selfDelivery).toBe(true);
    const done = run(reading, { type: "DONE" });
    expect(done.phase).toBe("done");
    expect(done.selfDelivery).toBe(false);
    expect(done.stats.approved).toBe(1);
    expect(done.activity.at(-1)?.what).toBe("said the sentence in their own voice");
  });

  it("keeps the sentence count from each result", () => {
    expect(recorded(say()).quota).toEqual({ left: 59, windowLeft: 14 });
  });

  it("out of sentences: shows why without recording, and only from rest", () => {
    const out = run(say(), { type: "OUT_OF_SENTENCES", message: "No more." });
    expect(out.phase).toBe("error");
    expect(out.error).toEqual({ code: "QUOTA_EXCEEDED", message: "No more.", retryable: false });
    expect(run(out, { type: "RETRY" }).phase).toBe("error");
    expect(run(out, { type: "DISMISS" }).phase).toBe("ready");
    expect(run(recorded(say()), { type: "OUT_OF_SENTENCES", message: "No more." }).phase).toBe("review");
  });

  it("warns only when the plan is nearly used up", () => {
    expect(quotaWarning({ left: null, windowLeft: null })).toBeNull();
    expect(quotaWarning({ left: 40, windowLeft: 10 })).toBeNull();
    expect(quotaWarning({ left: 5, windowLeft: 10 })).toBe("5 sentences left this month");
    expect(quotaWarning({ left: 1, windowLeft: 10 })).toBe("1 sentence left this month");
    expect(quotaWarning({ left: 0, windowLeft: 0 })).toBe("That was your last sentence this month.");
    expect(quotaWarning({ left: 40, windowLeft: 2 })).toBe("2 sentences left for the next few hours");
    expect(quotaWarning({ left: 40, windowLeft: 0 })).toBe("That was your last sentence for the next few hours.");
    expect(quotaWarning({ left: 40, windowLeft: null })).toBeNull();
  });
});
