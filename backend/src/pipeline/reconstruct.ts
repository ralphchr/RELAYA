import { randomUUID } from "node:crypto";
import { LanguageCodeSchema, ReconstructResponseSchema, RewriteDraftSchema, type LanguageMode } from "@relaya/contracts";
import { evaluateGuard } from "./guard/index.js";
import { pcmFromWav, transcribeLive } from "./liveTranscribe.js";

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_MS = 60_000;
const MIN_DURATION_MS = 400;
const UPSTREAM_TIMEOUT_MS = 15_000;
const GEMINI_TIMEOUT_MS = 6_000;

export class PipelineError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "TOO_SHORT" | "TOO_LONG" | "NO_SPEECH" | "RATE_LIMITED" | "STT_FAILED" | "LLM_FAILED" | "TIMEOUT" | "INTERNAL", message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = "PipelineError";
  }
}

interface Input { audio: File; durationMs: number; tone: "casual" | "professional"; languageMode: LanguageMode; names: string[] }
interface TranscriptInput { transcript: string; tone: "casual" | "professional"; names: string[] }

export async function reconstruct(input: Input) {
  if (input.durationMs < MIN_DURATION_MS) throw new PipelineError("TOO_SHORT", "Record at least half a second of speech.", 422);
  if (input.durationMs > MAX_DURATION_MS) throw new PipelineError("TOO_LONG", "Recordings must be 60 seconds or shorter.", 413);
  if (input.audio.size === 0 || input.audio.size > MAX_AUDIO_BYTES) throw new PipelineError("INVALID_INPUT", "The recording is empty or larger than 2 MB.", 413);
  if (!input.audio.type.startsWith("audio/")) throw new PipelineError("INVALID_INPUT", "Upload a supported audio recording.", 415);
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new PipelineError("INTERNAL", "Speech processing is not configured yet.", 503);

  // The product's own name is always known, so it's never misheard or flagged as unclear.
  const names = input.names.some((n) => n.toLowerCase() === "relaya") ? input.names : [...input.names, "Relaya"];
  const startedAt = performance.now();
  const sttStartedAt = startedAt;
  const transcript = await transcribe(key, input.audio, names, input.languageMode);
  const sttMs = Math.round(performance.now() - sttStartedAt);
  if (!transcript.trim()) throw new PipelineError("NO_SPEECH", "We couldn't hear speech in that recording. Try again a little closer to your microphone.", 422);

  const llmStartedAt = performance.now();
  const rewrite = await rewriteTranscript(key, transcript, input.tone, names);
  const llmMs = Math.round(performance.now() - llmStartedAt);
  const rulesStartedAt = performance.now();
  // The guard's spans are offsets into the draft, so the draft is what we
  // return; the panel falls back to `literal` by itself when status is unsure.
  const guard = evaluateGuard({
    transcript: transcript.trim(), sentence: rewrite.sentence, hedgedSentence: rewrite.hedgedSentence, names,
    languages: rewrite.languages, facts: rewrite.facts, confidence: rewrite.confidence, unresolvedTerms: unclearTerms(rewrite.unresolvedTerms, names),
  });
  const rulesMs = Math.round(performance.now() - rulesStartedAt);
  const sentence = rewrite.sentence;

  return ReconstructResponseSchema.parse({
    sentence: { id: randomUUID(), text: sentence, wordCount: sentence.split(/\s+/).filter(Boolean).length, literal: transcript.trim() },
    transcript: transcript.trim(), languages: rewrite.languages, facts: rewrite.facts,
    confidence: rewrite.confidence, unresolvedTerms: rewrite.unresolvedTerms,
    guard,
    quota: { reconstructionsLeft: null, windowLeft: null },
    timings: { sttMs, llmMs, rulesMs, totalMs: Math.round(performance.now() - startedAt) },
  });
}

