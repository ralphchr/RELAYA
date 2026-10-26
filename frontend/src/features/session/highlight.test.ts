import { describe, expect, it } from "vitest";
import { scriptedReconstruction } from "../../services/mock/scenario.js";
import { initialPanelState, panelReducer, type PanelState } from "./machine.js";
import { sentenceSegments } from "./highlight.js";

const base = (): PanelState => {
  const s = initialPanelState({ mode: "say", firstName: "Dana", agentName: "Dana's Relaya (AI)" }, 0);
  return [{ type: "PTT_DOWN", at: 0 } as const, { type: "PTT_UP" } as const, { type: "RESULT", result: scriptedReconstruction("s1") } as const].reduce(panelReducer, s);
};

describe("sentenceSegments", () => {
  it("marks the changed phrase in amber while the issue is open", () => {
    const marked = sentenceSegments(base()).filter((seg) => seg.mark);
    expect(marked).toEqual([{ text: "It's safer", mark: "warn" }]);
  });

  it("marks the kept fix in green and rebuilds the full sentence", () => {
    const fixed = panelReducer(base(), { type: "APPLY_FIX", issueId: "certainty-1" });
    const segments = sentenceSegments(fixed);
    expect(segments.filter((seg) => seg.mark)).toEqual([{ text: "might be safer", mark: "ok" }]);
    expect(segments.map((seg) => seg.text).join("")).toBe(fixed.text);
  });
});
