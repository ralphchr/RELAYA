import { GuardResultSchema } from "@relaya/contracts";
import { describe, expect, it } from "vitest";
import { evaluateGuard, type GuardInput } from "./index.js";

const NO_FACTS = { numbers: [], dates: [], names: [], negations: [], hedges: [], commitments: [] };

/** The canonical scripted utterance: a hedge the draft dropped. */
const FLAGGED = {
  transcript: "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.",
  sentence: "The main payments flow is ready, but we haven't tested refunds end to end yet. It's safer to present on Monday so Ralph can still QA it.",
  names: ["Ralph"],
};

const guard = (overrides: Partial<GuardInput> = {}) => evaluateGuard({
  transcript: "Okay na ang build, tapos na ang QA.",
  sentence: "The build is ready and QA is done.",
  names: [], facts: NO_FACTS, confidence: 0.9, unresolvedTerms: [],
  ...overrides,
});

describe("guard/index status (§7.1 step 7)", () => {
  it("doesn't treat \"or not\" as a negation the English must keep", () => {
    const result = guard({
      transcript: "Magandang gabi po. Ito po ang unang testing namin ng RELAYA. We want to know if this works or not.",
      sentence: "Good evening. This is our first test of Relaya, and we want to know if it works.",
      facts: { ...NO_FACTS, names: ["Relaya"] },
    });
    expect(result.status).toBe("clear");
    expect(guard({ transcript: "Tingnan natin kung gagana o hindi.", sentence: "Let's see if it works." }).status).toBe("clear");
  });

  it("a greeting like \"Kumusta kayo?\" isn't a question the English must keep", () => {
    expect(guard({ transcript: "Kumusta kayo? Let's start the meeting na, may hinahabol pa kasi ako.", sentence: "Hello everyone, let's start the meeting; I have another commitment after this." }).status).toBe("clear");
  });

  it("offers \"Let's not\", never \"Let isn't\"", () => {
    const result = guard({ transcript: "Huwag muna natin i-launch.", sentence: "Let's launch it now." });
    expect(result.issues[0]?.fix.sentence ?? "").not.toMatch(/let isn't/i);
  });

  it("still catches a real negation next to \"or not\"", () => {
    expect(guard({ transcript: "Hindi pa namin alam kung gagana o hindi.", sentence: "We know whether it works." }).status).not.toBe("clear");
  });

  it("flags when an issue was found", () => {
    const result = guard({ ...FLAGGED, facts: { ...NO_FACTS, hedges: ["basin"], names: ["Ralph"] } });
    expect(result.status).toBe("flagged");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe("certainty");
  });

  it("keeps flagged ahead of unsure, so the panel still shows the change", () => {
    const result = guard({ ...FLAGGED, confidence: 0.2, unresolvedTerms: ["kanang"] });
    expect(result.status).toBe("flagged");
  });

  it.each<[string, Partial<GuardInput>]>([
    ["low confidence", { confidence: 0.55 }],
    ["an unresolved term", { unresolvedTerms: ["kanang"] }],
    ["no safe fix available", { transcript: "Lima na lang ang stock.", sentence: "The stock is low." }],
  ])("is unsure on %s", (_label, overrides) => {
    const result = guard(overrides);
    expect(result.status).toBe("unsure");
    expect(result.issues).toEqual([]);
  });

  it("is clear on a faithful reconstruction at good confidence", () => {
    const result = guard();
    expect(result.status).toBe("clear");
    expect(result.issues).toEqual([]);
  });

  it("treats the confidence boundary as inclusive of 0.6", () => {
    expect(guard({ confidence: 0.6 }).status).toBe("clear");
    expect(guard({ confidence: 0.599 }).status).toBe("unsure");
  });
});

describe("guard/index risk and needsVerify", () => {
  it("ties needsVerify to high risk", () => {
    for (const overrides of [{}, FLAGGED, { confidence: 0.1 }]) {
      const result = guard(overrides);
      expect(result.needsVerify).toBe(result.risk === "high");
    }
  });

  it("is high risk whenever the transcript holds something critical", () => {
    expect(guard({ transcript: "Hindi pa tapos.", sentence: "It is not done." }).risk).toBe("high");
    expect(guard({ transcript: "Tapos na ang build.", sentence: "The build is ready." }).risk).toBe("low");
  });

  it("assumes the worst when the scan throws", () => {
    const result = evaluateGuard({
      transcript: "Hindi pa tapos.", sentence: "It is done.", names: [],
      facts: { ...NO_FACTS, get names(): string[] { throw new Error("boom"); } },
      confidence: 0.9, unresolvedTerms: [],
    });
    expect(result).toEqual({ status: "unsure", risk: "high", needsVerify: true, issues: [], kept: [] });
  });
});

describe("guard/index kept", () => {
  it("trims, drops blanks and dedupes", () => {
    const result = guard({ facts: { ...NO_FACTS, numbers: [" 5 ", "5"], dates: ["Monday", "  "], names: ["Ralph"] } });
    expect(result.kept).toEqual(["5", "Monday", "Ralph"]);
  });

  it("counts a name found only by the model as expected too", () => {
    const result = guard({
      transcript: "Para ma-QA pa ni Ralph.", sentence: "She will QA it.",
      names: [], facts: { ...NO_FACTS, names: ["Ralph"] },
    });
    expect(result.status).toBe("flagged");
    expect(result.issues[0]?.type).toBe("name");
  });
});

describe("guard/index contract", () => {
  it.each([
    ["clear", {}],
    ["flagged", FLAGGED],
    ["unsure", { confidence: 0.1 }],
  ] as const)("returns a valid GuardResult when %s", (_label, overrides) => {
    expect(GuardResultSchema.safeParse(guard(overrides)).success).toBe(true);
  });
});
