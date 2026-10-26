import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Pencil, ShieldCheck, AudioLines, Activity, LockKeyhole, LogOut } from "lucide-react";
import { LANGUAGE_MODE_OPTIONS, type LanguageMode, type SessionMode, type Tone } from "@relaya/contracts";
import type { Gender } from "../../services/types.js";
import { voiceForGender } from "../../services/genderVoice.js";
import { AppShell } from "../../components/shell/AppShell.js";
import { useServices } from "../../services/ServicesProvider.js";
import { accountChanged, useAccount } from "../account/AccountProvider.js";
import { useSignOut } from "../account/AccountProvider.js";
import { useRecentSessions } from "../sessions/useRecentSessions.js";
import { UserAvatar } from "../../components/shell/UserAvatar.js";
import { AvatarCropDialog } from "../account/AvatarCropDialog.js";
import { DEFAULT_PTT_KEY, isAllowedPttKey, keyLabel } from "../session/pttKey.js";
import { PageIntro, SavedNote, StorageNote, errorMessage } from "./parts.js";
import "./workspace-pages.css";

const TABS = [{ id: "preferences", label: "Preferences" }, { id: "privacy", label: "Privacy" }, { id: "notifications", label: "Notifications" }] as const;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
type Section = typeof TABS[number]["id"];

function SettingsSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const listId = `settings-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => open ? (index + direction + options.length) % options.length : selectedIndex);
      setOpen(true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      setOpen(true);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      const activeOption = options[activeIndex];
      if (activeOption) onChange(activeOption.value);
      setOpen(false);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
    } else if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      setActiveIndex(selectedIndex);
      setOpen(true);
    }
  }

  return (
    <div className="workspace-select" ref={root}>
      <button type="button" className={`workspace-select-trigger${open ? " is-open" : ""}`} role="combobox" aria-labelledby={`${listId}-label`} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined} onClick={() => { setActiveIndex(selectedIndex); setOpen((current) => !current); }} onKeyDown={handleKeyDown}>
        <span>{options[selectedIndex]?.label}</span><ChevronDown size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-select-menu" id={listId} role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button type="button" key={option.value} id={`${listId}-option-${index}`} className={`workspace-select-option${index === activeIndex ? " is-active" : ""}`} role="option" tabIndex={-1} aria-selected={option.value === value} onMouseEnter={() => setActiveIndex(index)} onClick={() => { onChange(option.value); setOpen(false); }}>
              <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Click, then press the key to hold for push-to-talk. Esc cancels. */
function KeyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function capture(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!listening) return;
    event.preventDefault();
    if (event.code === "Escape") { setListening(false); return; }
    if (!isAllowedPttKey(event.code)) { setProblem(`${keyLabel(event.code) || "That key"} is already used by the panel. Try another.`); return; }
    onChange(event.code);
    setProblem(null);
    setListening(false);
  }

  return (
    <div className="workspace-field">
      <span id="ptt-key-label">Push-to-talk key</span>
      <small>Hold it while the Relaya panel is in front to record. Esc and Enter stay as cancel and approve.</small>
      <div className="ptt-key-row">
        <button type="button" className={`wp-button ptt-key${listening ? " is-listening" : ""}`} aria-labelledby="ptt-key-label" aria-describedby="ptt-key-state"
          onClick={() => { setListening(true); setProblem(null); }} onKeyDown={capture} onBlur={() => setListening(false)}>
          {listening ? "Press a key…" : <kbd>{keyLabel(value)}</kbd>}
        </button>
        {value !== DEFAULT_PTT_KEY && !listening && <button type="button" className="wp-link" onClick={() => onChange(DEFAULT_PTT_KEY)}>Use Space again</button>}
      </div>
      <small id="ptt-key-state" role="status">{problem ?? (listening ? "Press the key you want. Esc to cancel." : null)}</small>
    </div>
  );
}

/** /settings/*: profile, session defaults, privacy facts and email preferences. */
export function SettingsPage({ standaloneProfile = false }: { standaloneProfile?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useAccount();
  const signOut = useSignOut();
  const { sessions: recentSessions, loaded: sessionsLoaded, failed: sessionsFailed } = useRecentSessions(50);
  const { data } = useServices();
  const requestedSection = (location.pathname.split("/")[2] || "preferences") as Section | "profile";
  const section: Section | "profile" = standaloneProfile ? "profile" : requestedSection;
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [mode, setMode] = useState<SessionMode>(me?.settings.defaultMode ?? "say");
  const [tone, setTone] = useState<Tone>(me?.settings.defaultTone ?? "professional");
  const [languageMode, setLanguageMode] = useState<LanguageMode>(me?.settings.languageMode ?? "auto");
  const [pttKey, setPttKey] = useState(me?.settings.pttKey ?? DEFAULT_PTT_KEY);
  const [productEmails, setProductEmails] = useState(me?.settings.emailProductUpdates ?? true);
  const [quotaEmails, setQuotaEmails] = useState(me?.settings.emailQuotaWarnings ?? true);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [gender, setGender] = useState<Gender | "">(me?.settings.gender ?? "");

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName);
    setMode(me.settings.defaultMode);
    setTone(me.settings.defaultTone);
    setLanguageMode(me.settings.languageMode);
    setPttKey(me.settings.pttKey);
    setProductEmails(me.settings.emailProductUpdates);
    setQuotaEmails(me.settings.emailQuotaWarnings);
    setGender(me.settings.gender ?? "");
  }, [me]);
  useEffect(() => setNotice(null), [section]);

  const profileDirty = displayName.trim() !== (me?.displayName.trim() ?? "");
  const styleDirty = mode !== me?.settings.defaultMode || tone !== me?.settings.defaultTone;
  const preferencesDirty = styleDirty || languageMode !== me?.settings.languageMode || pttKey !== me?.settings.pttKey || gender !== (me?.settings.gender ?? "");
  const notificationsDirty = productEmails !== me?.settings.emailProductUpdates || quotaEmails !== me?.settings.emailQuotaWarnings;

  if (!standaloneProfile && !TABS.some((tab) => tab.id === section)) return <Navigate to={requestedSection === "profile" ? "/profile" : "/settings/preferences"} replace />;

  async function save(event: FormEvent, change: () => Promise<void>, done: string) {
    event.preventDefault();
    setSaving(true);
    try { await change(); accountChanged(); setNotice({ text: done }); }
    catch (e) { setNotice({ text: errorMessage(e), error: true }); }
    finally { setSaving(false); }
  }

  async function signOutFromProfile() {
    try { await signOut(); navigate("/login", { replace: true }); }
    catch (error) { setNotice({ text: errorMessage(error), error: true }); }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !me?.signedIn) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setPhotoNotice({ text: "Choose a JPG, PNG, or WebP image.", error: true }); return; }
    if (file.size > MAX_PHOTO_SIZE) { setPhotoNotice({ text: "Choose an image smaller than 5 MB.", error: true }); return; }
    setPhotoNotice(null);
    setCropFile(file);
  }

  async function savePhoto(image: Blob) {
    if (!me?.signedIn) return;
    setPhotoBusy(true);
    setPhotoNotice(null);
    try {
      const avatarUrl = await data.uploadAvatar(image);
      await data.updateProfile({ avatarUrl });
      accountChanged();
      setPhotoNotice({ text: "Profile photo updated." });
      setCropFile(null);
    } catch (error) { setPhotoNotice({ text: errorMessage(error), error: true }); }
    finally { setPhotoBusy(false); }
  }

  return (
    <AppShell title={standaloneProfile ? "Profile" : "Settings"}>
      {cropFile && <AvatarCropDialog key={`${cropFile.name}:${cropFile.lastModified}:${cropFile.size}`} file={cropFile} busy={photoBusy} error={photoNotice?.error ? photoNotice.text : null} onCancel={() => { if (!photoBusy) { setCropFile(null); setPhotoNotice(null); } }} onSave={savePhoto} />}
      <div className="workspace-page workspace-motion">
        <PageIntro eyebrow="YOUR ACCOUNT" title={standaloneProfile ? "Your profile" : "Settings"} text={standaloneProfile ? "Your identity and how Relaya adapts to the way you communicate." : "Your preferences for every new session."} />
        <div className={`settings-layout${standaloneProfile ? " standalone-profile-layout" : ""}`}>
          {!standaloneProfile && <nav className="settings-nav" aria-label="Settings sections">
            {TABS.map((tab) => <Link key={tab.id} to={`/settings/${tab.id}`} className={tab.id === section ? "active" : ""} aria-current={tab.id === section ? "page" : undefined}>{tab.label}<ChevronRight size={16} /></Link>)}
          </nav>}
          <section className={standaloneProfile ? "profile-standalone-content" : "workspace-card settings-card"}>
            {section === "profile" && (
              <>
              <form onSubmit={(e) => void save(e, async () => {
                await data.updateProfile({ displayName: displayName.trim() });
              }, "Profile saved.")}>
                <h3>Profile overview</h3>
                <p className="card-lead">Your identity in Relaya. Your name also personalizes your AI agent's default name.</p>
                <div className="settings-avatar-card">
                  <div className="settings-avatar-art">
                    <UserAvatar avatarUrl={me?.avatarUrl} initials={me?.initials ?? "·"} className="settings-avatar" />
                    {me?.signedIn && <button type="button" className="settings-avatar-edit" aria-label={me.avatarUrl ? "Change profile photo" : "Add profile photo"} title={me.avatarUrl ? "Change profile photo" : "Add profile photo"} onClick={() => photoInput.current?.click()} disabled={photoBusy}><Pencil size={16} /></button>}
                  </div>
                  <div className="settings-avatar-copy">
                    <label className="settings-name-field">
                      <span className="sr-only">Your name</span>
                      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required aria-label="Your name" />
                    </label>
                    <span>@{me?.email?.split("@")[0] ?? "yourhandle"}</span>
                  </div>
                  {me?.signedIn && <div className="settings-avatar-actions">
                    <input ref={photoInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" onChange={selectPhoto} />
                    {photoBusy && <small role="status">Uploading…</small>}
                  </div>}
                </div>
                {profileDirty && <div className="workspace-actions"><button className="wp-button wp-button-primary" disabled={saving || !displayName.trim()}>{saving ? "Saving…" : "Save Changes"}</button></div>}
                {photoNotice && <p className={`settings-photo-note${photoNotice.error ? " error" : ""}`} role={photoNotice.error ? "alert" : "status"}>{photoNotice.text}</p>}
              </form>
              <div className="profile-sections">
                <section className="profile-section profile-activity">
                  <div className="profile-section-title"><span className="profile-section-icon"><Activity size={18} /></span><div><p className="profile-relaya-kicker">YOUR RELAYA ACTIVITY</p><h3>Recent communication</h3></div></div>
                  {sessionsFailed ? <p>We couldn't load your saved activity right now.</p> : !sessionsLoaded ? <div className="profile-activity-skeleton" aria-label="Loading activity"><i /><i /><i /></div> : (() => {
                    const ended = recentSessions.filter((session) => session.status === "ended");
                    const minutes = Math.round(ended.reduce((sum, session) => sum + session.agentSeconds, 0) / 60);
                    const latest = ended[0]?.endedAt ?? ended[0]?.startedAt;
                    return ended.length ? <><div className="profile-metrics"><div><b>{ended.length}</b><span>saved sessions shown</span></div><div><b>{minutes}</b><span>Speak for me minutes</span></div><div><b>{latest ? new Date(latest).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</b><span>most recent session</span></div></div><small className="profile-disclosure">Based on up to 50 most recent saved sessions. Session history stores counts, not what you said.</small><Link className="profile-inline-link" to="/sessions">View session history <ChevronRight size={15} /></Link></> : <div className="profile-empty"><b>Your first session starts here.</b><span>Once you finish a session, your saved activity will appear here.</span><Link to="/new">Start a session <ChevronRight size={15} /></Link></div>;
                  })()}
                </section>

                <section className="profile-section profile-style">
                  <div className="profile-section-title"><span className="profile-section-icon"><AudioLines size={18} /></span><div><p className="profile-relaya-kicker">MY VOICE, MY STYLE</p><h3>How Relaya helps you speak</h3></div></div>
                  <form onSubmit={(e) => void save(e, () => data.updateSettings({ defaultMode: mode, defaultTone: tone }), "Communication preferences saved.")}>
                    <fieldset className="profile-choice-group"><legend>Writing style</legend><div className="profile-choice-grid">
                      <label className={`profile-choice${tone === "casual" ? " selected" : ""}`}><input type="radio" name="profile-tone" checked={tone === "casual"} onChange={() => setTone("casual")} /><b>Natural</b><small>Warm and conversational, while keeping your meaning.</small></label>
                      <label className={`profile-choice${tone === "professional" ? " selected" : ""}`}><input type="radio" name="profile-tone" checked={tone === "professional"} onChange={() => setTone("professional")} /><b>Professional</b><small>Clear and workplace-ready, without adding certainty.</small></label>
                    </div></fieldset>
                    <fieldset className="profile-choice-group"><legend>Delivery</legend><div className="profile-choice-grid">
                      <label className={`profile-choice${mode === "say" ? " selected" : ""}`}><input type="radio" name="profile-mode" checked={mode === "say"} onChange={() => setMode("say")} /><b>Say it yourself</b><small>Review the sentence, then deliver it in your own voice.</small></label>
                      <label className={`profile-choice${mode === "speak" ? " selected" : ""}`}><input type="radio" name="profile-mode" checked={mode === "speak"} onChange={() => setMode("speak")} /><b>Speak for me</b><small>Approve each sentence before your Relaya voice delivers it.</small></label>
                    </div></fieldset>
                    <div className="profile-preview"><div><b>Style preview</b><span>Example only · not AI generated</span></div><p>“{tone === "casual" ? "We haven't finished the prototype yet, but we're making progress." : "The prototype isn't complete yet, but progress is underway."}”</p><small>Example meaning is preserved; actual session output depends on what you say.</small></div>
                    {styleDirty && <div className="workspace-actions"><button className="wp-button wp-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>}
                  </form>
                  <Link className="profile-inline-link" to="/voice">Choose your agent's voice, speed, and name <ChevronRight size={15} /></Link>
                </section>

                <section className="profile-section profile-account">
                  <div className="profile-section-title"><span className="profile-section-icon"><LockKeyhole size={18} /></span><div><p className="profile-relaya-kicker">ACCOUNT & PRIVACY</p><h3>Your data stays in your hands</h3></div></div>
                  <p>Relaya keeps your preferences, glossary terms, and session counts. It doesn't store your audio, transcripts, or reconstructed sentences.</p>
                  <div className="profile-account-links"><Link to="/settings/privacy">Privacy details <ChevronRight size={15} /></Link><Link to="/sessions">Review or delete session history <ChevronRight size={15} /></Link></div>
                  {me?.signedIn && <button type="button" className="profile-signout" onClick={() => void signOutFromProfile()}><LogOut size={15} />Sign out</button>}
                </section>
              </div>
              </>
            )}
            {section === "preferences" && (
              <form onSubmit={(e) => void save(e, async () => {
                const setupState = location.state as { setup?: string; from?: string } | null;
                if (setupState?.setup === "gender" && !gender) throw new Error("Choose a voice profile to continue.");
                await data.updateSettings({ defaultMode: mode, defaultTone: tone, languageMode, pttKey, ...(gender && gender !== me?.settings.gender ? { gender, voiceId: voiceForGender(gender) } : {}) });
                if (setupState?.setup === "gender") navigate(setupState.from || "/new", { replace: true });
              }, "Preferences saved.")}>
                <h3>Session defaults</h3>
                <div className="workspace-field"><span id="settings-select-default-mode-label">Default mode</span><SettingsSelect label="Default mode" value={mode} options={[{ value: "say", label: "Say it yourself" }, { value: "speak", label: "Speak for me" }]} onChange={(value) => setMode(value as SessionMode)} /></div>
                <div className="workspace-field"><span id="settings-select-default-tone-label">Default tone</span><SettingsSelect label="Default tone" value={tone} options={[{ value: "professional", label: "Professional" }, { value: "casual", label: "Casual" }]} onChange={(value) => setTone(value as Tone)} /></div>
                <div className="workspace-field"><span id="settings-select-spoken-languages-label">Spoken languages</span><SettingsSelect label="Spoken languages" value={languageMode} options={LANGUAGE_MODE_OPTIONS} onChange={(value) => setLanguageMode(value as LanguageMode)} /></div>
                <fieldset className="profile-gender-field"><legend>Voice personalization</legend><p>Choose the default voice profile for your Relaya agent.</p><div className="profile-gender-options">
                  <label className={gender === "female" ? "selected" : ""}><input type="radio" name="profile-gender" checked={gender === "female"} onChange={() => setGender("female")} /><span>Female voice</span></label>
                  <label className={gender === "male" ? "selected" : ""}><input type="radio" name="profile-gender" checked={gender === "male"} onChange={() => setGender("male")} /><span>Male voice</span></label>
                </div></fieldset>
                <KeyPicker value={pttKey} onChange={setPttKey} />
                <p className="workspace-local-note">Choose the languages you usually speak or mix to help speech recognition keep words in their original language. Relaya turns your speech into clear English.</p>
                {preferencesDirty && <div className="workspace-actions"><button className="wp-button wp-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>}
              </form>
            )}
            {section === "privacy" && <>
              <h3>Privacy at a glance</h3>
              <p className="card-lead">What Relaya keeps, and what it never keeps.</p>
              <div className="privacy-point"><ShieldCheck /><div><b>Nothing is said without your approval</b><p>You see every sentence before you read it or your agent says it.</p></div></div>
              <div className="privacy-point"><ShieldCheck /><div><b>Relaya doesn't keep your voice or sentences</b><p>Your recording is sent to Gemini for transcription when enabled, otherwise Groq Whisper. Relaya never stores recordings, transcripts or sentences.</p></div></div>
              <div className="privacy-point"><ShieldCheck /><div><b>What is saved</b><p>Your settings, your glossaries, and a history of sessions with counts only (how many sentences, fixes and re-records) plus the terms you used. You can delete any session.</p></div></div>
              <div className="privacy-point"><ShieldCheck /><div><b>Your agent is always labeled as AI</b><p>It doesn't record or save anything said in the meeting.</p></div></div>
            </>}
            {section === "notifications" && (
              <form onSubmit={(e) => void save(e, () => data.updateSettings({ emailProductUpdates: productEmails, emailQuotaWarnings: quotaEmails }), "Email preferences saved.")}>
                <h3>Emails</h3>
                <p className="card-lead">Choose which emails you'd like. Relaya doesn't send them yet; your choice is kept for when it does.</p>
                <label className="toggle-row"><span><b>Product updates</b><small>Occasional news about Relaya features.</small></span><input type="checkbox" checked={productEmails} onChange={(e) => setProductEmails(e.target.checked)} /></label>
                <label className="toggle-row"><span><b>Plan warnings</b><small>When you're close to your plan's limits.</small></span><input type="checkbox" checked={quotaEmails} onChange={(e) => setQuotaEmails(e.target.checked)} /></label>
                {notificationsDirty && <div className="workspace-actions"><button className="wp-button wp-button-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>}
              </form>
            )}
            {notice && <SavedNote error={notice.error ?? false}>{notice.text}</SavedNote>}
            {!standaloneProfile && section !== "privacy" && <StorageNote />}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
