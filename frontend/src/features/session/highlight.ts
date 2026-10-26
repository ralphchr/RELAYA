import type { PanelState } from "./machine.js";
import { composeSentence } from "./compose.js";

export interface Segment { text: string; mark: "warn" | "ok" | null }

/**
 * Split the current sentence into plain, amber (open issue: changed by Relaya)
 * and green (fix the user kept) segments. Marks come from composeSentence, which
 * builds the same text the reducer delivers; any other text (the literal
 * transcript) has no marks.
 */
export function sentenceSegments(s: PanelState): Segment[] {
  const text = s.text;
  if (!s.result) return [{ text, mark: null }];
  const composed = composeSentence(s.result, s.resolutions);
  if (composed.text !== text) return [{ text, mark: null }];

  const out: Segment[] = [];
  let at = 0;
  for (const r of [...composed.marks].sort((x, y) => x.start - y.start)) {
    if (r.start < at || r.end <= r.start) continue;
    if (r.start > at) out.push({ text: text.slice(at, r.start), mark: null });
    out.push({ text: text.slice(r.start, r.end), mark: r.mark });
    at = r.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: null });
  return out;
}
