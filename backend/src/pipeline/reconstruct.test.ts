import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineError, reconstruct, reconstructTranscript } from "./reconstruct.js";
import * as liveSpeech from "./liveTranscribe.js";

const audio = new File([new Uint8Array(2000)], "a.webm", { type: "audio/webm" });
const input = { audio, durationMs: 2000, tone: "professional" as const, languageMode: "auto" as const, names: [] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const draft = {
  sentence: "We will finish next week.", hedgedSentence: "We'll probably finish next week.", languages: ["ceb", "en"],
  facts: { numbers: [], dates: ["next week"], names: [], negations: [], hedges: ["siguro"], commitments: [] },
  confidence: 0.9, unresolvedTerms: [],
};
const stt = () => json(200, { text: "Siguro ma-finish nato next week." });
const chat = (body: unknown) => json(200, { choices: [{ message: { content: JSON.stringify(body) } }] });
const invalid = () => json(400, { error: { code: "json_validate_failed", message: "Failed to validate JSON." } });
const addedLanguages = [
  { mode: "japanese_english", code: "ja", hint: "ja-JP", name: "Japanese", transcript: "たぶん来週までに完了します。", hedge: "たぶん" },
  { mode: "mandarin_english", code: "zh", hint: "cmn-Hans-CN", name: "Mandarin Chinese", transcript: "我们可能下周完成。", hedge: "可能" },
  { mode: "spanish_english", code: "es", hint: "es-ES", name: "Spanish", transcript: "Tal vez terminemos la próxima semana.", hedge: "Tal vez" },
] as const;
const multilingualDraft = (code: string, hedge: string) => ({
  ...draft, sentence: "We will probably finish next week.", hedgedSentence: "We will probably finish next week.",
  languages: [code], facts: { ...draft.facts, hedges: [hedge] },
});

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test"); vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("STT_PROVIDER", "auto");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("reconstruct", () => {
  it.each(addedLanguages)("transcribes $name without losing the original script and returns English for review", async ({ mode, code, name, transcript, hedge }) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { text: transcript })).mockResolvedValueOnce(chat(multilingualDraft(code, hedge)));
    const result = await reconstruct({ ...input, languageMode: mode });
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("prompt")).toContain(`${name} and English`);
    expect(form.has("language")).toBe(false);
    expect(result.transcript).toBe(transcript);
    expect(result.sentence.literal).toBe(transcript);
    expect(result.languages).toEqual([code]);
    expect(result.sentence.text).toBe("We will probably finish next week.");
    expect(result.guard).toMatchObject({ status: "unsure", needsVerify: true, kept: [] });
    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: { content: string }[];
      response_format: { json_schema: { schema: { properties: { languages: { items: { enum: string[] } } } } } };
    };
    expect(request.messages[0]?.content).toContain(name);
    expect(request.response_format.json_schema.schema.properties.languages.items.enum).toContain(code);
  });

  it.each(addedLanguages)("provides $name and English hints to Gemini", async ({ mode, code, hint, transcript, hedge }) => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.stubEnv("STT_PROVIDER", "gemini");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { output_text: transcript })).mockResolvedValueOnce(chat(multilingualDraft(code, hedge)));
    await reconstruct({ ...input, languageMode: mode });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      generation_config: { transcription_config: { language_codes: string[] } };
    };
    expect(request.generation_config.transcription_config.language_codes).toEqual([hint, "en-US"]);
  });

  it.each(addedLanguages)("keeps the $name selection when falling back from Gemini to Whisper", async ({ mode, code, name, transcript, hedge }) => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.stubEnv("STT_PROVIDER", "gemini");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { text: transcript })).mockResolvedValueOnce(chat(multilingualDraft(code, hedge)));
    const result = await reconstruct({ ...input, languageMode: mode });
    const form = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(form.get("prompt")).toContain(`${name} and English`);
    expect(result.transcript).toBe(transcript);
  });

  it.each(addedLanguages)("handles auto-detected $name and English mixed speech", async ({ code, name, transcript, hedge }) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { text: `${transcript} Thank you.` }))
      .mockResolvedValueOnce(chat({ ...multilingualDraft(code, hedge), languages: [code, "en"] }));
    const result = await reconstruct(input);
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("prompt")).toContain(name);
    expect(result.languages).toEqual([code, "en"]);
    expect(result.guard.status).toBe("unsure");
  });

  it.each(addedLanguages)("rebuilds corrected $name text without audio recognition", async ({ code, transcript, hedge }) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chat(multilingualDraft(code, hedge)));
    const result = await reconstructTranscript({ transcript, tone: "professional", names: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.transcript).toBe(transcript);
    expect(result.languages).toEqual([code]);
    expect(result.guard.status).toBe("unsure");
  });

  it("uses a Cebuano-matched transcription prompt when Bisaya is selected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    await reconstruct({ ...input, languageMode: "bisaya_english" });
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("prompt")).toContain("Cebuano (Bisaya) and English");
    expect(form.get("prompt")).toContain("wala pa nato na-test");
    expect(form.has("language")).toBe(false);
  });

  it("uses Gemini Transcribe with Cebuano and English hints and glossary vocabulary when configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { output_text: "Maayo, we'll finish this later." })).mockResolvedValueOnce(chat({
      ...draft, sentence: "We can finish this later.", hedgedSentence: "We can finish this later.", facts: { ...draft.facts, dates: [], hedges: [] },
    }));
    const result = await reconstruct({ ...input, languageMode: "bisaya_english" });
    const [url, init] = fetchMock.mock.calls[0]!;
    const request = JSON.parse(String(init?.body)) as { model: string; input: unknown[]; generation_config: { transcription_config: { language_codes: string[]; custom_vocabulary: string[] } } };
    expect(String(url)).toContain("generativelanguage.googleapis.com/v1beta/interactions");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-test");
    expect(request.model).toBe("gemini-3.5-transcribe");
    expect(request.generation_config.transcription_config.language_codes).toEqual(["ceb", "en-US"]);
    expect(request.generation_config.transcription_config.custom_vocabulary).toContain("Relaya");
    expect(result.transcript).toBe("Maayo, we'll finish this later.");
  });

  it("falls back to Whisper if Gemini transcription is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(503, { error: { code: 503 } })).mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    const result = await reconstruct({ ...input, languageMode: "bisaya_english" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("api.groq.com/openai/v1/audio/transcriptions");
    expect(result.transcript).toBe("Siguro ma-finish nato next week.");
  });

  it("doesn't call the product's name or a known name unclear", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { text: "Okay na ang build ni Ralph sa RELAYA." }))
      .mockResolvedValueOnce(chat({ ...draft, sentence: "Ralph's Relaya build is ready.", hedgedSentence: "Ralph's Relaya build is ready.",
        facts: { ...draft.facts, dates: [], hedges: [], names: ["Ralph"] }, unresolvedTerms: ["RELAYA", "ralph"] }));
    const result = await reconstruct({ ...input, names: ["Ralph"] });
    expect(result.guard.status).toBe("clear");
  });
});

