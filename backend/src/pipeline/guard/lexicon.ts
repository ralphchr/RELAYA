/*
 * Risk lexicon, versioned and unit-tested.
 *
 * Two sides, deliberately asymmetric:
 *  - SOURCE entries match the Tagalog/Cebuano/English transcript precisely.
 *  - DRAFT entries match the English draft generously. The failure we must
 *    catch is a *dropped* negation or hedge, so a generous draft lexicon is
 *    what keeps "we haven't tested" from being read as a lost "wala pa".
 */

import type { Token } from "./text.js";

export const LEXICON_VERSION = "1";

export interface Match { raw: string; gloss?: string; start: number; end: number; length: number }

/* ---------- numbers ---------- */

/** Tagalog, Cebuano, Spanish-derived and English number words (§7.3). */
export const NUMBER_WORDS: Record<string, number> = {
  // Tagalog
  isa: 1, dalawa: 2, tatlo: 3, apat: 4, lima: 5, anim: 6, pito: 7, walo: 8, siyam: 9, sampu: 10,
  labing: 10, dalawampu: 20, tatlumpu: 30, apatnapu: 40, limampu: 50, animnapu: 60, pitumpu: 70, walumpu: 80, siyamnapu: 90,
  // Cebuano
  usa: 1, duha: 2, tulo: 3, upat: 4, unom: 6, napulo: 10, kawhaan: 20, katloan: 30,
  // Spanish-derived
  uno: 1, dos: 2, tres: 3, kuwatro: 4, kwatro: 4, singko: 5, sais: 6, siyete: 7, otso: 8, nuwebe: 9, nuebe: 9,
  diyes: 10, onse: 11, dose: 12, trese: 13, katorse: 14, kinse: 15, disisais: 16, disisyete: 17, disiotso: 18, disinuwebe: 19,
  beinte: 20, bente: 20, trenta: 30, kwarenta: 40, kuwarenta: 40, singkwenta: 50, sisenta: 60, setenta: 70, otsenta: 80, nobenta: 90,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1_000_000,
  // Scales
  gatos: 100, libo: 1000, milyon: 1_000_000,
};

/** Words that multiply what came before them rather than adding to it. */
export const SCALE_WORDS = new Set(["hundred", "thousand", "million", "gatos", "libo", "milyon"]);

/** Words that make a following number approximate (`mga lima` → "about five"). */
export const APPROXIMATORS = new Set(["mga", "about", "around", "roughly", "approximately", "almost", "halos", "mga-", "some"]);

export const isNumberToken = (t: Token | undefined): boolean =>
  t !== undefined && (/\d/.test(t.fold) || NUMBER_WORDS[t.fold] !== undefined);

/* ---------- negation ---------- */

/** §7.3 negation entries, longest first so `wala pa` consumes `wala`. */
const NEGATIONS_SOURCE: readonly { words: readonly string[]; gloss?: string }[] = [
  { words: ["wala", "pa"], gloss: "not yet" },
  { words: ["dili", "pa"], gloss: "not yet" },
  { words: ["hindi", "pa"], gloss: "not yet" },
  { words: ["di", "pa"], gloss: "not yet" },
  { words: ["walay"], gloss: "none" },
  { words: ["hindi"], gloss: "not" },
  { words: ["hinde"], gloss: "not" },
  { words: ["dili"], gloss: "not" },
  { words: ["wala"], gloss: "none" },
  { words: ["huwag"], gloss: "don't" },
  { words: ["wag"], gloss: "don't" },
  { words: ["ayaw"], gloss: "doesn't want to" },
  { words: ["di"], gloss: "not" },
  { words: ["never"] },
  { words: ["not"] },
  { words: ["no"] },
];

/** Readings that look like negation but are not (`di ba`, `no problem`). */
const NEGATION_EXCEPTIONS: readonly (readonly string[])[] = [
  ["di", "ba"], ["no", "problem"], ["no", "worries"], ["no", "choice"],
  // "if it works or not" / "kung gagana o hindi" asks whether; English drops the "or not" freely.
  ["or", "not"], ["or", "no"], ["o", "hindi"], ["o", "dili"],
];

/**
 * The generous English side. Matched against the whole draft rather than
 * token-by-token so contractions and multi-word forms both land.
 */
