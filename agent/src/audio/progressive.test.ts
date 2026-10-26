import { describe, expect, it } from "vitest";
import { ProgressiveSpeech } from "./progressive.js";
import type { Speech } from "./tts.js";

const part = (ms: number): Speech => ({ samples: new Float32Array(1), sampleRate: 24000, durationMs: ms });

/** A voice that makes one sentence each time `release()` is called. */
function slowVoice(count: number) {
  const gates: (() => void)[] = [];
  let made = 0;
  async function* source() {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => gates.push(resolve));
      made++;
      yield part(1000 + i);
    }
  }
  return { source: source(), release: () => gates.shift()?.(), made: () => made };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ProgressiveSpeech", () => {
  it("is ready after the first sentence, and plays the rest as they're voiced", async () => {
    const voice = slowVoice(3);
    const speech = new ProgressiveSpeech(voice.source);
    await tick(); voice.release();
    expect((await speech.first()).durationMs).toBe(1000);
    expect(speech.done).toBe(false);

    const heard: number[] = [];
    const playing = (async () => { for await (const p of speech) heard.push(p.durationMs); })();
    await tick();
    expect(heard).toEqual([1000]);
    voice.release(); await tick(); voice.release(); await tick();
    await playing;
    expect(heard).toEqual([1000, 1001, 1002]);
    expect(speech.done).toBe(true);
  });

  it("stops voicing a cancelled draft", async () => {
    const voice = slowVoice(3);
    const speech = new ProgressiveSpeech(voice.source);
    await tick(); voice.release();
    await speech.first();
    speech.cancel();
    voice.release(); await tick(); voice.release(); await tick();
    expect(voice.made()).toBeLessThan(3);
    expect(speech.done).toBe(true);
  });

  it("rejects first() when voicing fails before any sentence", async () => {
    const failing: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("model missing")) }) };
    const speech = new ProgressiveSpeech(failing);
    await expect(speech.first()).rejects.toThrow("model missing");
  });
});
