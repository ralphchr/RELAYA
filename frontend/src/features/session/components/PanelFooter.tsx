import { Check, Mic, RotateCcw, Square, Volume2 } from "lucide-react";
import { Wave } from "../../../components/ui/Wave.js";
import { copy } from "../../../copy/en.js";
import type { SessionController } from "../useSessionController.js";
import { canApprove, openIssues } from "../machine.js";
import { DEFAULT_PTT_KEY, keyLabel } from "../pttKey.js";
import { useAccount } from "../../account/AccountProvider.js";

/** The one primary action for each state. */
export function PanelFooter({ c }: { c: SessionController }) {
  const { state } = c;
  const p = copy.panel;
  const speak = state.ctx.mode === "speak";

  if (state.editing !== null) return <p className="draft-edit-hint">{p.finishEditHint}</p>;

  switch (state.phase) {
    case "ready":
    case "done":
      return <HoldButton onDown={c.pressStart} onUp={c.pressEnd} recording={false} />;
    case "recording":
      return <HoldButton onDown={c.pressStart} onUp={c.pressEnd} recording />;
    case "processing":
      return <button className="btn btn-ghost hold" disabled>{p.processing}</button>;
    case "review": {
      if (speak && state.audio.status === "failed" && state.audio.forText === state.text) {
        return (
          <div className="audio-failed">
            <p role="alert">{p.voiceFailed}</p>
            <div className="actions split">
              <button className="btn btn-ghost" onClick={() => c.dispatch({ type: "AUDIO_RETRY" })}><RotateCcw className="icon" />{p.retry}</button>
              <button className="btn btn-green" onClick={() => c.dispatch({ type: "READ_MYSELF" })}><Mic className="icon" />{p.readMyself}</button>
            </div>
          </div>
        );
      }
      const ok = canApprove(state);
      const toCheck = openIssues(state).length > 0;
      const waitingAudio = speak && !ok && !toCheck && state.audio.status === "preparing";
      return (
        <div className={`actions${ok ? " approve-focus" : ""}`}>
          <button className="icon-btn" title={p.recordAgain} aria-label={p.recordAgain} onClick={() => c.dispatch({ type: "RERECORD" })}><RotateCcw className="icon" /></button>
          <button className={`btn btn-green${toCheck ? " is-waiting" : ""}`} onClick={toCheck ? showFirstFlag : c.approve} disabled={!ok && !toCheck}>
            {toCheck ? p.checkFirst : waitingAudio ? p.preparingVoice : <>{speak ? <Volume2 className="icon" /> : <Check className="icon" />}{speak ? p.approveSpeak : p.approveSay}</>}
          </button>
        </div>
      );
    }
    case "unsure":
      return (
        <div className="actions trio">
          <button className="icon-btn" title={p.recordAgain} aria-label={p.recordAgain} onClick={() => c.dispatch({ type: "RERECORD" })}><RotateCcw className="icon" /></button>
          <button className="btn btn-ghost" onClick={() => c.dispatch({ type: "USE_LITERAL" })}>{p.useLiteral}</button>
          <button className="btn btn-green" onClick={() => c.dispatch({ type: "USE_DRAFT" })}><Check className="icon" />{p.useDraft}</button>
        </div>
      );
    case "delivering":
      return speak && !state.selfDelivery
        ? <button className="btn btn-ghost hold" onClick={c.stop}><Square className="icon" />{p.stop}</button>
        : <button className="btn btn-ghost hold" onClick={() => c.dispatch({ type: "DONE" })}><Check className="icon" />{copy.common.done}</button>;
    case "error":
      return (
        <div className="actions split">
          <button className="btn btn-ghost" onClick={() => c.dispatch({ type: "DISMISS" })}>{copy.common.dismiss}</button>
          {state.error?.retryable && <button className="btn btn-coral" onClick={c.retry}><RotateCcw className="icon" />{p.retry}</button>}
        </div>
      );
  }
}

/** A long draft can push the Context Guard choices out of view: bring the first one up. */
function showFirstFlag() {
  const flag = document.querySelector<HTMLElement>(".rpanel .flag");
  flag?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  flag?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
}

function HoldButton({ recording, onDown, onUp }: { recording: boolean; onDown: () => void; onUp: () => void }) {
  const p = copy.panel;
  const me = useAccount();
  return (
    <div className="hold-wrap">
      <button
        className={`btn btn-coral hold${recording ? " rec" : ""}`}
        aria-pressed={recording}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); onDown(); }}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.repeat) { event.preventDefault(); onDown(); } }}
        onKeyUp={(event) => { if (event.key === "Enter") { event.preventDefault(); onUp(); } }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {recording ? <><Wave heights={[10, 18, 24, 16, 10]} live />{p.releaseToFinish}</> : <><Mic className="icon" />{p.holdToSpeak}</>}
      </button>
      <span className="hold-hint">{p.holdHint(keyLabel(me?.settings.pttKey ?? DEFAULT_PTT_KEY))}</span>
    </div>
  );
}