export const DRAFT_NEGATION = /\b(?:\w+n['’]t|not|no|never|none|nothing|nobody|no one|without|nor|neither|cannot|unable|lacks?|missing|fails? to|yet to|short of|still (?:waiting|pending|open))\b/giu;

export const countDraftNegations = (draft: string): number => [...draft.matchAll(DRAFT_NEGATION)].length;

function matchWords(tokens: Token[], i: number, words: readonly string[]): Match | null {
  const first = tokens[i];
  if (!first) return null;
  for (let k = 0; k < words.length; k++) if (tokens[i + k]?.fold !== words[k]) return null;
  const last = tokens[i + words.length - 1];
  if (!last) return null;
  return { raw: words.length === 1 ? first.raw : `${first.raw} ${last.raw}`, start: first.start, end: last.end, length: words.length };
}

/** Longest negation starting at `tokens[i]`, or null. */
export function matchNegation(tokens: Token[], i: number): Match | null {
  // An exception may start before the negation word ("or not") or at it ("no problem").
  for (const exception of NEGATION_EXCEPTIONS) {
    for (let back = 0; back < exception.length && back <= i; back++) if (matchWords(tokens, i - back, exception)) return null;
  }
  // A bare leading "no" is a discourse response ("No, hindi pa natapos"), and the
  // real negation that follows is counted on its own.
  if (i === 0 && tokens[0]?.fold === "no" && (tokens.length === 1 || matchNegationAt(tokens, 1))) return null;
  return matchNegationAt(tokens, i);
}

function matchNegationAt(tokens: Token[], i: number): Match | null {
  for (const entry of NEGATIONS_SOURCE) {
    const match = matchWords(tokens, i, entry.words);
    if (match) return entry.gloss === undefined ? match : { ...match, gloss: entry.gloss };
  }
  return null;
}

/* ---------- hedges ---------- */

export interface HedgeEntry { gloss: string; modal: string; draft: readonly string[] }

/**
 * §7.3 hedges, each with the English modal a fix should restore. `draft` lists
 * English that already carries the doubt ("he thinks he'll finish" keeps "siguro").
 */
export const HEDGES: Record<string, HedgeEntry> = {
  siguro: { gloss: "maybe", modal: "might", draft: ["maybe", "might", "probably", "perhaps", "possibly", "i think", "thinks", "think", "likely", "hopefully"] },
  baka: { gloss: "might", modal: "might", draft: ["might", "maybe", "could", "possibly", "thinks", "think", "likely", "hopefully"] },
  yata: { gloss: "I think", modal: "probably", draft: ["i think", "seems", "probably", "thinks", "think", "likely", "hopefully"] },
  basin: { gloss: "maybe", modal: "might", draft: ["maybe", "might", "perhaps", "possibly", "thinks", "think", "likely", "hopefully"] },
  tingali: { gloss: "maybe", modal: "might", draft: ["maybe", "might", "probably", "perhaps", "thinks", "think", "likely", "hopefully"] },
  parang: { gloss: "it seems", modal: "seems to", draft: ["seems", "looks like", "sort of", "kind of"] },
  mukhang: { gloss: "it looks like", modal: "looks like", draft: ["looks like", "seems", "appears"] },
  murag: { gloss: "it seems", modal: "seems to", draft: ["seems", "looks like"] },
  maybe: { gloss: "maybe", modal: "might", draft: ["maybe", "might", "perhaps", "possibly", "thinks", "think", "likely", "hopefully"] },
  probably: { gloss: "probably", modal: "probably", draft: ["probably", "likely", "might", "thinks", "think", "hopefully"] },
  mga: { gloss: "about", modal: "about", draft: ["about", "around", "roughly", "approximately", "or so", "some"] },
};

/** Determiners that make `baka` the noun "cow" rather than the hedge. */
const BAKA_NOUN_MARKERS = new Set(["ang", "ng", "yung", "ug", "sa", "mga"]);

export interface HedgeMatch extends Match { key: string; entry: HedgeEntry }

/** Hedge starting at `tokens[i]`, or null. */
export function matchHedge(tokens: Token[], i: number): HedgeMatch | null {
  const token = tokens[i];
  if (!token) return null;
  const key = token.fold;
  // "I think" is two tokens.
  if (key === "i" && tokens[i + 1]?.fold === "think") {
    const next = tokens[i + 1];
    if (next) return { key: "yata", entry: HEDGES.yata as HedgeEntry, raw: `${token.raw} ${next.raw}`, gloss: "I think", start: token.start, end: next.end, length: 2 };
  }
  const entry = HEDGES[key];
  if (!entry) return null;
  // `mga` is also the plural marker; only a following number makes it a hedge.
  if (key === "mga") {
    if (!isNumberToken(tokens[i + 1])) return null;
    const next = tokens[i + 1];
    if (!next) return null;
    return { key, entry, raw: `${token.raw} ${next.raw}`, gloss: `about ${next.raw}`, start: token.start, end: next.end, length: 2 };
  }
  if (key === "baka" && BAKA_NOUN_MARKERS.has(tokens[i - 1]?.fold ?? "")) return null;
  return { key, entry, raw: token.raw, gloss: entry.gloss, start: token.start, end: token.end, length: 1 };
}

/** The generous English hedge side. */
export const DRAFT_HEDGES = /\b(?:might|may|maybe|perhaps|possibly|probably|likely|could|i think|seems?|appears?|looks like|sounds like|sort of|kind of|not sure|unsure|about|around|roughly|approximately|or so|some)\b/giu;

export const countDraftHedges = (draft: string): number => [...draft.matchAll(DRAFT_HEDGES)].length;

/**
 * Hedges that carry certainty, without the approximators. "about three days"
 * keeps a "mga" but says nothing about a "siguro", so it must not count as one.
 */
export const DRAFT_CERTAINTY_HEDGES = /\b(?:might|may|maybe|perhaps|possibly|probably|likely|could|i think|thinks?|hopefully|hopes? to|seems?|appears?|looks like|sounds like|sort of|kind of|not sure|unsure)\b/giu;

export const countDraftCertaintyHedges = (draft: string): number => [...draft.matchAll(DRAFT_CERTAINTY_HEDGES)].length;

/** Does this clause already carry an approximator (`about 500`)? */
export const hasApproximator = (text: string): boolean =>
  /\b(?:about|around|roughly|approximately|or so|some|almost|nearly)\b/i.test(text);
