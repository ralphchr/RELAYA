import { LinkParseError, parseMeetingLink } from "@relaya/link-parser";
import { MEET_AGENT_NAME } from "@relaya/contracts";

export interface TryJoinArgs { url: string; displayName: string; staySeconds: number }

/**
 * `try-join <meet link> [--stay 30]`. Legacy --name is accepted but ignored.
 * Throws an Error with a readable message on bad input.
 */
export function parseTryJoinArgs(argv: string[]): TryJoinArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      flags.set(arg.slice(2), value);
      i++;
    } else positional.push(arg);
  }
  const raw = positional[0];
  if (!raw) throw new Error("Paste your Google Meet link after the command, e.g. pnpm --filter @relaya/agent try-join https://meet.google.com/abc-defg-hij");

  let url: string;
  try {
    const link = parseMeetingLink(raw);
    if (link.platform !== "google_meet") throw new Error("Only Google Meet links are supported for now.");
    url = link.normalizedUrl;
  } catch (error) {
    throw new Error(error instanceof LinkParseError ? `That isn't a usable Google Meet link: ${error.message}` : (error as Error).message);
  }

  const stay = Number(flags.get("stay") ?? 30);
  if (!Number.isFinite(stay) || stay < 0 || stay > 3600) throw new Error("--stay must be a number of seconds between 0 and 3600.");

  return { url, displayName: MEET_AGENT_NAME, staySeconds: stay };
}
