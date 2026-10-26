import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronLeft, Mic, RotateCcw, X } from "lucide-react";
import { MEET_AGENT_NAME, type AgentStatus } from "@relaya/contracts";
import { AppShell } from "../../components/shell/AppShell.js";
import { ModePill } from "../../components/ui/ModePill.js";
import { copy } from "../../copy/en.js";
import { useServices } from "../../services/ServicesProvider.js";
import { useAccount } from "../account/AccountProvider.js";
import { sessionsChanged } from "../sessions/useRecentSessions.js";
import { useSessionDraft } from "../new-session/draft.js";
import type { AgentJoinProblem } from "../../services/types.js";
import { hasAgentConsent } from "./consent.js";
import { Crumbs } from "./Crumbs.js";
import "./meeting-link.css";

type FailStatus = "declined" | "timeout" | "blocked" | "failed";
const isFail = (s: AgentStatus): s is FailStatus => s === "declined" || s === "timeout" || s === "blocked" || s === "failed";

function failSub(problem: AgentJoinProblem | null, status: AgentStatus, detail?: string) {
  if (problem === "bot_name_mismatch" || problem === "bot_name_unverified") return detail ?? "Check the bot's Google profile name, then ask again.";
  if (!problem && status === "blocked") return copy.joining.blockedSub;
  const p = copy.joining.problems;
  return problem === "quota" ? p.quotaSub : problem === "signed_out" ? p.signedOutSub : problem === "agent_offline" ? p.agentOfflineSub
    : problem === "bot_signed_out" ? p.botSignedOutSub : copy.joining.failedSub;
}

function failTitle(status: FailStatus, agentName: string, problem: AgentJoinProblem | null) {
  const p = copy.joining.problems;
  if (problem === "bot_name_mismatch") return p.botNameMismatch;
  if (problem === "bot_name_unverified") return p.botNameUnverified;
  if (problem) return problem === "quota" ? p.quota : problem === "signed_out" ? p.signedOut : problem === "bot_signed_out" ? p.botSignedOut : p.agentOffline;
  const f = copy.joining.failed;
  return status === "declined" ? f.declined(agentName) : f[status];
}

type RowState = "done" | "active" | "fail" | "";
function StepRow({ state, text }: { state: RowState; text: string }) {
  return (
    <div className={`step-row ${state}`}>
      <span className="st">{state === "done" ? <Check className="icon" strokeWidth={3} /> : state === "fail" ? <X className="icon" strokeWidth={3} /> : null}</span>
      {text}
    </div>
  );
}

/** /new/joining: the agent asks to join and waits for the host to admit it. */
export function JoiningPage() {
  const { draft, update } = useSessionDraft();
  const { agent, sessions } = useServices();
  const me = useAccount();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AgentStatus>("preparing");
  const [problem, setProblem] = useState<{ kind: AgentJoinProblem; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const agentName = MEET_AGENT_NAME;
  const meeting = draft.meeting;

  useEffect(() => {
    if (!meeting) return;
    setStatus("preparing");
    setProblem(null);
    const handle = agent.join(
      {
        meetingUrl: meeting.url, displayName: agentName, consent: hasAgentConsent(me?.email ?? null),
        ...(me ? { voice: me.settings.voiceId, speed: me.settings.voiceSpeed } : {}),
      },
      (next, why) => { setStatus(next); setProblem(why ?? null); },
    );
    update({ agentSessionId: handle.agentSessionId });
    return () => handle.cancel();
    // One join per attempt or link change; the agent name and update() don't restart it.
  }, [agent, meeting?.url, attempt]);

  if (draft.mode !== "speak" || !meeting) return <Navigate to="/new" replace />;

  function cancel() {
    if (draft.agentSessionId) agent.leave(draft.agentSessionId);
    navigate("/new");
  }

  async function startSession() {
    if (!meeting) return;
    setStarting(true);
    try {
      const { id } = await sessions.create({ mode: "speak", tone: draft.tone, names: draft.names, meetingUrl: meeting.url });
      sessionsChanged();
      navigate(`/session/${id}`);
    } finally {
      setStarting(false);
    }
  }

  function switchToSay() {
    if (draft.agentSessionId) agent.leave(draft.agentSessionId);
    update({ mode: "say", meeting: null, agentSessionId: null });
    navigate("/new");
  }

  const t = copy.joining;
  const failed = isFail(status);
  const failStatus = failed ? status : null;
  const admitted = status === "admitted";
  const lastStep = failed ? (status === "declined" ? t.steps.declined : t.steps.notAdmitted) : admitted ? t.steps.admitted : t.steps.waitingHost;

  return (
    <AppShell title={copy.newSession.pageTitle}>
      <div className="setup-card">
        <div className="row-end"><ModePill mode="speak" /><Crumbs at={admitted ? 2 : 1} /></div>
        <div className="join-head" role="status" aria-live="polite">
          {failed ? <div className="ok-badge err-badge"><X className="icon" strokeWidth={3} /></div>
            : admitted ? <div className="ok-badge"><Check className="icon" strokeWidth={3} /></div>
            : <div className="spinner" aria-hidden="true" />}
          <div>
            <h2>{failed ? failStatus && failTitle(failStatus, agentName, problem?.kind ?? null) : admitted ? t.admitted(agentName) : status === "preparing" ? t.preparing : t.waiting}</h2>
            <p>{failed ? failSub(problem?.kind ?? null, status, problem?.message) : admitted ? t.admittedSub : `Google Meet · meet.google.com/${meeting.code}`}</p>
          </div>
        </div>
        {problem?.kind === "bot_name_mismatch" && <div className="steps">
          <p>{t.problems.googleNameAccountNote}</p>
          <a className="btn btn-ghost" href="https://myaccount.google.com/name" target="_blank" rel="noopener noreferrer">{t.problems.googleNameSettings}</a>
        </div>}
        <div className="steps">
          <StepRow state="done" text={t.steps.linkChecked} />
          {problem ? (
            // Stopped before the agent was asked: the host never saw a request.
            <StepRow state="fail" text={t.steps.preparingAgent} />
          ) : <>
            <StepRow state={status === "preparing" ? "active" : "done"} text={status === "preparing" ? t.steps.preparingAgent : t.steps.agentPrepared} />
            <StepRow state={failed ? "fail" : admitted ? "done" : status === "waiting_host" ? "active" : ""} text={lastStep} />
          </>}
        </div>
        <div className="row-end">
          {failed ? <>
            <button className="btn btn-ghost" onClick={() => navigate("/new")}><ChevronLeft className="icon" />{copy.common.back}</button>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={switchToSay}><Mic className="icon" />{t.useSay}</button>
            {problem?.kind !== "quota" && <button className="btn btn-coral" onClick={() => setAttempt((n) => n + 1)}><RotateCcw className="icon" />{t.askAgain}</button>}
          </> : admitted ? <>
            <button className="btn btn-ghost" onClick={cancel}><ChevronLeft className="icon" />{copy.common.back}</button>
            <span className="spacer" />
            <button className="btn btn-coral" onClick={startSession} disabled={starting}>{t.startSession}<ArrowRight className="icon" /></button>
          </> : (
            <button className="btn btn-ghost" onClick={cancel}><X className="icon" />{copy.common.cancel}</button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
