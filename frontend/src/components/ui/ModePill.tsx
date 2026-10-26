import { Mic, Volume2 } from "lucide-react";
import type { SessionMode } from "@relaya/contracts";
import { copy } from "../../copy/en.js";

export function ModeIcon({ mode, className = "icon" }: { mode: SessionMode; className?: string }) {
  return mode === "say" ? <Mic className={className} aria-hidden="true" /> : <Volume2 className={className} aria-hidden="true" />;
}

export function ModePill({ mode }: { mode: SessionMode }) {
  return <span className="mode-pill"><ModeIcon mode={mode} />{copy.modes[mode].label}</span>;
}
