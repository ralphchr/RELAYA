import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SessionMode, Tone } from "@relaya/contracts";

/**
 * What the user picks before the call: mode, tone, names, meeting link and,
 * for Speak for me, the agent session. Kept in sessionStorage so a refresh in
 * the middle of setup or the call does not lose it.
 */
export interface SessionDraft {
  mode: SessionMode;
  tone: Tone;
  names: string[];
  meeting: { url: string; code: string } | null;
  agentSessionId: string | null;
  /** The account's defaults (mode, tone, default name list) were applied to this draft. */
  defaultsApplied: boolean;
}

const STORAGE_KEY = "relaya.draft";
const EMPTY: SessionDraft = { mode: "say", tone: "professional", names: [], meeting: null, agentSessionId: null, defaultsApplied: false };

function load(): SessionDraft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<SessionDraft>) };
    const preferences = localStorage.getItem("relaya.preferences.v1");
    if (!preferences) return EMPTY;
    const saved = JSON.parse(preferences) as { mode?: SessionMode; tone?: Tone };
    return { ...EMPTY, ...(saved.mode === "say" || saved.mode === "speak" ? { mode: saved.mode } : {}), ...(saved.tone === "professional" || saved.tone === "casual" ? { tone: saved.tone } : {}) };
  } catch {
    return EMPTY;
  }
}

function save(draft: SessionDraft) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); } catch { /* storage blocked: keep in memory only */ }
}

interface DraftContextValue {
  draft: SessionDraft;
  update(patch: Partial<SessionDraft>): void;
  reset(): void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

export function SessionDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SessionDraft>(load);
  const update = useCallback((patch: Partial<SessionDraft>) => {
    setDraft((current) => { const next = { ...current, ...patch }; save(next); return next; });
  }, []);
  const reset = useCallback(() => {
    // Keep tone and names: people usually reuse them for the next call.
    setDraft((current) => { const next = { ...EMPTY, tone: current.tone, names: current.names, defaultsApplied: current.defaultsApplied }; save(next); return next; });
  }, []);
  const value = useMemo(() => ({ draft, update, reset }), [draft, update, reset]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useSessionDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("useSessionDraft must be used inside SessionDraftProvider");
  return value;
}
