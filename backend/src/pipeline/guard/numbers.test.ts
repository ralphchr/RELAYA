import { describe, expect, it } from "vitest";
import { canonicalize, countByCanonical, extractNumbers } from "./numbers.js";
import { tokenize } from "./text.js";

const first = (text: string) => extractNumbers(tokenize(text))[0];

describe("guard/numbers", () => {
  it.each([
    ["Lima na lang ang stock.", 5, ""],
    ["Usa ra ka bug.", 1, ""],
    ["Napulo ka tickets.", 10, ""],
    ["Dose na ang signups.", 12, ""],
    ["Beinte users pa.", 20, ""],
    ["Singkwenta porsyento na.", 50, "%"],
    ["Fifteen tickets left.", 15, ""],
    ["Twenty-five signups today.", 25, ""],
    ["Three thousand users na.", 3000, ""],
    ["We have 1,500 users.", 1500, ""],
    ["Mga 3k users na.", 3000, ""],
    ["Around 2M in revenue.", 2_000_000, ""],
    ["Churn is 4.5% monthly.", 4.5, "%"],
    ["It costs 500 pesos.", 500, "php"],
    ["It costs ₱500.", 500, "php"],
    ["Budget is PHP 500.", 500, "php"],
    ["It costs 20 dollars.", 20, "usd"],
    ["Meeting at alas-dos.", 2, "time"],
    ["Meeting at alas dose.", 12, "time"],
    ["Call at 2:30 later.", 2, "time"],
  ] as const)("reads %s as %d%s", (text, value, unit) => {
    const mention = first(text);
    expect(mention?.value).toBe(value);
    expect(mention?.unit).toBe(unit);
    expect(mention?.canonical).toBe(canonicalize(value, unit));
  });

  it.each([
    ["Mga 500 users na.", true],
    ["About 500 users na.", true],
    ["Exactly 500 users na.", false],
    ["We have 500 users.", false],
  ] as const)("marks approximation in %s as %s", (text, approx) => {
    expect(first(text)?.approx).toBe(approx);
  });

  it("canonicalizes word and digit forms to the same key", () => {
    expect(first("Lima na lang.")?.canonical).toBe(first("Only 5 are left.")?.canonical);
    expect(first("Mga 3k users.")?.canonical).toBe(first("We have 3,000 users.")?.canonical);
    expect(first("Meeting at alas-dos.")?.canonical).toBe(first("Meeting at 2:00.")?.canonical);
  });

  it("keeps offsets pointing at the mention", () => {
    const text = "We have 1,500 users.";
    const mention = first(text);
    expect(text.slice(mention?.start ?? 0, mention?.end ?? 0)).toBe("1,500");
  });

  it("counts a multiset of canonical forms", () => {
    const counts = countByCanonical(extractNumbers(tokenize("5 bugs, 5 tickets, and 3 blockers.")));
    expect(counts.get("5")).toBe(2);
    expect(counts.get("3")).toBe(1);
  });

  it("finds every number in a mixed sentence", () => {
    const mentions = extractNumbers(tokenize("Mga 1,500 users, 4.5% churn, alas-dos demo."));
    expect(mentions.map((m) => m.canonical)).toEqual(["1500", "4.5%", "2time"]);
  });

  it.each(["", "???", "alas-", "\u{1f600}"] as const)("does not throw on %j", (text) => {
    expect(() => extractNumbers(tokenize(text))).not.toThrow();
  });
});
