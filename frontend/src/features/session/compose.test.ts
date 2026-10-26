import { describe, expect, it } from "vitest";
import type { GuardIssue, ReconstructResponse } from "@relaya/contracts";
import { scriptedReconstruction } from "../../services/mock/scenario.js";
import { composeSentence } from "./compose.js";

const draft = "It will take three more days before delivery.";
const issue = (id: string, from: string, to: string, highlight: string): GuardIssue => {
  const a = draft.indexOf(from);
  const sentence = draft.slice(0, a) + to + draft.slice(a + from.length);
  const c = a + to.indexOf(highlight);
  return {
    id, type: "certainty", title: "Certainty changed", said: "siguro", draftSpan: [a, a + from.length],
    explanation: "You hedged this; the draft states it as fact.",
    fix: { label: "Keep", sentence, fixedSpan: [c, c + highlight.length] },
  };
};

// Same two issues the backend guard returns for "Siguro mga three days pa bago ma-deliver."
const twoIssues = (): ReconstructResponse => {
  const base = scriptedReconstruction("r1");
  return {
    ...base,
    sentence: { ...base.sentence, text: draft },
    guard: { ...base.guard, issues: [issue("certainty-1", "It will", "It might", "might"), issue("certainty-2", "three", "about three", "about three")] },
  };
};

describe("composeSentence", () => {
  it("applies both fixes in either order", () => {
    const result = twoIssues();
    const both = { "certainty-1": "fixed", "certainty-2": "fixed" } as const;
    const expected = "It might take about three more days before delivery.";
    expect(composeSentence(result, both).text).toBe(expected);
    expect(composeSentence(result, { "certainty-2": "fixed", "certainty-1": "fixed" }).text).toBe(expected);
    expect(composeSentence(result, both).marks.map((m) => expected.slice(m.start, m.end))).toEqual(["might", "about three"]);
  });

  it("keeps one fix and leaves the other open in amber", () => {
    const { text, marks } = composeSentence(twoIssues(), { "certainty-2": "fixed" });
    expect(text).toBe("It will take about three more days before delivery.");
    expect(marks.map((m) => [text.slice(m.start, m.end), m.mark])).toEqual([["It will", "warn"], ["about three", "ok"]]);
  });

  it("Use as is keeps the draft wording without a mark", () => {
    const { text, marks } = composeSentence(twoIssues(), { "certainty-1": "as_is", "certainty-2": "fixed" });
    expect(text).toBe("It will take about three more days before delivery.");
    expect(marks).toHaveLength(1);
  });

  it("matches the single-fix demo sentence exactly", () => {
    const result = scriptedReconstruction("r1");
    expect(composeSentence(result, { "certainty-1": "fixed" }).text).toBe(result.guard.issues[0]!.fix.sentence);
  });
});
