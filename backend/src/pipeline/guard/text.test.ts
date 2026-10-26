import { describe, expect, it } from "vitest";
import { clauseAt, fold, splitClauses, tokenize } from "./text.js";

describe("guard/text", () => {
  it.each([
    ["Niño", "nino"],
    ["RALPH", "ralph"],
    ["it’s", "it's"],
    ["Mañana", "manana"],
  ] as const)("folds %s to %s", (input, expected) => {
    expect(fold(input)).toBe(expected);
  });

  it.each([
    ["We have 1,500 users.", "1,500"],
    ["Churn is 4.5% monthly.", "4.5%"],
    ["Meeting at alas-dos.", "alas-dos"],
    ["It costs ₱500 total.", "₱500"],
    ["It's safer.", "It's"],
  ] as const)("keeps %s tokenized as one token", (text, expected) => {
    expect(tokenize(text).map((t) => t.raw)).toContain(expected);
  });

  it("strips sentence punctuation without losing offsets", () => {
    const text = "Present on Monday, please.";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.raw)).toEqual(["Present", "on", "Monday", "please"]);
    for (const token of tokens) expect(text.slice(token.start, token.end)).toBe(token.raw);
  });

  it("splits clauses on punctuation and coordinators with exact offsets", () => {
    const draft = "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.";
    const clauses = splitClauses(draft);
    expect(clauses.map((c) => c.text)).toEqual([
      "The main payments flow is ready",
      "we haven't tested refunds end to end yet",
      "It's safer to present on Monday",
      "Ralph can still QA it",
    ]);
    for (const clause of clauses) {
      expect(draft.slice(clause.start, clause.end)).toBe(clause.text);
      for (const token of clause.tokens) expect(draft.slice(token.start, token.end)).toBe(token.raw);
    }
  });

  it("finds the clause containing an offset", () => {
    const text = "Wala pa, basin Monday.";
    const clauses = splitClauses(text);
    expect(clauseAt(clauses, text.indexOf("basin"))?.text).toBe("basin Monday");
    expect(clauseAt(clauses, 999)).toBeNull();
  });

  it.each(["", "   ", "???", "\u{1f600}"] as const)("does not throw on %j", (text) => {
    expect(() => { tokenize(text); splitClauses(text); }).not.toThrow();
  });
});
