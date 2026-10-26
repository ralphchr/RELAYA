import { useEffect, useRef } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { copy } from "../../copy/en.js";

/** Shown once before the first Speak for me join. */
export function ConsentDialog({ agentName, onAgree, onCancel }: { agentName: string; onAgree: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => dialog?.close?.();
  }, []);

  const t = copy.meetingLink.consent;
  return (
    <dialog ref={ref} className="consent" aria-labelledby="consent-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <div className="consent-icon"><ShieldCheck className="icon" /></div>
      <h2 id="consent-title">{t.title}</h2>
      <ul>
        {t.points(agentName).map((point) => <li key={point}><span><Check className="icon" strokeWidth={3} /></span>{point}</li>)}
      </ul>
      <p className="consent-terms">{t.termsPrefix} <a href="/terms" target="_blank" rel="noopener">{t.termsLink}</a>.</p>
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{copy.common.cancel}</button>
        <button type="button" className="btn btn-coral" onClick={onAgree} autoFocus>{t.agree}<ArrowRight className="icon" /></button>
      </div>
    </dialog>
  );
}
