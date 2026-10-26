import { Mic, RotateCcw, TriangleAlert, UserX } from "lucide-react";
import { copy } from "../../../copy/en.js";

export function ErrorCard({ message, signIn = false, outOfSentences = false }: { message: string; signIn?: boolean; outOfSentences?: boolean }) {
  return (
    <div className="guard error" role="alert">
      <div className="g-head"><div className="g-icon"><TriangleAlert className="icon" /></div><div className="g-title">{outOfSentences ? copy.panel.quota.title : copy.panel.errorTitle}</div></div>
      <p className="status-body">{message}</p>
      {/* A new tab keeps this call and its recording; Retry works once signed in. */}
      {signIn && <a className="btn btn-ghost sign-in-again" href="/login" target="_blank" rel="noopener">{copy.panel.signInAgain}</a>}
      {outOfSentences && <a className="btn btn-ghost sign-in-again" href="/billing" target="_blank" rel="noopener">{copy.panel.quota.seePlans}</a>}
    </div>
  );
}

export function AgentGoneCard({ agentName, onRejoin, onUseSay }: { agentName: string; onRejoin: () => void; onUseSay: () => void }) {
  const t = copy.panel.agentGone;
  return (
    <div className="guard error agent-gone" role="alert">
      <div className="g-head"><div className="g-icon"><UserX className="icon" /></div><div className="g-title">{t.title(agentName)}</div></div>
      <p className="status-body">{t.body}</p>
      <div className="actions split">
        <button className="btn btn-ghost" onClick={onUseSay}><Mic className="icon" />{t.useSay}</button>
        <button className="btn btn-coral" onClick={onRejoin}><RotateCcw className="icon" />{t.rejoin}</button>
      </div>
    </div>
  );
}
