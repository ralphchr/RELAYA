/*
 * Context Guard entry point.
 *
 * This is the only module reconstruct.ts needs. Status lives here rather than
 * in the pipeline so the whole verdict is testable without calling Groq.
 */

import type { GuardResult, LanguageCode, ReconstructResponse } from "@relaya/contracts";
import { checkSentence } from "./checks.js";
import { scanTranscript } from "./rules.js";
import { verifiedChips } from "./kept.js";

export interface GuardInput {
  transcript: string;
  sentence: string;
  /** The model's version of `sentence` that keeps the speaker's hedge. */
  hedgedSentence?: string;
  names: string[];
  facts: ReconstructResponse["facts"];
  confidence: number;
  unresolvedTerms: string[];
  languages?: LanguageCode[];
}

const MIN_CONFIDENCE = 0.6;

/** Short, deduped fact phrases for the "kept" list. */
const keptFacts = (facts: GuardInput["facts"]): string[] =>
  [...new Set(Object.values(facts).flat().map((value) => value.trim()).filter(Boolean))];

export function evaluateGuard(input: GuardInput): GuardResult {
  try {
    // These languages can be reconstructed, but the deterministic lexicon is
    // still scoped to Tagalog/Cebuano/English. Require review instead of
    // claiming the translation's meaning was independently checked. Scanning
    // them with that lexicon can also misread unrelated words as number words.
    if (input.languages?.some((language) => language === "ja" || language === "zh" || language === "es")) {
      return { status: "unsure", risk: "high", needsVerify: true, issues: [], kept: [] };
    }
    // Names the model found count as expected too, not just the session list.
    const expected = [...input.names, ...input.facts.names];
    const scan = scanTranscript(input.transcript, expected);
    const { issues, unsafe } = checkSentence({ ...input, scan });
    // Prefer what the guard itself verified; fall back to the model's facts.
    const verified = verifiedChips(scan, input.sentence, issues, input.transcript);
    const kept = verified.length > 0 ? verified : keptFacts(input.facts);

    // `flagged` outranks `unsure` (§7.1 step 7): the unsure phase hides the
    // Context Guard card, so an unsure verdict would silently drop the flags.
    const status = issues.length > 0 ? "flagged"
      : unsafe || input.confidence < MIN_CONFIDENCE || input.unresolvedTerms.length > 0 ? "unsure"
      : "clear";
    return { status, risk: scan.risk, needsVerify: scan.risk === "high", issues, kept };
  } catch {
    // §7.3: when the scan errors, assume the worst and offer the literal.
    return { status: "unsure", risk: "high", needsVerify: true, issues: [], kept: [] };
  }
}

export { scanTranscript } from "./rules.js";
export { checkSentence } from "./checks.js";
