/*
 * Transcript rule scan.
 *
 * Deliberately generous: any lexicon hit raises `risk` to "high", which only
 * gates the §7.2 verify call. Emitting an issue is a separate, much stricter
 * decision made in checks.ts.
 */

import { LEXICON_VERSION, matchHedge, matchNegation, type HedgeMatch, type Match } from "./lexicon.js";
import { extractNumbers, type NumberMention } from "./numbers.js";
import { fold, splitClauses, tokenize, type Clause, type Token } from "./text.js";

export interface NameMention { name: string; raw: string; start: number; end: number }

export interface Scan {
  risk: "low" | "high";
  numbers: NumberMention[];
  names: NameMention[];
  negations: Match[];
  hedges: HedgeMatch[];
  clauses: Clause[];
  tokens: Token[];
  lexiconVersion: string;
}

/** Folded token sequences for each expected name, longest first. */
function nameNeedles(names: string[]): { name: string; parts: string[] }[] {
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    .map((name) => ({ name, parts: tokenize(name).map((t) => t.fold) }))
    .filter((n) => n.parts.length > 0)
    .sort((a, b) => b.parts.length - a.parts.length);
}

const POSSESSIVE = /'s$/;

/** Does the name's token sequence start at `tokens[i]`? Allows a possessive. */
function nameAt(tokens: Token[], i: number, parts: string[]): { start: number; end: number; raw: string } | null {
  for (let k = 0; k < parts.length; k++) {
    const token = tokens[i + k];
    if (!token) return null;
    const bare = token.fold.replace(POSSESSIVE, "");
    if (bare !== parts[k]) return null;
  }
  const first = tokens[i], last = tokens[i + parts.length - 1];
  if (!first || !last) return null;
  return { start: first.start, end: last.end, raw: tokens.slice(i, i + parts.length).map((t) => t.raw).join(" ") };
}

/** Every mention of an expected name in `tokens`. */
export function findNames(tokens: Token[], names: string[]): NameMention[] {
  const needles = nameNeedles(names);
  const out: NameMention[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const needle of needles) {
      const hit = nameAt(tokens, i, needle.parts);
      if (!hit) continue;
      out.push({ name: needle.name, ...hit });
      i += needle.parts.length - 1;
      break;
    }
  }
  return out;
}

export function scanTranscript(transcript: string, names: string[]): Scan {
  const tokens = tokenize(transcript);
  const clauses = splitClauses(transcript);
  const numbers = extractNumbers(tokens);
  const foundNames = findNames(tokens, names);

  const negations: Match[] = [];
  const hedges: HedgeMatch[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const negation = matchNegation(tokens, i);
    if (negation) { negations.push(negation); i += negation.length - 1; continue; }
    const hedge = matchHedge(tokens, i);
    if (hedge) { hedges.push(hedge); i += hedge.length - 1; }
  }

  const risk = numbers.length + foundNames.length + negations.length + hedges.length > 0 ? "high" : "low";
  return { risk, numbers, names: foundNames, negations, hedges, clauses, tokens, lexiconVersion: LEXICON_VERSION };
}

/** Case- and accent-insensitive whole-token presence of `name` in `text`. */
export const hasName = (text: string, name: string): boolean =>
  findNames(tokenize(text), [name]).length > 0;

export const foldedText = (text: string) => fold(text);
