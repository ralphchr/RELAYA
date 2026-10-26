import { DEFAULT_AGENT_VOICE, isAgentVoiceId } from "@relaya/contracts";
import type { NameItem, NameList, SessionDraftInput, SessionRecord, SessionStats, UserDataService, UserSettings } from "./types.js";
import { ServiceError } from "./types.js";
import { DEFAULT_PTT_KEY, isAllowedPttKey } from "../features/session/pttKey.js";

/*
 * The same data kept in this browser, for the preview workspace and for
 * development without Supabase. Older versions saved names and preferences
 * under different keys; those are read once and carried over.
 */
const KEYS = { lists: "relaya.nameLists.v2", settings: "relaya.settings.v2", profile: "relaya.profile.v2", sessions: "relaya.sessions.v2" };
const LEGACY = { lists: "relaya.savedNames.v1", preferences: "relaya.preferences.v1", voice: "relaya.voice.v1" };
const MAX_NAMES_PER_LIST = 30;
const MAX_SESSIONS = 50;
const DEFAULT_GLOSSARY = "Default Glossary";

export const DEFAULT_SETTINGS: UserSettings = {
  defaultMode: "say", defaultTone: "professional", languageMode: "auto", voiceId: DEFAULT_AGENT_VOICE, gender: "female", voiceSpeed: 1, pttKey: DEFAULT_PTT_KEY,
  emailProductUpdates: true, emailQuotaWarnings: true,
};

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { throw new ServiceError("STORAGE", "This browser blocked saving. Check its storage settings."); }
}

function ensureDefaultGlossary(lists: NameList[]): NameList[] {
  const next = [...lists];
  if (!next.length) next.push({ id: newId(), title: DEFAULT_GLOSSARY, isDefault: true, items: [] });
  if (!next.some((list) => list.isDefault)) next[0] = { ...next[0]!, isDefault: true };
  const defaultIndex = next.findIndex((list) => list.isDefault);
  const current = next[defaultIndex]!;
  let changed = !lists.length || !lists.some((list) => list.isDefault);
  let updated = current;
  if (current.title === "My names") { updated = { ...updated, title: DEFAULT_GLOSSARY }; changed = true; }
  if (!current.items.some((item) => item.value.toLocaleLowerCase() === "relaya") && current.items.length < MAX_NAMES_PER_LIST) {
    updated = { ...updated, items: [...updated.items, { id: newId(), value: "Relaya", position: updated.items.length }] };
    changed = true;
  }
  if (changed) {
    next[defaultIndex] = updated;
    write(KEYS.lists, next);
  }
  return next;
}

function loadLists(): NameList[] {
  const lists = read<NameList[]>(KEYS.lists);
  if (lists) return ensureDefaultGlossary(lists);
  const legacy = read<{ id: string; name: string; items: string[] }[]>(LEGACY.lists) ?? [];
  const migrated = legacy.map((list, index) => ({
    id: list.id, title: list.name, isDefault: index === 0,
    items: list.items.slice(0, MAX_NAMES_PER_LIST).map((value, position) => ({ id: newId(), value, position })),
  }));
  const initialized = ensureDefaultGlossary(migrated);
  write(KEYS.lists, initialized);
  return initialized;
}

export function loadLocalSettings(): UserSettings {
  const saved = read<Partial<UserSettings>>(KEYS.settings);
  if (saved) return { ...DEFAULT_SETTINGS, ...saved, pttKey: saved.pttKey && isAllowedPttKey(saved.pttKey) ? saved.pttKey : DEFAULT_PTT_KEY };
  const prefs = read<{ mode?: string; tone?: string }>(LEGACY.preferences) ?? {};
  const voice = read<{ rate?: number }>(LEGACY.voice) ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...(prefs.mode === "say" || prefs.mode === "speak" ? { defaultMode: prefs.mode } : {}),
    ...(prefs.tone === "casual" || prefs.tone === "professional" ? { defaultTone: prefs.tone } : {}),
    ...(typeof voice.rate === "number" ? { voiceSpeed: Math.min(1.2, Math.max(0.8, voice.rate)) } : {}),
  };
}

export function loadLocalProfile(): { displayName: string | null; agentDisplayName: string | null; avatarUrl: string | null } {
  const saved = read<{ displayName: string | null; agentDisplayName: string | null; avatarUrl?: string | null }>(KEYS.profile);
  if (saved) return { ...saved, avatarUrl: saved.avatarUrl ?? null };
  const legacyName = read<{ displayName?: unknown }>(LEGACY.voice)?.displayName;
  return { displayName: null, agentDisplayName: typeof legacyName === "string" && legacyName.trim() ? `${legacyName.trim()} (AI)` : null, avatarUrl: null };
}

