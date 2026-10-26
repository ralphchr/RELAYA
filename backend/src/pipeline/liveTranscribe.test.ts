import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pcmFromWav, transcribeLive } from "./liveTranscribe.js";

function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(40, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(4, 40); bytes.writeInt16LE(-32768, 44); bytes.writeInt16LE(32767, 46);
  return bytes;
}

class FakeSocket {
  static current: FakeSocket;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = "";
  sent: Record<string, unknown>[] = [];
  close = vi.fn();
  send(value: string) { this.sent.push(JSON.parse(value) as Record<string, unknown>); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  constructor() { FakeSocket.current = this; }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("speech WAV parsing", () => {
  it("extracts signed mono PCM samples and preserves their byte order", () => {
    expect(pcmFromWav(Uint8Array.from(wav()).buffer)).toEqual(Buffer.from([0, 128, 255, 127]));
  });
  it.each(["channels", "rate", "bits", "truncated", "not wav"])("declines %s so it can use normal transcription", (invalid) => {
    let bytes = wav();
    if (invalid === "channels") bytes.writeUInt16LE(2, 22);
    if (invalid === "rate") bytes.writeUInt32LE(48000, 24);
    if (invalid === "bits") bytes.writeUInt16LE(32, 34);
    if (invalid === "truncated") bytes = bytes.subarray(0, 47);
    if (invalid === "not wav") bytes.write("WEBM", 0);
    expect(pcmFromWav(Uint8Array.from(bytes).buffer)).toBeNull();
  });
});

describe("live speech recognition", () => {
  it("uses manual speech boundaries and waits for finalized text and generationComplete", async () => {
    const pending = transcribeLive("test", Buffer.alloc(6402), ["Relaya", "Ana"], ["ceb", "en-US"]);
    const socket = FakeSocket.current;
    socket.onopen?.();
    expect(socket.sent[0]).toMatchObject({ setup: { model: "models/gemini-3.5-transcribe-live", realtimeInputConfig: { automaticActivityDetection: { disabled: true } }, inputAudioTranscription: { languageCodes: ["ceb", "en-US"], customVocabulary: ["Relaya", "Ana"] } } });
    socket.receive({ setupComplete: {} });
    expect(socket.sent.slice(1)).toHaveLength(5); // start, three audio chunks, end
    expect(socket.sent[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityEnd: {} } });
    socket.receive({ serverContent: { interimInputTranscription: { text: "Wrong interim hypothesis" } } });
    socket.receive({ serverContent: { inputTranscription: { text: "Wala pa nahuman" } } });
    socket.receive({ serverContent: { inputTranscription: { text: "ang report." }, generationComplete: true } });
    expect(await pending).toBe("Wala pa nahuman ang report.");
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.onmessage).toBeNull();
  });
  it("recognizes the older turnComplete signal too", async () => {
    const pending = transcribeLive("test", Buffer.alloc(4), [], []);
    FakeSocket.current.receive({ serverContent: { inputTranscription: { text: "Ready." }, turnComplete: true } });
    expect(await pending).toBe("Ready.");
  });
  it("returns empty on finalized silence so the pipeline can report NO_SPEECH", async () => {
    const pending = transcribeLive("test", Buffer.alloc(4), [], []);
    FakeSocket.current.receive({ serverContent: { generationComplete: true } });
    expect(await pending).toBe("");
  });
  it("bounds the whole live request and closes its socket on timeout", async () => {
    vi.useFakeTimers();
    const pending = transcribeLive("test", Buffer.alloc(4), [], []).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toBeInstanceOf(Error);
    expect(FakeSocket.current.close).toHaveBeenCalledOnce();
  });
  it.each(["network", "closed", "provider", "bad frame"])("fails cleanly on %s without returning interim text", async (failure) => {
    const pending = transcribeLive("test", Buffer.alloc(4), [], []).catch((error: unknown) => error);
    const socket = FakeSocket.current;
    socket.receive({ serverContent: { interimInputTranscription: { text: "Unfinished" } } });
    if (failure === "network") socket.onerror?.();
    if (failure === "closed") socket.onclose?.();
    if (failure === "provider") socket.receive({ error: { code: 503 } });
    if (failure === "bad frame") socket.onmessage?.({ data: "{" });
    expect(await pending).toBeInstanceOf(Error);
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
