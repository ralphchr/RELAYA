import { copy } from "../../../copy/en.js";
import type { ActivityEntry, PanelState } from "../machine.js";
import { RelayaMark } from "../../../components/brand/RelayaMark.js";
import { NamesCard } from "./NamesCard.js";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A heads-up once the plan is nearly used up, so the limit never comes as a surprise mid-call. */
export function quotaWarning({ left, windowLeft }: PanelState["quota"]): string | null {
  const q = copy.panel.quota;
  if (left !== null && left <= 5) return left === 0 ? q.monthDone : q.monthLeft(left);
  if (windowLeft === null || windowLeft > 3) return null;
  return windowLeft === 0 ? q.windowOut : q.windowLeft(windowLeft);
}

/** Ready / done: names, the resting mark, and Relaya's own activity. */
export function ReadyView({ names, onNames, activity, notice, quota }: { names: string[]; onNames: (names: string[]) => void; activity: ActivityEntry[]; notice: string | null; quota: PanelState["quota"] }) {
  const warning = quotaWarning(quota);
  return (
    <div className="landing">
      <NamesCard names={names} onChange={onNames} />
      <div className="ready"><div className="rings"><b /><b /><i /><RelayaMark size={72} /></div></div>
      {notice && <p className="panel-notice" role="status">{notice}</p>}
      {warning && <p className="panel-notice quota-notice" role="status">{warning}</p>}
      <div className="activity" aria-label="Activity">
        {activity.slice(-4).map((entry) => <p key={entry.id}><b>{entry.who}</b> {entry.what} <span>· {time(entry.at)}</span></p>)}
      </div>
    </div>
  );
}
