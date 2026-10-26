import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronDown, Link as LinkIcon, TriangleAlert, X } from "lucide-react";
import { MEET_AGENT_NAME, type SessionMode, type Tone } from "@relaya/contracts";
import { AppShell } from "../../components/shell/AppShell.js";
import { copy } from "../../copy/en.js";
import { useServices } from "../../services/ServicesProvider.js";
import { useAccount } from "../account/AccountProvider.js";
import { checkMeetingLink } from "../meeting-link/checkLink.js";
import { ConsentDialog } from "../meeting-link/ConsentDialog.js";
import { hasAgentConsent, saveAgentConsent } from "../meeting-link/consent.js";
import { sessionsChanged } from "../sessions/useRecentSessions.js";
import { useSessionDraft } from "./draft.js";
import { NamesEditor } from "./NamesEditor.js";
import { useMicCheck, type MicStatus } from "./useMicCheck.js";
import sayArt from "./illustrations/say.svg";
import speakArt from "./illustrations/speak.svg";
import "../meeting-link/meeting-link.css";
import "./new-session.css";

const t = copy.newSession;
const ART: Record<SessionMode, string> = { say: sayArt, speak: speakArt };
const TONES: Tone[] = ["professional", "casual"];

const micBad = (status: MicStatus) => status === "blocked" || status === "unavailable";

