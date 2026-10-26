import { describe, expect, it } from "vitest";
import { parseTryJoinArgs } from "./args.js";

describe("try-join arguments", () => {
  it("uses the consistent Meet name even with a legacy --name flag", () => {
    expect(parseTryJoinArgs(["meet.google.com/abc-defg-hij", "--name", "Angel", "--stay", "10"])).toEqual({
      url: "https://meet.google.com/abc-defg-hij", displayName: "RELAYA AI", staySeconds: 10,
    });
  });

  it("defaults to RELAYA AI and a 30 second stay", () => {
    expect(parseTryJoinArgs(["https://meet.google.com/abc-defg-hij"])).toMatchObject({ displayName: "RELAYA AI", staySeconds: 30 });
  });

  it("explains a missing or wrong link", () => {
    expect(() => parseTryJoinArgs([])).toThrow(/Paste your Google Meet link/);
    expect(() => parseTryJoinArgs(["https://zoom.us/j/12345678901?pwd=x"])).toThrow(/Only Google Meet/);
    expect(() => parseTryJoinArgs(["meet.google.com/abc"])).toThrow(/isn't a usable Google Meet link/);
  });
});
