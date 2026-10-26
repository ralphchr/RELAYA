import { signTicket, TicketError, verifyTicket } from "@relaya/agent-ticket";
import { LinkParseError, parseMeetingLink } from "@relaya/link-parser";
import { rpc, select, update } from "../supabase.js";

export type TicketResult =
  | { ok: true; ticket: string | null; maxSeconds: number }
  | { ok: false; code: "INVALID_INPUT" | "UNSUPPORTED_PLATFORM" | "CONFLICT" | "QUOTA_EXCEEDED"; message: string; status: 400 | 409 | 422 | 429 };

interface UsageRow { agent_sessions_left: number | null; agent_sessions_total: number | null; agent_seconds_left: number; max_agent_session_minutes: number }
interface SettingsRow { agent_consented_at: string | null }

/**
 * POST /api/agent/ticket: may this user send the agent into this meeting?
 * Checks consent and that the plan has a session left, then signs a ticket the
 * agent verifies. The session is only spent once the host admits the agent
 * (recordAdmission), so a declined join or "Ask again" costs nothing.
 * Without AGENT_TICKET_SECRET (one laptop, local dev) the checks still run but
 * no ticket is signed; the agent then accepts any join and nothing is spent.
 */
export async function issueAgentTicket(userId: string, body: { meetingUrl?: unknown; consent?: unknown }): Promise<TicketResult> {
  if (typeof body.meetingUrl !== "string" || body.meetingUrl.length > 500) {
    return { ok: false, code: "INVALID_INPUT", message: "Send the meeting link.", status: 400 };
  }
  let meetingUrl: string;
  try {
    const parsed = parseMeetingLink(body.meetingUrl);
    if (parsed.platform !== "google_meet") return { ok: false, code: "UNSUPPORTED_PLATFORM", message: "Speak for me works with Google Meet for now.", status: 422 };
    meetingUrl = parsed.normalizedUrl;
  } catch (error) {
    if (!(error instanceof LinkParseError)) throw error;
    if (error.code === "INVALID_INPUT") return { ok: false, code: "INVALID_INPUT", message: "That isn't a meeting link.", status: 400 };
    return { ok: false, code: "UNSUPPORTED_PLATFORM", message: "Speak for me works with Google Meet for now.", status: 422 };
  }

  const user = encodeURIComponent(userId);
  const [settings] = await select<SettingsRow>(`user_settings?user_id=eq.${user}&select=agent_consented_at`);
  if (!settings?.agent_consented_at) {
    if (body.consent !== true) return { ok: false, code: "CONFLICT", message: "Agree to the Speak for me terms first.", status: 409 };
    await update(`user_settings?user_id=eq.${user}`, { agent_consented_at: new Date().toISOString() });
  }

  const [usage] = await select<UsageRow>(`v_usage_current?user_id=eq.${user}&select=agent_sessions_left,agent_sessions_total,agent_seconds_left,max_agent_session_minutes`);
  if (!usage) return { ok: false, code: "CONFLICT", message: "Your plan isn't set up yet. Sign out and in again.", status: 409 };
  const outOfSessions = { ok: false as const, code: "QUOTA_EXCEEDED" as const, status: 429 as const,
    message: usage.agent_sessions_total === null ? "You've used this month's Speak for me time." : `You've used all ${usage.agent_sessions_total} Speak for me sessions this month.` };
  if (usage.agent_seconds_left <= 0 || usage.agent_sessions_left === 0) return outOfSessions;

  const maxSeconds = Math.min(usage.max_agent_session_minutes * 60, usage.agent_seconds_left);
  const secret = process.env.AGENT_TICKET_SECRET;
  if (!secret) return { ok: true, ticket: null, maxSeconds };
  const { ticket } = await signTicket({ sub: userId, meetingUrl, maxSeconds }, secret);
  return { ok: true, ticket, maxSeconds };
}

/** Admission can take a while (the host has up to 5 minutes), so accept tickets this long after they expire. */
const ADMISSION_GRACE_MS = 10 * 60_000;

/**
 * POST /api/internal/agent/admitted (agent only, AGENT_SERVICE_KEY): the host
 * let the agent in, so spend one session. Returns false when the user ran out
 * in the meantime; the agent then leaves.
 */
export async function recordAdmission(ticket: unknown): Promise<{ ok: true; allowed: boolean } | { ok: false; message: string }> {
  const secret = process.env.AGENT_TICKET_SECRET;
  if (!secret || typeof ticket !== "string") return { ok: false, message: "Send the agent ticket." };
  let claims;
  try { claims = await verifyTicket(ticket, secret, Date.now() - ADMISSION_GRACE_MS); }
  catch (error) { if (error instanceof TicketError) return { ok: false, message: error.message }; throw error; }
  const allowed = await rpc<boolean>("consume_usage", { p_user_id: claims.sub, p_kind: "agent_session", p_quantity: 1 });
  return { ok: true, allowed };
}
