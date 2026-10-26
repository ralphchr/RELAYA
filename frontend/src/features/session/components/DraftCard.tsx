import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Mic, MicOff, Pencil, RotateCcw, ShieldAlert, ShieldCheck, Volume2, X } from "lucide-react";
import type { GuardIssue, LanguageCode } from "@relaya/contracts";
import { RelayaMark } from "../../../components/brand/RelayaMark.js";
import { Wave } from "../../../components/ui/Wave.js";
import { copy } from "../../../copy/en.js";
import type { Segment } from "../highlight.js";

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span>{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

/** "Keep “might”": in the pop-out and narrower only “might” shows (the check already says keep). */
function FixLabel({ label }: { label: string }) {
  const [, verb, rest] = /^(Keep|Use|Put)\s+(“.+)$/.exec(label) ?? [];
  return verb && rest ? <b><span className="opt-verb">{verb} </span>{rest}</b> : <b>{label}</b>;
}

type Props =
  | { kind: "pending"; recordingSince: number | null }
  | {
    kind: "review" | "unsure";
    transcript: string;
    output: string;
    transcriptEdited: boolean;
    textEdited: boolean;
    editing: "transcript" | "output" | null;
    languages: LanguageCode[];
    segments: Segment[];
    /** Context Guard issues still waiting for a decision. */
    open: GuardIssue[];
    /** What the Guard checked and kept, for the Checked badge's tooltip. */
    checked: string[];
    usedAsIs: boolean;
    audio: "none" | "preparing" | "ready" | "failed" | null;
    onFix: (id: string) => void;
    onAsIs: (id: string) => void;
    onRerecord: () => void;
    onBeginEdit: (target: "transcript" | "output") => void;
    onSaveTranscript: (text: string) => Promise<void>;
    onSaveOutput: (text: string) => void;
    onCancelEdit: () => void;
  };

/**
 * What you said and what Relaya will say, in one card. The sentence is the
 * star; the Guard is a badge, and only an open issue adds anything below it.
 * While recording or processing: a timer and placeholders, no text yet.
 */
export function DraftCard(props: Props) {
  const p = copy.panel;
  const pending = props.kind === "pending";
  const transcript = pending ? "" : props.transcript;
  const output = pending ? "" : props.output;
  const [inputEditing, setInputEditing] = useState(false);
  const [outputEditing, setOutputEditing] = useState(false);
  const [inputDraft, setInputDraft] = useState(transcript);
  const [outputDraft, setOutputDraft] = useState(output);
  const [inputSaving, setInputSaving] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  useEffect(() => { if (!inputEditing) setInputDraft(transcript); }, [transcript, inputEditing]);
  useEffect(() => { if (!outputEditing) setOutputDraft(output); }, [output, outputEditing]);

  function beginEdit(target: "transcript" | "output") {
    if (props.kind === "pending") return;
    props.onBeginEdit(target);
    if (target === "transcript") { setInputDraft(transcript); setInputEditing(true); }
    else { setOutputDraft(output); setOutputEditing(true); }
  }

  function cancelEdit(target: "transcript" | "output") {
    if (props.kind === "pending") return;
    props.onCancelEdit();
    if (target === "transcript") { setInputDraft(transcript); setInputEditing(false); }
    else { setOutputDraft(output); setOutputEditing(false); }
  }

  async function saveTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.kind === "pending") return;
    const save = props.onSaveTranscript;
    setInputSaving(true);
    setInputError(null);
    try {
      await save(inputDraft);
      setInputEditing(false);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : p.rebuildFailed);
    } finally {
      setInputSaving(false);
    }
  }

  if (pending) {
    const since = props.recordingSince;
    return (
      <div className="draft" aria-busy="true">
        <div className="draft-said">
          <div className="draft-said-head">
            <span className="ibadge in"><Mic className="icon" /></span>
            {since !== null && <span className="r"><span className="chip chip-line"><MicOff className="icon" />{p.stayMuted}</span><span className="chip chip-pink"><Wave heights={[6, 12, 8, 14, 7]} live /><Timer since={since} /></span></span>}
          </div>
          <div className="skel" aria-label={since !== null ? p.releaseToFinish : p.processing}><i style={{ width: "88%" }} /><i style={{ width: "64%" }} /></div>
        </div>
        <div className="draft-say">
          <div className="draft-say-head"><span className="faded"><RelayaMark size={26} /></span></div>
          <div className="skel"><i style={{ width: "94%" }} /><i style={{ width: "72%" }} /></div>
        </div>
      </div>
    );
  }

  const { languages, segments, open, checked, usedAsIs, audio } = props;
  const unsure = props.kind === "unsure";
  const translationReview = languages.some((language) => language === "ja" || language === "zh" || language === "es");
  const flagged = !unsure && open.length > 0;
  const badge = unsure
    ? <span className="g-badge warn"><ShieldAlert className="icon" />{translationReview ? p.reviewTranslation : p.notSure}</span>
    : flagged
      ? <span className="g-badge warn"><ShieldAlert className="icon" />{p.toCheck(open.length)}</span>
      : <span className="g-badge" title={checked.length ? checked.join("\n") : undefined}><ShieldCheck className="icon" />{translationReview ? p.reviewedByYou : p.checked}</span>;

  return (
    <section className={`draft${flagged || unsure ? " warn" : ""}`} aria-label={p.guardTitle}>
      <div className="draft-said">
        <div className="draft-said-head">
          <span className="ibadge in"><Mic className="icon" /></span>
          {languages.map((l) => <span key={l} className="mini-tag">{copy.languages[l]}</span>)}
          {props.transcriptEdited && <span className="edit-note">{p.corrected}</span>}
          {!inputEditing && props.editing === null && <button className="draft-edit" type="button" title={p.editHeard} aria-label={p.editHeard} onClick={() => beginEdit("transcript")}><Pencil className="icon" />{copy.common.edit}</button>}
        </div>
        {inputEditing ? <form className="draft-edit-form" onSubmit={(event) => void saveTranscript(event)}>
          <textarea autoFocus aria-label={p.editHeard} maxLength={2000} value={inputDraft} disabled={inputSaving} onChange={(event) => setInputDraft(event.target.value)} />
          <small className="draft-edit-note">{p.rebuildNote}</small>
          {inputError && <small className="draft-edit-error" role="alert">{inputError}</small>}
          <div className="draft-edit-actions"><button type="button" className="draft-edit-cancel" disabled={inputSaving} onClick={() => cancelEdit("transcript")}><X className="icon" />{copy.common.cancel}</button><button type="submit" className="draft-edit-save" disabled={inputSaving || !inputDraft.trim()}>{inputSaving ? <><RotateCcw className="icon spin" />{p.rebuildingEdit}</> : <><Check className="icon" />{p.saveEdit}</>}</button></div>
        </form> : <div className="said">{transcript}</div>}
      </div>
      <div className="draft-say">
        <div className="draft-say-head">
          <span className="l">
            <RelayaMark size={26} />
            {!flagged && !unsure && usedAsIs && <span className="chip chip-line">{p.usedAsIs}</span>}
            {!flagged && !unsure && audio === "ready" && <span className="chip chip-line"><Volume2 className="icon" />{p.audioReady}</span>}
            {!flagged && !unsure && audio === "preparing" && <span className="chip chip-line">{p.preparingVoice}</span>}
          </span>
          <span className="draft-say-tools">{!unsure && !flagged && !outputEditing && props.editing === null && <button className="draft-edit" type="button" title={p.editOutput} aria-label={p.editOutput} onClick={() => beginEdit("output")}><Pencil className="icon" />{copy.common.edit}</button>}{props.textEdited ? <span className="g-badge edited"><Pencil className="icon" />{p.editedByYou}</span> : badge}</span>
        </div>
        {outputEditing ? <form className="draft-edit-form output-edit" onSubmit={(event) => { event.preventDefault(); props.onSaveOutput(outputDraft); setOutputEditing(false); }}>
          <textarea autoFocus aria-label={p.editOutput} maxLength={2000} value={outputDraft} onChange={(event) => setOutputDraft(event.target.value)} />
          <div className="draft-edit-actions"><button type="button" className="draft-edit-cancel" onClick={() => cancelEdit("output")}><X className="icon" />{copy.common.cancel}</button><button type="submit" className="draft-edit-save" disabled={!outputDraft.trim()}><Check className="icon" />{p.saveEdit}</button></div>
        </form> : <p className="willsay">{segments.map((seg, i) => seg.mark ? <span key={i} className={seg.mark === "warn" ? "mark-warn" : "diff"}>{seg.text}</span> : <span key={i}>{seg.text}</span>)}</p>}
        {unsure && <p className="draft-note">{translationReview ? p.translationReviewNote : p.unsureNote}</p>}
        {flagged && open.map((issue) => (
          <div key={issue.id} className="flag">
            <div className="f-top">{issue.saidGloss ? p.youSaid(issue.said, issue.saidGloss) : issue.title}</div>
            <div className="opts">
              <button className="opt rec" disabled={props.editing !== null} title={issue.fix.label} aria-label={issue.fix.label} onClick={() => props.onFix(issue.id)}><Check className="icon" strokeWidth={3} /><FixLabel label={issue.fix.label} /></button>
              <button className="opt" disabled={props.editing !== null} title={p.useAsIs} onClick={() => props.onAsIs(issue.id)}><ArrowRight className="icon" /><b>{p.useAsIs}</b></button>
              <button className="opt" disabled={props.editing !== null} title={p.reRecord} onClick={props.onRerecord}><RotateCcw className="icon" /><b>{p.reRecord}</b></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
