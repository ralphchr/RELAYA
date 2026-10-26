import { describe, expect, it } from "vitest";
import { evaluateGuard } from "./index.js";
import { questionFix, spokenQuestion } from "./question.js";

const NO_FACTS = { numbers: [], dates: [], names: [], negations: [], hedges: [], commitments: [] };
const guard = (transcript: string, sentence: string) =>
  evaluateGuard({ transcript, sentence, names: [], facts: NO_FACTS, confidence: 0.9, unresolvedTerms: [] });

describe("Context Guard: questions stay questions", () => {
  it("flags a question that came back as a statement and offers the question", () => {
    const result = guard("Ito ba? Kakayanin ba natin ito?", "We can handle this.");
    expect(result.status).toBe("flagged");
    expect(result.issues[0]).toMatchObject({ type: "question", title: "Question turned into a statement", said: "Kakayanin ba natin ito?" });
    expect(result.issues[0]?.fix).toMatchObject({ label: "Keep it a question", sentence: "Can we handle this?" });
  });

  it("is clear when the question was kept, and says so", () => {
    const result = guard("Ito ba? Kakayanin ba natin ito?", "Can we handle this?");
    expect(result.status).toBe("clear");
    expect(result.kept).toContain("Question kept");
  });

  it("does not flag statements", () => {
    expect(guard("Okay na yung design.", "The design is ready.").status).toBe("clear");
  });

  it("detects the ba particle even without a question mark", () => {
    expect(spokenQuestion("Okay na ba yung design")).toBe("Okay na ba yung design");
  });

  it("inverts subject and auxiliary when it can, otherwise makes the last sentence a question", () => {
    expect(questionFix("We can handle this.")?.sentence).toBe("Can we handle this?");
    expect(questionFix("The design is ready.")?.sentence).toBe("Is the design ready?");
    expect(questionFix("I should join the call.")?.sentence).toBe("Should I join the call?");
    expect(questionFix("The refunds are tested. We can ship it.")?.sentence).toBe("The refunds are tested. Can we ship it?");
    expect(questionFix("You finished the report.")?.sentence).toBe("You finished the report?");
  });

  it("turns a di ba confirmation into a tag question, not a rewrite", () => {
    const result = guard("Di ba Monday ang demo?", "The demo is on Monday.");
    expect(result.issues[0]?.fix.sentence).toBe("The demo is on Monday, right?");
  });
});
