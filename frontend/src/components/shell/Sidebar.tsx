import { useEffect, useRef, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { BookOpenText, PanelLeft, Plus, Search, Settings, Volume2, X } from "lucide-react";
import { RelayaLockup } from "../brand/RelayaMark.js";
import { copy } from "../../copy/en.js";
import { useAccount } from "../../features/account/AccountProvider.js";
import { useRecentSessions } from "../../features/sessions/useRecentSessions.js";
import type { SessionRecord } from "../../services/types.js";
import { AccountMenu } from "./AccountMenu.js";

const NAV = [
  { to: "/new", label: copy.shell.nav.newSession, Icon: Plus },
  { to: "/names", label: copy.shell.nav.names, Icon: BookOpenText },
  { to: "/voice", label: copy.shell.nav.voice, Icon: Volume2 },
  { to: "/settings", label: copy.shell.nav.settings, Icon: Settings },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Today, Yesterday, This week (last 7 days) or Earlier, and how to show the start time in that group. */
function dayGroup(startedAt: string, now = new Date()) {
  const d = new Date(startedAt);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY_MS);
  const g = copy.shell.recentsDays;
  if (days <= 0) return { label: g.today, when: time(d) };
  if (days === 1) return { label: g.yesterday, when: time(d) };
  if (days < 7) return { label: g.week, when: `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time(d)}` };
  return { label: g.earlier, when: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
}

/** The plan card stays hidden once dismissed, until the plan resets. */
const PLAN_DISMISSED_KEY = "relaya.planCardDismissed";
function readDismissed(resetsOn: string | undefined) {
  try { return Boolean(resetsOn) && localStorage.getItem(PLAN_DISMISSED_KEY) === resetsOn; } catch { return false; }
}

/** The last few sessions, grouped by day. */
function RecentList({ sessions }: { sessions: SessionRecord[] }) {
  const groups: { label: string; items: { s: SessionRecord; when: string }[] }[] = [];
  for (const s of sessions) {
    const { label, when } = dayGroup(s.startedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push({ s, when });
    else groups.push({ label, items: [{ s, when }] });
  }
  return <>
    {groups.map((group) => (
      <div key={group.label} className="rec-g">
        <div className="rec-day">{group.label}</div>
        {group.items.map(({ s, when }) => (
          <NavLink key={s.id} to={`/sessions/${s.id}`} className={({ isActive }) => `rec-i${isActive ? " on" : ""}`} title={s.title}>
            <span className="rec-mode">{copy.modes[s.mode].label}</span><small className="rec-when">{when}</small>
          </NavLink>
        ))}
      </div>
    ))}
  </>;
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const me = useAccount();
  const plan = me?.plan;
  const recents = useRecentSessions(10);
  const [planDismissed, setPlanDismissed] = useState(() => readDismissed(plan?.resetsOn));
  // The account loads after the first render on a fresh page.
  useEffect(() => { if (readDismissed(plan?.resetsOn)) setPlanDismissed(true); }, [plan?.resetsOn]);
  const dismissPlan = () => {
    setPlanDismissed(true);
    try { if (plan) localStorage.setItem(PLAN_DISMISSED_KEY, plan.resetsOn); } catch { /* per-viewer convenience only */ }
  };
  const planCardRef = useRef<HTMLDivElement>(null);
  const limited = plan && plan.agentSessionsTotal !== null && plan.agentSessionsLeft !== null;
  const sessionsRemaining = limited ? copy.shell.plan.left(plan.agentSessionsLeft!, plan.agentSessionsTotal!) : undefined;
  useEffect(() => {
    const card = planCardRef.current;
    if (!card) return;
    if (planDismissed) card.setAttribute("inert", "");
    else card.removeAttribute("inert");
  }, [planDismissed]);
  return (
    <aside className="side" aria-label="Sidebar">
      <div className="side-top">
        <Link to="/new" aria-label={copy.brand.home} className="side-brand"><RelayaLockup size={32} /></Link>
        {!collapsed && <Link className="side-ic side-search" to="/search" aria-label={copy.shell.search} title={copy.shell.search}><Search className="icon" /></Link>}
        <button className="side-ic side-toggle" onClick={onToggle} aria-label={collapsed ? copy.shell.expand : copy.shell.collapse} aria-expanded={!collapsed}><PanelLeft className={`icon${collapsed ? " is-collapsed" : ""}`} /></button>
      </div>

      <nav className="nav">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-i${isActive ? " on" : ""}`} title={collapsed ? label : undefined}>
            <Icon className="icon" aria-hidden="true" /><span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="recents">
        <div className="rec-l">
          <span>{copy.shell.recents}</span>
          {recents.sessions.length > 0 && <Link className="rec-all" to="/sessions">{copy.shell.recentsAll}</Link>}
        </div>
        {recents.sessions.length > 0
          ? <RecentList sessions={recents.sessions} />
          : <Link className="rec-empty" to="/sessions">{copy.shell.recentsEmpty}</Link>}
      </div>

      <div className="side-foot">
        {plan && (
          <div ref={planCardRef} className={`plan${planDismissed ? " is-dismissed" : ""}`} aria-hidden={planDismissed}>
            <div className="plan-t"><b>{plan.name}</b><span>{limited ? copy.shell.plan.left(plan.agentSessionsLeft!, plan.agentSessionsTotal!) : copy.shell.plan.minutesLeft(plan.agentMinutesLeft)}</span></div>
            <button className="plan-dismiss" type="button" aria-label={copy.common.dismiss} title={copy.common.dismiss} onClick={dismissPlan}><X className="icon" aria-hidden="true" /></button>
            {limited && (
              <div className="bar" role="progressbar" aria-label={copy.shell.plan.barLabel} aria-valuemin={0} aria-valuemax={plan.agentSessionsTotal!} aria-valuenow={plan.agentSessionsLeft!}>
                <i style={{ width: `${(plan.agentSessionsLeft! / Math.max(1, plan.agentSessionsTotal!)) * 100}%` }} />
              </div>
            )}
            <p>{copy.shell.plan.resets(plan.resetsOn)}</p>
            <Link className="plan-up" to="/billing">{copy.shell.plan.upgrade}</Link>
          </div>
        )}
      </div>
      <AccountMenu {...(planDismissed && sessionsRemaining ? { sessionsRemaining } : {})} />
    </aside>
  );
}
