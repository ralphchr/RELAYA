import { describe, expect, it } from "vitest";
import { alignClause, buildIssue, hedgeRewrite, negationRewrite, replaceSpan, verbRun } from "./fixes.js";
import { scanTranscript } from "./rules.js";
import { splitClauses } from "./text.js";

const clause = (text: string) => splitClauses(text)[0];

describe("guard/fixes replaceSpan", () => {
  it("swaps the anchor and points fixedSpan at the highlight", () => {
    const draft = "It's safer to present on Monday.";
    const fix = replaceSpan(draft, [0, 10], "It might be safer", "might be safer");
    expect(draft.slice(...fix.draftSpan)).toBe("It's safer");
    expect(fix.sentence).toBe("It might be safer to present on Monday.");
    expect(fix.sentence.slice(...fix.fixedSpan)).toBe("might be safer");
  });

  it("falls back to the whole replacement when the highlight is absent", () => {
    const fix = replaceSpan("abc def", [0, 3], "xyz", "nope");
    expect(fix.sentence.slice(...fix.fixedSpan)).toBe("xyz");
  });

  it.each([
    ["The report is finished.", "The report is", "The report is not", "is not"],
    ["We have 1,000 users.", "1,000", "1,500", "1,500"],
  ] as const)("keeps both spans non-empty for %s", (draft, anchorText, replacement, highlight) => {
    const start = draft.indexOf(anchorText);
    const fix = replaceSpan(draft, [start, start + anchorText.length], replacement, highlight);
    expect(fix.draftSpan[1]).toBeGreaterThan(fix.draftSpan[0]);
    expect(fix.fixedSpan[1]).toBeGreaterThan(fix.fixedSpan[0]);
    expect(fix.sentence.slice(...fix.fixedSpan)).toBe(highlight);
  });
});

describe("guard/fixes verbRun", () => {
  it.each([
    ["It's safer to present on Monday", "It's safer"],
    ["The report is finished", "The report is finished"],
    ["I am ready for the demo", "I am ready"],
    ["We will ship Monday", "We will"],
    ["we haven't tested refunds end to end yet", "we haven't"],
    ["Ralph joined the call", "Ralph joined"],
  ] as const)("anchors %s to %s", (text, expected) => {
    const target = clause(text);
    const anchor = target ? verbRun(target) : null;
    expect(anchor && text.slice(anchor[0], anchor[1])).toBe(expected);
  });

  it("can stop at the auxiliary instead of extending past a copula", () => {
    const target = clause("The report is finished");
    const anchor = target ? verbRun(target, false) : null;
    expect(anchor && "The report is finished".slice(anchor[0], anchor[1])).toBe("The report is");
  });

  it("returns null for a clause with no tokens", () => {
    expect(verbRun({ text: "", start: 0, end: 0, tokens: [] })).toBeNull();
  });
});

describe("guard/fixes rewrites", () => {
  it.each([
    ["It's safer", "might", "It might be safer", "might be safer"],
    ["The report is finished", "might", "The report might be finished", "might be finished"],
    ["we have shipped", "probably", "we probably have shipped", "probably have shipped"],
    ["We will ship", "might", "We might ship", "might ship"],
    ["It's ready", "seems to", "It seems to be ready", "seems to be ready"],
  ] as const)("hedges %s with %s", (anchor, modal, replacement, highlight) => {
    expect(hedgeRewrite(anchor, modal)).toEqual({ replacement, highlight });
  });

  it.each([
    ["The report is finished", "The report is not finished", "is not finished"],
    ["I am ready", "I am not ready", "am not ready"],
    ["It's safer", "It isn't safer", "isn't safer"],
    ["We will ship", "We will not ship", "will not ship"],
    ["Ralph can QA", "Ralph cannot QA", "cannot QA"],
    ["we have tested", "we have not tested", "have not tested"],
  ] as const)("negates %s", (anchor, replacement, highlight) => {
    expect(negationRewrite(anchor)).toEqual({ replacement, highlight });
  });

  it.each(["Ralph joined", "the stock low", ""] as const)("returns null when there is no auxiliary to work with: %j", (anchor) => {
    expect(hedgeRewrite(anchor, "might")).toBeNull();
    expect(negationRewrite(anchor)).toBeNull();
  });
});

describe("guard/fixes alignClause", () => {
  const draft = "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.";
  const transcript = "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.";
  const scan = scanTranscript(transcript, ["Ralph"]);
  const draftClauses = splitClauses(draft);

  it("picks the draft clause sharing a borrowed word", () => {
    const target = scan.clauses.find((c) => c.text.includes("refund"));
    expect(alignClause(draftClauses, target ?? null, 1, scan)?.text).toContain("tested refunds");
  });

  it("picks the draft clause sharing a name", () => {
    const target = scan.clauses.find((c) => c.text.includes("Ralph"));
    expect(alignClause(draftClauses, target ?? null, 3, scan)?.text).toContain("Ralph");
  });

  it("falls back to position when nothing overlaps", () => {
    const target = { text: "wala gyud", start: 0, end: 9, tokens: [] };
    expect(alignClause(draftClauses, target, 1, scan)?.text).toBe(draftClauses[1]?.text);
  });

  it("returns the only clause when the draft has one, and null when it has none", () => {
    const single = splitClauses("The report is finished.");
    expect(alignClause(single, null, 5, scan)?.text).toBe("The report is finished");
    expect(alignClause([], null, 0, scan)).toBeNull();
  });
});

describe("guard/fixes buildIssue", () => {
  const draft = "The report is finished.";
  const valid = {
    type: "negation" as const, title: "Negation dropped", said: "hindi",
    draftSpan: [0, 13] as [number, number], explanation: "The draft turns what you said into a yes.",
    fix: { label: "Keep “not”", sentence: "The report is not finished.", fixedSpan: [11, 17] as [number, number] },
  };

  it("accepts a well-formed issue and assigns the id", () => {
    expect(buildIssue(draft, valid, "negation-1")?.id).toBe("negation-1");
  });

  it.each([
    ["an empty draft span", { ...valid, draftSpan: [5, 5] as [number, number] }],
    ["a draft span past the end", { ...valid, draftSpan: [0, 999] as [number, number] }],
    ["an empty fixed span", { ...valid, fix: { ...valid.fix, fixedSpan: [3, 3] as [number, number] } }],
    ["a fix identical to the draft", { ...valid, fix: { ...valid.fix, sentence: draft } }],
    ["an unknown issue type", { ...valid, type: "vibes" as never }],
    ["an empty said", { ...valid, said: "" }],
  ] as const)("rejects %s", (_label, candidate) => {
    expect(buildIssue(draft, candidate, "negation-1")).toBeNull();
  });
});
