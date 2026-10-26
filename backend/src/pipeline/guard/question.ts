/*
 * Questions must stay questions. "Kakayanin ba natin ito?" asks; "We can handle
 * this." promises. Turning one into the other changes meaning as much as a
 * dropped "hindi", so Context Guard flags it with a one-tap fix.
 */

import { replaceSpan, type SpanFix } from "./fixes.js";
import { fold } from "./text.js";

/** Tagalog/Bisaya question particle; Whisper usually adds "?" too. */
const QUESTION_PARTICLE = /(?:^|[\s,])ba(?=[\s?.,!]|$)/iu;

/** "Kumusta kayo?" is a greeting; "Hello everyone" is a fine English answer to it, not a lost question. */
const GREETING = /^(?:hi|hello|hey|uy|oy|good (?:morning|afternoon|evening)|magandang (?:umaga|tanghali|hapon|gabi)(?: po)?)?[\s,!]*(?:ku|ka)?musta(?: (?:na|ka|kayo|po|kayong lahat|everyone|guys))*[\s?!.]*$|^how are (?:you|you all|you guys|everyone)(?: doing| today)?[\s?!.]*$|^what'?s up[\s?!.]*$/iu;

/** The question the speaker asked (its raw text), or null. */
export function spokenQuestion(transcript: string): string | null {
  const asked = spokenSentences(transcript).reverse().find((s) => (s.endsWith("?") || QUESTION_PARTICLE.test(fold(s))) && !GREETING.test(fold(s)));
  return asked ?? null;
}

export const spokenSentences = (transcript: string): string[] =>
  transcript.match(/[^.?!]+[.?!]*/gu)?.map((s) => s.trim()).filter(Boolean) ?? [];

export const draftAsks = (sentence: string): boolean => sentence.includes("?");

const SUBJECTS = new Set(["i", "we", "you", "they", "he", "she", "it", "this", "that", "these", "those", "there"]);
/** Tagalog/Bisaya confirmation tags: "di ba", "diba", "hindi ba", "dili ba". */
const TAG_QUESTION = /\b(?:di ba|diba|hindi ba|dili ba)\b/u;
const DETERMINERS = new Set(["the", "our", "my", "your", "their", "his", "her", "this", "that", "these", "those"]);
const AUX = new Set(["can", "could", "will", "would", "should", "shall", "may", "might", "must", "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had"]);

/**
 * Fix for the last sentence of the draft: invert subject and auxiliary when
 * that is grammatical ("We can handle this." → "Can we handle this?"),
 * otherwise keep the words and make it a question ("We handle this?").
 */
export function questionFix(draft: string, asked = ""): SpanFix | null {
  const trimmedEnd = draft.replace(/\s+$/u, "").length;
  const body = draft.slice(0, trimmedEnd);
  const lastStart = Math.max(body.search(/[^.?!]*[.?!]*$/u), 0);
  const leading = body.slice(lastStart).match(/^\s*/u)?.[0].length ?? 0;
  const start = lastStart + leading;
  const last = body.slice(start);
  if (!last.trim()) return null;

  // "Di ba Monday ang demo?" asks for confirmation: keep the statement, add "right?".
  if (TAG_QUESTION.test(fold(asked))) {
    const lastWord = last.match(/(\S+)\s*$/u);
    if (lastWord?.index !== undefined) {
      const bare = lastWord[1]!.replace(/[.!?]+$/u, "");
      return replaceSpan(draft, [start + lastWord.index, trimmedEnd], `${bare}, right?`, "right?");
    }
  }

  const words = last.replace(/[.!]+$/u, "").split(/\s+/u);
  // Subject is a pronoun ("we") or a short determiner phrase ("the design").
  const first = words[0]?.toLowerCase() ?? "";
  const auxAt = SUBJECTS.has(first) ? 1 : DETERMINERS.has(first) ? words.findIndex((w, i) => i >= 2 && i <= 3 && AUX.has(w.toLowerCase())) : -1;
  const aux = auxAt > 0 ? words[auxAt] : undefined;
  if (aux && AUX.has(aux.toLowerCase()) && words.length > auxAt + 1) {
    const subject = words.slice(0, auxAt).map((w, i) => (i === 0 && w.toLowerCase() !== "i" ? w.toLowerCase() : w)).join(" ");
    const inverted = `${aux[0]!.toUpperCase()}${aux.slice(1).toLowerCase()} ${subject} ${words.slice(auxAt + 1).join(" ")}?`;
    return replaceSpan(draft, [start, trimmedEnd], inverted, inverted);
  }

  // No clean inversion: turn just the final word's punctuation into "?".
  const lastWord = last.match(/(\S+)\s*$/u);
  if (!lastWord || lastWord.index === undefined) return null;
  const wordStart = start + lastWord.index;
  const bare = lastWord[1]!.replace(/[.!]+$/u, "");
  return replaceSpan(draft, [wordStart, trimmedEnd], `${bare}?`, `${bare}?`);
}
