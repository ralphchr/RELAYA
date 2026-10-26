import { describe, expect, it } from "vitest";
import { LinkParseError, parseMeetingLink } from "./index.js";

describe("parseMeetingLink", () => {
  it.each([
    ["meet.google.com/abc-defg-hij?authuser=0", "google_meet", "abc-defg-hij"],
    ["https://zoom.us/j/123456789?pwd=secret", "zoom", "123456789"],
    ["https://company.zoom.us/my/room", "zoom", "room"],
    ["https://teams.microsoft.com/l/meetup-join/abc/0?context=x", "teams", "abc"],
    ["https://teams.live.com/meet/abc?p=secret", "teams", "abc"],
  ] as const)("parses %s", (input: string, platform: "google_meet" | "zoom" | "teams", meetingCode: string) => {
    expect(parseMeetingLink(input)).toMatchObject({ platform, meetingCode });
  });

  it("strips nonessential Meet query parameters", () => {
    expect(parseMeetingLink("https://meet.google.com/abc-defg-hij?foo=bar").normalizedUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it.each(["", "not a url", "https://meet.google.com/invalid"]) ("rejects malformed input %j", (input: string) => {
    expect(() => parseMeetingLink(input)).toThrowError(LinkParseError);
  });

  it("requires a Zoom passcode on numeric join links", () => {
    expect(() => parseMeetingLink("https://zoom.us/j/123456789")).toThrowError(expect.objectContaining({ code: "MISSING_PASSCODE" }));
  });

  it("rejects an unsupported platform", () => {
    expect(() => parseMeetingLink("https://example.com/meeting")).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_PLATFORM" }));
  });
});
