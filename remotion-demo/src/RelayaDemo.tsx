import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ArrowRight, Check, ChevronDown, Globe2, Mic, MicOff, MoreHorizontal, Phone, ShieldCheck, Video, Volume2 } from 'lucide-react';
// These are the application's actual components, not a redraw of its interface.
import { RelayaLockup, RelayaMark } from '../../frontend/src/components/brand/RelayaMark';
import { PanelHeader } from '../../frontend/src/features/session/components/PanelHeader';
import { DraftCard } from '../../frontend/src/features/session/components/DraftCard';
import '../../frontend/src/styles/tokens.css';
import '../../frontend/src/components/ui/ui.css';
import '../../frontend/src/features/session/panel.css';
import './video.css';

export const SOURCE = 'Sir, nahuman na nako ang report, pero I need to double-check the data.';
export const TRANSLATION = "Sir, I've finished the report, but I need to double-check the data.";
const noop = () => {};
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ramp = (f: number, start: number, end: number, a = 0, b = 1) => interpolate(f, [start, end], [a, b], clamp);
const enter = (frame: number, delay = 0) => spring({ frame: frame - delay, fps: 30, config: { damping: 24, stiffness: 105, mass: 0.85 } });
const words = (text: string, frame: number, start: number, end: number) => text.split(' ').slice(0, Math.floor(ramp(frame, start, end) * text.split(' ').length)).join(' ');

function Waveform({ frame, active = true, bars = 21 }: { frame: number; active?: boolean; bars?: number }) {
  return <span className="audio-wave">{Array.from({ length: bars }, (_, i) => <i key={i} style={{ height: active ? 7 + 25 * Math.abs(Math.sin(frame * 0.19 + i * 1.13) * Math.cos(frame * 0.063 + i * 0.71)) : 6 }} />)}</span>;
}

function Portrait({ client = false, talking = false, frame }: { client?: boolean; talking?: boolean; frame: number }) {
  const skin = client ? '#E9BA9C' : '#CF946F';
  const nod = talking ? Math.sin(frame * 0.075) * 1.3 : Math.sin(frame * 0.025) * 0.5;
  return <svg viewBox="0 0 500 420" preserveAspectRatio="xMidYMid slice" className="portrait" aria-label={client ? 'Illustrated client' : 'Illustrated Filipino virtual assistant'}>
    <rect width="500" height="420" fill={client ? '#BECFC6' : '#E5C6BB'} />
    <rect x="25" y="30" width="130" height="180" rx="6" fill={client ? '#DDE8E0' : '#F8E7D7'} />
    <path d="M90 30v180M25 115h130" stroke={client ? '#A6BAB0' : '#D1B4A4'} strokeWidth="7" />
    <rect x="366" y="78" width="95" height="10" rx="5" fill="#FFFFFF55" /><rect x="385" y="34" width="29" height="44" rx="5" fill="#8F9D8D" />
    <path d="M398 54q-30-30-18-40q27 11 18 40m0 0q32-40 41-25q-9 27-41 25" fill="#718E76" />
    <ellipse cx="254" cy="441" rx="158" ry="160" fill={client ? '#4C6475' : '#7E596F'} />
    <g transform={`rotate(${nod} 250 240)`}>
      {!client && <path d="M161 203q-12-129 90-130q110 0 100 140l18 141H143Z" fill="#3E3338" />}
      <path d="M220 272h63v60q-30 26-63 0Z" fill={skin} />
      <ellipse cx="250" cy="207" rx="79" ry="103" fill={skin} />
      <path d={client ? 'M171 199q-27-115 70-124q107-2 92 117l-25-38q-80 11-103-17Z' : 'M171 204q-25-132 93-128q93 6 71 127l-32-67q-65 52-129 29Z'} fill={client ? '#675047' : '#3E3338'} />
      <path d="M205 193q11-7 23 0m43 0q11-7 23 0" fill="none" stroke="#503E38" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="218" cy="209" rx="4" ry="5" fill="#3E3338" /><ellipse cx="282" cy="209" rx="4" ry="5" fill="#3E3338" />
      <path d="M249 215l-5 24h10" fill="none" stroke="#B77E60" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="250" cy="260" rx={talking ? 12 : 10} ry={talking ? 3 + 6 * Math.abs(Math.sin(frame * 0.37)) : 2.5} fill="#865052" />
      {!client && <><path d="M163 201q-7-111 91-111q93 2 89 111" fill="none" stroke="#544851" strokeWidth="10" /><rect x="157" y="192" width="19" height="54" rx="9" fill="#5F5461" /><rect x="327" y="192" width="19" height="54" rx="9" fill="#5F5461" /><path d="M336 236q0 40-61 39" fill="none" stroke="#5F5461" strokeWidth="5" /><rect x="264" y="269" width="20" height="10" rx="5" fill="#443A41" /></>}
    </g>
    <path d="M167 421v-48m168 48v-48" stroke="#FFFFFF18" strokeWidth="3" />
  </svg>;
}