async function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new ServiceError("STORAGE", "Couldn't read that photo."));
    reader.onerror = () => reject(new ServiceError("STORAGE", "Couldn't read that photo."));
    reader.readAsDataURL(blob);
  });
}

const loadSessions = () => read<(SessionRecord & { names: string[] })[]>(KEYS.sessions) ?? [];

function editList(listId: string, change: (list: NameList) => NameList) {
  const lists = loadLists();
  if (!lists.some((list) => list.id === listId)) throw new ServiceError("NOT_FOUND", "That list no longer exists.");
  write(KEYS.lists, lists.map((list) => (list.id === listId ? change(list) : list)));
}

export const localData: UserDataService = {
  async updateProfile(patch) { write(KEYS.profile, { ...loadLocalProfile(), ...patch }); },
  async uploadAvatar(image) { return blobAsDataUrl(image); },
  async updateSettings(patch) {
    if (patch.pttKey !== undefined && !isAllowedPttKey(patch.pttKey)) throw new ServiceError("INVALID_INPUT", "Pick a different push-to-talk key.");
    if (patch.voiceId && !isAgentVoiceId(patch.voiceId)) throw new ServiceError("INVALID_INPUT", "Pick one of the listed voices.");
    write(KEYS.settings, { ...loadLocalSettings(), ...patch });
  },

  async nameLists() { return loadLists(); },
  async createList(title) {
    const list: NameList = { id: newId(), title, isDefault: false, items: [] };
    write(KEYS.lists, [...loadLists(), list]);
    return list;
  },
  async renameList(listId, title) { editList(listId, (list) => ({ ...list, title })); },
  async deleteList(listId) { write(KEYS.lists, loadLists().filter((list) => list.id !== listId)); },
  async setDefaultList(listId) { write(KEYS.lists, loadLists().map((list) => ({ ...list, isDefault: list.id === listId }))); },
  async addNames(listId, values) {
    const list = loadLists().find((l) => l.id === listId);
    if (!list) throw new ServiceError("NOT_FOUND", "That list no longer exists.");
    if (list.items.length + values.length > MAX_NAMES_PER_LIST) throw new ServiceError("INVALID_INPUT", `You can add up to ${MAX_NAMES_PER_LIST} names to a list.`);
    const existing = new Set(list.items.map((item) => item.value.toLocaleLowerCase()));
    if (values.some((value) => existing.has(value.toLocaleLowerCase()))) throw new ServiceError("CONFLICT", "That name is already on the list.");
    const added: NameItem[] = values.map((value, i) => ({ id: newId(), value, position: list.items.length + i }));
    editList(listId, (l) => ({ ...l, items: [...l.items, ...added] }));
    return added;
  },
  async removeName(itemId) {
    write(KEYS.lists, loadLists().map((list) => ({ ...list, items: list.items.filter((item) => item.id !== itemId) })));
  },
  async reorderNames(listId, itemIds) {
    editList(listId, (list) => ({
      ...list,
      items: itemIds.map((id) => list.items.find((item) => item.id === id)).filter((item): item is NameItem => Boolean(item)).map((item, position) => ({ ...item, position })),
    }));
  },

  async recentSessions(limit) {
    return loadSessions().slice(0, limit).map((record) => { const copy: Partial<typeof record> = { ...record }; delete copy.names; return copy as SessionRecord; });
  },
  async session(id) { return loadSessions().find((s) => s.id === id) ?? null; },
  async deleteSession(id) { write(KEYS.sessions, loadSessions().filter((s) => s.id !== id)); },
};

/** The preview workspace's session history. */
export const localSessions = {
  start(input: SessionDraftInput & { title: string }): string {
    const id = newId();
    const record = {
      id, title: input.title, mode: input.mode, tone: input.tone, status: "active" as const,
      startedAt: new Date().toISOString(), endedAt: null, agentSeconds: 0,
      approved: 0, edited: 0, usedAsIs: 0, rerecords: 0, names: input.names,
    };
    try { write(KEYS.sessions, [record, ...loadSessions()].slice(0, MAX_SESSIONS)); } catch { /* History is optional. */ }
    return id;
  },
  end(id: string, stats: SessionStats) {
    const endedAt = new Date().toISOString();
    try {
      write(KEYS.sessions, loadSessions().map((s) => (s.id === id && s.status === "active" ? {
        ...s, ...stats, status: "ended" as const, endedAt,
        agentSeconds: s.mode === "speak" ? Math.round((Date.parse(endedAt) - Date.parse(s.startedAt)) / 1000) : 0,
      } : s)));
    } catch { /* History is optional. */ }
  },
};
