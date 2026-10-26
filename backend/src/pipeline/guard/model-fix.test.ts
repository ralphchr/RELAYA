import { describe, expect, it } from "vitest";
import { evaluateGuard } from "./index.js";

const NO_FACTS = { numbers: [], dates: [], names: [], negations: [], hedges: [], commitments: [] };
const guard = (transcript: string, sentence: string, hedgedSentence: string, names: string[] = []) =>
  evaluateGuard({ transcript, sentence, hedgedSentence, names, facts: NO_FACTS, confidence: 0.9, unresolvedTerms: [] });

describe("Context Guard with the model's hedged sentence (concept note, Table 1)", () => {
  it("flags the confident draft and offers the model's hedged wording as the fix", () => {
    const result = guard("Siguro ma-finish nato next week.", "We will finish next week.", "We'll probably finish next week.");
    expect(result.status).toBe("flagged");
    const issue = result.issues[0]!;
    expect(issue).toMatchObject({ type: "certainty", title: "Certainty changed", said: "Siguro", saidGloss: "maybe" });
    expect(issue.fix.label).toBe("Keep “probably”");
    expect(issue.fix.sentence).toBe("We'll probably finish next week.");
    expect(issue.fix.sentence.slice(...issue.fix.fixedSpan)).toBe("probably");
    expect("We will finish next week.".slice(...issue.draftSpan)).toBe("We will");
  });

  it("stays clear when there was nothing hedged", () => {
    const result = guard("Pwede ba nating i-move ang deadline kasi hindi pa tapos ang backend?", "Can we move the deadline? The backend isn't finished yet.", "Can we move the deadline? The backend isn't finished yet.");
    expect(result.status).toBe("clear");
  });

  it("does not let an \"about\" from mga stand in for a dropped siguro", () => {
    const result = guard("Siguro mga three days pa bago ma-deliver.", "It will take about three more days to deliver.", "It will probably take about three more days to deliver.");
    expect(result.status).toBe("flagged");
    expect(result.issues[0]?.fix.sentence).toBe("It will probably take about three more days to deliver.");
  });

  it("keeps the I capitalized in the label", () => {
    const result = guard("Parang kailangan natin ng five thousand pesos.", "We need five thousand pesos.", "I think we need five thousand pesos.");
    expect(result.issues[0]?.fix.label).toBe("Keep “I think”");
  });

  it("falls back to the rule-based fix when the hedged version also drops a negation", () => {
    const result = guard("Baka hindi pa ready yung report bukas.", "The report won't be ready tomorrow.", "The report might be ready tomorrow.");
    const fix = result.issues.find((i) => i.type === "certainty")?.fix;
    expect(fix?.sentence ?? "").not.toBe("The report might be ready tomorrow.");
  });
});