function Meeting({ frame, translated = false, compact = false }: { frame: number; translated?: boolean; compact?: boolean }) {
  const text = translated ? words(TRANSLATION, frame, 234, 290) : words(SOURCE, frame, 14, 151);
  return <div className={`meeting ${compact ? 'compact' : ''}`}>
    <div className="meeting-top"><span className="meeting-dot" /> Weekly project sync <span className="meeting-time">00:{String(Math.floor(frame / 30)).padStart(2, '0')} <MoreHorizontal size={22} /></span></div>
    <div className="participants">
      {[false, true].map(client => <div className={`person ${!client && frame < 160 ? 'is-speaking' : ''}`} key={String(client)}>
        <Portrait client={client} frame={frame} talking={!client && frame > 14 && frame < 155} />
        <div className="person-label">{client ? <MicOff size={17} /> : <Mic size={17} />}{client ? 'James · Client, UK' : 'Maya · Filipino VA'}</div>
        {!client && <div className="person-wave"><Waveform frame={frame} active={frame < 160} bars={8} /></div>}
      </div>)}
    </div>
    <div className={`meeting-captions ${translated ? 'translated' : ''}`}>
      <div className="caption-label">{translated ? <><RelayaMark size={20} /> RELAYA · ENGLISH CAPTIONS</> : <><Mic size={17} /> MAYA · ORIGINAL SPEECH</>}</div>
      <div className="caption-text">{text || '…'}</div>
    </div>
    <div className="meeting-bottom"><span className="meeting-meta">2 participants</span><div className="call-buttons"><span><Mic size={21} /></span><span><Video size={22} /></span><span className="hangup"><Phone size={23} /></span></div><span className="cc">CC</span></div>
  </div>;
}

function AppPanel({ frame, final = false }: { frame: number; final?: boolean }) {
  const transcript = final ? SOURCE : words(SOURCE, frame, 128, 193);
  const output = final ? TRANSLATION : words(TRANSLATION, frame, 191, 246);
  return <div className="demo-panel rpanel">
    <PanelHeader mode="speak" tone="professional" onTone={noop} confirmQuit={false} onQuit={noop} onPopOut={noop} />
    <div className="rp-body">
      <div className="panel-status"><span className="status-dot" />{final || frame > 246 ? 'Ready for your review' : frame > 191 ? 'Preparing English' : 'Listening to mixed speech'}<Waveform frame={frame} active={!final && frame < 246} bars={8} /></div>
      <DraftCard kind="review" transcript={transcript || '…'} output={output || '…'} transcriptEdited={false} textEdited={false} editing={null} languages={frame > 148 || final ? ['ceb', 'en'] : []} segments={[{ text: output || '…', mark: null }]} open={[]} checked={['Meaning preserved']} usedAsIs={false} audio={final || frame > 246 ? 'ready' : 'preparing'} onFix={noop} onAsIs={noop} onRerecord={noop} onBeginEdit={noop} onSaveTranscript={async () => {}} onSaveOutput={noop} onCancelEdit={noop} />
    </div>
    <div className="rp-foot"><button className="btn btn-green"><Volume2 size={20} />Approve & speak <span className="keycap">↵</span></button><div className="panel-footnote">Speak for me · You stay in control</div></div>
  </div>;
}

