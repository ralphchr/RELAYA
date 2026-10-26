/*
 * Makes the short samples the web app's Voice page plays, one per voice.
 *
 *   pnpm --filter @relaya/agent voice-samples
 *
 * Writes frontend/public/voices/<voice>.wav. Run it once (and again if the
 * voice list changes), then commit the files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_VOICES } from "@relaya/contracts";
import { encodeWav } from "../audio/wav.js";
import { loadTts, synthesize } from "../audio/tts.js";

const SAMPLE = "Hi, I'm your Relaya. I only say what you approve.";

async function main() {
  const out = join(dirname(fileURLToPath(import.meta.url)), "../../../frontend/public/voices");
  mkdirSync(out, { recursive: true });
  console.log("Loading the voice model…");
  await loadTts();
  for (const voice of AGENT_VOICES) {
    const speech = await synthesize(SAMPLE, { voice: voice.id });
    const file = join(out, `${voice.id}.wav`);
    writeFileSync(file, encodeWav(speech.samples, speech.sampleRate));
    console.log(`  ${voice.name}: ${file}`);
  }
  console.log("Done. Commit frontend/public/voices/ so everyone gets the samples.");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
