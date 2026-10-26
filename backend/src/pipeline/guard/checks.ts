/*
 * Deterministic checks on the reconstructed sentence.
 *
 * Scope: hedges, numbers, names and negation. `date` and `commitment` are not
 * implemented yet.
 *
 * Each failure becomes a GuardIssue whose fix is a span replacement. When no
 * grammatical rewrite exists — a dropped number has nowhere to go that reads
 * correctly — we set `unsafe` instead of shipping a fix that makes the sentence
 * worse; the caller turns that into `unsure` and offers the literal transcript.
 */

import type { GuardIssue, GuardIssueType, ReconstructResponse } from "@relaya/contracts";
import { countDraftCertaintyHedges, countDraftNegations, DRAFT_CERTAINTY_HEDGES, DRAFT_NEGATION, hasApproximator, matchNegation } from "./lexicon.js";
import { countByCanonical, extractNumbers } from "./numbers.js";
import { hasName, type Scan } from "./rules.js";
import { alignClause, buildIssue, hedgeRewrite, modelHedgeFix, negationRewrite, PRONOUNS, replaceSpan, verbRun, type SpanFix } from "./fixes.js";
import { clauseAt, splitClauses, tokenize, type Clause } from "./text.js";
import { draftAsks, questionFix, spokenQuestion, spokenSentences } from "./question.js";

type Facts = ReconstructResponse["facts"];

export interface CheckInput { transcript: string; sentence: string; hedgedSentence?: string; names: string[]; facts: Facts; scan: Scan }
export interface CheckResult { issues: GuardIssue[]; unsafe: boolean }

/** §7.1 fixes are computed against the original draft, so they do not compose. */
const MAX_ISSUES = 2;
const PRIORITY: Record<GuardIssueType, number> = { negation: 0, question: 1, number: 2, name: 3, certainty: 4, date: 5, commitment: 6 };

interface Candidate { type: GuardIssueType; title: string; said: string; gloss?: string; explanation: string; label: string; fix: SpanFix }

const quote = (s: string) => `“${s}”`;

export function checkSentence(input: CheckInput): CheckResult {
  const { sentence, scan } = input;
  const draftClauses = splitClauses(sentence);
  const candidates: Candidate[] = [];
  let unsafe = false;

  const align = (offset: number) => {
    const target = clauseAt(scan.clauses, offset);
    const index = target ? scan.clauses.indexOf(target) : 0;
    return alignClause(draftClauses, target, index, scan);
  };

  /* ---------- negation (§7.1: each transcript negation has one in the sentence) ---------- */
  const negatedClauses = scan.clauses.filter((c) => c.tokens.some((_, i) => matchNegation(c.tokens, i)));
  if (negatedClauses.length > countDraftNegations(sentence)) {
    const offender = negatedClauses.find((c) => {
      const draftClause = align(c.start);
      return draftClause !== null && countDraftNegations(draftClause.text) === 0;
    }) ?? negatedClauses[0];
    const mention = offender ? firstNegation(offender) : null;
    const draftClause = offender ? align(offender.start) : null;
    if (mention && draftClause) {
      const anchor = verbRun(draftClause);
      const rewrite = anchor ? negationRewrite(sentence.slice(anchor[0], anchor[1]), sentence.slice(anchor[1], draftClause.end)) : null;
      if (anchor && rewrite) {
        candidates.push({
          type: "negation", title: "Negation dropped", said: mention.raw,
          ...(mention.gloss ? { gloss: mention.gloss } : {}),
          explanation: "The draft turns what you said into a yes.",
          label: `Keep ${quote(mention.gloss ?? "not")}`,
          fix: replaceSpan(sentence, anchor, rewrite.replacement, rewrite.highlight),
        });
      } else unsafe = true;
    } else unsafe = true;
  }

  /* ---------- numbers (§7.1: number sets equal after normalization) ---------- */
  const draftNumbers = extractNumbers(tokenize(sentence));
  const remaining = countByCanonical(draftNumbers);
  for (const mention of scan.numbers) {
    const left = remaining.get(mention.canonical) ?? 0;
    if (left > 0) {
      remaining.set(mention.canonical, left - 1);
      // `mga lima` kept its value but lost its "about" (§7.1 step 6).
      const draftClause = align(mention.start);
      if (mention.approx && draftClause && !hasApproximator(draftClause.text)) {
        const token = draftClause.tokens.find((t) => t.fold.replace(/,/g, "") === String(mention.value) || t.fold === mention.raw.toLowerCase());
        if (token) {
          // Quote what the speaker actually said ("mga 500"), not the bare digits.
          const spoken = scan.hedges.find((h) => h.key === "mga" && h.start <= mention.start && h.end >= mention.end);
          candidates.push({
            type: "certainty", title: "Approximate number made exact", said: spoken?.raw ?? mention.raw, gloss: `about ${mention.value}`,
            explanation: "You said about this number; the draft states it exactly.",
            label: `Keep ${quote("about")}`,
            fix: replaceSpan(sentence, [token.start, token.end], `about ${token.raw}`, `about ${token.raw}`),
          });
        }
      }
      continue;
    }
    // Absent. A different number in the same clause can be corrected in place;
    // a number with no counterpart has no grammatical insertion point.
    const draftClause = align(mention.start);
    const wrong = draftClause?.tokens.find((t) => /\d/.test(t.fold) && t.fold.replace(/,/g, "") !== String(mention.value));
    if (wrong) {
      candidates.push({
        type: "number", title: "Number changed", said: mention.raw,
        explanation: "The draft shows a different number than you said.",
        label: `Use ${quote(mention.raw)}`,
        fix: replaceSpan(sentence, [wrong.start, wrong.end], mention.raw, mention.raw),
      });
    } else unsafe = true;
  }

  /* ---------- names (§7.1: every transcript name appears in the sentence) ---------- */
  for (const name of [...new Set(scan.names.map((n) => n.name))]) {
    if (hasName(sentence, name)) continue;
    const mention = scan.names.find((n) => n.name === name);
    const draftClause = mention ? align(mention.start) : draftClauses[0] ?? null;
    const fix = draftClause ? nameFix(sentence, draftClause, name) : null;
    if (fix) {
      candidates.push({
        type: "name", title: "Name missing", said: name,
        explanation: "The draft drops a name you said.",
        label: `Put ${quote(name)} back`,
        fix,
      });
    } else unsafe = true;
  }

  /* ---------- questions: a question must not come back as a statement ---------- */
  const asked = spokenQuestion(input.transcript);
  if (asked && !draftAsks(sentence)) {
    // The fix rewrites the draft's last sentence, so it only fits a question the speaker ended on.
    const fix = spokenSentences(input.transcript).at(-1) === asked ? questionFix(sentence, asked) : null;
    if (fix) {
      candidates.push({
        type: "question", title: "Question turned into a statement", said: asked,
        explanation: "You asked this; the draft states it as a fact.",
        label: "Keep it a question",
        fix,
      });
    } else unsafe = true;
  }

  /* ---------- hedges (§7.1: each hedge maps to a hedge) ---------- */
  const spoken = scan.hedges.filter((h) => h.key !== "mga");
  if (spoken.length > countDraftCertaintyHedges(sentence)) {
    const offender = spoken.find((h) => {
      const draftClause = align(h.start);
      return draftClause !== null && !new RegExp(DRAFT_CERTAINTY_HEDGES.source, "iu").test(draftClause.text);
    }) ?? spoken[0];
    const draftClause = offender ? align(offender.start) : null;
    // Prefer the model's own hedged wording ("We'll probably finish"); fall
    // back to the rule-based rewrite when it is missing or not a clean edit.
    const numbersOf = (text: string) => extractNumbers(tokenize(text)).map((n) => n.canonical);
    const modelFix = offender && input.hedgedSentence
      ? modelHedgeFix(sentence, input.hedgedSentence, DRAFT_CERTAINTY_HEDGES, DRAFT_NEGATION, numbersOf) : null;
    if (offender && modelFix) {
      candidates.push({
        type: "certainty", title: "Certainty changed", said: offender.raw,
        ...(offender.gloss ? { gloss: offender.gloss } : {}),
        explanation: "You hedged this; the draft states it as fact.",
        label: `Keep ${quote(modelFix.hedge.toLowerCase().replace(/\bi\b/g, "I"))}`,
        fix: modelFix,
      });
    } else if (offender && draftClause) {
      const anchor = verbRun(draftClause);
      const rewrite = anchor ? hedgeRewrite(sentence.slice(anchor[0], anchor[1]), offender.entry.modal) : null;
      if (anchor && rewrite) {
        candidates.push({
          type: "certainty", title: "Certainty changed", said: offender.raw,
          ...(offender.gloss ? { gloss: offender.gloss } : {}),
          explanation: "You hedged this; the draft states it as fact.",
          label: `Keep ${quote(offender.entry.modal)}`,
          fix: replaceSpan(sentence, anchor, rewrite.replacement, rewrite.highlight),
        });
      } else unsafe = true;
    } else unsafe = true;
  }

  return finalize(sentence, candidates, unsafe);
}

