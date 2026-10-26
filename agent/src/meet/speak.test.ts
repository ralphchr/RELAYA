import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { Speech } from "../audio/tts.js";

const played: number[] = [];
const mutes: string[] = [];
vi.mock("./join.js", () => ({ setMicInCall: vi.fn(async (_page: unknown, on: boolean) => { mutes.push(on ? "on" : "off"); return true; }) }));
vi.mock("./audio-bridge.js", () => ({
  playInPage: vi.fn(async (_page: unknown, speech: Speech) => { played.push(speech.durationMs); return "ended"; }),
  stopInPage: vi.fn(async () => undefined),
}));
const { speakInMeet, stopSpeaking } = await import("./speak.js");

const page = { waitForTimeout: async () => undefined, viewportSize: () => ({ width: 1280, height: 720 }), mouse: { move: async () => undefined } } as unknown as Page;
const part = (ms: number): Speech => ({ samples: new Float32Array(1), sampleRate: 24000, durationMs: ms });

beforeEach(() => { played.length = 0; mutes.length = 0; });

describe("speakInMeet", () => {
  it("plays every sentence in order, unmuting once and re-muting at the end", async () => {
    async function* sentences() { yield part(1); yield part(2); yield part(3); }
    expect(await speakInMeet(page, sentences())).toBe("ended");
    expect(played).toEqual([1, 2, 3]);
    expect(mutes).toEqual(["on", "off"]);
  });

  it("stops while the next sentence is still being voiced, and re-mutes", async () => {
    let release: () => void = () => undefined;
    async function* sentences() { yield part(1); await new Promise<void>((r) => { release = r; }); yield part(2); }
    const speaking = speakInMeet(page, sentences());
    await new Promise((r) => setTimeout(r, 0));
    await stopSpeaking(page);
    expect(await speaking).toBe("stopped");
    release();
    expect(played).toEqual([1]);
    expect(mutes).toHaveLength(2);
  });
});
