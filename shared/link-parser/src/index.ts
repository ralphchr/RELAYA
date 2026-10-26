export type MeetingPlatform = "google_meet" | "zoom" | "teams";
export type LinkParseErrorCode = "INVALID_INPUT" | "UNSUPPORTED_PLATFORM" | "MISSING_PASSCODE";

export class LinkParseError extends Error {
  constructor(readonly code: LinkParseErrorCode, message: string) {
    super(message);
    this.name = "LinkParseError";
  }
}

export interface ParsedMeetingLink {
  platform: MeetingPlatform;
  normalizedUrl: string;
  meetingCode: string;
}

function parseUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new LinkParseError("INVALID_INPUT", "Meeting link is required.");
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new LinkParseError("INVALID_INPUT", "Meeting link is malformed.");
  }
}

export function parseMeetingLink(input: string): ParsedMeetingLink {
  const url = parseUrl(input);
  const host = url.hostname.toLowerCase();

  if (host === "meet.google.com") {
    const code = url.pathname.split("/").filter(Boolean)[0];
    if (!code || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code)) {
      throw new LinkParseError("INVALID_INPUT", "Google Meet link must contain a meeting code.");
    }
    return { platform: "google_meet", normalizedUrl: `https://meet.google.com/${code}`, meetingCode: code };
  }

  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const meetingIndex = parts.findIndex((part) => part === "j");
    if (meetingIndex >= 0) {
      const code = parts[meetingIndex + 1];
      if (!code || !/^\d{9,11}$/.test(code)) throw new LinkParseError("INVALID_INPUT", "Zoom meeting ID is malformed.");
      const passcode = url.searchParams.get("pwd");
      if (!passcode) throw new LinkParseError("MISSING_PASSCODE", "Zoom meeting link is missing its passcode.");
      return { platform: "zoom", normalizedUrl: `https://${host}/j/${code}?pwd=${encodeURIComponent(passcode)}`, meetingCode: code };
    }
    const vanityIndex = parts.findIndex((part) => part === "my");
    if (vanityIndex >= 0 && parts[vanityIndex + 1]) {
      const code = parts[vanityIndex + 1]!;
      return { platform: "zoom", normalizedUrl: `https://${host}/my/${encodeURIComponent(code)}`, meetingCode: code };
    }
    throw new LinkParseError("INVALID_INPUT", "Zoom link must contain a meeting ID or vanity name.");
  }

  if (host === "teams.microsoft.com" && url.pathname.startsWith("/l/meetup-join/")) {
    const code = url.pathname.slice("/l/meetup-join/".length).split("/")[0];
    if (!code) throw new LinkParseError("INVALID_INPUT", "Teams link must contain a meeting ID.");
    return { platform: "teams", normalizedUrl: `https://${host}${url.pathname}${url.search}`, meetingCode: code };
  }

  if (host === "teams.live.com" && url.pathname.startsWith("/meet/")) {
    const code = url.pathname.slice("/meet/".length).split("/")[0];
    if (!code) throw new LinkParseError("INVALID_INPUT", "Teams link must contain a meeting ID.");
    return { platform: "teams", normalizedUrl: `https://${host}${url.pathname}${url.search}`, meetingCode: code };
  }

  throw new LinkParseError("UNSUPPORTED_PLATFORM", "This meeting platform is not supported.");
}
