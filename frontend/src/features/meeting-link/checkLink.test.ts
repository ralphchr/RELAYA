import { describe, expect, it } from "vitest";
import { checkMeetingLink } from "./checkLink.js";
import { copy } from "../../copy/en.js";

describe("checkMeetingLink", () => {
  it("accepts a Google Meet link with or without https", () => {
    expect(checkMeetingLink("meet.google.com/kqv-xmtp-ruz")).toEqual({ ok: true, url: "https://meet.google.com/kqv-xmtp-ruz", code: "kqv-xmtp-ruz" });
    expect(checkMeetingLink(" https://meet.google.com/kqv-xmtp-ruz?authuser=0 ").ok).toBe(true);
  });

  it("explains each kind of bad link", () => {
    const e = copy.meetingLink.errors;
    expect(checkMeetingLink("")).toEqual({ ok: false, error: e.empty });
    expect(checkMeetingLink("meet.google.com/abc")).toEqual({ ok: false, error: e.meetIncomplete });
    expect(checkMeetingLink("https://zoom.us/j/12345678901?pwd=x")).toEqual({ ok: false, error: e.comingSoon });
    expect(checkMeetingLink("https://example.com/call")).toEqual({ ok: false, error: e.unsupported });
  });
});
