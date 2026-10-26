import { afterEach, describe, expect, it, vi } from "vitest";
import { toSpeechWav } from "./pcmAudio.js";

const original = { arrayBuffer: async () => new ArrayBuffer(8) } as Blob;
const readBytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(blob);
});
afterEach(() => vi.unstubAllGlobals());

describe("speech WAV conversion", () => {
  it("renders mono 16 kHz audio and encodes signed 16-bit PCM", async () => {
    const contexts: { channels: number; frames: number; rate: number }[] = [];
    class OfflineContext {
      destination = {};
      constructor(channels: number, frames: number, rate: number) { contexts.push({ channels, frames, rate }); }
      async decodeAudioData() { return { duration: 0.001 }; }
      createBufferSource() { return { buffer: null, connect: () => undefined, start: () => undefined }; }
      async startRendering() { return { getChannelData: () => new Float32Array([-2, -0.5, 0, 0.5, 2]) }; }
    }
    vi.stubGlobal("OfflineAudioContext", OfflineContext);
    const result = await toSpeechWav(original);
    expect(result.type).toBe("audio/wav");
    expect(contexts[1]).toEqual({ channels: 1, frames: 16, rate: 16000 });
    const view = new DataView(await readBytes(result));
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + 2 * i, true))).toEqual([-32768, -16384, 0, 16384, 32767]);
  });
  it("keeps the original recording when conversion is unavailable", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
    expect(await toSpeechWav(original)).toBe(original);
  });
  it("keeps the original recording when the browser cannot decode its format", async () => {
    vi.stubGlobal("OfflineAudioContext", class { async decodeAudioData() { throw new Error("Unsupported codec"); } });
    expect(await toSpeechWav(original)).toBe(original);
  });
});
