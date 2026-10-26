/*
 * Number normalization.
 *
 * Both sides reduce to a canonical `value+unit` string, so `lima` ↔ `5`,
 * `1,500` ↔ `1500`, `3k` ↔ `3,000` and `alas-dos` ↔ `2 PM` all compare equal.
 * Matching on value instead of surface form is what keeps the false-alarm
 * rate inside the §7.4 budget.
 */

import { APPROXIMATORS, NUMBER_WORDS, SCALE_WORDS } from "./lexicon.js";
import type { Token } from "./text.js";

export type Unit = "" | "%" | "php" | "usd" | "time";

export interface NumberMention {
  raw: string;
  start: number;
  end: number;
  value: number;
  unit: Unit;
  canonical: string;
  /** `mga lima`, `about 500` — the speaker was approximating. */
  approx: boolean;
}

export const canonicalize = (value: number, unit: Unit): string => `${value}${unit}`;

const DIGITS = /^(?:(?:₱|\$|php|usd)\s?)?(\d[\d,]*(?:\.\d+)?)\s?(%|k|m)?$/i;
const PERCENT_WORDS = new Set(["percent", "porsyento", "porciento", "%"]);
const PESO_WORDS = new Set(["peso", "pesos", "piso", "php", "₱"]);
const DOLLAR_WORDS = new Set(["dollar", "dollars", "usd", "$"]);

function unitFromToken(t: Token | undefined): Unit | null {
  if (!t) return null;
  if (PERCENT_WORDS.has(t.fold)) return "%";
  if (PESO_WORDS.has(t.fold)) return "php";
  if (DOLLAR_WORDS.has(t.fold)) return "usd";
  return null;
}

function unitFromPrefix(raw: string): Unit | null {
  if (/^(?:₱|php)/i.test(raw)) return "php";
  if (/^(?:\$|usd)/i.test(raw)) return "usd";
  return null;
}

/** Compose number words: `three thousand five hundred` → 3500, `beinte` → 20. */
function readNumberWords(tokens: Token[], i: number): { value: number; next: number } | null {
  let total = 0, current = 0, j = i, saw = false;
  while (j < tokens.length) {
    const token = tokens[j];
    if (!token) break;
    const word = token.fold;
    if (word === "at" || word === "and" || word === "y" || word === "ug") {
      if (!saw) break;
      // Only a connector between number words counts ("one thousand and five").
      const after = tokens[j + 1];
      if (!after || NUMBER_WORDS[after.fold] === undefined) break;
      j++;
      continue;
    }
    const parts = word.split("-").filter(Boolean);
    const values = parts.map((p) => NUMBER_WORDS[p]);
    if (values.length === 0 || values.some((v) => v === undefined)) break;
    for (const [k, value] of values.entries()) {
      const part = parts[k] as string;
      const amount = value as number;
      if (SCALE_WORDS.has(part)) {
        current = (current || 1) * amount;
        if (amount >= 1000) { total += current; current = 0; }
      } else current += amount;
    }
    saw = true;
    j++;
  }
  return saw ? { value: total + current, next: j } : null;
}

const isApprox = (tokens: Token[], i: number) =>
  APPROXIMATORS.has(tokens[i - 1]?.fold ?? "") || APPROXIMATORS.has(tokens[i - 2]?.fold ?? "");

/** Every number mentioned in `tokens`, canonicalized. */
export function extractNumbers(tokens: Token[]): NumberMention[] {
  const out: NumberMention[] = [];
  /** Index of a unit token already consumed as a trailing unit. */
  let consumed = -1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    // `alas-dos`, `alas dos` → a clock time.
    const alas = /^alas-?(.*)$/.exec(token.fold);
    if (alas) {
      const inline = alas[1] ?? "";
      const hour = inline.length > 0 ? NUMBER_WORDS[inline] ?? Number(inline) : NUMBER_WORDS[tokens[i + 1]?.fold ?? ""];
      if (typeof hour === "number" && Number.isFinite(hour)) {
        const end = inline.length > 0 ? token.end : tokens[i + 1]?.end ?? token.end;
        out.push({ raw: inline.length > 0 ? token.raw : `${token.raw} ${tokens[i + 1]?.raw ?? ""}`.trim(), start: token.start, end, value: hour, unit: "time", canonical: canonicalize(hour, "time"), approx: isApprox(tokens, i) });
        if (inline.length === 0) i++;
        continue;
      }
    }

    const digits = DIGITS.exec(token.raw);
    if (digits) {
      const base = Number((digits[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(base)) continue;
      const suffix = (digits[2] ?? "").toLowerCase();
      const value = suffix === "k" ? base * 1000 : suffix === "m" ? base * 1_000_000 : base;
      let unit: Unit = suffix === "%" ? "%" : unitFromPrefix(token.raw) ?? "";
      let start = token.start, end = token.end, raw = token.raw;
      const approx = isApprox(tokens, i);
      if (unit === "" && suffix !== "k" && suffix !== "m") {
        const trailing = unitFromToken(tokens[i + 1]);
        if (trailing) { unit = trailing; end = tokens[i + 1]?.end ?? end; raw = `${raw} ${tokens[i + 1]?.raw ?? ""}`.trim(); consumed = i + 1; i++; }
      }
      // A currency word can also lead: "PHP 500", "$ 20".
      if (unit === "" && i - 1 !== consumed) {
        const leading = unitFromToken(tokens[i - 1]);
        const previous = tokens[i - 1];
        if (leading && previous) { unit = leading; start = previous.start; raw = `${previous.raw} ${raw}`; }
      }
      out.push({ raw, start, end, value, unit, canonical: canonicalize(value, unit), approx });
      continue;
    }

    // Clock times written `2:30` keep only the hour; minutes rarely carry meaning here.
    const clock = /^(\d{1,2}):(\d{2})$/.exec(token.raw);
    if (clock) {
      const hour = Number(clock[1]);
      out.push({ raw: token.raw, start: token.start, end: token.end, value: hour, unit: "time", canonical: canonicalize(hour, "time"), approx: isApprox(tokens, i) });
      continue;
    }

    const words = readNumberWords(tokens, i);
    if (words) {
      const last = tokens[words.next - 1] ?? token;
      let unit: Unit = "";
      let end = last.end;
      const trailing = unitFromToken(tokens[words.next]);
      if (trailing) { unit = trailing; end = tokens[words.next]?.end ?? end; }
      out.push({
        raw: tokens.slice(i, words.next).map((t) => t.raw).join(" "),
        start: token.start, end, value: words.value, unit,
        canonical: canonicalize(words.value, unit), approx: isApprox(tokens, i),
      });
      i = words.next - 1 + (trailing ? 1 : 0);
    }
  }
  return out;
}

/** Multiset of canonical forms, for comparing the transcript against the draft. */
export function countByCanonical(mentions: NumberMention[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of mentions) counts.set(m.canonical, (counts.get(m.canonical) ?? 0) + 1);
  return counts;
}
