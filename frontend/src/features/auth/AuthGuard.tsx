import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSession, isAuthConfigured, isGuestPreview } from "./client.js";
import { useAccount, useAccountLoaded } from "../account/AccountProvider.js";

/**
 * Every app route needs an account (usage limits, names, recents).
 * Without Supabase env vars (local UI work) the app runs as a preview user.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const account = useAccount();
  const accountLoaded = useAccountLoaded();
  const [session, setSession] = useState(getSession);
  useEffect(() => {
    const sync = () => setSession(getSession());
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("relaya:auth-session", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("relaya:auth-session", sync);
    };
  }, []);
  const guestPreview = isGuestPreview();
  if (isAuthConfigured() && !session?.access_token && !guestPreview) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (isAuthConfigured() && session?.access_token && !guestPreview) {
    if (!accountLoaded) return <main className="session-restore" role="status">Loading your account…</main>;
    if (account?.settings.gender == null && location.pathname !== "/settings/preferences") return <Navigate to="/settings/preferences" replace state={{ setup: "gender", from: location.pathname }} />;
  }
  return <>{children}</>;
}