describe("speech latency and provider routing", () => {
  it("uses live transcription for Bisaya WAV, then the existing English rewrite", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.spyOn(liveSpeech, "pcmFromWav").mockReturnValue(Buffer.alloc(4));
    const live = vi.spyOn(liveSpeech, "transcribeLive").mockResolvedValue("Wala pa nahuman ang report.");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chat(draft));
    const result = await reconstruct({ ...input, audio: new File([new Uint8Array(48)], "speech.wav", { type: "audio/wav" }), languageMode: "bisaya_english" });
    expect(live).toHaveBeenCalledWith("gemini-test", expect.any(Buffer), ["Relaya"], ["ceb", "en-US"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("chat/completions");
    expect(result.transcript).toBe("Wala pa nahuman ang report.");
  });

  it("falls straight back to Whisper if the live connection fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.spyOn(liveSpeech, "pcmFromWav").mockReturnValue(Buffer.alloc(4));
    vi.spyOn(liveSpeech, "transcribeLive").mockRejectedValue(new Error("Unavailable"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    await reconstruct({ ...input, audio: new File([new Uint8Array(48)], "speech.wav", { type: "audio/wav" }), languageMode: "bisaya_english" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("audio/transcriptions");
  });

  it.each(["auto", "tagalog_english", "japanese_english", "mandarin_english", "spanish_english"] as const)("uses Whisper directly for %s even with Gemini configured", async (languageMode) => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    await reconstruct({ ...input, languageMode });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("audio/transcriptions");
    expect((fetchMock.mock.calls[0]?.[1]?.body as FormData).get("response_format")).toBe("json");
  });

  it("allows deployments to force Whisper for Bisaya", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    vi.stubEnv("STT_PROVIDER", "whisper");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    await reconstruct({ ...input, languageMode: "bisaya_english" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("audio/transcriptions");
  });

  it("falls back to Gemini when the default Whisper path fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(200, { output_text: "We will finish next week." })).mockResolvedValueOnce(chat(draft));
    const result = await reconstruct(input);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("generativelanguage.googleapis.com");
    expect(result.transcript).toBe("We will finish next week.");
  });

  it("does not send another paid request after a Whisper rate limit", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(429, {}));
    await expect(reconstruct(input)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled Gemini response body before falling back to Whisper", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GEMINI_API_KEY", "gemini-test");
    const stalled = json(200, {});
    vi.spyOn(stalled, "json").mockImplementation(() => new Promise(() => undefined));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stalled).mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    const pending = reconstruct({ ...input, languageMode: "bisaya_english" });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).transcript).toBe("Siguro ma-finish nato next week.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("Speech provider request failed", expect.objectContaining({ stage: "gemini-stt", reason: "timeout" }));
  });

  it("returns a timeout when rewrite response headers arrive but the body stalls", async () => {
    vi.useFakeTimers();
    const stalled = json(200, {});
    vi.spyOn(stalled, "json").mockImplementation(() => new Promise(() => undefined));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(stalled);
    const pending = reconstruct(input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ code: "TIMEOUT", status: 504, retryable: true });
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs stage timings without transcript or generated text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(chat(draft));
    await reconstruct(input);
    expect(console.info).toHaveBeenCalledWith("Speech provider timing", expect.objectContaining({ stage: "whisper-stt", status: 200 }));
    expect(console.info).toHaveBeenCalledWith("Speech provider timing", expect.objectContaining({ stage: "rewrite", status: 200 }));
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).not.toContain("Siguro");
    expect(logs).not.toContain(draft.sentence);
  });
});

