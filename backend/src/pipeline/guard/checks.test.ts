import { GuardIssueSchema, type GuardIssue } from "@relaya/contracts";
import { describe, expect, it } from "vitest";
import { checkSentence } from "./checks.js";
import { scanTranscript } from "./rules.js";
import { wordCount } from "./text.js";

const NO_FACTS = { numbers: [], dates: [], names: [], negations: [], hedges: [], commitments: [] };

const run = (transcript: string, sentence: string, names: string[] = []) =>
  checkSentence({ transcript, sentence, names, facts: NO_FACTS, scan: scanTranscript(transcript, names) });

/** Every issue the guard emits must be renderable and applicable by the panel. */
function expectWellFormed(issue: GuardIssue, draft: string) {
  expect(GuardIssueSchema.safeParse(issue).success).toBe(true);
  const [a, b] = issue.draftSpan;
  expect(b).toBeGreaterThan(a);
  expect(b).toBeLessThanOrEqual(draft.length);
  expect(draft.slice(a, b).trim()).not.toBe("");
  const [c, d] = issue.fix.fixedSpan;
  expect(d).toBeGreaterThan(c);
  expect(issue.fix.sentence.slice(c, d).trim()).not.toBe("");
  expect(issue.fix.sentence).not.toBe(draft);
  expect(wordCount(issue.explanation)).toBeLessThanOrEqual(15);
}

describe("guard/checks hedges", () => {
  const transcript = "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.";
  const draft = "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.";
  const fixed = "The main payments flow is ready, but we haven't tested refunds end to end yet. It might be safer to present on Monday so Ralph can still QA it.";

  it("reproduces the canonical scripted issue", () => {
    const { issues, unsafe } = run(transcript, draft, ["Ralph"]);
    expect(unsafe).toBe(false);
    expect(issues).toHaveLength(1);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft);
    expect(issue.id).toBe("certainty-1");
    expect(issue.type).toBe("certainty");
    expect(issue.title).toBe("Certainty changed");
    expect(issue.said).toBe("Basin");
    expect(issue.saidGloss).toBe("maybe");
    expect(draft.slice(...issue.draftSpan)).toBe("It's safer");
    expect(issue.fix.sentence).toBe(fixed);
    expect(issue.fix.sentence.slice(...issue.fix.fixedSpan)).toBe("might be safer");
    expect(issue.fix.label).toBe("Keep “might”");
  });

  it("stays clear when the draft already hedges", () => {
    expect(run(transcript, fixed, ["Ralph"])).toEqual({ issues: [], unsafe: false });
  });

  it.each([
    ["Siguro Monday na lang ang demo.", "The demo is on Monday.", "Siguro"],
    ["Tingali dili pa ready ang build.", "The build is not ready.", "Tingali"],
    ["Mukhang delayed ang launch.", "The launch is delayed.", "Mukhang"],
    ["Tapos na yata ang QA.", "QA is done.", "yata"],
  ] as const)("flags a dropped hedge in %s", (transcript_, draft_, said) => {
    const { issues } = run(transcript_, draft_);
    const certainty = issues.find((i) => i.type === "certainty");
    expect(certainty?.said).toBe(said);
    if (certainty) expectWellFormed(certainty, draft_);
  });

  it("flags an approximate number the draft made exact", () => {
    const draft_ = "We have 500 users now.";
    const { issues } = run("Mga 500 users na.", draft_);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft_);
    expect(issue.type).toBe("certainty");
    expect(issue.title).toBe("Approximate number made exact");
    expect(issue.said).toBe("Mga 500");
    expect(issue.saidGloss).toBe("about 500");
    expect(issue.fix.sentence).toBe("We have about 500 users now.");
    expect(issue.fix.sentence.slice(...issue.fix.fixedSpan)).toBe("about 500");
  });

  it("stays clear when the draft kept the approximation", () => {
    expect(run("Mga 500 users na.", "We have about 500 users now.").issues).toEqual([]);
  });

  it("does not treat the plural marker as a hedge", () => {
    expect(run("Mga tao na-late sa meeting.", "People were late to the meeting.")).toEqual({ issues: [], unsafe: false });
  });
});

describe("guard/checks negation", () => {
  it.each([
    ["Hindi pa natapos ang report.", "The report is finished.", "Hindi pa", "not yet", "The report is not finished."],
    ["Dili pa ko ready sa demo.", "I am ready for the demo.", "Dili pa", "not yet", "I am not ready for the demo."],
    ["Wala pa ang approval.", "The approval is in.", "Wala pa", "not yet", "The approval is not in."],
    ["Hindi pa natin na-test ang refund.", "We have tested the refund.", "Hindi pa", "not yet", "We have not tested the refund."],
  ] as const)("flags a dropped negation in %s", (transcript, draft, said, gloss, sentence) => {
    const { issues } = run(transcript, draft);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft);
    expect(issue.type).toBe("negation");
    expect(issue.title).toBe("Negation dropped");
    expect(issue.said).toBe(said);
    expect(issue.saidGloss).toBe(gloss);
    expect(issue.fix.sentence).toBe(sentence);
  });

  it.each([
    ["Ang refund wala pa nato na-test.", "We haven't tested refunds yet."],
    ["Hindi pa natapos ang report.", "The report is not finished."],
    ["Dili pa ready ang build.", "The build is still pending."],
    ["Wala tayong QA.", "We have no QA."],
    ["Di ba Monday ang demo?", "The demo is on Monday."],
  ] as const)("accepts an equivalent negation: %s", (transcript, draft) => {
    expect(run(transcript, draft).issues.filter((issue) => issue.type === "negation")).toEqual([]);
  });
});

