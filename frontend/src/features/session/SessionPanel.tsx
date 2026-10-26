import { WifiOff } from "lucide-react";
import { useOnline } from "../../lib/useOnline.js";
import type { ReconstructResponse, Tone } from "@relaya/contracts";
import { copy } from "../../copy/en.js";
import { openIssues, type Resolution } from "./machine.js";
import { sentenceSegments } from "./highlight.js";
import type { SessionController } from "./useSessionController.js";
import { PanelHeader } from "./components/PanelHeader.js";
import { ReadyView } from "./components/ReadyView.js";
import { DraftCard } from "./components/DraftCard.js";
import { SentenceCard } from "./components/SentenceCard.js";
import { Prompter } from "./components/Prompter.js";
import { AgentGoneCard, ErrorCard } from "./components/StatusCards.js";
import { PanelFooter } from "./components/PanelFooter.js";
import { isGuestPreview } from "../auth/client.js";

interface Props {
  c: SessionController;
  tone: Tone;
  onTone: (tone: Tone) => void;
  names: string[];
  onNames: (names: string[]) => void;
  onQuit: () => void;
  onPopOut: (() => void) | null;
  onRejoin: () => void;
  onUseSay: () => void;
}

const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** What Context Guard checked and kept, including the user's own decisions on its flags. */
function guardChecks(result: ReconstructResponse, resolutions: Record<string, Resolution>): string[] {
  const decisions = result.guard.issues.filter((issue) => resolutions[issue.id]).map((issue) => {
    const fixed = resolutions[issue.id] === "fixed";
    const [a, b] = fixed ? issue.fix.fixedSpan : issue.draftSpan;
    const phrase = (fixed ? issue.fix.sentence : result.sentence.text).slice(a, b);
    return fixed ? `“${capitalize(phrase)}” keeps “${issue.said}”` : copy.panel.keptAsChosen(phrase);
  });
  return [...new Set([...decisions, ...result.guard.kept])];
}

/** The Relaya panel. Renders inline or inside the PiP window. */
export function SessionPanel({ c, tone, onTone, names, onNames, onQuit, onPopOut, onRejoin, onUseSay }: Props) {
  const { state } = c;
  const open = openIssues(state);
  const online = useOnline();
  const busy = !["ready", "done", "error"].includes(state.phase);

  let body;
  switch (state.phase) {
    case "ready":
    case "done":
      body = <ReadyView names={names} onNames={onNames} activity={state.activity} notice={state.notice} quota={state.quota} />;
      break;
    case "recording":
    case "processing":
      body = <DraftCard kind="pending" recordingSince={state.recordingStartedAt} />;
      break;
    case "review":
    case "unsure": {
      const result = state.result;
      if (!result) break;
      const unsure = state.phase === "unsure";
      body = (
        <DraftCard
          kind={unsure ? "unsure" : "review"}
          transcript={result.transcript}
          output={unsure ? result.sentence.literal : state.text}
          transcriptEdited={state.transcriptEdited}
          textEdited={state.textEdited}
          editing={state.editing}
          languages={result.languages}
          segments={unsure ? [{ text: result.sentence.text, mark: null }] : sentenceSegments(state)}
          open={open}
          checked={guardChecks(result, state.resolutions)}
          usedAsIs={Object.values(state.resolutions).includes("as_is")}
          audio={state.ctx.mode === "speak" ? state.audio.status : null}
          onFix={(issueId) => c.dispatch({ type: "APPLY_FIX", issueId })}
          onAsIs={(issueId) => c.dispatch({ type: "USE_AS_IS", issueId })}
          onRerecord={() => c.dispatch({ type: "RERECORD" })}
          onBeginEdit={(target) => c.dispatch({ type: "BEGIN_EDIT", target })}
          onSaveTranscript={(text) => c.rebuildTranscript(text)}
          onSaveOutput={(text) => c.dispatch({ type: "EDIT_OUTPUT", text })}
          onCancelEdit={() => c.dispatch({ type: "CANCEL_EDIT" })}
        />
      );
      break;
    }
    case "delivering":
      body = state.ctx.mode === "speak" && !state.selfDelivery
        ? <SentenceCard text={state.text} />
        : <Prompter text={state.text} />;
      break;
    case "error":
      body = <ErrorCard message={state.error?.message ?? copy.panel.genericError} signIn={state.error?.code === "UNAUTHORIZED"} outOfSentences={state.error?.code === "QUOTA_EXCEEDED"} />;
      break;
  }

  return (
    <aside className="rpanel" aria-label="Relaya panel">
      <PanelHeader mode={state.ctx.mode} tone={tone} onTone={onTone} confirmQuit={busy || state.ctx.mode === "speak"} onQuit={onQuit} onPopOut={onPopOut} />
      <div className="rp-body" aria-live="polite">
        {!online && <div className="offline-banner" role="status"><WifiOff className="icon" />{copy.panel.offline}</div>}
        {isGuestPreview() && <div className="guest-preview-banner" role="status">Guest preview · sample responses</div>}
      {state.agentGone && <AgentGoneCard agentName={state.ctx.agentName} onRejoin={onRejoin} onUseSay={onUseSay} />}
        {body}
      </div>
      <div className="rp-foot"><PanelFooter c={c} /></div>
    </aside>
  );
}
