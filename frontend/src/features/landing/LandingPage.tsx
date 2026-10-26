import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Mic, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { RelayaMark } from "../../components/brand/RelayaMark.js";
import { getSession } from "../auth/client.js";
import sayArt from "../new-session/illustrations/say.svg";
import speakArt from "../new-session/illustrations/speak.svg";
import "./landing.css";

const WAVE = [14, 26, 18, 34, 22, 40, 28, 18, 32, 24, 14, 30, 20];
const prefersReducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PLANS = [
  { name: "Free", price: "₱0", per: "/ month", featured: true, points: ["60 sentences a month, up to 15 every 6 hours", "Context Guard on every sentence", "8 Speak for me sessions a month", "Up to 30 minutes per meeting"] },
  { name: "Pro", price: "Coming soon", per: "", featured: false, points: ["Everything in Free", "1,000 sentences a month, no hourly cap", "Unlimited Speak for me sessions", "Up to 2 hours per meeting", "1,800 agent minutes a month"] },
  { name: "Teams", price: "Coming soon", per: "", featured: false, points: ["Everything in Pro, per seat", "For groups of 5 or more", "One plan for the whole team"] },
];

/** Public landing page at /. Visual first: short lines, product shown instead of described. */
export function LandingPage() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getSession()?.access_token));

  useEffect(() => {
    const syncSession = () => setSignedIn(Boolean(getSession()?.access_token));
    window.addEventListener("relaya:auth-session", syncSession);
    window.addEventListener("storage", syncSession);
    window.addEventListener("focus", syncSession);
    return () => {
      window.removeEventListener("relaya:auth-session", syncSession);
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("focus", syncSession);
    };
  }, []);

  useEffect(() => {
    const page = document.querySelector(".lp");
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-lp-reveal]"));
    if (!page || prefersReducedMotion()) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    page.classList.add("lp-motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -36px 0px" });
    targets.forEach((target) => observer.observe(target));

    return () => {
      observer.disconnect();
      page.classList.remove("lp-motion-ready");
    };
  }, []);

  return (
    <main className="lp">
      <header className="lp-bar">
        <div className="lp-bar-in">
          <Link className="lp-brand" to="/" aria-label="Relaya home" onClick={(event) => {
            if (window.location.pathname !== "/") return;
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
          }}><img src="/assets/relaya-logo.png" alt="" width={34} height={34} /><span>RELAYA</span></Link>
          <nav className="lp-nav" aria-label="Main navigation">
            <a href="#ways-to-use">Ways to use Relaya</a>
            <a href="#how-it-works">How it works</a>
            <a href="#privacy">Your privacy</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <Link className="lp-cta header-cta" to={signedIn ? "/new" : "/login"}>{signedIn ? "Go to app" : "Sign up / Login"} <ArrowRight className="lp-i" aria-hidden="true" /></Link>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <i className="lp-blob lp-blob-a" aria-hidden="true" />
        <i className="lp-blob lp-blob-b" aria-hidden="true" />
        <div className="lp-hero-in">
          <div className="lp-hero-copy" data-lp-hero-copy>
            <span className="lp-pill"><Sparkles className="lp-i" aria-hidden="true" />Taglish in. Clear English out.</span>
            <h1>Speak clearly, <em>in your own words.</em></h1>
            <div className="lp-actions">
              <Link className="lp-btn lp-btn-coral" to="/login">Get started <ArrowRight className="lp-i" aria-hidden="true" /></Link>
              <a className="lp-btn lp-btn-ghost" href="#how-it-works">See how it works</a>
            </div>
          </div>

          <div className="lp-stage" data-lp-hero-stage role="img" aria-label="Relaya turning a Taglish thought into a clear English sentence, checked by Context Guard">
            <div className="lp-bubble lp-said">
              <span className="lp-tag">Taglish</span>
              “Siguro mga three days pa bago ma-deliver…”
            </div>
            <div className="lp-wave-pill"><Mic className="lp-i" aria-hidden="true" /><span className="lp-wave">{WAVE.map((h, i) => <i key={i} style={{ height: h }} />)}</span></div>
            <div className="lp-card lp-sentence">
              <div className="lp-card-top"><RelayaMark size={28} /><span className="lp-chip lp-chip-green"><ShieldCheck className="lp-i" aria-hidden="true" />Clear</span></div>
              <p>It <mark>might take about three more days</mark> before we can deliver it.</p>
            </div>
            <div className="lp-float lp-float-guard"><span className="lp-dot"><Check className="lp-i" aria-hidden="true" /></span>“Siguro” kept as “might”</div>
            <div className="lp-float lp-float-approve"><Check className="lp-i" aria-hidden="true" />Approve &amp; say it</div>
            <Sparkles className="lp-spark lp-spark-a" aria-hidden="true" />
            <Sparkles className="lp-spark lp-spark-b" aria-hidden="true" />
          </div>
        </div>
        <svg className="lp-wave-edge" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 34 C 180 72 350 12 540 32 C 720 52 880 72 1060 38 C 1210 10 1320 16 1440 38 V90 H0 Z" /></svg>
      </section>

      {/* Two modes */}
      <section className="lp-modes" id="ways-to-use">
        <h2 className="lp-h2" data-lp-reveal>Two ways to <em>speak up.</em></h2>
        <div className="lp-mode-grid" data-lp-reveal>
          <article className="lp-mode lp-mode-say">
            <img src={sayArt} alt="Person reading a prepared sentence beside their video call" />
            <div className="lp-mode-foot">
              <span className="lp-mode-ic"><Mic className="lp-i" aria-hidden="true" /></span>
              <div><h3>Say it yourself</h3><p>Read it in your own voice.</p></div>
            </div>
          </article>
          <article className="lp-mode lp-mode-speak">
            <img src={speakArt} alt="A labeled Relaya agent speaking in the call for the user" />
            <div className="lp-mode-foot">
              <span className="lp-mode-ic"><Volume2 className="lp-i" aria-hidden="true" /></span>
              <div><h3>Speak for me</h3><p>Your labeled Relaya says it.</p></div>
            </div>
          </article>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how" id="how-it-works">
        <svg className="lp-wave-top" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 50 C 240 0 480 80 720 40 S 1200 0 1440 40 V0 H0 Z" /></svg>
        <h2 className="lp-h2" data-lp-reveal>Hold. Check. <em>Approve.</em></h2>
        <ol className="lp-steps" data-lp-reveal>
          <li><span className="lp-step-art lp-step-hold"><Mic aria-hidden="true" /></span><b>Hold to speak</b><small>Any mix of languages</small></li>
          <li><span className="lp-step-art lp-step-guard"><ShieldCheck aria-hidden="true" /></span><b>Context Guard checks</b><small>Names, numbers, “maybe”</small></li>
          <li><span className="lp-step-art lp-step-ok"><Check aria-hidden="true" /></span><b>You approve</b><small>Then it’s said</small></li>
        </ol>
      </section>

      {/* Privacy */}
      <section className="lp-trust" id="privacy">
        <div className="lp-rings" data-lp-reveal aria-hidden="true"><i /><i /><RelayaMark size={96} /></div>
        <div className="lp-trust-copy" data-lp-reveal>
          <h2 className="lp-h2 lp-left">Your voice. <em>Your call.</em></h2>
          <ul>
            <li><span><Check className="lp-i" aria-hidden="true" /></span>Nothing is said without your approval</li>
            <li><span><Check className="lp-i" aria-hidden="true" /></span>The agent is always labeled as AI</li>
            <li><span><Check className="lp-i" aria-hidden="true" /></span>Stop it mid-sentence, anytime</li>
          </ul>
        </div>
      </section>

      {/* Pricing: planned tiers, no checkout yet */}
      <section className="lp-pricing" id="pricing">
        <svg className="lp-pricing-wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 34 C 180 5 360 66 545 35 C 730 5 910 11 1080 35 C 1220 55 1330 54 1440 28 V60 H0 Z" /></svg>
        <div className="lp-pricing-intro" data-lp-reveal>
          <h2 className="lp-h2">Start free. <em>Grow when you need to.</em></h2>
        </div>
        <div className="lp-price-grid" data-lp-reveal>
          {PLANS.map((plan) => (
            <article key={plan.name} className={`lp-price${plan.featured ? " featured" : " coming-soon"}`}>
              <h3>{plan.name}</h3>
              <p className={`lp-price-tag${plan.featured ? "" : " soon"}`}>{plan.price}{plan.per && <small>{plan.per}</small>}</p>
              <ul>{plan.points.map((point) => <li key={point}><Check className="lp-i" aria-hidden="true" />{point}</li>)}</ul>
              {plan.featured && <Link className="lp-btn lp-btn-coral" to="/login">Start free <ArrowRight className="lp-i" aria-hidden="true" /></Link>}
            </article>
          ))}
        </div>
      </section>

      {/* Closing */}
      <section className="lp-close">
        <svg className="lp-wave-top lp-wave-light" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C 240 80 480 0 720 40 S 1200 80 1440 30 V0 H0 Z" /></svg>
        <h2 data-lp-reveal>Let’s find <em>your words.</em></h2>
        <div data-lp-reveal><Link className="lp-btn lp-btn-light" to="/login">Sign up / Login <ArrowRight className="lp-i" aria-hidden="true" /></Link></div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <Link className="lp-brand" to="/" aria-label="Relaya home"><img src="/assets/relaya-logo.png" alt="" width={28} height={28} /><span>RELAYA</span></Link>
          <nav className="lp-foot-links" aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><span>© 2026 Relaya</span></nav>
        </div>
      </footer>
    </main>
  );
}