describe("reconstruct with Groq failures", () => {
  it("rebuilds an edited transcript without sending audio to speech recognition", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chat(draft));
    const result = await reconstructTranscript({ transcript: "Siguro ma-finish nato next week.", tone: "professional", names: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("chat/completions");
    expect(result.transcript).toBe("Siguro ma-finish nato next week.");
    expect(result.sentence.literal).toBe(result.transcript);
  });

  it("retries once when Groq rejects the JSON, then flags the dropped hedge", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(invalid()).mockResolvedValueOnce(chat(draft));
    const result = await reconstruct(input);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.guard.status).toBe("flagged");
    expect(result.guard.issues[0]?.fix.label).toBe("Keep “probably”");
  });

  it("returns a retryable LLM_FAILED error instead of crashing when both attempts fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(invalid()).mockResolvedValueOnce(invalid());
    const error = await reconstruct(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error).toMatchObject({ code: "LLM_FAILED", retryable: true });
  });

  it("maps a rate limit to RATE_LIMITED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(stt()).mockResolvedValueOnce(json(429, { error: { code: "rate_limit_exceeded", message: "slow down" } }));
    await expect(reconstruct(input)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("does not leave an unhandled rejection when speech-to-text fails", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(400, { error: { message: "bad audio" } }));
    await expect(reconstruct(input)).rejects.toMatchObject({ code: "STT_FAILED" });
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
