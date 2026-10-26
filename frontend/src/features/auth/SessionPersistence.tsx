import { useEffect, useState, type ReactNode } from "react";
import { getSession, isAuthConfigured, restoreSession } from "./client.js";

const REFRESH_MARGIN_MS = 60_000;
const RETRY_DELAY_MS = 15_000;

/** Hydrates saved auth before routes render and keeps Supabase tokens renewed. */
export function SessionPersistence({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const savedSession = getSession();
    if (!isAuthConfigured() || !savedSession?.refresh_token) {
      setReady(true);
      return;
    }

    let active = true;
    let timer = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!isAuthConfigured()) return;
      const session = getSession();
      if (!session?.refresh_token) return;
      const expiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + 3_600_000;
      const delay = Math.max(1_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
      timer = window.setTimeout(() => { void refreshAndReschedule(); }, delay);
    };

    const refreshAndReschedule = async () => {
      try {
        await restoreSession();
        if (active) schedule();
      } catch {
        if (active) timer = window.setTimeout(() => { void refreshAndReschedule(); }, RETRY_DELAY_MS);
      }
    };

    const handleFocus = () => { void refreshAndReschedule(); };
    const handleSessionChange = () => schedule();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleSessionChange);
    window.addEventListener("relaya:auth-session", handleSessionChange);

    void restoreSession().catch(() => undefined).finally(() => {
      if (!active) return;
      setReady(true);
      schedule();
    });

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleSessionChange);
      window.removeEventListener("relaya:auth-session", handleSessionChange);
    };
  }, []);

  return ready ? <>{children}</> : <main className="session-restore" role="status">Restoring your saved session…</main>;
}
