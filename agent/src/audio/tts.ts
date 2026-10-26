import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { AGENT_VOICES, DEFAULT_AGENT_VOICE, isAgentVoiceId, type AgentVoiceId } from "@relaya/contracts";

/*
 * Text to speech for Speak for me: Kokoro-82M, run offline
 * on the laptop's CPU. Free, no API key, no Groq quota. The model (~80 MB) is
 * downloaded from Hugging Face on first use and cached after that.
 */
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** The voices offered in the app's Voice page (shared with the web app). */
export const VOICES = Object.fromEntries(AGENT_VOICES.map((v) => [v.id, `${v.name} (${v.accent}, ${v.gender})`])) as Record<AgentVoiceId, string>;
export type VoiceId = AgentVoiceId;
export const DEFAULT_VOICE: VoiceId = DEFAULT_AGENT_VOICE;
export const isVoiceId = isAgentVoiceId;

export interface Speech { samples: Float32Array; sampleRate: number; durationMs: number }

let loading: Promise<KokoroTTS> | null = null;

/** Load the model once; later calls reuse it. Call early to warm it up. */
export function loadTts(onProgress?: (message: string) => void): Promise<KokoroTTS> {
  loading ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "cpu",
    progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
      if (info.status === "progress" && info.file?.endsWith(".onnx") && typeof info.progress === "number") {
        onProgress?.(`Downloading the voice model… ${Math.round(info.progress)}%`);
      }
    },
  }).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}

/**
 * Voice the text one sentence at a time, yielding each as soon as it's ready,
 * so playback can start before the rest is voiced. (A single generate() call
 * also silently cuts off after ~30 s of speech.)
 */
export async function* synthesizeSentences(text: string, options: { voice?: VoiceId; speed?: number } = {}): AsyncGenerator<Speech> {
  const clean = text.trim();
  if (!clean) throw new Error("Nothing to say.");
  const tts = await loadTts();
  // Hand stream() a closed splitter: given a plain string, kokoro-js 1.2.1 never closes its own and waits forever.
  const sentences = new TextSplitterStream();
  sentences.push(clean);
  sentences.close();
  for await (const chunk of tts.stream(sentences, { voice: options.voice ?? DEFAULT_VOICE, speed: options.speed ?? 1 })) {
    const samples = chunk.audio.audio as Float32Array;
    const sampleRate = chunk.audio.sampling_rate as number;
    yield { samples, sampleRate, durationMs: Math.round((samples.length / sampleRate) * 1000) };
  }
}

/** The whole text as one clip (for the CLI tools). */
export async function synthesize(text: string, options: { voice?: VoiceId; speed?: number } = {}): Promise<Speech> {
  const parts: Speech[] = [];
  for await (const part of synthesizeSentences(text, options)) parts.push(part);
  if (!parts.length) throw new Error("Nothing to say.");
  const samples = new Float32Array(parts.reduce((n, p) => n + p.samples.length, 0));
  let at = 0;
  for (const part of parts) { samples.set(part.samples, at); at += part.samples.length; }
  const sampleRate = parts[0]!.sampleRate;
  return { samples, sampleRate, durationMs: Math.round((samples.length / sampleRate) * 1000) };
}
