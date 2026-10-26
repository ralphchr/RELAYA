import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { copy } from "../../copy/en.js";
import { getSession, requestPasswordReset, restoreSession, sendOtp, signInWithPassword, signUpWithPassword, signInWithProvider, updatePassword, verifyOtp } from "./client.js";
import "./auth.css";
import { FacebookIcon, GoogleIcon } from "../../components/brand/SocialIcons.js";
import type { Gender } from "../../services/types.js";

type AuthTab = "signin" | "signup";

/** /login: password sign-in and account creation, with magic link as a fallback. */
export function LoginPage() {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);
  const [tab, setTab] = useState<AuthTab>("signin");
  const [emailLinkMode, setEmailLinkMode] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(new URLSearchParams(window.location.search).get("reset") === "1");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [code, setCode] = useState("");
  const [codeStep, setCodeStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get("reset") === "1") {
      setRecoveryMode(true);
      setCheckingSession(false);
      return () => { active = false; };
    }
    restoreSession().then((session) => {
      if (!active) return;
      if (session?.access_token) navigate("/new", { replace: true });
      else setCheckingSession(false);
    }).catch(() => {
      if (!active) return;
      if (getSession()?.access_token) navigate("/new", { replace: true });
      else setCheckingSession(false);
    });
    return () => { active = false; };
  }, [navigate]);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (tab === "signup") {
        if (password !== confirmPassword) throw new Error("Your passwords don’t match.");
        if (!gender) throw new Error("Choose your gender to create an account.");
        const result = await signUpWithPassword(address.trim(), password, { fullName: fullName.trim(), dateOfBirth, gender });
        if (result.needsEmailConfirmation) {
          setTab("signin");
          setPassword("");
          setConfirmPassword("");
          setMessage("Account created. Check your email to confirm your address, then sign in.");
          return;
        }
      } else {
        await signInWithPassword(address.trim(), password);
      }
      window.location.assign("/new");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't complete that request. Please try again.");
    } finally { setBusy(false); }
  }

  async function submitEmailLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await sendOtp("email", address.trim());
      setCodeStep(true);
      setMessage("Check your email for a sign-in link or code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't send the email. Please try again.");
    } finally { setBusy(false); }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await verifyOtp("email", address.trim(), code.trim());
      window.location.assign("/new");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That code couldn't be verified. Check it and try again.");
    } finally { setBusy(false); }
  }

  async function submitResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await requestPasswordReset(address.trim());
      setMessage("If an account exists for that email, we’ve sent a password reset link.");
      setResetMode(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't send a reset email. Please try again.");
    } finally { setBusy(false); }
  }

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) { setMessage("Your passwords don’t match."); return; }
    setBusy(true);
    setMessage("");
    try {
      await updatePassword(password);
      setRecoveryMode(false);
      setPassword("");
      setConfirmPassword("");
      window.history.replaceState({}, "", "/login");
      setMessage("Password updated. You can now sign in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't update your password. Please try again.");
    } finally { setBusy(false); }
  }

  async function startSocial(provider: "google" | "facebook") {
    setBusy(true);
    setMessage("");
    try { await signInWithProvider(provider); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't start sign-in. Please try again.");
      setBusy(false);
    }
  }

  if (checkingSession) return <main className="session-restore" role="status">Restoring your saved session…</main>;

  return (
    <main className="login-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" to="/" aria-label={copy.brand.home}><img className="auth-mark" src="/assets/logo_w.png" alt="" /></Link>
        <p className="eyebrow">WELCOME TO RELAYA</p>
        <h1 id="auth-title">{recoveryMode ? "Choose a new password" : codeStep ? "Check your email" : "Welcome to Relaya"}</h1>
        <p className="auth-description">{recoveryMode ? "Set a new password for your account." : codeStep ? `We sent a sign-in message to ${address}.` : "Clearer conversations start here."}</p>

        {!recoveryMode && !codeStep && <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={tab === "signin"} className={tab === "signin" ? "active" : ""} onClick={() => { setTab("signin"); setMessage(""); setResetMode(false); }}>Sign In</button>
          <button type="button" role="tab" aria-selected={tab === "signup"} className={tab === "signup" ? "active" : ""} onClick={() => { setTab("signup"); setMessage(""); setResetMode(false); }}>Create Account</button>
        </div>}

        {recoveryMode ? <form onSubmit={submitNewPassword} className="auth-form">
          <label htmlFor="auth-password">New password</label>
          <input id="auth-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <label htmlFor="auth-confirm-password">Confirm new password</label>
          <input id="auth-confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
        </form> : codeStep ? <form onSubmit={submitCode} className="auth-form">
          <label htmlFor="auth-code">Six-digit code</label>
          <input id="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required />
          <button className="button button-primary auth-submit" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify and sign in"}</button>
          <button className="text-button" type="button" onClick={() => { setCodeStep(false); setMessage(""); }}>Back to sign in</button>
        </form> : resetMode ? <form onSubmit={submitResetRequest} className="auth-form">
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="email" value={address} onChange={(event) => setAddress(event.target.value)} required />
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <button className="text-button" type="button" onClick={() => { setResetMode(false); setMessage(""); }}>Back to sign in</button>
        </form> : <>
          {tab === "signin" && <>
            <div className="social-auth-buttons">
              <button className="google-button" type="button" disabled={busy} onClick={() => startSocial("google")}><GoogleIcon />Continue with Google</button>
              <button className="facebook-button" type="button" disabled={busy} onClick={() => startSocial("facebook")}><FacebookIcon />Continue with Facebook</button>
            </div>
            <div className="auth-divider"><span>or with email</span></div>
          </>}
          <form onSubmit={emailLinkMode && tab === "signin" ? submitEmailLink : submitCredentials} className="auth-form">
            {tab === "signup" && <>
              <label htmlFor="auth-name">Full name</label>
              <input id="auth-name" type="text" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
              <fieldset className="gender-fieldset">
                <legend>Gender <span aria-hidden="true">*</span></legend>
                <div className="gender-options">
                  <label className={`gender-option${gender === "male" ? " selected" : ""}`}>
                    <input type="radio" name="gender" value="male" checked={gender === "male"} onChange={() => setGender("male")} required />
                    <span><strong>Male</strong></span>
                  </label>
                  <label className={`gender-option${gender === "female" ? " selected" : ""}`}>
                    <input type="radio" name="gender" value="female" checked={gender === "female"} onChange={() => setGender("female")} required />
                    <span><strong>Female</strong></span>
                  </label>
                </div>
              </fieldset>
            </>}
            <label htmlFor="auth-email">Email address</label>
            <input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={address} onChange={(event) => setAddress(event.target.value)} required />
            {tab === "signup" && <>
              <label htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <input id="auth-confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              <label htmlFor="auth-birthday">Birthday <span className="optional-label">Optional</span></label>
              <input id="auth-birthday" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
            </>}
            {tab === "signin" && !emailLinkMode && <>
              <label htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </>}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : tab === "signup" ? "Create Account" : emailLinkMode ? "Send sign-in email" : "Sign In"}</button>
          </form>
          {tab === "signin" && <div className="auth-secondary-actions">
            {!emailLinkMode && <button className="text-button" type="button" onClick={() => { setResetMode(true); setMessage(""); }}>Forgot password?</button>}
            <button className="text-button" type="button" onClick={() => { setEmailLinkMode(!emailLinkMode); setMessage(""); }}>{emailLinkMode ? "Use a password instead" : "Use an email sign-in link"}</button>
          </div>}
        </>}

        {message && <p className="auth-notice" role="status">{message}</p>}
        <p className="auth-terms">Your voice stays yours. You approve every sentence. By continuing you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</p>
      </section>
      <footer className="auth-footer"><Link className="guest-continue" to="/new" onClick={() => sessionStorage.setItem("relaya.guestPreview", "1")}>Continue as Guest</Link></footer>
    </main>
  );
}
