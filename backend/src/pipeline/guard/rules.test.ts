import { describe, expect, it } from "vitest";
import { findNames, hasName, scanTranscript } from "./rules.js";
import { tokenize } from "./text.js";

describe("guard/rules risk", () => {
  it.each([
    ["Lima na lang ang stock.", "numbers"],
    ["Hindi pa natapos.", "negation"],
    ["Basin Monday na lang.", "hedge"],
    ["Mga 500 users na.", "approximation"],
  ] as const)("raises risk to high on %s (%s)", (transcript, category) => {
    expect(scanTranscript(transcript, []).risk, category).toBe("high");
  });

  it("raises risk to high when a session name is mentioned", () => {
    expect(scanTranscript("Ralph will handle the QA.", ["Ralph"]).risk).toBe("high");
    expect(scanTranscript("Ralph will handle the QA.", []).risk).toBe("low");
  });

  it("stays low with nothing critical in the transcript", () => {
    expect(scanTranscript("The build is done.", []).risk).toBe("low");
  });

  it("collects every category from the canonical transcript", () => {
    const transcript = "Kanang, sa payments… ang main flow okay na, pero ang refund wala pa nato na-test end-to-end. Basin mas safe if Monday nato i-present, para ma-QA pa ni Ralph.";
    const scan = scanTranscript(transcript, ["Ralph"]);
    expect(scan.negations.map((n) => n.raw)).toContain("wala pa");
    expect(scan.hedges.map((h) => h.raw)).toContain("Basin");
    expect(scan.names.map((n) => n.name)).toEqual(["Ralph"]);
    expect(scan.risk).toBe("high");
    expect(scan.lexiconVersion).toBe("1");
  });

  it("never double-counts overlapping matches", () => {
    const scan = scanTranscript("Ang refund wala pa nato na-test.", []);
    expect(scan.negations).toHaveLength(1);
    expect(scan.negations[0]?.raw).toBe("wala pa");
  });
});

describe("guard/rules names", () => {
  it.each([
    ["Ralph will QA it.", "Ralph", true],
    ["ralph will QA it.", "Ralph", true],
    ["It is Ralph's turn.", "Ralph", true],
    ["Niño joined late.", "Nino", true],
    ["Nino joined late.", "Niño", true],
    ["I ate a banana.", "Ana", false],
    ["She will QA it.", "Ralph", false],
  ] as const)("hasName(%s, %s) is %s", (text, name, expected) => {
    expect(hasName(text, name)).toBe(expected);
  });

  it("matches multi-word names", () => {
    expect(hasName("Maria Clara is presenting.", "Maria Clara")).toBe(true);
    expect(hasName("Maria is presenting.", "Maria Clara")).toBe(false);
  });

  it("keeps offsets on name mentions", () => {
    const text = "Para ma-QA pa ni Ralph.";
    const mention = findNames(tokenize(text), ["Ralph"])[0];
    expect(text.slice(mention?.start ?? 0, mention?.end ?? 0)).toBe("Ralph");
  });
});

describe("guard/rules robustness", () => {
  it.each(["", "   ", "???", "\u{1f600}\u{1f600}", "a".repeat(5000)] as const)("does not throw on %j", (text) => {
    expect(() => scanTranscript(text, ["Ralph"])).not.toThrow();
  });

  it("stays well inside the 10 ms per-call budget (§7.1)", () => {
    const transcript = "Basin mga 1,500 users pa, pero wala pa nato na-test ni Ralph, hindi pa tapos. ".repeat(4);
    const started = performance.now();
    for (let i = 0; i < 200; i++) scanTranscript(transcript, ["Ralph"]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
