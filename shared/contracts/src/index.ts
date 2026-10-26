import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "INVALID_INPUT", "UNAUTHORIZED", "QUOTA_EXCEEDED", "FORBIDDEN", "FORBIDDEN_HOST",
  "NOT_FOUND", "CONFLICT", "NO_SPEECH", "TOO_SHORT", "TOO_LONG", "UNSUPPORTED_PLATFORM",
  "MISSING_PASSCODE", "RATE_LIMITED", "STT_FAILED", "LLM_FAILED", "VERIFY_FAILED",
  "TTS_FAILED", "AGENT_UNAVAILABLE", "TIMEOUT", "INTERNAL",
]);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    requestId: z.string().min(1),
  }).strict(),
}).strict();

export const HealthResponseSchema = z.object({ ok: z.literal(true), version: z.string().min(1) }).strict();

export const SessionModeSchema = z.enum(["say", "speak"]);
export const ToneSchema = z.enum(["casual", "professional"]);
export const LanguageModeSchema = z.enum(["auto", "tagalog_english", "bisaya_english", "japanese_english", "mandarin_english", "spanish_english"]);
export const LANGUAGE_MODE_OPTIONS = [
  { value: "auto", label: "Auto-detect mixed speech" },
  { value: "bisaya_english", label: "Bisaya and English" },
  { value: "tagalog_english", label: "Tagalog and English" },
  { value: "japanese_english", label: "Japanese and English" },
  { value: "mandarin_english", label: "Mandarin Chinese and English" },
  { value: "spanish_english", label: "Spanish and English" },
] satisfies { value: z.infer<typeof LanguageModeSchema>; label: string }[];

export const SessionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("RECORD_START") }).strict(),
  z.object({ type: z.literal("RECORD_STOP"), durationMs: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("RECORD_CANCEL") }).strict(),
  z.object({ type: z.literal("RECONSTRUCT_SUCCESS"), sentenceId: z.string().min(1), sentence: z.string().min(1) }).strict(),
  z.object({ type: z.literal("RECONSTRUCT_FAILURE"), code: ApiErrorCodeSchema }).strict(),
  z.object({ type: z.literal("APPROVE") }).strict(),
  z.object({ type: z.literal("EDIT") }).strict(),
  z.object({ type: z.literal("DISMISS") }).strict(),
  z.object({ type: z.literal("QUIT") }).strict(),
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;

/* ---------- Reconstruction + Context Guard ---------- */
const SpanSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

export const LanguageCodeSchema = z.enum(["tl", "ceb", "en", "ja", "zh", "es"]);
export const GuardIssueTypeSchema = z.enum(["number", "date", "name", "negation", "certainty", "commitment", "question"]);

export const GuardIssueSchema = z.object({
  id: z.string().min(1),
  type: GuardIssueTypeSchema,
  title: z.string().min(1),
  said: z.string().min(1),
  saidGloss: z.string().min(1).optional(),
  draftSpan: SpanSchema,
  explanation: z.string().min(1),
  fix: z.object({ label: z.string().min(1), sentence: z.string().min(1), fixedSpan: SpanSchema }).strict(),
}).strict();

export const GuardResultSchema = z.object({
  status: z.enum(["clear", "flagged", "unsure"]),
  risk: z.enum(["low", "high"]),
  needsVerify: z.boolean(),
  issues: z.array(GuardIssueSchema),
  kept: z.array(z.string().min(1)),
}).strict();

export const ReconstructResponseSchema = z.object({
  sentence: z.object({ id: z.string().min(1), text: z.string().min(1), wordCount: z.number().int().positive(), literal: z.string().min(1) }).strict(),
  transcript: z.string().min(1),
  languages: z.array(LanguageCodeSchema),
  facts: z.object({
    numbers: z.array(z.string()), dates: z.array(z.string()), names: z.array(z.string()),
    negations: z.array(z.string()), hedges: z.array(z.string()), commitments: z.array(z.string()),
  }).strict(),
  confidence: z.number().min(0).max(1),
  unresolvedTerms: z.array(z.string()),
  guard: GuardResultSchema,
  quota: z.object({ reconstructionsLeft: z.number().int().nonnegative().nullable(), windowLeft: z.number().int().nonnegative().nullable() }).strict(),
  timings: z.object({ sttMs: z.number(), llmMs: z.number(), rulesMs: z.number(), totalMs: z.number() }).strict(),
}).strict();

