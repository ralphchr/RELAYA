import type { SessionMode } from "@relaya/contracts";
import { copy } from "../copy/en.js";

/** "Say it yourself · Oct 17, 9:05 AM", in the user's own time zone. */
export function sessionTitle(mode: SessionMode, at = new Date()): string {
  const when = at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${copy.modes[mode].label} · ${when}`;
}
