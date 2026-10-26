import { useCallback, useEffect, useReducer, useRef } from "react";
import type { LanguageMode, Tone } from "@relaya/contracts";
import { copy } from "../../copy/en.js";
import { useServices } from "../../services/ServicesProvider.js";
import { ServiceError } from "../../services/types.js";
import { RecorderError, type Recorder, type Recording } from "./capture/recorder.js";
import { canApprove, initialPanelState, needsAudio, panelReducer, type PanelContext } from "./machine.js";

const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 400;

interface Options extends PanelContext {
  sessionId: string;
  /** From the account: sentences left this month and when they come back. */
  plan: { sentencesLeft: number; resetsOn: string } | null;
  agentSessionId: string | null;
  tone: Tone;
  languageMode: LanguageMode;
  names: string[];
}

function micMessage(error: unknown): string {
  const p = copy.panel;
  if (!(error instanceof RecorderError)) return p.micDenied;
  return { MIC_UNSUPPORTED: p.micUnsupported, MIC_MISSING: p.micMissing, MIC_BUSY: p.micBusy, MIC_LOST: p.micLost, MIC_DENIED: p.micDenied }[error.code];
}

/** Out of sentences: what to tell the user, and until when (ms since epoch). */
interface Block { message: string; until: number }

const DAY_MS = 24 * 60 * 60 * 1000;
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The server's message when the limit is far off (a date); the local clock time when it's within a day. */
function blockFrom(error: ServiceError, now = Date.now()): Block {
  if (error.retryAfterMs === null) return { message: error.message, until: Infinity };
  const until = now + error.retryAfterMs;
  return { message: error.retryAfterMs < DAY_MS ? copy.panel.quota.opensAt(clock(until)) : error.message, until };
}

