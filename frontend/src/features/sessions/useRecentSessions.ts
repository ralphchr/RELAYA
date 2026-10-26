import { useEffect, useState } from "react";
import { useServices } from "../../services/ServicesProvider.js";
import type { SessionRecord } from "../../services/types.js";

/** Starting, ending or deleting a session fires this so lists refresh. */
export const SESSIONS_CHANGED = "relaya:sessions-changed";
export const sessionsChanged = () => window.dispatchEvent(new Event(SESSIONS_CHANGED));

export function useRecentSessions(limit: number) {
  const { data } = useServices();
  const [state, setState] = useState<{ sessions: SessionRecord[]; loaded: boolean; failed: boolean }>({ sessions: [], loaded: false, failed: false });

  useEffect(() => {
    let active = true;
    const load = () => {
      data.recentSessions(limit)
        .then((sessions) => { if (active) setState({ sessions, loaded: true, failed: false }); })
        .catch(() => { if (active) setState((s) => ({ ...s, loaded: true, failed: true })); });
    };
    load();
    for (const event of [SESSIONS_CHANGED, "relaya:auth-session"]) window.addEventListener(event, load);
    return () => { active = false; for (const event of [SESSIONS_CHANGED, "relaya:auth-session"]) window.removeEventListener(event, load); };
  }, [data, limit]);

  return state;
}