/** Rebuilds a reviewed sentence after the user corrects what speech recognition heard. */
export async function reconstructTranscript(input: TranscriptInput) {
  const transcript = input.transcript.trim();
  if (!transcript || transcript.length > 2000) throw new PipelineError("INVALID_INPUT", "Enter a transcript between 1 and 2,000 characters.", 400);
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new PipelineError("INTERNAL", "Speech processing is not configured yet.", 503);

  const names = input.names.some((name) => name.toLowerCase() === "relaya") ? input.names : [...input.names, "Relaya"];
  const startedAt = performance.now();
  const llmStartedAt = startedAt;
  const rewrite = await rewriteTranscript(key, transcript, input.tone, names);
  const llmMs = Math.round(performance.now() - llmStartedAt);
  const rulesStartedAt = performance.now();
  const guard = evaluateGuard({
    transcript, sentence: rewrite.sentence, hedgedSentence: rewrite.hedgedSentence, names,
    languages: rewrite.languages, facts: rewrite.facts, confidence: rewrite.confidence, unresolvedTerms: unclearTerms(rewrite.unresolvedTerms, names),
  });
  const rulesMs = Math.round(performance.now() - rulesStartedAt);
  return ReconstructResponseSchema.parse({
    sentence: { id: randomUUID(), text: rewrite.sentence, wordCount: rewrite.sentence.split(/\s+/).filter(Boolean).length, literal: transcript },
    transcript, languages: rewrite.languages, facts: rewrite.facts,
    confidence: rewrite.confidence, unresolvedTerms: rewrite.unresolvedTerms,
    guard,
    quota: { reconstructionsLeft: null, windowLeft: null },
    timings: { sttMs: 0, llmMs, rulesMs, totalMs: Math.round(performance.now() - startedAt) },
  });
}
/** The rewrite and Guard on typed text, no audio: for checking how a sentence is handled (scripts/tests). */
export async function rewriteText(transcript: string, tone: Input["tone"], names: string[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new PipelineError("INTERNAL", "Speech processing is not configured yet.", 503);
  const known = names.some((n) => n.toLowerCase() === "relaya") ? names : [...names, "Relaya"];
  const rewrite = await rewriteTranscript(key, transcript, tone, known);
  const guard = evaluateGuard({
    transcript, sentence: rewrite.sentence, hedgedSentence: rewrite.hedgedSentence, names: known,
    languages: rewrite.languages, facts: rewrite.facts, confidence: rewrite.confidence, unresolvedTerms: unclearTerms(rewrite.unresolvedTerms, known),
  });
  return { rewrite, guard };
}

/** A word the model calls unclear isn't, when it's one of the user's names (or Relaya). */
function unclearTerms(terms: string[], names: string[]) {
  const known = new Set(names.map((n) => n.toLowerCase()));
  return terms.filter((term) => !known.has(term.trim().toLowerCase()));
}

async function transcribe(key: string, audio: File, names: string[], languageMode: Input["languageMode"]) {
  const geminiKey = process.env.GEMINI_API_KEY;
  // Whisper is substantially faster for the general multilingual path. Keep
  // Gemini first for explicitly selected Bisaya, which Whisper often mishears.
  // A deployment can still opt into either provider for every language.
  const provider = process.env.STT_PROVIDER || "auto";
  const geminiFirst = provider === "gemini" || (provider === "auto" && languageMode === "bisaya_english");
  if (geminiFirst && geminiKey) {
    try {
      const pcm = provider === "auto" && languageMode === "bisaya_english" && audio.type === "audio/wav"
        ? pcmFromWav(await audio.arrayBuffer()) : null;
      const transcript = pcm
        ? await transcribeLive(geminiKey, pcm, names, TRANSCRIPTION_HINTS[languageMode].codes)
        : await transcribeWithGemini(geminiKey, audio, names, languageMode);
      if (transcript.trim()) return transcript;
      console.warn("Gemini transcription returned no text; falling back to Whisper");
    } catch {
      // Keep recording available if the optional provider is down or misconfigured.
      console.warn("Gemini transcription failed; falling back to Whisper");
    }
  }
  try {
    return await transcribeWithWhisper(key, audio, names, languageMode);
  } catch (error) {
    // An unavailable primary provider should not break recording when the
    // other provider is configured. Do not retry rate limits on paid services.
    if (!geminiFirst && provider !== "whisper" && geminiKey && error instanceof PipelineError && error.code !== "RATE_LIMITED") {
      console.warn("Whisper transcription failed; falling back to Gemini");
      return transcribeWithGemini(geminiKey, audio, names, languageMode);
    }
    throw error;
  }
}

const TRANSCRIPTION_HINTS: Record<LanguageMode, { codes: string[]; prompt: string }> = {
  auto: {
    codes: [],
    prompt: "Multilingual work conversation in Cebuano (Bisaya), Tagalog, English, Japanese, Mandarin Chinese, Spanish, or a mix. Preserve the languages and original scripts spoken; do not translate.",
  },
  bisaya_english: {
    codes: ["ceb", "en-US"],
    prompt: 'Cebuano (Bisaya) and English work conversation. Keep Cebuano words in Cebuano, English in English. Do not translate. Example: "Okay na ang report, pero wala pa nato na-test. Basin Monday na lang nato i-present."',
  },
  tagalog_english: {
    codes: ["fil-PH", "en-US"],
    prompt: 'Tagalog and English work conversation. Keep Tagalog words in Tagalog, English in English. Do not translate. Example: "Okay na yung report, pero hindi pa namin na-test. Sa Monday na lang natin i-present."',
  },
  japanese_english: {
    codes: ["ja-JP", "en-US"],
    prompt: 'Japanese and English work conversation. 日本語は日本語の文字で、英語は英語のまま書き起こしてください。翻訳しないでください。Example: "レポートはできましたが、まだテストしていません。Monday に確認します。"',
  },
  mandarin_english: {
    codes: ["cmn-Hans-CN", "en-US"],
    prompt: 'Mandarin Chinese and English work conversation. 中文保留汉字，英文保留英文，不要翻译，也不要转成拼音。Example: "报告已经完成了，但是还没有测试。Monday 再确认。"',
  },
  spanish_english: {
    codes: ["es-ES", "en-US"],
    prompt: 'Spanish and English work conversation. Transcribe el español en español y el inglés en inglés. No traduzcas. Example: "El informe está listo, pero todavía no lo hemos probado. Lo revisamos el Monday."',
  },
};

async function transcribeWithGemini(key: string, audio: File, names: string[], languageMode: Input["languageMode"]) {
  const hints = TRANSCRIPTION_HINTS[languageMode];
  const audioData = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const { response, payload: rawPayload } = await upstreamJson("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GEMINI_STT_MODEL || "gemini-3.5-transcribe",
      input: [
        { type: "text", text: `Transcribe the speech verbatim. ${hints.prompt} Do not summarize or polish.` },
        { type: "audio", data: audioData, mime_type: audio.type || "audio/webm" },
      ],
      generation_config: { transcription_config: {
        language_codes: hints.codes,
        custom_vocabulary: names.slice(0, 100),
      } },
    }),
  }, "gemini-stt", GEMINI_TIMEOUT_MS);
  if (!response.ok) {
    const payload = rawPayload as { error?: { code?: number } } | null;
    console.warn("Gemini transcription request failed", { status: response.status, code: payload?.error?.code ?? null });
    throw new PipelineError(response.status === 429 ? "RATE_LIMITED" : "STT_FAILED", "Speech recognition failed. Please try again.", response.status === 429 ? 429 : 502, true);
  }
  const payload = rawPayload as {
    output_text?: string;
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  } | null;
  const fromSteps = payload?.steps?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? []).filter((content) => content.type === "text")
    .map((content) => content.text ?? "").join(" ");
  return typeof payload?.output_text === "string" ? payload.output_text : fromSteps ?? "";
}

