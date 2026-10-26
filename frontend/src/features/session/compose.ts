import type { GuardIssue, ReconstructResponse } from "@relaya/contracts";
import type { Resolution } from "./machine.js";

export interface Mark { start: number; end: number; mark: "warn" | "ok" }
export interface Composed { text: string; marks: Mark[] }

interface Edit { start: number; end: number; replacement: string; highlight: [number, number] }

/**
 * The API computes every fix against the original draft, so fixes don't stack
 * by themselves: taking fix #2's sentence would undo fix #1. Each fix only
 * replaces its own `draftSpan`, so we recover that replacement and apply every
 * kept fix to the draft in one pass. The result is the same in any order.
 */
function editFor(draft: string, issue: GuardIssue): Edit | null {
  const [a, b] = issue.draftSpan;
  const fixed = issue.fix.sentence;
  const tailLength = draft.length - b;
  // A fix that changes text outside its span can't be combined with others.
  if (!fixed.startsWith(draft.slice(0, a)) || !fixed.endsWith(draft.slice(b)) || fixed.length - tailLength < a) return null;
  const replacement = fixed.slice(a, fixed.length - tailLength);
  const [c, d] = issue.fix.fixedSpan;
  const from = Math.max(0, Math.min(c - a, replacement.length));
  const to = Math.max(from, Math.min(d - a, replacement.length));
  return { start: a, end: b, replacement, highlight: [from, to] };
}

/** The sentence to deliver plus its amber (open) and green (fixed) marks. */
export function composeSentence(result: ReconstructResponse, resolutions: Record<string, Resolution>): Composed {
  const draft = result.sentence.text;
  const issues = [...result.guard.issues].sort((x, y) => x.draftSpan[0] - y.draftSpan[0]);

  const fixedIssues = issues.filter((issue) => resolutions[issue.id] === "fixed");
  const edits = fixedIssues.map((issue) => editFor(draft, issue));
  if (edits.some((edit) => edit === null)) {
    // Non-local fix: fall back to the last fix's whole sentence, as before.
    const last = fixedIssues[fixedIssues.length - 1];
    if (last) {
      const [c, d] = last.fix.fixedSpan;
      return { text: last.fix.sentence, marks: [{ start: c, end: d, mark: "ok" }] };
    }
  }

  let text = "";
  let at = 0;
  const marks: Mark[] = [];
  for (const issue of issues) {
    const [a, b] = issue.draftSpan;
    if (a < at) continue; // overlaps a span already handled
    text += draft.slice(at, a);
    const resolution = resolutions[issue.id];
    const edit = resolution === "fixed" ? editFor(draft, issue) : null;
    if (edit) {
      const base = text.length;
      text += edit.replacement;
      marks.push({ start: base + edit.highlight[0], end: base + edit.highlight[1], mark: "ok" });
    } else {
      const base = text.length;
      text += draft.slice(a, b);
      if (!resolution) marks.push({ start: base, end: base + (b - a), mark: "warn" });
    }
    at = b;
  }
  text += draft.slice(at);
  return { text, marks };
}
