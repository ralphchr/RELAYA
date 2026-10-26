import { describe, expect, it } from "vitest";
import { verifiedChips } from "./kept.js";
import { scanTranscript } from "./rules.js";
import { checkSentence } from "./checks.js";

const NO_FACTS = { numbers: [], dates: [], names: [], negations: [], hedges: [], commitments: [] };

function chips(transcript: string, sentence: string, names: string[] = []) {
  const scan = scanTranscript(transcript, names);
  const { issues } = checkSentence({ transcript, sentence, names, facts: NO_FACTS, scan });
  return verifiedChips(scan, sentence, issues, transcript);
}

describe("guard/kept verified chips", () => {
  it("pairs each kept hedge, negation, number and name with the draft", () => {
    expect(chips(
      "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.",
      "The main payments flow is ready, but refunds aren't tested end to end yet, so it might be safer to present on Monday for Ralph to QA.",
      ["Ralph"],
    )).toEqual(["“Basin” → “might”", "“wala pa” → “aren't”", "Ralph kept"]);
    expect(chips("Siguro mga three days pa bago ma-deliver.", "It might take about three more days before we can deliver."))
      .toEqual(["“Siguro” → “might”", "About three kept"]);
  });

  it("never claims a hedge was kept when the draft dropped it", () => {
    const result = chips(
      "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.",
      "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.",
      ["Ralph"],
    );
    expect(result.some((c) => c.includes("Basin"))).toBe(false);
  });

  it("returns nothing when there was nothing risky to check", () => {
    expect(chips("Okay na yung design.", "The design is ready.")).toEqual([]);
  });
});
