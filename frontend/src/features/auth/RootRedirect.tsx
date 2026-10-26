import { useEffect, useState } from "react";
import { completeImplicitCallback } from "./client.js";
import { LandingPage } from "../landing/LandingPage.js";

/**
 * `/` is the public product overview. Older magic links may still return
 * session tokens to the site root, so finish that sign-in before navigation.
 */
export function RootRedirect() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has("access_token") && hash.has("refresh_token")) {
      try { completeImplicitCallback(hash); } catch { window.location.replace("/login"); return; }
      // Reload so the account and auth guard read the new session.
      window.location.replace("/new");
      return;
    }
    setReady(true);
  }, []);
  return ready ? <LandingPage /> : null;
}
