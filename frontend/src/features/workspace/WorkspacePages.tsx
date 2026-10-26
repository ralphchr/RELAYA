import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronRight, CircleHelp, Copy, Search } from "lucide-react";
import { AppShell } from "../../components/shell/AppShell.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { useAccount } from "../account/AccountProvider.js";
import { PageIntro } from "./parts.js";
import "./workspace-pages.css";

const SEARCH_ITEMS = [
  { title: "New session", description: "Choose how you want to communicate", to: "/new", terms: "session call mode microphone" },
  { title: "Sessions", description: "Review recent conversations", to: "/sessions", terms: "history recent conversations" },
  { title: "Glossary", description: "Manage words and terms Relaya should recognize", to: "/names", terms: "names glossary people terms" },
  { title: "Voice", description: "Choose your agent's voice, speed and name", to: "/voice", terms: "voice speaking sound speed agent name" },
  { title: "Profile", description: "Your identity and communication preferences", to: "/profile", terms: "profile account name avatar voice language" },
  { title: "Preferences", description: "Defaults for new sessions", to: "/settings/preferences", terms: "settings tone mode defaults" },
  { title: "Privacy settings", description: "What Relaya keeps and never keeps", to: "/settings/privacy", terms: "settings privacy data" },
  { title: "Notification settings", description: "Email preferences", to: "/settings/notifications", terms: "settings notifications email" },
  { title: "Plan and usage", description: "Your plan and what's left this month", to: "/billing", terms: "plan billing usage sessions minutes" },
  { title: "Help center", description: "Find answers and troubleshooting steps", to: "/help", terms: "help support microphone troubleshooting" },
];

export { NamesPage } from "./NamesPage.js";
export { VoicePage } from "./VoicePage.js";
export { SettingsPage } from "./SettingsPage.js";

export function BillingPage() {
  const plan = useAccount()?.plan;
  const sessions = plan?.agentSessionsTotal === null ? "Unlimited Speak for me sessions" : `${plan?.agentSessionsLeft ?? 8} of ${plan?.agentSessionsTotal ?? 8} Speak for me sessions left`;
  return <AppShell title="Plan and usage"><div className="workspace-page"><PageIntro eyebrow="YOUR PLAN" title="Plan and usage" text="Your current plan and what's left this month." />
    <section className="workspace-card billing-current"><div><p className="workspace-eyebrow">CURRENT PLAN</p><h3>{plan?.name ?? "Free plan"}</h3><p>{plan?.sentencesLeft ?? 60} of {plan?.sentencesTotal ?? 60} sentences left · {sessions} · {plan?.agentMinutesLeft ?? 240} agent minutes left. Resets on {plan?.resetsOn ?? "the next cycle"}.</p></div><span className="billing-pill">Active</span></section>
    <div className="billing-grid"><section className="workspace-card"><p className="workspace-eyebrow">INCLUDED</p><h3>Free</h3><p className="billing-price">₱0 <small>/ month</small></p><ul><li>60 sentences a month, up to 15 every 6 hours</li><li>8 Speak for me sessions a month, up to 30 minutes each</li><li>240 agent minutes a month</li><li>Say it yourself</li><li>Review and approve every sentence</li></ul></section><section className="workspace-card billing-pro"><p className="workspace-eyebrow">FOR MORE ROOM</p><h3>Pro</h3><p className="billing-price">Coming soon</p><ul><li>1,000 sentences a month, no hourly cap</li><li>Unlimited Speak for me sessions, up to 2 hours each</li><li>1,800 agent minutes a month</li></ul><button className="wp-button" disabled title="Payments are not connected yet">Upgrade unavailable</button><p className="workspace-local-note">Checkout isn't connected yet.</p></section></div>
  </div></AppShell>;
}

export function NotificationsPage() {
  return <AppShell title="Notifications"><div className="workspace-page"><PageIntro eyebrow="UPDATES" title="Notifications" text="Activity and account updates will appear here." /><div className="workspace-card"><EmptyState title="You’re all caught up" body="There are no notifications yet. Relaya will show updates here when notifications are connected." /></div></div></AppShell>;
}