export const RewriteDraftSchema = z.object({
  sentence: z.string().trim().min(1),
  /** The same sentence with the speaker's hedge kept; equals `sentence` when there was none. */
  hedgedSentence: z.string(),
  languages: z.array(LanguageCodeSchema).min(1),
  facts: z.object({
    numbers: z.array(z.string()), dates: z.array(z.string()), names: z.array(z.string()),
    negations: z.array(z.string()), hedges: z.array(z.string()), commitments: z.array(z.string()),
  }).strict(),
  confidence: z.number().min(0).max(1),
  unresolvedTerms: z.array(z.string()),
}).strict();

/* ---------- Agent service ---------- */
/** Consistent participant name in Google Meet, independent of the user's profile. */
export const MEET_AGENT_NAME = "RELAYA AI";
export const AgentStatusSchema = z.enum(["preparing", "waiting_host", "admitted", "declined", "timeout", "blocked", "failed", "speaking", "left"]);
export const AgentProblemReasonSchema = z.enum(["bot_signed_out", "bot_name_mismatch", "bot_name_unverified"]);
export type AgentProblemReason = z.infer<typeof AgentProblemReasonSchema>;

export type LanguageCode = z.infer<typeof LanguageCodeSchema>;
export type GuardIssueType = z.infer<typeof GuardIssueTypeSchema>;
export type GuardIssue = z.infer<typeof GuardIssueSchema>;
export type GuardResult = z.infer<typeof GuardResultSchema>;
export type ReconstructResponse = z.infer<typeof ReconstructResponseSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;
export type Tone = z.infer<typeof ToneSchema>;
export type LanguageMode = z.infer<typeof LanguageModeSchema>;

/* ---------- Agent HTTP API (laptop agent) ---------- */
export const AgentJoinRequestSchema = z.object({
  agentSessionId: z.string().min(8).max(64).regex(/^[\w-]+$/),
  meetingUrl: z.string().url(),
  /** Accepted for older clients; the agent enforces MEET_AGENT_NAME. */
  displayName: z.string().min(1).max(80),
  voice: z.string().min(1).max(40).optional(),
  speed: z.number().min(0.8).max(1.2).optional(),
  /** From POST /api/agent/ticket. Required when the agent runs with AGENT_TICKET_SECRET. */
  ticket: z.string().max(2000).nullable().optional(),
}).strict();

export const AgentUtteranceRequestSchema = z.object({ text: z.string().trim().min(1).max(1500) }).strict();

export const AgentSessionViewSchema = z.object({
  agentSessionId: z.string(),
  status: AgentStatusSchema,
  detail: z.string().nullable(),
  /** The utterance being spoken now, if any. */
  playing: z.string().nullable(),
  /** The last utterance that finished, and how. */
  lastPlayback: z.object({ utteranceId: z.string(), result: z.enum(["ended", "stopped", "unmute_failed"]) }).nullable(),
  /** Actionable Google sign-in or display-name problem. */
  reason: AgentProblemReasonSchema.nullable().optional(),
}).strict();

export type AgentJoinRequest = z.infer<typeof AgentJoinRequestSchema>;
export type AgentSessionView = z.infer<typeof AgentSessionViewSchema>;

/* ---------- Speak for me voices (Kokoro-82M ids) ---------- */
export const AGENT_VOICES = [
  { id: "af_heart", name: "Heart", accent: "American", gender: "female" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "female" },
  { id: "bf_emma", name: "Emma", accent: "British", gender: "female" },
  { id: "am_michael", name: "Michael", accent: "American", gender: "male" },
  { id: "am_fenrir", name: "Fenrir", accent: "American", gender: "male" },
  { id: "bm_george", name: "George", accent: "British", gender: "male" },
] as const;
export type AgentVoiceId = typeof AGENT_VOICES[number]["id"];
export const DEFAULT_AGENT_VOICE: AgentVoiceId = "af_heart";
export const isAgentVoiceId = (value: string): value is AgentVoiceId => AGENT_VOICES.some((voice) => voice.id === value);
/** The agent speaks between 0.8× and 1.2×. */
export const AGENT_SPEED = { min: 0.8, max: 1.2, default: 1 } as const;
