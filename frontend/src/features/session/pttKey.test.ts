import { describe, expect, it } from "vitest";
import { isAllowedPttKey, keyLabel } from "./pttKey.js";

describe("push-to-talk key", () => {
  it("names keys the way people know them", () => {
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("KeyF")).toBe("F");
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("AltRight")).toBe("Right Alt");
    expect(keyLabel("ControlLeft")).toBe("Left Ctrl");
    expect(keyLabel("Backquote")).toBe("`");
    expect(keyLabel("F8")).toBe("F8");
  });

  it("keeps the panel's own keys free", () => {
    expect(isAllowedPttKey("KeyF")).toBe(true);
    expect(isAllowedPttKey("Escape")).toBe(false);
    expect(isAllowedPttKey("Enter")).toBe(false);
    expect(isAllowedPttKey("Tab")).toBe(false);
    expect(isAllowedPttKey("")).toBe(false);
    expect(isAllowedPttKey("x".repeat(21))).toBe(false);
  });
});
