/*
 * What Context Guard verified, as short chips for a clear sentence
 * ("“siguro” → “might”"). Shown so a clear result reads as "checked",
 * not "skipped". Only pairs we can actually see in both texts are listed.
 */

import type { GuardIssue, GuardIssueType } from "@relaya/contracts";
import { DRAFT_CERTAINTY_HEDGES, DRAFT_NEGATION } from "./lexicon.js";
import { extractNumbers } from "./numbers.js";
import { hasName, type Scan } from "./rules.js";
import { tokenize } from "./text.js";
import { draftAsks, spokenQuestion } from "./question.js";

const MAX_CHIPS = 5;

const q = (s: string) => `“${s}”`;
const words = (re: RegExp, text: string) => [...text.matchAll(new RegExp(re.source, "giu"))].map((m) => m[0]);

export function verifiedChips(scan: Scan, sentence: string, issues: GuardIssue[], transcript = ""): string[] {
  const flagged = new Set<GuardIssueType>(issues.map((i) => i.type));
  const chips: string[] = [];

  // Questions stay questions.
  if (!flagged.has("question") && spokenQuestion(transcript) && draftAsks(sentence)) chips.push("Question kept");

  // Hedges: pair spoken hedges with draft hedges in order.
  if (!flagged.has("certainty")) {
    const draftHedges = words(DRAFT_CERTAINTY_HEDGES, sentence);
    scan.hedges.filter((h) => h.key !== "mga").forEach((h, i) => {
      const draft = draftHedges[i];
      if (draft) chips.push(`${q(h.raw)} → ${q(draft.toLowerCase())}`);
    });
  }

  // Negations: pair in order.
  if (!flagged.has("negation")) {
    const draftNegations = words(DRAFT_NEGATION, sentence);
    scan.negations.forEach((n, i) => {
      const draft = draftNegations[i];
      if (draft) chips.push(`${q(n.raw)} → ${q(draft.toLowerCase())}`);
    });
  }

  // Numbers: list each spoken number whose value is still in the draft.
  if (!flagged.has("number") && !flagged.has("certainty")) {
    const draftValues = new Set(extractNumbers(tokenize(sentence)).map((m) => m.canonical));
    for (const n of scan.numbers) {
      if (draftValues.has(n.canonical)) chips.push(`${n.approx ? "About " : ""}${n.raw} kept`);
    }
  }

  // Names.
  if (!flagged.has("name")) {
    for (const name of new Set(scan.names.map((n) => n.name))) {
      if (hasName(sentence, name)) chips.push(`${name} kept`);
    }
  }

  return [...new Set(chips)].slice(0, MAX_CHIPS);
}
