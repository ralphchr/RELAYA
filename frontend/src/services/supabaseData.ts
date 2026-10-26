import { isAgentVoiceId, type LanguageMode, type SessionMode, type Tone } from "@relaya/contracts";
import { getSession, restoreSession } from "../features/auth/client.js";
import { DEFAULT_SETTINGS } from "./localData.js";
import { DEFAULT_PTT_KEY, isAllowedPttKey } from "../features/session/pttKey.js";
import { ServiceError, type NameItem, type NameList, type Plan, type SessionRecord, type UserDataService, type UserSettings } from "./types.js";

/*
 * The signed-in user's data, read and written straight to Supabase (PostgREST)
 * with their own login. Row level security (database/migrations/0002) limits
 * every query to their rows, so no filter here is a security boundary.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const SESSION_COLUMNS = "id,title,mode,tone,status,started_at,ended_at,sentences_approved,sentences_edited,sentences_used_as_is,rerecords,agent_seconds";

/** Postgres errors the database raises on purpose, worded for people. */
function friendly(payload: { code?: string; message?: string } | null): string | null {
  if (payload?.code === "23505") return "That name is already on the list.";
  if (payload?.code === "23514" && payload.message && !payload.message.includes("violates")) return payload.message;
  return null;
}

async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  if (!supabaseUrl || !anonKey) throw new ServiceError("INTERNAL", "Supabase isn't configured.");
  const session = await restoreSession().catch(() => getSession());
  if (!session?.access_token) throw new ServiceError("UNAUTHORIZED", "Sign in again to save your changes.");
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ServiceError("NETWORK_ERROR", "Couldn't reach Relaya. Check your connection and try again.", true);
  }
  if (response.status === 204) return null as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as { code?: string; message?: string } | null;
    if (response.status === 401) throw new ServiceError("UNAUTHORIZED", "Your sign-in expired. Sign in again.");
    throw new ServiceError(error?.code === "23505" ? "CONFLICT" : "INTERNAL", friendly(error) ?? "Couldn't save that. Try again.", response.status >= 500);
  }
  return payload as T;
}

