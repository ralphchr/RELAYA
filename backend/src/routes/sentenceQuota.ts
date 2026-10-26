import { rpc, select, selectAsUser } from "../supabase.js";

interface UsageRow { plan_id: string; period_end: string; reconstructions_used: number; reconstructions_left: number; window_reconstructions_left: number | null; window_hours: number | null }

export type SentenceAllowance =
  | { ok: true; left: number; windowLeft: number | null }
  | { ok: false; code: "QUOTA_EXCEEDED"; message: string; retryAfterSeconds: number }
  | { ok: false; code: "CONFLICT"; message: string };

const formatDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

function formatWait(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * May this user turn one more recording into a sentence? Checked before the
 * recording is sent to speech recognition, so a user at the limit costs nothing.
 * The sentence is only counted once it comes back (recordSentence): a failed
 * or silent recording is free.
 */
export async function checkSentenceAllowance(userId: string, now = Date.now()): Promise<SentenceAllowance> {
  return allowance(`user_id=eq.${encodeURIComponent(userId)}&`, select, now);
}

/** Safe to run alongside Auth: RLS scopes every read to the verified bearer token. */
export function checkSentenceAllowanceForToken(token: string, now = Date.now()): Promise<SentenceAllowance> {
  return allowance("", <T>(path: string) => selectAsUser<T>(path, token), now);
}

async function allowance(userFilter: string, read: <T>(path: string) => Promise<T[]>, now: number): Promise<SentenceAllowance> {
  const [usage] = await read<UsageRow>(`v_usage_current?${userFilter}select=plan_id,period_end,reconstructions_used,reconstructions_left,window_reconstructions_left,window_hours`);
  if (!usage) return { ok: false, code: "CONFLICT", message: "Your plan isn't set up yet. Sign out and in again." };

  if (usage.reconstructions_left <= 0) {
    const total = usage.reconstructions_used + usage.reconstructions_left;
    return {
      ok: false, code: "QUOTA_EXCEEDED",
      message: `You've used all ${total} sentences on your plan this month. They come back on ${formatDay(usage.period_end)}.`,
      retryAfterSeconds: Math.max(60, Math.ceil((Date.parse(usage.period_end) - now) / 1000)),
    };
  }

  if (usage.window_hours !== null && usage.window_reconstructions_left !== null && usage.window_reconstructions_left <= 0) {
    const since = new Date(now - usage.window_hours * 3_600_000).toISOString();
    // The oldest sentence in the window is the next one to free up.
    const [[oldest], [plan]] = await Promise.all([
      read<{ occurred_at: string }>(`usage_ledger?${userFilter}kind=eq.reconstruction&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.asc&limit=1&select=occurred_at`),
      read<{ window_reconstructions: number }>(`plans?id=eq.${encodeURIComponent(usage.plan_id)}&select=window_reconstructions`),
    ]);
    const opensAt = oldest ? Date.parse(oldest.occurred_at) + usage.window_hours * 3_600_000 : now + 60_000;
    const retryAfterSeconds = Math.max(60, Math.ceil((opensAt - now) / 1000));
    const count = plan ? `${plan.window_reconstructions} sentences` : "your sentences";
    return {
      ok: false, code: "QUOTA_EXCEEDED",
      message: `You've used ${count} in the last ${usage.window_hours} hours, the most your plan allows. Your next one opens in ${formatWait(retryAfterSeconds)}.`,
      retryAfterSeconds,
    };
  }

  return { ok: true, left: usage.reconstructions_left, windowLeft: usage.window_reconstructions_left };
}

/** Counts one sentence. False when another request took the last one first. */
export async function recordSentence(userId: string): Promise<boolean> {
  return rpc<boolean>("consume_usage", { p_user_id: userId, p_kind: "reconstruction", p_quantity: 1 });
}
