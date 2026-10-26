import type { ReconstructResponse } from "@relaya/contracts";

/**
 * The scripted sentence from FINAL RELAYA DEMO.html. The mock pipeline returns
 * it for every recording until POST /api/reconstruct exists.
 */
const transcript = "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.";
const draft = "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.";
const fixed = "The main payments flow is ready, but we haven't tested refunds end to end yet. It might be safer to present on Monday so Ralph can still QA it.";

function span(text: string, part: string): [number, number] {
  const start = text.indexOf(part);
  if (start < 0) throw new Error(`"${part}" is not in the sentence`);
  return [start, start + part.length];
}

export function scriptedReconstruction(sentenceId: string): ReconstructResponse {
  return {
    sentence: { id: sentenceId, text: draft, wordCount: draft.split(/\s+/).length, literal: "Uhm, about payments… the main flow is okay already, but the refund we haven't tested end-to-end. Maybe it's safer if we present on Monday, so Ralph can still QA it." },
    transcript,
    languages: ["ceb", "en"],
    facts: { numbers: [], dates: ["Monday"], names: ["Ralph"], negations: ["wala pa"], hedges: ["basin"], commitments: [] },
    confidence: 0.86,
    unresolvedTerms: [],
    guard: {
      status: "flagged",
      risk: "high",
      needsVerify: false,
      issues: [{
        id: "certainty-1",
        type: "certainty",
        title: "Certainty changed",
        said: "basin",
        saidGloss: "maybe",
        draftSpan: span(draft, "It's safer"),
        explanation: "The draft makes Monday sound certain.",
        fix: { label: "Keep “might”", sentence: fixed, fixedSpan: span(fixed, "might be safer") },
      }],
      kept: ["Payments flow ready", "Refunds not tested yet", "Present on Monday", "Ralph does QA"],
    },
    quota: { reconstructionsLeft: 59, windowLeft: 14 },
    timings: { sttMs: 420, llmMs: 610, rulesMs: 4, totalMs: 1034 },
  };
}