async function transcribeWithWhisper(key: string, audio: File, names: string[], languageMode: Input["languageMode"]) {
  const form = new FormData();
  form.set("file", audio, audio.name || "recording.webm");
  form.set("model", process.env.GROQ_STT_MODEL || "whisper-large-v3");
  // Only text is consumed; omit timestamps and verbose metadata.
  form.set("response_format", "json");
  form.set("temperature", "0");
  // Leave the single-language parameter unset to preserve code-switching.
  form.set("prompt", `${TRANSCRIPTION_HINTS[languageMode].prompt} Names: ${names.join(", ")}.`);
  const { response, payload: rawPayload } = await upstreamJson("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form }, "whisper-stt");
  if (!response.ok) throw upstreamFailure(response, rawPayload, "STT_FAILED", "Speech recognition failed. Please try again.").error;
  const payload = rawPayload as { text?: string } | null;
  return typeof payload?.text === "string" ? payload.text : "";
}

/*
 * Relaya proposes clear, confident English (concept note §III): as many
 * sentences as the speaker needed, up to MAX_WORDS. When the
 * speaker hedged, the confident draft drops the hedge and `hedgedSentence`
 * keeps it; Context Guard flags that change and offers the hedged version as
 * the one-tap fix, so the user decides. Everything else is never changed.
 */
const SYSTEM_PROMPT = [
  "You are Relaya. A professional on a live English call spoke a short thought in Tagalog, Bisaya (Cebuano), English, Japanese, Mandarin Chinese, Spanish, or a mix.",
  "Work out what they mean and say it the way a fluent, articulate English speaker would on a work call with international colleagues: polished, natural, and easy to follow, in the requested tone.",
  "Improve their English parts too: fix grammar, smooth the flow, vary repeated words, and split run-ons into well-formed sentences. Never translate word for word; drop filler like \"kanang\", \"ano\", \"bale\", and merge what they repeated.",
  "Say everything they said, in as many sentences as it takes; about as long as what they said, never more than 150 words.",
  "Never change, add, or drop names, numbers, approximations (\"mga\" means about), dates, negation, or commitments. Do not invent claims.",
  "Keep how strongly they meant it, not their exact words: a wish stays a wish (\"I'd like to\", \"I'm hoping to\", \"I'd love to\" are all fine for \"gusto\"/\"want\"; \"I plan to\" and \"I will\" are not), and a plan doesn't become a promise.",
  "Example. Said: \"Magandang gabi po. Gusto ko sana i-share yung update, kasi yung client gusto nila ng changes. Gusto rin nila ng meeting.\" Write: \"Good evening, everyone. I'd like to share a quick update: the client has asked for some changes, and they'd also like to set up a meeting.\"",
  "If they opened with a greeting (\"Magandang gabi po\", \"Hi everyone\"), start with the English greeting (\"Good evening,\").",
  "Keep the kind of sentence the speaker used: a question stays a question (\"ba\", \"kaya\", or a question mark means they are asking), a \"di ba\" confirmation becomes \"…, right?\", and a request stays a request. Confident never means turning a question into a statement.",
  "Certainty: if the speaker hedged (siguro, baka, yata, basin, tingali, parang, mukhang, maybe, I think), write `sentence` as the confident statement without the hedge, and write `hedgedSentence` as the same English with only the words needed to keep their uncertainty (for example \"might\", \"probably\", \"I think\"). If there was no hedge, `hedgedSentence` must equal `sentence`.",
  "For any speech containing Japanese, Mandarin Chinese, or Spanish, preserve all uncertainty in `sentence` as well as `hedgedSentence`, including たぶん, かもしれない, 可能, 也许, quizás, tal vez, and creo que. These languages require user review because the deterministic Context Guard lexicon does not yet cover them fully.",
  "`sentence` holds the whole English text, even when it is several sentences.",
  "List only the languages actually spoken in `languages`: tl for Tagalog, ceb for Cebuano, en for English, ja for Japanese, zh for Mandarin Chinese, es for Spanish. Chinese transcripts can use simplified or traditional characters; preserve names and their spelling unless an English spelling was supplied in knownNames.",
  "If you are unsure about a word, list it in unresolvedTerms. Extract facts faithfully from the transcript. Return only the requested structured object.",
].join(" ");

async function rewriteTranscript(key: string, transcript: string, tone: Input["tone"], names: string[]) {
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      sentence: { type: "string" },
      hedgedSentence: { type: "string" },
      languages: { type: "array", items: { type: "string", enum: LanguageCodeSchema.options } },
      facts: { type: "object", additionalProperties: false, properties: {
        numbers: { type: "array", items: { type: "string" } }, dates: { type: "array", items: { type: "string" } },
        names: { type: "array", items: { type: "string" } }, negations: { type: "array", items: { type: "string" } },
        hedges: { type: "array", items: { type: "string" } }, commitments: { type: "array", items: { type: "string" } },
      }, required: ["numbers", "dates", "names", "negations", "hedges", "commitments"] },
      confidence: { type: "number" }, unresolvedTerms: { type: "array", items: { type: "string" } },
    }, required: ["sentence", "hedgedSentence", "languages", "facts", "confidence", "unresolvedTerms"],
  };
  const model = process.env.GROQ_RECONSTRUCT_MODEL || "openai/gpt-oss-120b";
  const body = JSON.stringify({
    model,
    temperature: 0,
    // gpt-oss reasons before it answers and those tokens count here, so leave
    // room for the reasoning plus both sentences; keep the reasoning short.
    max_completion_tokens: 2000,
    ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    response_format: { type: "json_schema", json_schema: { name: "relaya_reconstruction", strict: true, schema } },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ tone, knownNames: names, transcript }) },
    ],
  });
  const retryMessage = "We couldn't safely shape that sentence. Please retry or use the literal transcript.";

  // On an invalid or unparseable answer, retry once.
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= REWRITE_ATTEMPTS;
    const { response, payload: rawPayload } = await upstreamJson("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    }, "rewrite");
    if (!response.ok) {
      const failure = upstreamFailure(response, rawPayload, "LLM_FAILED", retryMessage);
      if (!last && failure.upstreamCode === "json_validate_failed") continue;
      throw failure.error;
    }
    const payload = rawPayload as { choices?: Array<{ message?: { content?: string | null } }> } | null;
    const draft = parseRewrite(payload?.choices?.[0]?.message?.content);
    if (draft) return draft;
    console.warn("Rewrite answer was not a valid draft", { attempt });
    if (last) throw new PipelineError("LLM_FAILED", "We couldn't safely shape that sentence. Please retry.", 502, true);
  }
}