/** Connects the pure panel machine to the recorder, the pipeline and the agent. */
export function useSessionController(options: Options) {
  const { pipeline, agent, createRecorder } = useServices();
  const [state, dispatch] = useReducer(panelReducer, options, (o) => initialPanelState({ mode: o.mode, firstName: o.firstName, agentName: o.agentName }));
  const recorderRef = useRef<Recorder>(createRecorder());
  const lastRecording = useRef<Recording | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef(state);
  stateRef.current = state;
  // Known to be out of sentences: say so on the next press instead of recording.
  const block = useRef<Block | null>(null);

  const upload = useCallback(async (recording: Recording) => {
    const o = optionsRef.current;
    try {
      const result = await pipeline.reconstruct({ sessionId: o.sessionId, audio: recording.blob, durationMs: recording.durationMs, tone: o.tone, languageMode: o.languageMode, names: o.names });
      dispatch({ type: "RESULT", result });
      if (result.quota.reconstructionsLeft === 0) block.current = { message: copy.panel.quota.monthOut(o.plan?.resetsOn ?? "the next cycle"), until: Infinity };
    } catch (error) {
      if (error instanceof ServiceError && error.code === "TOO_SHORT") { dispatch({ type: "TOO_SHORT" }); return; }
      if (error instanceof ServiceError && error.code === "QUOTA_EXCEEDED") block.current = blockFrom(error);
      const retryable = error instanceof ServiceError ? error.retryable : true;
      const message = error instanceof ServiceError ? error.message : copy.panel.genericError;
      dispatch({ type: "FAILED", code: error instanceof ServiceError ? error.code : "INTERNAL", message, retryable });
    }
  }, [pipeline]);

  const pressStart = useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase !== "ready" && phase !== "done") return;
    // Until this session's first sentence, the account's plan is the only count we have.
    const plan = optionsRef.current.plan;
    const blocked = block.current ?? (plan?.sentencesLeft === 0 && stateRef.current.quota.left === null ? { message: copy.panel.quota.monthOut(plan.resetsOn), until: Infinity } : null);
    if (blocked && Date.now() < blocked.until) { dispatch({ type: "OUT_OF_SENTENCES", message: blocked.message }); return; }
    block.current = null;
    dispatch({ type: "PTT_DOWN", at: Date.now() });
    recorderRef.current.start().catch((error: unknown) => {
      dispatch({ type: "FAILED", code: "MIC", message: micMessage(error), retryable: false });
    });
  }, []);

  const pressEnd = useCallback(async () => {
    if (stateRef.current.phase !== "recording") return;
    dispatch({ type: "PTT_UP" });
    let recording: Recording;
    try { recording = await recorderRef.current.stop(); }
    catch (error) { dispatch({ type: "FAILED", code: "MIC", message: micMessage(error), retryable: false }); return; }
    if (recording.durationMs < MIN_RECORDING_MS || recording.blob.size === 0) { dispatch({ type: "TOO_SHORT" }); return; }
    lastRecording.current = recording;
    await upload(recording);
  }, [upload]);

  const cancel = useCallback(() => {
    if (stateRef.current.phase !== "recording") return;
    recorderRef.current.cancel();
    dispatch({ type: "CANCEL" });
  }, []);

  // Auto-stop at 60 s.
  useEffect(() => {
    if (state.phase !== "recording") return;
    const timer = setTimeout(() => { void pressEnd(); }, MAX_RECORDING_MS);
    return () => clearTimeout(timer);
  }, [state.phase, pressEnd]);

  // Speak for me: prepare agent audio whenever the sentence is clear and its text changed.
  useEffect(() => {
    const agentSessionId = optionsRef.current.agentSessionId;
    if (!agentSessionId || !needsAudio(state)) return;
    const text = state.text;
    dispatch({ type: "AUDIO_PREPARING", text });
    agent.prepare(agentSessionId, text)
      .then(({ textHash }) => dispatch({ type: "AUDIO_READY", text, textHash }))
      .catch(() => dispatch({ type: "AUDIO_FAILED", text }));
  }, [state, agent]);

  // Speak for me: notice when the agent drops out of the call.
  const watchedAgent = options.agentSessionId;
  useEffect(() => {
    if (!watchedAgent) return;
    return agent.watch(watchedAgent, () => dispatch({ type: "AGENT_LEFT" }));
  }, [agent, watchedAgent]);

  const approve = useCallback(() => {
    const s = stateRef.current;
    if (!canApprove(s)) return;
    dispatch({ type: "APPROVE" });
    const agentSessionId = optionsRef.current.agentSessionId;
    if (s.ctx.mode === "speak" && agentSessionId && s.audio.textHash) {
      agent.play(agentSessionId, s.audio.textHash, () => dispatch({ type: "PLAYBACK_ENDED" }));
    }
  }, [agent]);

  const stop = useCallback(() => {
    const agentSessionId = optionsRef.current.agentSessionId;
    if (agentSessionId) agent.stop(agentSessionId);
    dispatch({ type: "STOP" });
  }, [agent]);

  const retry = useCallback(() => {
    const recording = lastRecording.current;
    if (!stateRef.current.error?.retryable) return;
    if (!recording) { dispatch({ type: "DISMISS" }); return; }
    dispatch({ type: "RETRY" });
    void upload(recording);
  }, [upload]);

  const rebuildTranscript = useCallback(async (transcript: string) => {
    const o = optionsRef.current;
    const result = await pipeline.reconstructTranscript({ transcript, tone: o.tone, names: o.names });
    dispatch({ type: "TRANSCRIPT_REBUILT", result });
    if (result.quota.reconstructionsLeft === 0) block.current = { message: copy.panel.quota.monthOut(o.plan?.resetsOn ?? "the next cycle"), until: Infinity };
  }, [pipeline]);

  // Open the mic as the panel opens so the first word of the first recording
  // is captured; a denied permission surfaces on the first press instead.
  useEffect(() => {
    const recorder = recorderRef.current;
    recorder.warmUp().catch(() => undefined);
    return () => recorder.dispose();
  }, []);

  return {
    state,
    dispatch,
    pressStart,
    pressEnd: () => { void pressEnd(); },
    cancel,
    approve,
    stop,
    retry,
    rebuildTranscript,
  };
}

export type SessionController = ReturnType<typeof useSessionController>;
