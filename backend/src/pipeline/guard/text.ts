/*
 * Offset-preserving text helpers for the Context Guard.
 *
 * Every GuardIssue span is a char offset into the original draft, but matching
 * has to ignore case and accents. Folding the whole string would break the
 * offsets (NFD changes length), so we fold per token and keep the raw offsets.
 */

export interface Token { raw: string; fold: string; start: number; end: number }
export interface Clause { text: string; start: number; end: number; tokens: Token[] }

/** Accent- and case-insensitive form of a token. Straightens curly apostrophes. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[’`]/g, "'");

/**
 * Words plus the shapes the lexicon cares about: `1,500`, `4.5%`, `alas-dos`,
 * `₱500`, `it's`. Sentence punctuation is trimmed off the end so `Monday.`
 * tokenizes as `Monday` without losing its offset.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}₱$][\p{L}\p{N}'’.,:%₱$-]*/gu)) {
    const start = match.index;
    const trimmed = match[0].replace(/[.,:;!?-]+$/, "");
    const raw = trimmed.length > 0 ? trimmed : match[0];
    out.push({ raw, fold: fold(raw), start, end: start + raw.length });
  }
  return out;
}

/**
 * Punctuation or a coordinator. The leading guard keeps `1,000` and `4.5` from
 * being torn in half — digit-internal separators are not clause breaks.
 */
const CLAUSE_BREAK = /(?!(?<=\d)[,.](?=\d))[,;.!?]+|\s+(?:but|and|so|because|though|although|while|then)\s+/giu;

/** Split into clauses on punctuation and coordinators, keeping offsets exact. */
export function splitClauses(text: string): Clause[] {
  const out: Clause[] = [];
  let at = 0;
  const push = (from: number, to: number) => {
    const slice = text.slice(from, to);
    const lead = slice.length - slice.trimStart().length;
    const start = from + lead, end = to - (slice.length - slice.trimEnd().length);
    if (end <= start) return;
    const inner = text.slice(start, end);
    out.push({ text: inner, start, end, tokens: tokenize(inner).map((t) => ({ ...t, start: t.start + start, end: t.end + start })) });
  };
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    push(at, match.index);
    at = match.index + match[0].length;
  }
  push(at, text.length);
  return out;
}

/** The clause containing `offset`, or null when it falls in a break. */
export const clauseAt = (clauses: Clause[], offset: number): Clause | null =>
  clauses.find((c) => offset >= c.start && offset < c.end) ?? null;

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
