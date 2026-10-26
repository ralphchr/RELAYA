/*
 * Agent step 3: hear the agent's voice.
 *
 *   pnpm --filter @relaya/agent say "We'll probably finish next week." [--voice af_heart] [--speed 1]
 *
 * Saves a .wav in agent/.audio/ and prints its path. Nothing joins a call.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWav } from "../audio/wav.js";
import { DEFAULT_VOICE, isVoiceId, loadTts, synthesizeSentences, VOICES, type Speech } from "../audio/tts.js";

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const voice = flag("voice") ?? DEFAULT_VOICE;
  const speed = Number(flag("speed") ?? 1);
  const text = argv.join(" ").trim();

  if (!text) throw new Error(`Type the sentence after the command, e.g. pnpm --filter @relaya/agent say "We'll probably finish next week."`);
  if (!isVoiceId(voice)) throw new Error(`Unknown voice "${voice}". Choose one of:\n${Object.entries(VOICES).map(([id, label]) => `  ${id}  ${label}`).join("\n")}`);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("--speed must be between 0.5 and 2.");

  console.log("Loading the voice (the first run downloads ~80 MB, then it's cached)…");
  let lastProgress = "";
  const started = performance.now();
  await loadTts((message) => { if (message !== lastProgress) { lastProgress = message; process.stdout.write(`\r${message}   `); } })
    .catch((error: unknown) => {
      throw new Error(/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|403|network/i.test(String(error))
        ? "Couldn't download the voice model from Hugging Face. Check your internet connection and try again."
        : `Couldn't load the voice model: ${error instanceof Error ? error.message : String(error)}`);
    });
  if (lastProgress) process.stdout.write("\n");
  console.log(`Voice ready in ${((performance.now() - started) / 1000).toFixed(1)} s. Speaking with ${VOICES[voice]}…`);

  const t = performance.now();
  // Same as the meeting: sentence by sentence. The first one is when the agent could start talking.
  const parts: Speech[] = [];
  for await (const part of synthesizeSentences(text, { voice, speed })) {
    if (!parts.length) console.log(`First sentence ready in ${((performance.now() - t) / 1000).toFixed(1)} s (the agent would start talking here).`);
    parts.push(part);
  }
  const samples = new Float32Array(parts.reduce((n, p) => n + p.samples.length, 0));
  parts.reduce((at, p) => { samples.set(p.samples, at); return at + p.samples.length; }, 0);
  const speech = { samples, sampleRate: parts[0]!.sampleRate, durationMs: Math.round((samples.length / parts[0]!.sampleRate) * 1000) };
  const dir = join(process.cwd(), ".audio");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `say-${Date.now()}.wav`);
  writeFileSync(file, encodeWav(speech.samples, speech.sampleRate));
  console.log(`✅ ${(speech.durationMs / 1000).toFixed(1)} s of speech in ${parts.length} sentences, all made in ${((performance.now() - t) / 1000).toFixed(1)} s.`);
  console.log(`Saved: ${file}`);
  console.log(process.platform === "win32" ? `Play it: start "" "${file}"` : `Play it by opening that file.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
