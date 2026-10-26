import { describe, expect, it } from "vitest";
import { countDraftHedges, countDraftNegations, HEDGES, LEXICON_VERSION, matchHedge, matchNegation } from "./lexicon.js";
import { tokenize } from "./text.js";

/** First negation/hedge anywhere in `text`, the way the scan walks tokens. */
function firstNegation(text: string) {
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const match = matchNegation(tokens, i);
    if (match) return match;
  }
  return null;
}

function firstHedge(text: string) {
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const match = matchHedge(tokens, i);
    if (match) return match;
  }
  return null;
}

describe("guard/lexicon negation", () => {
  it.each([
    ["Hindi pa natapos ang report.", "Hindi pa", "not yet"],
    ["Ang refund wala pa nato na-test.", "wala pa", "not yet"],
    ["Dili pa ko ready.", "Dili pa", "not yet"],
    ["Dili ko ready.", "Dili", "not"],
    ["Walay budget para niana.", "Walay", "none"],
    ["Huwag muna natin i-ship.", "Huwag", "don't"],
    ["Ayaw niya ng demo.", "Ayaw", "doesn't want to"],
    ["Di ko kaya yan.", "Di", "not"],
    ["Wala tayong QA.", "Wala", "none"],
  ] as const)("matches %s", (text, raw, gloss) => {
    const match = firstNegation(text);
    expect(match?.raw).toBe(raw);
    expect(match?.gloss).toBe(gloss);
  });

  it.each([
    "Dili lang na importante.",
    "Dito na lang tayo.",
    "Masaya din ako.",
    "Diri ta mag-meeting.",
  ] as const)("does not fire inside a longer word: %s", (text) => {
    const match = firstNegation(text);
    expect(match?.raw.toLowerCase()).not.toBe("di");
  });

  it.each([
    "Di ba Monday ang demo?",
    "No problem sa akin.",
  ] as const)("skips the known exception: %s", (text) => {
    expect(firstNegation(text)).toBeNull();
  });

  it("treats a bare leading no as a discourse response", () => {
    expect(firstNegation("No, hindi pa natapos.")?.raw).toBe("hindi pa");
    expect(firstNegation("No budget for that.")?.raw).toBe("No");
  });

  it.each([
    ["we haven't tested refunds", 1],
    ["The report is not finished", 1],
    ["It is finished", 0],
    ["No one tested it and nothing is ready", 2],
    ["The feature is still pending", 1],
  ] as const)("counts draft negations in %s", (draft, expected) => {
    expect(countDraftNegations(draft)).toBe(expected);
  });
});

describe("guard/lexicon hedges", () => {
  it.each([
    ["Siguro Monday na lang.", "Siguro", "maybe", "might"],
    ["Basin mas safe if Monday.", "Basin", "maybe", "might"],
    ["Tingali dili pa ready.", "Tingali", "maybe", "might"],
    ["Tapos na yata ang QA.", "yata", "I think", "probably"],
    ["Parang may bug pa.", "Parang", "it seems", "seems to"],
    ["Mukhang delayed ang launch.", "Mukhang", "it looks like", "looks like"],
    ["Murag okay na.", "Murag", "it seems", "seems to"],
    ["Baka bukas na lang.", "Baka", "might", "might"],
    ["I think it is ready.", "I think", "I think", "probably"],
  ] as const)("matches %s", (text, raw, gloss, modal) => {
    const match = firstHedge(text);
    expect(match?.raw).toBe(raw);
    expect(match?.gloss).toBe(gloss);
    expect(match?.entry.modal).toBe(modal);
  });

  it.each([
    ["Mga 500 users na.", "Mga 500"],
    ["Mga lima na lang.", "Mga lima"],
  ] as const)("treats %s as an approximation hedge", (text, raw) => {
    expect(firstHedge(text)?.raw).toBe(raw);
  });

  it.each([
    "Mga tao na-late sa meeting.",
    "Mga bug pa ang natira.",
  ] as const)("ignores the plural marker in %s", (text) => {
    expect(firstHedge(text)).toBeNull();
  });

  it("ignores baka as a noun", () => {
    expect(firstHedge("Ang baka sa farm.")).toBeNull();
    expect(firstHedge("Baka ma-delay ang demo.")?.raw).toBe("Baka");
  });

  it.each([
    ["It might be safer", 1],
    ["It's safer", 0],
    ["Maybe it seems ready", 2],
    ["We have about 500 users", 1],
  ] as const)("counts draft hedges in %s", (draft, expected) => {
    expect(countDraftHedges(draft)).toBe(expected);
  });

  it("gives every hedge a gloss, modal and draft list", () => {
    expect(Object.keys(HEDGES).length).toBeGreaterThan(8);
    for (const [key, entry] of Object.entries(HEDGES)) {
      expect(entry.gloss.length, key).toBeGreaterThan(0);
      expect(entry.modal.length, key).toBeGreaterThan(0);
      expect(entry.draft.length, key).toBeGreaterThan(0);
    }
  });

  it("is versioned", () => {
    expect(LEXICON_VERSION).toBe("1");
  });
});