const HELP_ARTICLES = [
  { title: "Getting started", category: "Basics", body: "Choose Say it yourself to record a short phrase and review a clearer draft. Choose Speak for me to prepare a Google Meet guest, then start only after the host admits it." },
  { title: "The two speaking modes", category: "Basics", body: "In Say it yourself, Relaya prepares a sentence for you to read aloud. In Speak for me, a labeled AI guest can say only the sentence you approve." },
  { title: "Context Guard", category: "Reviewing a draft", body: "Context Guard highlights changes that may affect names, certainty, numbers, or meaning. Keep the suggested fix, use the draft as written, or record again." },
  { title: "Names and uncommon terms", category: "Reviewing a draft", body: "Add important names and terms before a session so Relaya can use them as context. Review any transcription carefully, especially names and figures." },
  { title: "Admitting Relaya to Google Meet", category: "Speak for me", body: "The host has to admit your agent. It joins labeled as AI, muted, and only speaks sentences you approve. Tell the people in the meeting that an AI guest may speak for you. The meeting must allow guests to ask to join." },
  { title: "If your agent leaves the meeting", category: "Speak for me", body: "If the host removes your agent or its time runs out, the panel says so within a few seconds. Choose Rejoin to send it back in, or Use Say it yourself to keep going in your own voice." },
  { title: "Voice, speed and agent name", category: "Speak for me", body: "Pick one of six voices, the speaking speed and your agent's name on the Voice page. Your next Speak for me session uses them." },
  { title: "Microphone troubleshooting", category: "Troubleshooting", body: "Use a current Chrome or Edge browser, allow microphone access when prompted, and check that the correct microphone is selected in your browser and operating system." },
  { title: "Privacy and your control", category: "Privacy", body: "Review every draft before sharing it. Relaya does not claim to know whether you are muted in your meeting; follow the meeting app’s own mute controls." },
  { title: "Plans and limits", category: "Account", body: "The Free plan includes 60 sentences a month (up to 15 every 6 hours), 8 Speak for me sessions and 240 agent minutes. A sentence counts when Relaya hands you a draft; a recording with no speech or an error is free. A session only counts once the host admits your agent. What's left is in the sidebar and on Plan and usage." },
  { title: "Your session history", category: "Account", body: "Sessions lists your last 20 sessions with counts only: sentences approved, fixes kept, used as is and re-records, plus the names you used. What you said is never saved. You can delete any session." },
];
export function HelpPage() {
  const [query, setQuery] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const articles = HELP_ARTICLES.filter((article) => `${article.title} ${article.category} ${article.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <AppShell title="Help & privacy"><div className="workspace-page"><PageIntro eyebrow="HELP CENTER" title="How can we help?" text="Browse quick answers about sessions, reviewing drafts, and account settings." />
    <label className="help-search"><Search size={18} /><span className="sr-only">Search help articles</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help articles" /></label>
    <div className="help-articles">{articles.map((article) => <section className="workspace-card help-article" key={article.title}><button aria-expanded={open === article.title} onClick={() => setOpen(open === article.title ? null : article.title)}><span><small>{article.category}</small><b>{article.title}</b></span><ChevronRight className={open === article.title ? "rotated" : ""} size={19} /></button>{open === article.title && <p>{article.body}</p>}</section>)}{articles.length === 0 && <div className="workspace-card"><EmptyState title="No matching help articles" body="Try another search term." /></div>}</div>
    <section className="support-card"><CircleHelp /><div><h3>Still need help?</h3><p>Contact your Relaya project team with the issue and your browser name. Don’t include recordings, transcripts, or passwords.</p></div><button className="wp-button" onClick={async () => { const text = `Relaya support request\n\nIssue:\n\nBrowser:\n`; try { await navigator.clipboard.writeText(text); setOpen("copied"); } catch { setOpen("copy-failed"); } }}>{open === "copied" ? <><Check size={16} />Copied template</> : open === "copy-failed" ? <><Copy size={16} />Copy template</> : <><Copy size={16} />Copy report template</>}</button></section>
  </div></AppShell>;
}

export function SearchPage() {
  const [query, setQuery] = useState(""); const navigate = useNavigate();
  const results = useMemo(() => SEARCH_ITEMS.filter((item) => `${item.title} ${item.description} ${item.terms}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query]);
  return <AppShell title="Search"><div className="workspace-page"><PageIntro eyebrow="FIND YOUR WAY" title="Search Relaya" text="Find a page or help topic." />
    <label className="help-search"><Search size={18} /><span className="sr-only">Search Relaya</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and help" onKeyDown={(event) => { if (event.key === "Escape") navigate(-1); if (event.key === "Enter" && results[0]) navigate(results[0].to); }} /></label>
    <div className="search-results" role="list">{results.map((item) => <Link role="listitem" key={item.to} to={item.to}><span><b>{item.title}</b><small>{item.description}</small></span><ChevronRight size={18} /></Link>)}{!results.length && <div className="workspace-card"><EmptyState title="No results" body="Try a different word or phrase." /></div>}</div>
  </div></AppShell>;
}