describe("guard/checks names", () => {
  it("restores a name the draft replaced with a pronoun", () => {
    const draft = "The flow is ready so he can QA it.";
    const { issues } = run("Okay na ang flow, para ma-QA pa ni Ralph.", draft, ["Ralph"]);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft);
    expect(issue.type).toBe("name");
    expect(issue.title).toBe("Name missing");
    expect(issue.said).toBe("Ralph");
    expect(draft.slice(...issue.draftSpan)).toBe("he");
    expect(issue.fix.sentence).toBe("The flow is ready so Ralph can QA it.");
    expect(issue.fix.label).toBe("Put “Ralph” back");
  });

  it("prefixes the clause when there is no pronoun to replace", () => {
    const draft = "The payments flow is ready.";
    const { issues } = run("Si Ralph, okay na ang payments flow.", draft, ["Ralph"]);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft);
    expect(issue.fix.sentence).toBe("Ralph The payments flow is ready.");
  });

  it.each([
    ["Para ma-QA pa ni Ralph.", "Ralph will QA it.", "Ralph"],
    ["Para ma-QA pa ni Ralph.", "ralph will QA it.", "Ralph"],
    ["Para ma-QA pa ni Ralph.", "It is Ralph's turn to QA.", "Ralph"],
    ["Si Niño ang mag-present.", "Nino will present.", "Niño"],
  ] as const)("stays clear when the name is present: %s", (transcript, draft, name) => {
    expect(run(transcript, draft, [name]).issues).toEqual([]);
  });

  it("ignores names that were never spoken", () => {
    expect(run("Okay na ang flow.", "The flow is ready.", ["Ralph", "Nino"]).issues).toEqual([]);
  });
});

describe("guard/checks numbers", () => {
  it("flags a changed number and corrects it in place", () => {
    const draft = "We have 1,000 users now.";
    const { issues } = run("Mga 1,500 users na.", draft);
    const issue = issues[0] as GuardIssue;
    expectWellFormed(issue, draft);
    expect(issue.type).toBe("number");
    expect(issue.title).toBe("Number changed");
    expect(issue.said).toBe("1,500");
    expect(draft.slice(...issue.draftSpan)).toBe("1,000");
    expect(issue.fix.sentence).toBe("We have 1,500 users now.");
  });

  it.each([
    ["Lima na lang ang stock.", "Only 5 are left in stock."],
    ["Mga 3k users na.", "We have about 3,000 users."],
    ["Singkwenta porsyento na ang churn.", "Churn is 50% now."],
    ["Meeting at alas-dos.", "The meeting is at 2:00."],
    ["We have 1,500 users.", "We have 1,500 users."],
  ] as const)("accepts an equivalent number: %s", (transcript, draft) => {
    expect(run(transcript, draft).issues).toEqual([]);
  });

  it("degrades to unsafe when a dropped number has no place to go", () => {
    const { issues, unsafe } = run("Lima na lang ang stock.", "The stock is low.");
    expect(issues).toEqual([]);
    expect(unsafe).toBe(true);
  });
});

describe("guard/checks safety valve", () => {
  it.each([
    ["a dropped number with no counterpart", "Lima na lang ang stock.", "The stock is low."],
    ["a negation needing do-support", "Wala tayong budget para diyan.", "We have budget for that."],
    ["a clause with no auxiliary to hedge", "Basin Monday ang demo.", "Ralph demoed Monday."],
  ] as const)("declines to guess a fix for %s", (_label, transcript, draft) => {
    const { issues, unsafe } = run(transcript, draft, ["Ralph"]);
    expect(issues).toEqual([]);
    expect(unsafe).toBe(true);
  });
});

describe("guard/checks ordering and limits", () => {
  it("orders by position, ids per type, and caps at two issues", () => {
    const transcript = "Hindi pa tapos, wala pa ang 1,500 users, basin bukas na lang, si Ralph wala.";
    const draft = "The work is done and we have 1,000 users so it is ready tomorrow.";
    const { issues } = run(transcript, draft, ["Ralph"]);
    expect(issues.length).toBeLessThanOrEqual(2);
    for (const issue of issues) expectWellFormed(issue, draft);
    expect(issues.map((i) => i.draftSpan[0])).toEqual([...issues.map((i) => i.draftSpan[0])].sort((a, b) => a - b));
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
    expect(issues.every((i) => /^(?:negation|number|name|certainty)-\d+$/.test(i.id))).toBe(true);
  });

  it("prefers a negation over a hedge when both are dropped", () => {
    const { issues } = run("Hindi pa tapos, basin bukas.", "The work is done tomorrow.");
    expect(issues[0]?.type).toBe("negation");
  });

  it("stays clear on a faithful reconstruction", () => {
    expect(run("Okay na ang build, tapos na ang QA.", "The build is ready and QA is done.")).toEqual({ issues: [], unsafe: false });
  });

  it.each(["", "   ", "???"] as const)("does not throw on transcript %j", (transcript) => {
    expect(() => run(transcript, "The build is ready.")).not.toThrow();
  });
});
