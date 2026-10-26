/*
 * Fixes built by span replacement.
 *
 * Two constraints come from the panel, not from the plan:
 *  - ContextGuardCard slices sentence.text with draftSpan to render the kept
 *    phrase, and highlight.ts falls back to indexOf on that slice. An empty
 *    span would render an empty quote and mark a bogus range.
 *  - So there is no such thing as an insertion-point span. Every issue anchors
 *    to real, non-empty draft text, and the fix replaces that text.
 *
 * When no safe rewrite exists we return null and the caller degrades the whole
 * response to `unsure` rather than shipping a broken fix.
 */

import { GuardIssueSchema, type GuardIssue } from "@relaya/contracts";
import { fold, type Clause, type Token } from "./text.js";
import type { Scan } from "./rules.js";

export type Anchor = readonly [number, number];
export interface SpanFix { draftSpan: [number, number]; sentence: string; fixedSpan: [number, number] }

/** Swap `anchor` for `replacement`; `fixedSpan` points at `highlight` inside it. */
export function replaceSpan(draft: string, [start, end]: Anchor, replacement: string, highlight = replacement): SpanFix {
  const sentence = draft.slice(0, start) + replacement + draft.slice(end);
  const relative = replacement.indexOf(highlight);
  const from = start + (relative < 0 ? 0 : relative);
  const to = from + (relative < 0 ? replacement.length : highlight.length);
  return { draftSpan: [start, end], sentence, fixedSpan: [from, to] };
}

const AUX = /^(?:is|are|was|were|am|be|been|being|has|have|had|will|would|can|could|should|shall|may|might|must|do|does|did)$/;
const CONTRACTED = /^[\p{L}]+'(?:s|re|ll|ve|d|m)$/u;
const COPULA = /^(?:is|are|was|were|am)$/;
export const PRONOUNS = new Set(["he", "she", "they", "him", "her", "them", "his", "their", "it", "we", "i"]);

/**
 * The span a fix should anchor to when the missing content has nowhere to
 * point: the clause's subject plus its first auxiliary, extended one token
 * past a copula so the phrase reads as something ("It's safer", "I am ready").
 */
export function verbRun(clause: Clause, extendPastCopula = true): Anchor | null {
  const first = clause.tokens[0];
  if (!first) return null;
  for (let i = 0; i < clause.tokens.length && i < 6; i++) {
    const token = clause.tokens[i];
    if (!token) break;
    const contracted = CONTRACTED.test(token.fold);
    if (!AUX.test(token.fold) && !contracted) continue;
    const extend = extendPastCopula && (COPULA.test(token.fold) || /'(?:s|re|m)$/.test(token.fold));
    const last = (extend ? clause.tokens[i + 1] : undefined) ?? token;
    return [first.start, last.end];
  }
  const head = clause.tokens.slice(0, 2);
  const last = head[head.length - 1];
  return last ? [first.start, last.end] : null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "for", "and", "but", "so", "it", "we", "i",
  "ang", "ng", "sa", "na", "ni", "ay", "yung", "kay", "ug", "pa", "nato", "mas", "pero", "kanang", "para",
]);

const contentTokens = (tokens: Token[]) =>
  new Set(tokens.map((t) => t.fold.replace(/^(?:na-|ma-|i-|ni-|mag-|gi-)/, "")).filter((w) => w.length > 2 && !STOPWORDS.has(w)));

/**
 * Pick the draft clause that corresponds to a transcript clause, scoring on
 * evidence that survives translation — names, numbers and borrowed words —
 * and falling back to position when nothing overlaps.
 */
