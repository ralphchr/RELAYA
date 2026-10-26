import { describe, expect, it } from "vitest";
import { formatDuration } from "./SessionsPages.js";

describe("session length", () => {
  const start = "2026-10-18T01:00:00Z";
  it("reads minutes for ended sessions", () => {
    expect(formatDuration({ startedAt: start, endedAt: "2026-10-18T01:12:00Z" })).toBe("12 minutes");
    expect(formatDuration({ startedAt: start, endedAt: "2026-10-18T01:00:20Z" })).toBe("Under a minute");
  });
  it("says in progress for a live session, and not recorded once it's clearly stale", () => {
    expect(formatDuration({ startedAt: start, endedAt: null }, Date.parse("2026-10-18T01:30:00Z"))).toBe("In progress");
    expect(formatDuration({ startedAt: start, endedAt: null }, Date.parse("2026-10-18T09:00:00Z"))).toBe("Length not recorded");
  });
});
