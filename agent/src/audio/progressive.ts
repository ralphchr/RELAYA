import type { Speech } from "./tts.js";

/**
 * Speech that is still being voiced: sentences arrive one at a time and can be
 * played in order while the rest are made. Playback waits for a sentence that
 * isn't ready yet; cancel() stops voicing a draft that will never be played.
 */
export class ProgressiveSpeech implements AsyncIterable<Speech> {
  private parts: Speech[] = [];
  private finished = false;
  private cancelled = false;
  private error: unknown = null;
  private waiters: (() => void)[] = [];

  constructor(source: AsyncIterable<Speech>) { void this.pump(source); }

  get done() { return this.finished; }

  /** The first sentence, once voiced. Rejects if voicing failed before it. */
  async first(): Promise<Speech> {
    while (!this.parts.length && !this.finished) await this.next();
    if (this.parts[0]) return this.parts[0];
    throw this.error instanceof Error ? this.error : new Error("Nothing to say.");
  }

  cancel() { this.cancelled = true; }

  async *[Symbol.asyncIterator](): AsyncGenerator<Speech> {
    for (let i = 0; ; i++) {
      while (i >= this.parts.length && !this.finished) await this.next();
      if (i >= this.parts.length) {
        // Voicing broke partway: say what's ready rather than nothing, and note it.
        if (this.error && i > 0) console.warn("Voicing stopped partway; the rest of the sentence wasn't said.", this.error);
        return;
      }
      yield this.parts[i]!;
    }
  }

  private async pump(source: AsyncIterable<Speech>) {
    try {
      for await (const part of source) {
        if (this.cancelled) break;
        this.parts.push(part);
        this.wake();
      }
    } catch (error) {
      this.error = error;
    } finally {
      this.finished = true;
      this.wake();
    }
  }

  private next() { return new Promise<void>((resolve) => this.waiters.push(resolve)); }
  private wake() { for (const resolve of this.waiters.splice(0)) resolve(); }
}