export function alignClause(draftClauses: Clause[], target: Clause | null, index: number, scan: Scan): Clause | null {
  if (draftClauses.length === 0) return null;
  if (draftClauses.length === 1) return draftClauses[0] ?? null;
  if (target) {
    const wanted = contentTokens(target.tokens);
    const numbers = new Set(scan.numbers.filter((n) => n.start >= target.start && n.end <= target.end).map((n) => n.canonical));
    const names = new Set(scan.names.filter((n) => n.start >= target.start && n.end <= target.end).map((n) => fold(n.name)));
    let best: { clause: Clause; score: number } | null = null;
    for (const clause of draftClauses) {
      const have = contentTokens(clause.tokens);
      let score = 0;
      for (const word of have) if (wanted.has(word)) score += 1;
      for (const name of names) if ([...have].some((w) => w.replace(/'s$/, "") === name)) score += 3;
      for (const token of clause.tokens) if (numbers.has(token.fold.replace(/,/g, ""))) score += 2;
      const normalized = score / Math.max(1, have.size);
      if (score > 0 && (!best || normalized > best.score)) best = { clause, score: normalized };
    }
    if (best) return best.clause;
  }
  return draftClauses[Math.min(index, draftClauses.length - 1)] ?? null;
}

export interface Rewrite { replacement: string; highlight: string }

/** Put a hedge back into an anchored verb phrase. */
export function hedgeRewrite(anchorText: string, modal: string): Rewrite | null {
  const contraction = /^(.*?)([\p{L}]+)['’](?:s|re|m)\s+(.+)$/su.exec(anchorText);
  if (contraction) {
    const highlight = `${modal} be ${contraction[3]}`;
    return { replacement: `${contraction[1]}${contraction[2]} ${highlight}`, highlight };
  }
  const copula = /^(.*?)\b(?:is|are|was|were|am)\b(\s+.*)?$/su.exec(anchorText);
  if (copula) {
    const highlight = `${modal} be${copula[2] ?? ""}`;
    return { replacement: `${copula[1]}${highlight}`, highlight };
  }
  const perfect = /^(.*?)\b(?:have|has|had)\b(\s+.*)?$/su.exec(anchorText);
  if (perfect) {
    const highlight = `${modal} have${perfect[2] ?? ""}`;
    return { replacement: `${perfect[1]}${highlight}`, highlight };
  }
  const modalVerb = /^(.*?)\b(?:will|would|can|could|should|shall|must|may|might)\b(\s+.*)?$/su.exec(anchorText);
  if (modalVerb) {
    const highlight = `${modal}${modalVerb[2] ?? ""}`;
    return { replacement: `${modalVerb[1]}${highlight}`, highlight };
  }
  return null;
}

/** A participle after have/has/had makes it an auxiliary rather than the main verb. */
const PARTICIPLE = /^\s*(?:been|done|gone|seen|made|run|built|sent|got|begun|written|taken|given|\p{L}+ed|\p{L}+en)\b/u;

/**
 * Put a negation back into an anchored verb phrase. Auxiliaries only: "have"
 * as a main verb ("we have budget") would need do-support, so we decline and
 * let the caller fall back to the literal transcript.
 *
 * `rest` is the draft text following the anchor, needed to tell "we have
 * tested" (auxiliary) from "we have budget" (main verb).
 */
export function negationRewrite(anchorText: string, rest = ""): Rewrite | null {
  // "Let's see" → "Let's not see"; "let's" is "let us", never "let is".
  const lets = /^(.*?\blet['’]s)(\s+.*)?$/isu.exec(anchorText);
  if (lets) return { replacement: `${lets[1]} not${lets[2] ?? ""}`, highlight: `not${lets[2] ?? ""}` };
  const contraction = /^(.*?)([\p{L}]+)['’](s|re|m)(\s+.*)?$/su.exec(anchorText);
  if (contraction) {
    const form = contraction[3] === "s" ? "isn't" : contraction[3] === "re" ? "aren't" : "am not";
    const highlight = `${form}${contraction[4] ?? ""}`;
    return { replacement: `${contraction[1]}${contraction[2]} ${highlight}`, highlight };
  }
  const aux = /^(.*?)\b(is|are|was|were|am|has|have|had|will|would|can|could|should|shall|does|do|did)\b(\s+.*)?$/su.exec(anchorText);
  if (!aux) return null;
  const verb = (aux[2] ?? "").toLowerCase();
  const trailing = aux[3] ?? "";
  if (/^(?:has|have|had)$/.test(verb) && !PARTICIPLE.test(trailing.length > 0 ? trailing : rest)) return null;
  const negated = verb === "can" ? "cannot" : `${aux[2]} not`;
  const highlight = `${negated}${trailing}`;
  return { replacement: `${aux[1]}${highlight}`, highlight };
}

/**
 * Validate against the shared contract before an issue leaves the guard. A
 * malformed issue would fail ReconstructResponseSchema.parse and 500 the whole
 * request, so a null here becomes `unsure` instead.
 */
export function buildIssue(draft: string, candidate: Omit<GuardIssue, "id">, id: string): GuardIssue | null {
  const parsed = GuardIssueSchema.safeParse({ ...candidate, id });
  if (!parsed.success) return null;
  const issue = parsed.data;
  const [a, b] = issue.draftSpan;
  const [c, d] = issue.fix.fixedSpan;
  if (b <= a || b > draft.length || draft.slice(a, b).trim().length === 0) return null;
  if (d <= c || d > issue.fix.sentence.length || issue.fix.sentence.slice(c, d).trim().length === 0) return null;
  if (issue.fix.sentence.trim() === draft.trim()) return null;
  return issue;
}

/* ---------- fixes from the model's own hedged sentence ---------- */

const WORD_CHAR = /[\p{L}\p{N}'’]/u;
const APPROX_WORDS = new Set(["about", "around", "roughly", "approximately", "some", "or so"]);
const MAX_SPAN_WORDS = 8;

export interface ModelFix extends SpanFix { hedge: string }

/**
 * Build a certainty fix from `hedged`, the model's version of `draft` that keeps
 * the speaker's hedge. The fix is the smallest whole-word span where the two
 * differ, so it composes with other span fixes. Returns null unless the change
 * is short, adds a real hedge word, and leaves negations and numbers intact.
 */
export function modelHedgeFix(draft: string, hedged: string, hedgePattern: RegExp, negationPattern: RegExp, numbersOf: (text: string) => string[]): ModelFix | null {
  if (!hedged.trim() || hedged.trim() === draft.trim()) return null;
  let p = 0;
  while (p < draft.length && p < hedged.length && draft[p] === hedged[p]) p++;
  let s = 0;
  while (s < draft.length - p && s < hedged.length - p && draft[draft.length - 1 - s] === hedged[hedged.length - 1 - s]) s++;

  // Widen to whole words. Both texts share the prefix and suffix, so the same
  // widening is valid for both.
  while (p > 0 && WORD_CHAR.test(draft[p - 1] ?? "")) p--;
  let end = draft.length - s;
  while (end < draft.length && WORD_CHAR.test(draft[end] ?? "")) end++;
  // A pure insertion has an empty draft span; anchor it to the next word.
  if (draft.slice(p, end).trim() === "") {
    while (end < draft.length && !WORD_CHAR.test(draft[end] ?? "")) end++;
    while (end < draft.length && WORD_CHAR.test(draft[end] ?? "")) end++;
  }
  s = draft.length - end;
  let start = p;
  while (start < end && /\s/.test(draft[start] ?? "")) start++;

  const removed = draft.slice(start, end);
  const replacement = hedged.slice(start, hedged.length - s);
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  if (!removed.trim() || !replacement.trim() || words(removed) > MAX_SPAN_WORDS || words(replacement) > MAX_SPAN_WORDS + 3) return null;

  const hedge = [...replacement.matchAll(new RegExp(hedgePattern.source, "giu"))]
    .map((m) => m[0])
    .find((w) => !APPROX_WORDS.has(w.toLowerCase()) && !new RegExp(`\\b${w}\\b`, "iu").test(removed));
  if (!hedge) return null;

  // The hedged version may only add uncertainty: no lost negation or number.
  const count = (re: RegExp, t: string) => [...t.matchAll(new RegExp(re.source, "giu"))].length;
  if (count(negationPattern, replacement) < count(negationPattern, removed)) return null;
  const kept = new Set(numbersOf(replacement));
  if (numbersOf(removed).some((n) => !kept.has(n))) return null;

  return { ...replaceSpan(draft, [start, end], replacement, hedge), hedge };
}
