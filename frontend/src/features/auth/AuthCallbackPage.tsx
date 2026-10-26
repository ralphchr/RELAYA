import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthClientError, completeImplicitCallback, completeOAuthCallback, verifyEmailTokenHash, type AuthSession } from "./client.js";
import "./auth.css";

// One request per callback URL, so StrictMode's double effect doesn't spend the code twice.
const authCallbackRequests = new Map<string, Promise<AuthSession>>();

/** /auth/callback: finishes OAuth (PKCE), email-link and implicit-token sign-in. */
export function AuthCallbackPage() {
  const [message, setMessage] = useState("Verifying your sign-in. This should only take a moment.");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const callbackUrl = new URL(window.location.href);
    const code = callbackUrl.searchParams.get("code");
    const tokenHash = callbackUrl.searchParams.get("token_hash");
    const type = callbackUrl.searchParams.get("type");
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const isRecovery = type === "recovery" || hashParams.get("type") === "recovery" || callbackUrl.searchParams.get("next") === "/login?reset=1";
    const isEmailConfirmation = type === "signup" || hashParams.get("type") === "signup" || callbackUrl.searchParams.get("next") === "/email-confirmed";
    const oauthError = callbackUrl.searchParams.get("error_description") ?? callbackUrl.searchParams.get("error") ?? hashParams.get("error_description") ?? hashParams.get("error");
    if (oauthError) {
      setMessage(oauthError);
      setError(true);
      return () => { active = false; };
    }
    const callbackKey = callbackUrl.href;
    let finish = authCallbackRequests.get(callbackKey);
    if (!finish) {
      finish = code
        ? completeOAuthCallback(code)
        : tokenHash && (!type || type === "email" || type === "signup" || type === "magiclink")
          ? verifyEmailTokenHash(tokenHash, (type || "email") as "email" | "signup" | "magiclink")
          : hashParams.has("access_token") && hashParams.has("refresh_token")
            ? Promise.resolve().then(() => completeImplicitCallback(hashParams))
            : Promise.reject(new AuthClientError("This sign-in link is invalid or has expired. Please request a fresh code."));
      authCallbackRequests.set(callbackKey, finish);
      void finish.then(
        () => authCallbackRequests.delete(callbackKey),
        () => authCallbackRequests.delete(callbackKey),
      );
    }
    finish.then(() => {
      if (!active) return;
      const destination = isRecovery ? "/login?reset=1" : isEmailConfirmation ? "/email-confirmed" : "/new";
      window.history.replaceState({}, "", "/auth/callback");
      window.location.replace(destination);
    }).catch((reason: unknown) => {
      if (!active) return;
      setMessage(reason instanceof Error ? reason.message : "We couldn't finish sign-in. Please try again.");
      setError(true);
    });
    return () => { active = false; };
  }, []);
  return <main className="login-page callback-page"><div className="auth-card callback-card"><img className="auth-mark" src="/assets/logo_w.png" alt="Relaya" /><p className="eyebrow">WELCOME TO RELAYA</p><h1>{error ? "Sign-in needs another try." : "Signing you in…"}</h1><p className={error ? "auth-notice auth-error" : "auth-description"} role={error ? "alert" : "status"}>{message}</p>{error && <Link className="button button-primary" to="/login">Back to sign in</Link>}</div></main>;
}
