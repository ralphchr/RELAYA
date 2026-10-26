import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "./legal.css";

/** Shown at the top of both pages. Change it whenever either page changes. */
const UPDATED = "October 17, 2026";
/** Where people send privacy requests. Fill in before the pilot; the line is hidden while empty. */
export const CONTACT_EMAIL = "relaya.agent.demo@gmail.com";

function LegalLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className="legal">
      <header className="legal-bar">
        <Link className="legal-brand" to="/" aria-label="Relaya home"><img src="/assets/relaya-logo.png" alt="" width={30} height={30} /><span>RELAYA</span></Link>
        <Link className="legal-back" to="/"><ArrowLeft size={16} aria-hidden="true" />Back to Relaya</Link>
      </header>
      <article className="legal-body">
        <p className="legal-updated">Last updated {UPDATED}</p>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        {children}
        {CONTACT_EMAIL && <p className="legal-contact">Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>}
        <nav className="legal-links" aria-label="Legal"><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Use</Link></nav>
      </article>
    </main>
  );
}

/** /privacy */
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" intro="Relaya helps you say what you mean in meetings. This page explains what we keep, what we never keep, and who helps us run the service. We handle personal data in line with the Philippine Data Privacy Act of 2012.">
      <h2>What we never keep</h2>
      <ul>
        <li><b>Your recordings.</b> When you hold to speak, the recording is sent to our transcription provider to make your sentence. Relaya doesn't store it.</li>
        <li><b>Transcripts and sentences.</b> What you said and the sentence Relaya rebuilt are shown in your browser and not saved.</li>
        <li><b>Other people in your meeting.</b> Relaya only processes your own voice. The Speak for me agent doesn't record or save anything said in the meeting.</li>
      </ul>

      <h2>What we keep</h2>
      <ul>
        <li><b>Your account:</b> email address, name, birthday if you gave one, and how you sign in (email, Google or Facebook).</li>
        <li><b>Your settings:</b> default mode and tone, voice, speed, your agent's name and your email choices.</li>
        <li><b>Your name lists:</b> the names and terms you save so Relaya spells them right.</li>
        <li><b>Session history:</b> for each session, its mode, tone, start and end time, the names you used, and counts (sentences approved, fixes kept, used as is, re-records). Never the sentences themselves.</li>
        <li><b>Plan usage:</b> how many Speak for me sessions and agent minutes you used, so your plan's limits work.</li>
        <li><b>Your agreement</b> to the Speak for me terms, with the date.</li>
      </ul>

      <h2>Who helps us run Relaya</h2>
      <ul>
        <li><b>Supabase</b> stores your account and the data listed above, and handles sign-in.</li>
        <li><b>Groq</b> turns your recording into text and rebuilds the sentence. It receives your recording, the names for that call, and your tone.</li>
        <li><b>Google and Facebook</b>, only if you choose to sign in with them.</li>
        <li><b>Our hosting providers</b> run the web app and the API.</li>
      </ul>
      <p>We don't sell your data and we don't use it for ads.</p>

      <h2>In your browser</h2>
      <p>Relaya keeps your sign-in and a few preferences in your browser's storage so you stay signed in. In the preview workspace (not signed in), your lists and history are kept only in that browser. We don't use advertising or tracking cookies.</p>

      <h2>How long we keep it</h2>
      <p>Your account data stays until you delete it or ask us to. You can delete any session from Sessions at any time. Deleting your account removes your settings, lists, history and usage.</p>

      <h2>Your rights</h2>
      <p>You can ask to see, correct or delete your personal data, and you can withdraw consent to Speak for me at any time by not using it. To delete your account, contact the Relaya team.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we'll update the date above and tell signed-in users about important changes.</p>
    </LegalLayout>
  );
}

/** /terms */
export function TermsPage() {
  return (
    <LegalLayout title="Terms of Use" intro="Relaya is in early access. By using it, you agree to these terms.">
      <h2>What Relaya does</h2>
      <p>Relaya turns what you say, in Tagalog, Bisaya, English, Japanese, Mandarin Chinese, Spanish or a mix, into a clear English sentence. You review and approve every sentence. You then read it yourself, or your Speak for me agent says it in a Google Meet call.</p>

      <h2>You're responsible for what you approve</h2>
      <ul>
        <li>Relaya can make mistakes. Context Guard flags risky changes like names, numbers, dates and certainty, but it can miss some. Read each sentence before you approve it.</li>
        <li>An approved sentence is your statement, whether you read it or your agent says it.</li>
      </ul>

      <h2>Using Speak for me</h2>
      <ul>
        <li>Your agent always joins labeled as AI, and the host has to admit it. Don't try to hide that it's an AI.</li>
        <li>Tell the people in your meeting that an AI guest may speak for you, and follow your workplace's or school's rules on AI in meetings.</li>
        <li>Don't use Relaya to impersonate someone, mislead people, or say anything unlawful or harmful.</li>
      </ul>

      <h2>Plans and limits</h2>
      <p>The Free plan includes a set number of Speak for me sessions and agent minutes each month, shown in the app. During early access we may change plans and limits; we'll show the current ones in the app.</p>

      <h2>Your account</h2>
      <p>Keep your sign-in secure. We may suspend accounts that misuse Relaya or break these terms.</p>

      <h2>No guarantees</h2>
      <p>Relaya is provided as is during early access. We work to keep it available and accurate, but we can't promise it will always work, or that every sentence will be right. To the extent the law allows, we aren't liable for losses caused by using it.</p>

      <h2>Changes</h2>
      <p>We may update these terms. If we do, we'll change the date above, and using Relaya after that means you accept the new terms.</p>
    </LegalLayout>
  );
}