/** Beside Start: the microphone, checked as the page opens. Click to check again. */
function MicPill({ status, label, onCheck }: { status: MicStatus; label: string | null; onCheck: () => void }) {
  return (
    <button type="button" className={`ln-mic${micBad(status) ? " is-bad" : status === "ready" ? " is-ready" : ""}`} onClick={onCheck} title={label ?? undefined} aria-live="polite">
      {t.mic[status]}
      {status === "ready" && <span className="mic-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
    </button>
  );
}

/** Names for this call, in a dropdown so the row stays one line. */
function NamesDropdown({ names, onNames }: { names: string[]; onNames: (names: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div className="names-dd" ref={root} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <button type="button" className="ln-field names-trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <small>{t.names}</small>
        <b className={names.length ? "" : "muted"}>{names.length ? names.join(", ") : t.namesNone}</b>
        <ChevronDown className="icon" aria-hidden="true" />
      </button>
      {open && (
        <div className="names-pop" role="dialog" aria-label={copy.names.dialogTitle}>
          <div className="np-head"><b>{copy.names.dialogTitle}</b><button type="button" aria-label={copy.common.done} onClick={() => setOpen(false)}><X className="icon" /></button></div>
          <NamesEditor names={names} onChange={onNames} autoFocus />
        </div>
      )}
    </div>
  );
}

/** /new: pick a mode, set up the call and go. Speak for me takes the Meet link here too. */
export function ChooseModePage() {
  const { draft, update } = useSessionDraft();
  const { sessions, data } = useServices();
  const navigate = useNavigate();
  const mic = useMicCheck();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(draft.meeting?.url ?? "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [askConsent, setAskConsent] = useState(false);

  // Check the microphone as the page opens, so it's ready (or fixed) before the call.
  const checkMic = mic.check;
  useEffect(() => { void checkMic(); }, [checkMic]);

  const pickedNames = useRef(false);
  // Choices made before the account's defaults arrive win over the defaults.
  const picked = useRef<{ mode?: true; tone?: true }>({});
  useEffect(() => {
    const savedNames = sessionStorage.getItem("relaya.namesNextSession");
    if (!savedNames) return;
    sessionStorage.removeItem("relaya.namesNextSession");
    try {
      const names = JSON.parse(savedNames) as unknown;
      if (Array.isArray(names) && names.every((name) => typeof name === "string")) { pickedNames.current = true; update({ names: names.slice(0, 30) }); }
    } catch { /* Ignore a malformed local list and keep the current session draft. */ }
  }, [update]);

  // First visit this tab: start from the account's defaults and default name list.
  const needsDefaults = !draft.defaultsApplied && Boolean(account);
  useEffect(() => {
    if (!needsDefaults || !account) return;
    let active = true;
    const { defaultMode, defaultTone } = account.settings;
    data.nameLists()
      .then((lists) => lists.find((l) => l.isDefault)?.items.map((i) => i.value) ?? [])
      .catch(() => [] as string[])
      .then((defaultNames) => {
        if (!active) return;
        update({
          ...(picked.current.mode ? {} : { mode: defaultMode }), ...(picked.current.tone ? {} : { tone: defaultTone }),
          defaultsApplied: true, ...(pickedNames.current || !defaultNames.length ? {} : { names: defaultNames.slice(0, 30) }),
        });
      });
    return () => { active = false; };
  }, [needsDefaults, account, data, update]);

  const speak = draft.mode === "speak";
  const email = account?.email ?? null;

  // No session without a working microphone: there would be nothing to hear.
  const micBlocked = micBad(mic.status);

  async function go() {
    if (micBlocked) return;
    if (speak) {
      const result = checkMeetingLink(link);
      if (!result.ok) { setLinkError(result.error); return; }
      update({ meeting: { url: result.url, code: result.code }, agentSessionId: null });
      if (hasAgentConsent(email)) navigate("/new/joining");
      else setAskConsent(true);
      return;
    }
    setBusy(true);
    try {
      const { id } = await sessions.create({ mode: "say", tone: draft.tone, names: draft.names, meetingUrl: null });
      sessionsChanged();
      update({ meeting: null, agentSessionId: null });
      navigate(`/session/${id}`);
    } finally {
      setBusy(false);
    }
  }

  function toneKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    picked.current.tone = true;
    update({ tone: draft.tone === "professional" ? "casual" : "professional" });
  }

  return (
    <AppShell title={t.pageTitle}>
      <div className="launch">
        <div className="launch-glow" aria-hidden="true"><i /><i /></div>
        <p className="launch-date">{t.greeting(new Date().getHours())}</p>
        <h2 className="launch-title">{t.headline(account?.firstName ?? "")}</h2>
        <p className="launch-lead">{t.lead}</p>

        <div className="launch-card">
          <div className="launch-modes" role="radiogroup" aria-label={t.title}>
            {(["say", "speak"] as const).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={draft.mode === mode} className={`ln-mode${draft.mode === mode ? " on" : ""}`} onClick={() => { picked.current.mode = true; update({ mode }); }}>
                <span className="ln-art"><img src={ART[mode]} alt="" /></span>
                <span className="ln-text"><b>{copy.modes[mode].label}</b><small>{t.modeShort[mode]}</small></span>
                <span className="ln-radio" aria-hidden="true">{draft.mode === mode && <Check className="icon" strokeWidth={3} />}</span>
              </button>
            ))}
          </div>

          {speak && (
            <div className="ln-link">
              <div className={`ln-field ln-url${linkError ? " err" : ""}`}>
                <LinkIcon className="icon" aria-hidden="true" />
                <input type="url" inputMode="url" autoComplete="off" spellCheck={false} aria-label={t.linkLabel} placeholder={t.linkPlaceholder}
                  value={link} aria-invalid={Boolean(linkError)} aria-describedby="ln-link-err"
                  onChange={(event) => { setLink(event.target.value); setLinkError(null); }}
                  onKeyDown={(event) => { if (event.key === "Enter") void go(); }} />
              </div>
              {linkError && <p id="ln-link-err" className="ln-err" role="alert"><TriangleAlert className="icon" />{linkError}</p>}
            </div>
          )}

          <div className="ln-row">
            <div className="ln-tone" role="radiogroup" aria-label={t.setup.tone} onKeyDown={toneKeys}>
              {TONES.map((tone) => (
                <button key={tone} type="button" role="radio" aria-checked={draft.tone === tone} tabIndex={draft.tone === tone ? 0 : -1}
                  className={draft.tone === tone ? "on" : ""} onClick={() => { picked.current.tone = true; update({ tone }); }}>{t.tones[tone]}</button>
              ))}
            </div>
            <NamesDropdown names={draft.names} onNames={(names) => update({ names })} />
            <MicPill status={mic.status} label={mic.label} onCheck={() => { void mic.check(); }} />
            <button type="button" className="btn btn-coral ln-go" onClick={() => { void go(); }} disabled={busy || micBlocked}>
              {speak ? t.send : t.start}<ArrowRight className="icon" />
            </button>
          </div>
          {micBlocked && <p className="ln-err ln-mic-note" role="alert">{mic.status === "unavailable" ? t.micUnavailable : t.micBlocked}</p>}
        </div>
      </div>
      {askConsent && (
        <ConsentDialog agentName={MEET_AGENT_NAME} onCancel={() => setAskConsent(false)}
          onAgree={() => { saveAgentConsent(email); setAskConsent(false); navigate("/new/joining"); }} />
      )}
    </AppShell>
  );
}
