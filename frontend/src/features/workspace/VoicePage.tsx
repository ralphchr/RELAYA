import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Pause, Play } from "lucide-react";
import { AGENT_SPEED, AGENT_VOICES, type AgentVoiceId, DEFAULT_AGENT_VOICE, MEET_AGENT_NAME } from "@relaya/contracts";
import { AppShell } from "../../components/shell/AppShell.js";
import { useServices } from "../../services/ServicesProvider.js";
import { accountChanged, agentDisplayName, useAccount } from "../account/AccountProvider.js";
import { PageIntro, SavedNote, StorageNote, errorMessage } from "./parts.js";
import "./workspace-pages.css";

/** "Angel's Relaya (AI)" → "Angel's Relaya": the part people type. The AI label is added back on save. */
export const baseAgentName = (name: string) => name.replace(/\s*(\(AI\)|AI)\s*$/, "").trim();
export const withAiLabel = (base: string) => `${base.trim()} (AI)`;

/** /voice: the agent's voice, speed and name. Used by the next Speak for me session. */
export function VoicePage() {
  const me = useAccount();
  const { data } = useServices();
  const [voice, setVoice] = useState<AgentVoiceId>(me?.settings.voiceId ?? DEFAULT_AGENT_VOICE);
  const [speed, setSpeed] = useState(me?.settings.voiceSpeed ?? AGENT_SPEED.default);
  const [name, setName] = useState(() => baseAgentName(agentDisplayName(me)));
  const [playing, setPlaying] = useState<AgentVoiceId | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // The account loads after the first render on a fresh page load.
  useEffect(() => {
    if (!me) return;
    setVoice(me.settings.voiceId);
    setSpeed(me.settings.voiceSpeed);
    setName(baseAgentName(agentDisplayName(me)));
  }, [me]);
  useEffect(() => () => audio.current?.pause(), []);

  function preview(id: AgentVoiceId) {
    audio.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    const clip = new Audio(`/voices/${id}.wav`);
    clip.playbackRate = speed;
    clip.onended = () => setPlaying(null);
    clip.onerror = () => { setPlaying(null); setNotice({ text: "Voice samples aren't on this site yet. Run pnpm --filter @relaya/agent voice-samples once to make them.", error: true }); };
    audio.current = clip;
    setPlaying(id);
    clip.play().catch(() => setPlaying(null));
  }

  async function save() {
    const base = baseAgentName(name);
    if (!base) { setNotice({ text: "Give your agent a name.", error: true }); return; }
    setSaving(true);
    try {
      await data.updateSettings({ voiceId: voice, voiceSpeed: speed });
      const label = withAiLabel(base);
      // Keep the default (null) when the name is the default one.
      await data.updateProfile({ agentDisplayName: label === agentDisplayName({ firstName: me?.firstName ?? "", agentDisplayName: null }) ? null : label });
      accountChanged();
      setNotice({ text: "Saved. Your next Speak for me session uses these." });
    } catch (e) {
      setNotice({ text: errorMessage(e), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Voice">
      <div className="workspace-page workspace-motion">
        <PageIntro eyebrow="SPEAK FOR ME" title="Your agent's voice and name" text="Pick how your Relaya sounds and its nickname in the app." />

        <section className="workspace-card settings-card">
          <h3>Voice</h3>
          <div className="voice-grid" role="radiogroup" aria-label="Voice">
            {AGENT_VOICES.map((v) => (
              <div key={v.id} className={`voice-option${voice === v.id ? " selected" : ""}`}>
                <button type="button" role="radio" aria-checked={voice === v.id} className="voice-pick" onClick={() => setVoice(v.id)}>
                  <span className="voice-check" aria-hidden="true">{voice === v.id && <Check size={14} strokeWidth={3} />}</span>
                  <span><b>{v.name}</b><small>{v.accent} · {v.gender}</small></span>
                </button>
                <button type="button" className="icon-action" aria-label={playing === v.id ? `Stop ${v.name}` : `Play ${v.name}`} onClick={() => preview(v.id)}>
                  {playing === v.id ? <Pause size={16} /> : <Play size={16} />}
                </button>
              </div>
            ))}
          </div>

          <label className="workspace-field">
            <span>Speaking speed <b>{speed.toFixed(2)}×</b></span>
            <small>The samples play at this speed too.</small>
            <input type="range" className="speed-range" min={AGENT_SPEED.min} max={AGENT_SPEED.max} step="0.05" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ "--fill": `calc(12px + (100% - 24px) * ${(speed - AGENT_SPEED.min) / (AGENT_SPEED.max - AGENT_SPEED.min)})` } as CSSProperties} />
            <span className="speed-scale" aria-hidden="true"><span>Slower</span><span>Natural</span><span>Faster</span></span>
          </label>

          <label className="workspace-field">
            <span>Agent name</span>
            <small>This nickname is used in the app. The participant in Google Meet is always <b>{MEET_AGENT_NAME}</b>.</small>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dana's Relaya" />
          </label>

          <div className="workspace-actions"><button className="wp-button wp-button-primary" disabled={saving} onClick={() => { void save(); }}>Save</button></div>
          {notice && <SavedNote error={notice.error ?? false}>{notice.text}</SavedNote>}
          <StorageNote />
        </section>
      </div>
    </AppShell>
  );
}
