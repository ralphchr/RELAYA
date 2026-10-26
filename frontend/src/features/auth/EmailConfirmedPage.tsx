import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { RelayaLockup } from "../../components/brand/RelayaMark.js";
import "./auth.css";

/** Confirmation destination for newly created email/password accounts. */
export function EmailConfirmedPage() {
  return (
    <main className="login-page callback-page">
      <section className="auth-card email-confirmed-card" aria-labelledby="email-confirmed-title">
        <Link className="confirmed-lockup" to="/" aria-label="Relaya home"><RelayaLockup size={32} /></Link>
        <span className="email-confirmed-icon" aria-hidden="true"><Check /></span>
        <p className="eyebrow">WELCOME TO RELAYA</p>
        <h1 id="email-confirmed-title">Your email is confirmed</h1>
        <p className="auth-description">Your account is ready. Sign in to start using Relaya.</p>
        <Link className="button button-primary auth-submit confirmed-continue" to="/login">Continue to sign in <span aria-hidden="true">→</span></Link>
      </section>
    </main>
  );
}