function DemoScene() {
  const frame = useCurrentFrame();
  const move = ramp(frame, 107, 150);
  const reveal = enter(frame, 120);
  return <AbsoluteFill style={{ opacity: 1 - ramp(frame, 349, 360) }}>
    <div className="scene-title" style={{ opacity: (1 - ramp(frame, 103, 120)) * ramp(frame, 0, 12), transform: `translateY(${(1 - enter(frame)) * 18}px)` }}><span className="eyebrow">THE WORDS ARE THERE.</span><h1>Language barriers shouldn't<br /><em>slow you down.</em></h1></div>
    <div className="scene-title action-title" style={{ opacity: ramp(frame, 119, 139), transform: `translateY(${(1 - reveal) * 24}px)` }}><span className="eyebrow">YOUR VOICE. CLEARLY UNDERSTOOD.</span><h1>Speak naturally. <em>Relaya translates.</em></h1></div>
    <div className="meeting-position" style={{ left: 190 - 100 * move, top: 325 - 37 * move, width: 1540 - 675 * move, height: 615 + 75 * move, transform: `scale(${1 + ramp(frame, 0, 105, 0, 0.018) * (1 - move)})` }}><Meeting frame={frame} translated={frame >= 234} /></div>
    <div className="panel-position" style={{ left: 1020 + (1 - move) * 1000, top: 288, opacity: ramp(frame, 119, 142), transform: `translateY(${(1 - reveal) * 28}px) scale(${1.34 + ramp(frame, 150, 345, 0, 0.025)})` }}><AppPanel frame={frame} /></div>
    <div className="demo-flow" style={{ opacity: ramp(frame, 148, 165) }}><span className={frame < 194 ? 'active' : ''}><Mic size={19} /> Mixed speech</span><ArrowRight size={19} /><span className={frame >= 194 && frame < 247 ? 'active' : ''}>English translation</span><ArrowRight size={19} /><span className={frame >= 247 ? 'active' : ''}><Check size={19} /> Meeting captions</span></div>
  </AbsoluteFill>;
}

const languageItems = [
  { name: 'Tagalog', sub: 'Tagalog + English', word: 'Magandang araw.', detail: 'Good day.', code: 'TL' },
  { name: 'Cebuano', sub: 'Bisaya + English', word: 'Maayong adlaw.', detail: 'Good day.', code: 'CEB' },
  { name: 'English', sub: 'Your conversation, connected', word: 'Good day.', detail: 'Keep the conversation going.', code: 'EN' },
];

function LanguagesScene() {
  const frame = useCurrentFrame();
  const active = Math.min(2, Math.floor(Math.max(0, frame - 16) / 29));
  return <AbsoluteFill className="languages-scene" style={{ opacity: ramp(frame, 0, 9) * (1 - ramp(frame, 110, 120)) }}>
    <div className="language-heading"><span className="eyebrow"><Globe2 size={21} /> BUILT FOR THE WAY YOU SPEAK</span><h1>More than one language.<br /><em>One clear conversation.</em></h1></div>
    <div className="language-cards">{languageItems.map((item, index) => {
      const on = active === index;
      const p = enter(frame, 5 + index * 7);
      return <div className={`language-card ${on ? 'selected' : ''}`} key={item.code} style={{ opacity: p, transform: `translateY(${(1 - p) * 65 + (on ? -12 : 0)}px)` }}><div className="language-code">{item.code}<span>{on ? <Waveform frame={frame} bars={9} /> : <Globe2 size={28} />}</span></div><h2>{item.name}</h2><p>{item.sub}</p><div className="language-example">{item.word}<small>{item.detail}</small></div><div className="language-bottom"><Check size={18} />{index === 1 ? 'Cebuano / Bisaya' : 'Available in Relaya'}</div></div>;
    })}</div>
    <div className="languages-note">Auto-detect mixed speech <span>→</span> Natural English</div>
  </AbsoluteFill>;
}