/** The user's id from their access token (the `sub` claim). */
function userId(): string {
  const token = getSession()?.access_token;
  try {
    const payload = JSON.parse(atob(token!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    if (payload.sub) return payload.sub;
  } catch { /* fall through */ }
  throw new ServiceError("UNAUTHORIZED", "Sign in again to save your changes.");
}

interface ListRow { id: string; title: string; is_default: boolean; name_list_items: NameItem[] }
interface SessionRow {
  id: string; title: string; mode: SessionMode; tone: Tone; status: "active" | "ended"; started_at: string; ended_at: string | null;
  sentences_approved: number; sentences_edited: number; sentences_used_as_is: number; rerecords: number; agent_seconds: number;
}

const toList = (row: ListRow): NameList => ({ id: row.id, title: row.title, isDefault: row.is_default, items: row.name_list_items ?? [] });
const toSession = (row: SessionRow): SessionRecord => ({
  id: row.id, title: row.title, mode: row.mode, tone: row.tone, status: row.status, startedAt: row.started_at, endedAt: row.ended_at,
  approved: row.sentences_approved, edited: row.sentences_edited, usedAsIs: row.sentences_used_as_is, rerecords: row.rerecords, agentSeconds: row.agent_seconds,
});
const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

export const supabaseData: UserDataService = {
  async updateProfile(patch) {
    const body: Record<string, unknown> = {};
    if (patch.displayName !== undefined) body.display_name = patch.displayName;
    if (patch.agentDisplayName !== undefined) body.agent_display_name = patch.agentDisplayName;
    if (patch.avatarUrl !== undefined) body.avatar_url = patch.avatarUrl;
    if (patch.avatarUrl === null) {
      const session = await restoreSession().catch(() => getSession());
      if (!supabaseUrl || !anonKey || !session?.access_token) throw new ServiceError("UNAUTHORIZED", "Sign in again to remove your photo.");
      try {
        const response = await fetch(`${supabaseUrl}/storage/v1/object/relaya-avatars/${userId()}/avatar.webp`, {
          method: "DELETE", headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok && response.status !== 404) throw new ServiceError("INTERNAL", "Couldn't remove your photo. Try again.", response.status >= 500);
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("NETWORK_ERROR", "Couldn't remove your photo. Check your connection and try again.", true);
      }
    }
    await rest(`profiles?id=${eq(userId())}`, { method: "PATCH", body, prefer: "return=minimal" });
  },
  async uploadAvatar(image) {
    if (!supabaseUrl || !anonKey) throw new ServiceError("INTERNAL", "Supabase isn't configured.");
    const session = await restoreSession().catch(() => getSession());
    if (!session?.access_token) throw new ServiceError("UNAUTHORIZED", "Sign in again to save your photo.");
    const path = `${userId()}/avatar.webp`;
    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/storage/v1/object/relaya-avatars/${path}`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "image/webp", "x-upsert": "true" },
        body: image,
      });
    } catch {
      throw new ServiceError("NETWORK_ERROR", "Couldn't upload your photo. Check your connection and try again.", true);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string; message?: string; statusCode?: string } | null;
      const storageMessage = payload?.message ?? payload?.error ?? "";
      const normalizedMessage = storageMessage.toLowerCase();
      if (response.status === 404 && normalizedMessage.includes("bucket")) {
        throw new ServiceError("NOT_CONFIGURED", "Profile photo storage isn't set up yet. Apply database/migrations/0007_profile_avatars.sql in your Supabase SQL Editor, then try again.");
      }
      if (response.status === 413 || normalizedMessage.includes("exceed") || normalizedMessage.includes("too large")) {
        throw new ServiceError("INVALID_INPUT", "That photo is too large. Choose an image under 512 KB after resizing.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new ServiceError("FORBIDDEN", "Supabase blocked the photo upload. Check that migration 0007_profile_avatars.sql is applied, then sign in again.");
      }
      throw new ServiceError("INTERNAL", storageMessage || "Couldn't upload your photo. Try again.", response.status >= 500);
    }
    return `${supabaseUrl}/storage/v1/object/public/relaya-avatars/${path}?v=${Date.now()}`;
  },
  async updateSettings(patch) {
    const body: Record<string, unknown> = {};
    if (patch.defaultMode) body.default_mode = patch.defaultMode;
    if (patch.defaultTone) body.default_tone = patch.defaultTone;
    if (patch.languageMode) body.language_mode = patch.languageMode;
    if (patch.pttKey !== undefined) {
      if (!isAllowedPttKey(patch.pttKey)) throw new ServiceError("INVALID_INPUT", "Pick a different push-to-talk key.");
      body.ptt_key = patch.pttKey;
    }
    if (patch.voiceId) body.voice_id = patch.voiceId;
    if (patch.gender !== undefined) body.gender = patch.gender;
    if (patch.voiceSpeed !== undefined) body.voice_speed = patch.voiceSpeed;
    if (patch.emailProductUpdates !== undefined) body.email_product_updates = patch.emailProductUpdates;
    if (patch.emailQuotaWarnings !== undefined) body.email_quota_warnings = patch.emailQuotaWarnings;
    await rest(`user_settings?user_id=${eq(userId())}`, { method: "PATCH", body, prefer: "return=minimal" });
  },

  async nameLists() {
    const rows = await rest<ListRow[]>("name_lists?select=id,title,is_default,name_list_items(id,value,position)&order=created_at.asc&name_list_items.order=position.asc");
    return rows.map(toList);
  },
  async createList(title) {
    const [row] = await rest<ListRow[]>("name_lists?select=id,title,is_default,name_list_items(id,value,position)", {
      method: "POST", body: { user_id: userId(), title }, prefer: "return=representation",
    });
    return toList({ ...row!, name_list_items: [] });
  },
  async renameList(listId, title) {
    await rest(`name_lists?id=${eq(listId)}`, { method: "PATCH", body: { title }, prefer: "return=minimal" });
  },
  async deleteList(listId) {
    await rest(`name_lists?id=${eq(listId)}`, { method: "DELETE", prefer: "return=minimal" });
  },
  async setDefaultList(listId) {
    // One default per user (unique index): clear the old one first.
    await rest("name_lists?is_default=is.true", { method: "PATCH", body: { is_default: false }, prefer: "return=minimal" });
    await rest(`name_lists?id=${eq(listId)}`, { method: "PATCH", body: { is_default: true }, prefer: "return=minimal" });
  },
  async addNames(listId, values) {
    if (!values.length) return [];
    const existing = await rest<{ position: number }[]>(`name_list_items?list_id=${eq(listId)}&select=position&order=position.desc&limit=1`);
    const start = (existing[0]?.position ?? -1) + 1;
    return rest<NameItem[]>("name_list_items?select=id,value,position", {
      method: "POST", body: values.map((value, i) => ({ list_id: listId, value, position: start + i })), prefer: "return=representation",
    });
  },
  async removeName(itemId) {
    await rest(`name_list_items?id=${eq(itemId)}`, { method: "DELETE", prefer: "return=minimal" });
  },
  async reorderNames(_listId, itemIds) {
    await Promise.all(itemIds.map((id, position) => rest(`name_list_items?id=${eq(id)}`, { method: "PATCH", body: { position }, prefer: "return=minimal" })));
  },

  async recentSessions(limit) {
    const rows = await rest<SessionRow[]>(`call_sessions?select=${SESSION_COLUMNS}&order=started_at.desc&limit=${limit}`);
    return rows.map(toSession);
  },
  async session(id) {
    const rows = await rest<(SessionRow & { session_names: { value: string; position: number }[] })[]>(
      `call_sessions?id=${eq(id)}&select=${SESSION_COLUMNS},session_names(value,position)&session_names.order=position.asc`,
    );
    const row = rows[0];
    return row ? { ...toSession(row), names: row.session_names.map((n) => n.value) } : null;
  },
  async deleteSession(id) {
    await rest(`call_sessions?id=${eq(id)}`, { method: "DELETE", prefer: "return=minimal" });
  },
};

interface ProfileRow { display_name: string; agent_display_name: string | null; avatar_url: string | null }
interface SettingsRow {
  default_mode: SessionMode; default_tone: Tone; language_mode?: LanguageMode; voice_id: string; gender: "male" | "female" | null; voice_speed: number; ptt_key: string;
  email_product_updates: boolean; email_quota_warnings: boolean;
}
interface UsageRow {
  plan_id: "free" | "paid" | "teams"; period_end: string; agent_sessions_left: number | null; agent_sessions_total: number | null; agent_seconds_left: number;
  reconstructions_used: number; reconstructions_left: number;
}

const PLAN_NAMES = { free: "Free plan", paid: "Pro plan", teams: "Teams plan" } as const;

export const formatResetDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Profile, settings and plan for GET-me. Missing rows fall back to defaults so the app still opens. */
export async function loadSupabaseAccountData(): Promise<{ displayName: string | null; agentDisplayName: string | null; avatarUrl: string | null; settings: UserSettings; plan: Plan | null }> {
  const [profile, settings, usage] = await Promise.all([
    rest<ProfileRow[]>("profiles?select=display_name,agent_display_name,avatar_url").then((rows) => rows[0] ?? null),
    rest<SettingsRow[]>("user_settings?select=default_mode,default_tone,language_mode,voice_id,gender,voice_speed,ptt_key,email_product_updates,email_quota_warnings").then((rows) => rows[0] ?? null),
    rest<UsageRow[]>("v_usage_current?select=plan_id,period_end,agent_sessions_left,agent_sessions_total,agent_seconds_left,reconstructions_used,reconstructions_left").then((rows) => rows[0] ?? null),
  ]);
  return {
    displayName: profile?.display_name ?? null,
    agentDisplayName: profile?.agent_display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    settings: settings ? {
      defaultMode: settings.default_mode,
      defaultTone: settings.default_tone,
      languageMode: settings.language_mode ?? "auto",
      voiceId: isAgentVoiceId(settings.voice_id) ? settings.voice_id : DEFAULT_SETTINGS.voiceId,
      gender: settings.gender ?? null,
      voiceSpeed: Number(settings.voice_speed),
      pttKey: isAllowedPttKey(settings.ptt_key) ? settings.ptt_key : DEFAULT_PTT_KEY,
      emailProductUpdates: settings.email_product_updates,
      emailQuotaWarnings: settings.email_quota_warnings,
    } : DEFAULT_SETTINGS,
    plan: usage ? {
      name: PLAN_NAMES[usage.plan_id] ?? "Free plan",
      agentSessionsLeft: usage.agent_sessions_left,
      agentSessionsTotal: usage.agent_sessions_total,
      agentMinutesLeft: Math.floor(usage.agent_seconds_left / 60),
      sentencesLeft: usage.reconstructions_left,
      sentencesTotal: usage.reconstructions_used + usage.reconstructions_left,
      resetsOn: formatResetDate(usage.period_end),
    } : null,
  };
}
