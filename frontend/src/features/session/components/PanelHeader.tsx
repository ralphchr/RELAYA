import { useState } from "react";
import { LogOut, PictureInPicture2 } from "lucide-react";
import type { SessionMode, Tone } from "@relaya/contracts";
import { RelayaMark } from "../../../components/brand/RelayaMark.js";
import { ModePill } from "../../../components/ui/ModePill.js";
import { copy } from "../../../copy/en.js";
import { ToneSelect } from "../../../components/ui/ToneSelect.js";

interface Props {
  mode: SessionMode;
  tone: Tone;
  onTone: (tone: Tone) => void;
  /** Ask before quitting: a sentence is pending or playing, or the agent is in the meeting. */
  confirmQuit: boolean;
  onQuit: () => void;
  onPopOut: (() => void) | null;
}

/** Mark, mode pill (fixed for the session), tone for the next sentence, pop-out and quit. */
export function PanelHeader({ mode, tone, onTone, confirmQuit, onQuit, onPopOut }: Props) {
  const [asking, setAsking] = useState(false);
  const p = copy.panel;
  return (
    <header className="rp-top">
      <RelayaMark size={30} label />
      <ModePill mode={mode} />
      <span className="spacer" />
      <ToneSelect tone={tone} onTone={onTone} label={p.tone} className="tone" />
      {onPopOut && <button className="icon-btn sm" onClick={onPopOut} aria-label={p.popOut} title={p.popOut}><PictureInPicture2 className="icon" /></button>}
      <button className="icon-btn sm danger" onClick={() => (confirmQuit ? setAsking(true) : onQuit())} aria-label={p.quit} title={p.quit}><LogOut className="icon" /></button>
      {asking && (
        <div className="quit-confirm" role="alertdialog" aria-label={p.quitConfirm}>
          <b>{mode === "speak" ? p.quitConfirmSpeak : p.quitConfirm}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} autoFocus>{p.quitNo}</button>
          <button className="btn btn-coral btn-sm" onClick={onQuit}>{p.quitYes}</button>
        </div>
      )}
    </header>
  );
}