function firstNegation(clause: Clause) {
  for (let i = 0; i < clause.tokens.length; i++) {
    const match = matchNegation(clause.tokens, i);
    if (match) return match;
  }
  return null;
}

/** Replace a stand-in pronoun with the name, else prefix the clause. */
function nameFix(sentence: string, clause: Clause, name: string): SpanFix | null {
  const pronoun = clause.tokens.find((t) => PRONOUNS.has(t.fold));
  if (pronoun) return replaceSpan(sentence, [pronoun.start, pronoun.end], name, name);
  const first = clause.tokens[0];
  if (!first) return null;
  return replaceSpan(sentence, [first.start, first.end], `${name} ${first.raw}`, name);
}

/** Dedupe by (type, span), order by severity then position, cap, assign ids. */
function finalize(sentence: string, candidates: Candidate[], unsafe: boolean): CheckResult {
  const seen = new Set<string>();
  const unique = candidates
    .sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.fix.draftSpan[0] - b.fix.draftSpan[0])
    .filter((c) => {
      const key = `${c.type}:${c.fix.draftSpan[0]}:${c.fix.draftSpan[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const counts = new Map<GuardIssueType, number>();
  const issues: GuardIssue[] = [];
  for (const candidate of unique) {
    if (issues.length >= MAX_ISSUES) break;
    const n = (counts.get(candidate.type) ?? 0) + 1;
    counts.set(candidate.type, n);
    const issue = buildIssue(sentence, {
      type: candidate.type, title: candidate.title, said: candidate.said,
      ...(candidate.gloss ? { saidGloss: candidate.gloss } : {}),
      draftSpan: candidate.fix.draftSpan, explanation: candidate.explanation,
      fix: { label: candidate.label, sentence: candidate.fix.sentence, fixedSpan: candidate.fix.fixedSpan },
    }, `${candidate.type}-${n}`);
    if (issue) issues.push(issue); else unsafe = true;
  }
  return { issues: issues.sort((a, b) => a.draftSpan[0] - b.draftSpan[0]), unsafe };
}
