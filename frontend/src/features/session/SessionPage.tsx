import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { PictureInPicture2 } from "lucide-react";
import { MEET_AGENT_NAME } from "@relaya/contracts";
import { copy } from "../../copy/en.js";
import { isDocumentPipSupported, openDocumentPip } from "../../lib/documentPip.js";
import { useServices } from "../../services/ServicesProvider.js";
import { agentDisplayName, useAccount, useAccountLoaded } from "../account/AccountProvider.js";
import { useSessionDraft } from "../new-session/draft.js";
import { sessionsChanged } from "../sessions/useRecentSessions.js";
import { SessionPanel } from "./SessionPanel.js";
import { usePushToTalk } from "./usePushToTalk.js";
import { useSessionController } from "./useSessionController.js";
import "./panel.css";

/** /session/:sessionId: the in-call panel, beside the user's own meeting window. */
export function SessionPage() {
  // The panel's activity log uses the user's name, so wait for GET /api/me.
  return useAccountLoaded() ? <LiveSession /> : <div className="session-page" aria-busy="true"><div className="spinner" /></div>;
}

function LiveSession() {
  const { sessionId = "" } = useParams();
  const { draft, update, reset } = useSessionDraft();
  const { sessions, agent } = useServices();
  const me = useAccount();
  const navigate = useNavigate();
  const firstName = me?.firstName || "You";
  const mode = draft.mode === "speak" && draft.agentSessionId ? "speak" : "say";

  const c = useSessionController({
    sessionId, mode, firstName, agentName: mode === "speak" ? MEET_AGENT_NAME : agentDisplayName(me),
    agentSessionId: mode === "speak" ? draft.agentSessionId : null,
    tone: draft.tone, languageMode: me?.settings.languageMode ?? "auto", names: draft.names,
    plan: me ? { sentencesLeft: me.plan.sentencesLeft, resetsOn: me.plan.resetsOn } : null,
  });

  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  usePushToTalk(pipWindow ?? window, { onDown: c.pressStart, onUp: c.pressEnd, onCancel: c.cancel, onEnter: c.approve }, me?.settings.pttKey);

  const popOut = useCallback(async () => {
    const win = await openDocumentPip({ width: 460, height: 820 }).catch(() => null);
    if (!win) return;
    win.addEventListener("pagehide", () => setPipWindow(null), { once: true });
    setPipWindow(win);
  }, []);
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  // Closing the tab or window ends the session (with its counts so far) and
  // sends the agent out of the meeting, so neither is left hanging.
  const leavingAgent = mode === "speak" ? draft.agentSessionId : null;
  const stats = useRef(c.state.stats);
  stats.current = c.state.stats;
  useEffect(() => {
    const close = () => {
      if (leavingAgent) agent.leave(leavingAgent);
      void sessions.end(sessionId, stats.current).catch(() => undefined);
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [agent, leavingAgent, sessions, sessionId]);

  // The agent dropped out of the call: send it back in, or carry on in Say it yourself.
  async function rejoin() {
    pipWindow?.close();
    if (draft.agentSessionId) agent.leave(draft.agentSessionId);
    await sessions.end(sessionId, c.state.stats).catch(() => undefined);
    sessionsChanged();
    update({ agentSessionId: null });
    navigate("/new/joining");
  }

  function switchToSay() {
    if (draft.agentSessionId) agent.leave(draft.agentSessionId);
    c.dispatch({ type: "SWITCH_TO_SAY" });
    update({ agentSessionId: null });
  }

  async function quit() {
    pipWindow?.close();
    if (mode === "speak" && draft.agentSessionId) agent.leave(draft.agentSessionId);
    await sessions.end(sessionId, c.state.stats).catch(() => undefined);
    sessionsChanged();
    reset();
    navigate("/new");
  }

  const panel = (
    <SessionPanel
      c={c}
      tone={draft.tone}
      onTone={(tone) => update({ tone })}
      names={draft.names}
      onNames={(names) => update({ names })}
      onQuit={() => { void quit(); }}
      onPopOut={isDocumentPipSupported() && !pipWindow ? () => { void popOut(); } : null}
      onRejoin={() => { void rejoin(); }}
      onUseSay={switchToSay}
    />
  );

  return (
    <div className="session-page">
      {pipWindow ? (
        <>
          {createPortal(panel, pipWindow.document.body)}
          <div className="pip-placeholder">
            <PictureInPicture2 className="icon" />
            <p>{copy.panel.popOutActive}</p>
            <button className="btn btn-ghost" onClick={() => pipWindow.close()}>{copy.panel.bringBack}</button>
          </div>
        </>
      ) : (
        <>
          {panel}
          {!isDocumentPipSupported() && <p className="snap-tip">{copy.panel.snapTip}</p>}
        </>
      )}
    </div>
  );
}