const REWRITE_ATTEMPTS = 2;
/** About what 60 s of speech (the recording limit) becomes in English, with room to spare. */
const MAX_WORDS = 170;

/** A schema-valid draft of at most MAX_WORDS words, or null. */
function parseRewrite(content: string | null | undefined) {
  if (!content) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  const result = RewriteDraftSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.sentence.split(/\s+/).filter(Boolean).length > MAX_WORDS) return null;
  return result.data;
}

/** Keep the deadline active through body download, not just response headers. */
async function upstreamJson(url: string, init: RequestInit, stage: string, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject before aborting so a body parser's abort cannot hide the timeout.
      reject(new PipelineError("TIMEOUT", "Speech processing took too long. Please try again.", 504, true));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      return { response, payload };
    })()]);
    console.info("Speech provider timing", { stage, durationMs: Math.round(performance.now() - startedAt), status: result.response.status });
    return result;
  } catch (error) {
    console.warn("Speech provider request failed", { stage, durationMs: Math.round(performance.now() - startedAt), reason: controller.signal.aborted ? "timeout" : "network" });
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("INTERNAL", "Speech processing is temporarily unavailable.", 503, true);
  } finally { clearTimeout(timer!); }
}

/**
 * Turn a failed Groq response into a PipelineError. Returned rather than thrown
 * so callers can `throw` it synchronously; the old async version threw a
 * rejected promise that nothing caught, which crashed the whole server.
 * Logs Groq's error code and HTTP status (never the user's words) so a failure
 * can be diagnosed from the terminal.
 */
function upstreamFailure(response: Response, rawPayload: unknown, code: "STT_FAILED" | "LLM_FAILED", message: string) {
  const payload = rawPayload as { error?: { code?: string; type?: string } } | null;
  const upstreamCode = payload?.error?.code ?? payload?.error?.type ?? null;
  console.warn("Groq request failed", { stage: code, status: response.status, code: upstreamCode });
  const error = response.status === 429
    ? new PipelineError("RATE_LIMITED", "Speech processing is busy. Wait a moment and try again.", 429, true)
    : new PipelineError(code, message, 502, response.status >= 500 || upstreamCode === "json_validate_failed");
  return { error, upstreamCode };
}
