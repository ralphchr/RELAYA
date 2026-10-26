import { LinkParseError, parseMeetingLink } from "@relaya/link-parser";
import { insert, select, update } from "../supabase.js";

export type SessionResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; message: string };

const MAX_NAMES = 30;
/** Longest an agent can be in a call (paid plans); caps the agent time a session can record. */
const MAX_AGENT_SECONDS = 2 * 60 * 60;

/**
 * POST /api/sessions: start a session in the user's history. Users can't write
 * call_sessions themselves (RLS), so the API does it with the service role.
 * Only counts and the names snapshot are stored, never sentences.
 */
export async function startSession(userId: string, body: Record<string, unknown>): Promise<SessionResult<{ id: string }>> {
  const { mode, tone, title, names, meetingUrl } = body;
  if (mode !== "say" && mode !== "speak") return bad("Pick a mode.");
  if (tone !== "casual" && tone !== "professional") return bad("Pick a tone.");
  if (typeof title !== "string" || !title.trim() || title.length > 120) return bad("The session needs a title.");
  const nameList = Array.isArray(names) ? names : [];
  if (nameList.length > MAX_NAMES || !nameList.every((n) => typeof n === "string" && n.trim().length > 0 && n.length <= 60)) {
    return bad(`Names must be up to ${MAX_NAMES} short text values.`);
  }

  let platform: string | null = null;
  if (mode === "speak" && typeof meetingUrl === "string") {
    try { platform = parseMeetingLink(meetingUrl).platform; } catch (error) { if (!(error instanceof LinkParseError)) throw error; }
  }

  const [row] = await insert<{ id: string }>("call_sessions?select=id", { user_id: userId, title: title.trim(), mode, tone, platform });
  if (!row) throw new Error("The session wasn't created.");
  if (nameList.length) {
    await insert("session_names?select=id", (nameList as string[]).map((value, position) => ({ session_id: row.id, value: value.trim(), position })));
  }
  return { ok: true, value: { id: row.id } };
}

/**
 * POST /api/sessions/:id/end: close the session with its counts. For Speak for
 * me the session's length is recorded as agent time (the agent is in the call
 * for the whole session) so the monthly minutes go down.
 */
export async function endSession(userId: string, sessionId: string, body: Record<string, unknown>): Promise<SessionResult<{ ended: true }>> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return { ok: false, status: 404, message: "That session doesn't exist." };
  const count = (key: string) => {
    const value = body[key];
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000 ? value as number : 0;
  };

  const filter = `call_sessions?id=eq.${sessionId}&user_id=eq.${encodeURIComponent(userId)}`;
  const [session] = await select<{ mode: "say" | "speak"; status: string; started_at: string }>(`${filter}&select=mode,status,started_at`);
  if (!session) return { ok: false, status: 404, message: "That session doesn't exist." };
  if (session.status === "ended") return { ok: true, value: { ended: true } };

  const endedAt = new Date();
  const agentSeconds = session.mode === "speak"
    ? Math.min(MAX_AGENT_SECONDS, Math.max(0, Math.round((endedAt.getTime() - Date.parse(session.started_at)) / 1000)))
    : 0;
  await update(`${filter}&status=eq.active`, {
    status: "ended", ended_at: endedAt.toISOString(), agent_seconds: agentSeconds,
    sentences_approved: count("approved"), sentences_edited: count("edited"), sentences_used_as_is: count("usedAsIs"), rerecords: count("rerecords"),
  });
  if (agentSeconds > 0) {
    await insert("usage_ledger?select=id", { user_id: userId, session_id: sessionId, kind: "agent_second", quantity: agentSeconds });
  }
  return { ok: true, value: { ended: true } };
}

const bad = (message: string) => ({ ok: false as const, status: 400 as const, message });
