import { LinkParseError, parseMeetingLink } from "@relaya/link-parser";
import { copy } from "../../copy/en.js";

export type LinkCheck = { ok: true; url: string; code: string } | { ok: false; error: string };

/**
 * MVP accepts Google Meet only (current scope). Zoom and Teams
 * still parse, so we can say "coming soon" instead of "not a meeting link".
 */
export function checkMeetingLink(raw: string): LinkCheck {
  const errors = copy.meetingLink.errors;
  if (!raw.trim()) return { ok: false, error: errors.empty };
  try {
    const link = parseMeetingLink(raw);
    if (link.platform !== "google_meet") return { ok: false, error: errors.comingSoon };
    return { ok: true, url: link.normalizedUrl, code: link.meetingCode };
  } catch (error) {
    if (!(error instanceof LinkParseError)) return { ok: false, error: errors.malformed };
    if (error.code === "MISSING_PASSCODE") return { ok: false, error: errors.comingSoon };
    if (error.code === "UNSUPPORTED_PLATFORM") return { ok: false, error: errors.unsupported };
    if (/google meet/i.test(error.message)) return { ok: false, error: errors.meetIncomplete };
    if (/zoom|teams/i.test(error.message)) return { ok: false, error: errors.comingSoon };
    return { ok: false, error: errors.malformed };
  }
}
