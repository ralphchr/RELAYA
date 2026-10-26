import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav.js";

describe("encodeWav", () => {
  it("writes a valid 16-bit mono PCM header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]), 24000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);      // PCM
    expect(wav.readUInt16LE(22)).toBe(1);      // mono
    expect(wav.readUInt32LE(24)).toBe(24000);  // sample rate
    expect(wav.readUInt16LE(34)).toBe(16);     // bits
    expect(wav.readUInt32LE(40)).toBe(10);     // 5 samples * 2 bytes
    expect(wav.length).toBe(54);
    expect([0, 1, 2, 3, 4].map((i) => wav.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});
