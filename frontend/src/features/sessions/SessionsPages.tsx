import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Mic, Trash2, Volume2 } from "lucide-react";
import { AppShell } from "../../components/shell/AppShell.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { copy } from "../../copy/en.js";
import { useServices } from "../../services/ServicesProvider.js";
import type { SessionRecord } from "../../services/types.js";
import { accountChanged } from "../account/AccountProvider.js";
import { PageIntro, SavedNote, StorageNote, errorMessage } from "../workspace/parts.js";
import { sessionsChanged, useRecentSessions } from "./useRecentSessions.js";
import "../workspace/workspace-pages.css";
import "./sessions.css";

const t = copy.sessions;

/** Older than this and never ended: the tab or browser closed before the end was recorded. */
const STALE_MS = 6 * 60 * 60 * 1000;

export function formatDuration(record: Pick<SessionRecord, "startedAt" | "endedAt">, now = Date.now()): string {
  if (!record.endedAt) return now - Date.parse(record.startedAt) > STALE_MS ? t.notRecorded : t.inProgress;
  const minutes = Math.max(0, Math.round((Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 60_000));
  return minutes < 1 ? t.underAMinute : t.minutes(minutes);
}

const formatWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** /sessions: the last 20 sessions. */
export function SessionsPage() {
  const { sessions, loaded, failed } = useRecentSessions(20);
  return (
    <AppShell title={t.title}>
      <div className="workspace-page">
        <PageIntro eyebrow={t.eyebrow} title={t.title} text={t.intro} />
        {failed && <SavedNote error>{t.loadFailed}</SavedNote>}
        {loaded && !sessions.length && !failed ? (
          <div className="workspace-card">
            <EmptyState title={t.emptyTitle} body={t.emptyBody} />
            <div className="center-action"><Link className="wp-button wp-button-primary" to="/new">{t.start}</Link></div>
          </div>
        ) : (
          <div className="session-list" role="list" aria-busy={!loaded}>
            {sessions.map((s) => (
              <Link role="listitem" key={s.id} to={`/sessions/${s.id}`} className="workspace-card session-row">
                <span className={`session-mode ${s.mode}`} aria-hidden="true">{s.mode === "speak" ? <Volume2 size={18} /> : <Mic size={18} />}</span>
                <span className="session-main">
                  <b>{s.title}</b>
                  <small>{formatDuration(s)} · {t.approvedCount(s.approved)}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
        <StorageNote />
      </div>
    </AppShell>
  );
}

/** /sessions/:id: what happened in one session. Counts only; sentences are never saved. */
export function SessionSummaryPage() {
  const { sessionId = "" } = useParams();
  const { data } = useServices();
  const navigate = useNavigate();
  const [session, setSession] = useState<Awaited<ReturnType<typeof data.session>> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSession(undefined);
    data.session(sessionId).then((s) => { if (active) setSession(s); }).catch((e: unknown) => { if (active) { setSession(null); setError(errorMessage(e)); } });
    return () => { active = false; };
  }, [data, sessionId]);

  async function remove() {
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      await data.deleteSession(sessionId);
      sessionsChanged();
      accountChanged();
      navigate("/sessions");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const back = <Link className="wp-button" to="/sessions"><ChevronLeft size={16} />{t.all}</Link>;
  if (session === undefined) return <AppShell title={t.title}><div className="workspace-page" aria-busy="true"><div className="spinner" /></div></AppShell>;
  if (!session) {
    return <AppShell title={t.title}><div className="workspace-page"><div className="workspace-card"><EmptyState title={t.notFoundTitle} body={error ?? t.notFoundBody} action={back} /></div></div></AppShell>;
  }

  const stats = [
    { label: t.stats.approved, value: session.approved },
    { label: t.stats.edited, value: session.edited },
    { label: t.stats.usedAsIs, value: session.usedAsIs },
    { label: t.stats.rerecords, value: session.rerecords },
  ];
  return (
    <AppShell title={t.title}>
      <div className="workspace-page">
        <PageIntro eyebrow={copy.modes[session.mode].label.toUpperCase()} title={session.title} text={`${formatWhen(session.startedAt)} · ${formatDuration(session)} · ${copy.newSession.tones[session.tone]}`} action={back} />
        <div className="session-stats">
          {stats.map((s) => <div className="workspace-card session-stat" key={s.label}><b>{s.value}</b><span>{s.label}</span></div>)}
        </div>
        <section className="workspace-card">
          <div className="workspace-card-head"><h3>{copy.names.title}</h3></div>
          {session.names.length ? <div className="session-names">{session.names.map((n) => <span key={n}>{n}</span>)}</div> : <p className="card-lead">{t.noNames}</p>}
        </section>
        {session.mode === "speak" && session.agentSeconds > 0 && <p className="card-lead">{t.agentTime(Math.ceil(session.agentSeconds / 60))}</p>}
        <p className="workspace-local-note">{t.privacy}</p>
        <div className="workspace-actions"><button className="wp-button danger-button" onClick={() => { void remove(); }}><Trash2 size={16} />{t.delete}</button></div>
        {error && <SavedNote error>{error}</SavedNote>}
      </div>
    </AppShell>
  );
}