function ClosingScene() {
  const frame = useCurrentFrame();
  const p = enter(frame, 3);
  return <AbsoluteFill className="closing-scene" style={{ opacity: ramp(frame, 0, 12) }}>
    <div className="closing-copy" style={{ transform: `translateY(${(1 - p) * 35}px)`, opacity: p }}><div className="closing-logo"><RelayaMark size={122} /><span>Relaya.</span></div><h1>Every conversation<br /><em>matters.</em></h1><div className="closing-rule" /><p>Speak naturally. Stay connected.</p></div>
    <div className="closing-app" style={{ opacity: enter(frame, 11), transform: `translateY(${(1 - enter(frame, 11)) * 80}px) rotate(-3deg) scale(1.18)` }}><div className="closing-app-bar"><RelayaLockup size={28} /><span>YOUR MEETING COMPANION</span></div><AppPanel frame={300} final /></div>
  </AbsoluteFill>;
}

export function RelayaDemo() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Load original Relaya fonts'));
  useEffect(() => { Promise.all([document.fonts.load('500 20px "Quicksand"'), document.fonts.load('500 20px "Plus Jakarta Sans"'), document.fonts.load('800 20px "Plus Jakarta Sans"')]).then(() => continueRender(fontHandle)); }, [fontHandle]);
  return <AbsoluteFill className="video-root">
    <style>{`@font-face{font-family:"Plus Jakarta Sans";src:url("${staticFile('fonts/plus-jakarta-sans-normal.ttf')}") format("truetype");font-weight:200 800;font-style:normal;}@font-face{font-family:"Quicksand";src:url("${staticFile('fonts/quicksand-normal.ttf')}") format("truetype");font-weight:300 700;font-style:normal;}`}</style>
    <div className="background-orb orb-one" style={{ transform: `translate(${Math.sin(frame / fps * 0.21) * 30}px, ${Math.cos(frame / fps * 0.16) * 15}px)` }} /><div className="background-orb orb-two" />
    <div className="top-brand"><RelayaLockup size={42} /></div><div className="simulation-badge"><span /> PRODUCT DEMO · SIMULATED CONVERSATION</div>
    <Sequence from={0} durationInFrames={360}><DemoScene /></Sequence>
    <Sequence from={360} durationInFrames={120}><LanguagesScene /></Sequence>
    <Sequence from={480} durationInFrames={120}><ClosingScene /></Sequence>
    <div className="bottom-line"><span>RELAYA</span><span>{frame < 360 ? 'Simulated live-caption preview · Actual Relaya interface' : frame < 480 ? 'Tagalog · Cebuano / Bisaya · English' : 'Relaya. Every conversation matters.'}</span><span>{frame < 120 ? '01 / 04' : frame < 360 ? '02 / 04' : frame < 480 ? '03 / 04' : '04 / 04'}</span></div>
    <div className="timeline-track"><div style={{ width: `${frame / 599 * 100}%` }} /></div>
    <Audio src={staticFile('audio/soundtrack.wav')} volume={0.48} />
    <Sequence from={12}><Audio src={staticFile('audio/maya.wav')} volume={1} /></Sequence>
    <Sequence from={250}><Audio src={staticFile('audio/english.wav')} volume={0.94} /></Sequence>
    <Sequence from={493}><Audio src={staticFile('audio/closing.wav')} volume={0.94} /></Sequence>
    <AbsoluteFill style={{ background: '#FFF8F3', opacity: ramp(frame, 577, 599), pointerEvents: 'none' }} />
  </AbsoluteFill>;
}
