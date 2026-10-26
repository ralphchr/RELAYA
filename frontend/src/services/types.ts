import type { Recorder } from "../features/session/capture/recorder.js";
import type { AgentProblemReason, AgentStatus, AgentVoiceId, LanguageMode, ReconstructResponse, SessionMode, Tone } from "@relaya/contracts";

/**
 * Service seams between the UI and the backend. Each one maps to an endpoint in
 * The UI only talks to these interfaces, so swapping a mock for
 * the real HTTP client does not touch any screen.
 */

export interface UserSettings {
  defaultMode: SessionMode;
  defaultTone: Tone;
  languageMode: LanguageMode;
  voiceId: AgentVoiceId;
  gender: Gender | null;
  voiceSpeed: number;
  /** Push-to-talk key, as a KeyboardEvent.code ("Space", "KeyF"). */
  pttKey: string;
  emailProductUpdates: boolean;
  emailQuotaWarnings: boolean;
}

export type Gender = "male" | "female";

export interface Plan {
  name: string;
  /** null = unlimited */
  agentSessionsLeft: number | null;
  agentSessionsTotal: number | null;
  agentMinutesLeft: number;
  sentencesLeft: number;
  sentencesTotal: number;
  resetsOn: string;
}

export interface Account {
  displayName: string;
  firstName: string;
  initials: string;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  signedIn: boolean;
  /** Saved app nickname, or null for the personal default. Doesn't change the Meet name. */
  agentDisplayName: string | null;
  settings: UserSettings;
  plan: Plan;
}

export interface AccountService {
  /** Profile, settings and plan usage for the signed-in user. */
  getMe(): Promise<Account>;
}

export interface SessionDraftInput {
  mode: SessionMode;
  tone: Tone;
  names: string[];
  meetingUrl: string | null;
}

/** What happened in a session. Counts only: sentences are never saved. */
export interface SessionStats {
  approved: number;
  edited: number;
  usedAsIs: number;
  rerecords: number;
}

export interface SessionsService {
  /** POST /api/sessions */
  create(input: SessionDraftInput): Promise<{ id: string }>;
  /** POST /api/sessions/:id/end */
  end(sessionId: string, stats: SessionStats): Promise<void>;
}

export interface SessionRecord extends SessionStats {
  id: string;
  title: string;
  mode: SessionMode;
  tone: Tone;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  agentSeconds: number;
}

export interface NameItem { id: string; value: string; position: number }
export interface NameList { id: string; title: string; isDefault: boolean; items: NameItem[] }

/**
 * The user's own saved data. Signed in: Supabase, guarded by row level
 * security. Preview or no Supabase: this browser's storage.
 */
export interface UserDataService {
  updateProfile(patch: { displayName?: string; agentDisplayName?: string | null; avatarUrl?: string | null }): Promise<void>;
  /** Upload a normalized profile image and return its display URL. */
  uploadAvatar(image: Blob): Promise<string>;
  updateSettings(patch: Partial<UserSettings>): Promise<void>;

  nameLists(): Promise<NameList[]>;
  createList(title: string): Promise<NameList>;
  renameList(listId: string, title: string): Promise<void>;
  deleteList(listId: string): Promise<void>;
  setDefaultList(listId: string): Promise<void>;
  /** Adds in order after the existing names. Returns the stored items. */
  addNames(listId: string, values: string[]): Promise<NameItem[]>;
  removeName(itemId: string): Promise<void>;
  /** Saves the order given (item ids, first to last). */
  reorderNames(listId: string, itemIds: string[]): Promise<void>;

  recentSessions(limit: number): Promise<SessionRecord[]>;
  session(id: string): Promise<(SessionRecord & { names: string[] }) | null>;
  deleteSession(id: string): Promise<void>;
}

export interface ReconstructInput {
  sessionId: string;
  audio: Blob;
  durationMs: number;
  tone: Tone;
  languageMode: LanguageMode;
  names: string[];
}

export interface PipelineService {
  /** POST /api/reconstruct */
  reconstruct(input: ReconstructInput, signal?: AbortSignal): Promise<ReconstructResponse>;
  /** POST /api/reconstruct/text: rebuilds a corrected transcript. Counts as a sentence. */
  reconstructTranscript(input: { transcript: string; tone: Tone; names: string[] }, signal?: AbortSignal): Promise<ReconstructResponse>;
}

export interface AgentJoinHandle {
  agentSessionId: string;
  cancel(): void;
}

/** Why a join failed before the host was ever asked. */
export type AgentJoinProblem = "quota" | "signed_out" | "agent_offline" | AgentProblemReason;

export interface AgentService {
  /**
   * POST /api/agent/ticket (when there's an API), then POST agent /sessions,
   * then status updates until admitted or refused. `consent`: the user accepted
   * the Speak for me terms.
   */
  join(
    input: { meetingUrl: string; displayName: string; consent: boolean; voice?: AgentVoiceId; speed?: number },
    onStatus: (status: AgentStatus, problem?: { kind: AgentJoinProblem; message: string }) => void,
  ): AgentJoinHandle;
  /** Calls onLeft once if the agent drops out of the call (removed, time limit, crashed). Returns unsubscribe. */
  watch(agentSessionId: string, onLeft: () => void): () => void;
  /** POST agent /sessions/:id/utterances. Resolves on `audio_ready`. */
  prepare(agentSessionId: string, text: string): Promise<{ textHash: string }>;
  /** POST agent /utterances/:uid/play. Calls onEnded on `playback_ended`. */
  play(agentSessionId: string, textHash: string, onEnded: () => void): void;
  /** POST agent /sessions/:id/stop */
  stop(agentSessionId: string): void;
  /** DELETE agent /sessions/:id */
  leave(agentSessionId: string): void;
}

export interface Services {
  /** Browser microphone capture. Swapped for a fake in tests. */
  createRecorder: () => Recorder;
  account: AccountService;
  sessions: SessionsService;
  data: UserDataService;
  pipeline: PipelineService;
  agent: AgentService;
}

export class ServiceError extends Error {
  /** retryAfterMs: when the server said to try again (a plan limit), if it did. */
  constructor(readonly code: string, message: string, readonly retryable = false, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = "ServiceError";
  }
}
