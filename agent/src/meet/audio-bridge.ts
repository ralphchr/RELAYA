import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import type { Speech } from "../audio/tts.js";

/*
 * The agent's microphone. Every page gets a replacement for
 * getUserMedia whose audio track comes from a Web Audio channel only Relaya
 * plays into. The laptop's real microphone, and Chrome's fake test-tone mic,
 * are never used: when nothing is playing, the agent's mic is pure silence.
 * The camera is a drawn name card ("<name>", AI agent), never Chrome's fake
 * camera (a green test pattern). It only ever shows in the bot's own pre-join
 * preview: the agent won't join until the camera is off. Meet mirrors that
 * preview like a selfie camera, so the card is drawn mirrored to read right.
 */
/*
 * Kept as plain JavaScript text on purpose: a TypeScript function passed to
 * addInitScript gets helper calls injected by the TS runner (tsx/esbuild),
 * which don't exist inside the page and silently break the whole script.
 */
const BRIDGE_SOURCE = String.raw`(() => {
  if (window.__relaya) return;
  let ctx = null;
  let bus = null;
  let current = null;

  const audio = () => {
    if (!ctx) { ctx = new AudioContext(); bus = ctx.createGain(); }
    if (ctx.state === "suspended") ctx.resume();
    return { ctx, bus };
  };

  /*
   * The name card: Relaya's cream background, the logo with a slow pulse, the
   * agent's full name (always labeled AI), an animated "getting ready" line,
   * and a note not to touch the window. Drawn at 1280x720, mirrored for Meet's
   * selfie-style preview, and kept clear of Meet's name label and buttons.
   */
  let card = null;
  const cardStream = () => {
    if (card) return card;
    const W = 1280, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    const given = (window.__relayaCardName || "Relaya").trim();
    const name = /(\(AI\)|\bAI)$/.test(given) ? given : given + " (AI)";
    const logo = new Image();
    if (window.__relayaLogo) logo.src = window.__relayaLogo;
    const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
    const INK = "#443A41", MUTED = "#7B6F76";
    const started = performance.now();

    const glow = (x, y, r, color) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color); grad.addColorStop(1, "rgba(255,248,243,0)");
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const pill = (x, y, w, h, fill, stroke) => {
      g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fillStyle = fill; g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
    };
    const fit = (text, weight, size, max) => {
      let s = size;
      do { g.font = weight + " " + s + "px " + FONT; } while (g.measureText(text).width > max && (s -= 2) > 24);
      return s;
    };

    const draw = () => {
      const t = (performance.now() - started) / 1000;
      g.setTransform(-1, 0, 0, 1, W, 0); // pre-mirrored
      g.fillStyle = "#FFF8F3"; g.fillRect(0, 0, W, H);
      glow(1090, 120, 420, "rgba(243,166,181,0.55)");
      glow(170, 640, 380, "rgba(247,215,168,0.55)");
      // Soft shade at the top so Meet's white name label stays readable.
      const shade = g.createLinearGradient(0, 0, 0, 110);
      shade.addColorStop(0, "rgba(68,58,65,0.28)"); shade.addColorStop(1, "rgba(68,58,65,0)");
      g.fillStyle = shade; g.fillRect(0, 0, W, 110);
      g.textAlign = "center"; g.textBaseline = "middle";

      // Logo with a slow pulse ring.
      const cx = W / 2, cy = 236;
      const pulse = (t % 2.4) / 2.4;
      g.beginPath(); g.arc(cx, cy, 78 + pulse * 46, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,107,139," + (0.35 * (1 - pulse)).toFixed(3) + ")"; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(cx, cy, 78, 0, Math.PI * 2); g.fillStyle = "#FFFFFF"; g.fill();
      g.strokeStyle = "rgba(233,220,216,1)"; g.lineWidth = 2; g.stroke();
      if (logo.complete && logo.naturalWidth) g.drawImage(logo, cx - 44, cy - 44, 88, 88);

      // The agent's name.
      const size = fit(name, "800", 64, 1000);
      g.font = "800 " + size + "px " + FONT; g.fillStyle = INK; g.textAlign = "center";
      g.fillText(name, cx, 398);

      // Status with animated dots.
      const dots = ".".repeat(1 + (Math.floor(t * 2) % 3));
      g.font = "500 26px " + FONT; g.fillStyle = MUTED; g.textAlign = "left";
      const status = "Getting ready to join the meeting";
      const sw = g.measureText(status + "...").width;
      g.fillText(status + dots, cx - sw / 2, 462);

      // Don't-touch note.
      g.textAlign = "center"; g.font = "600 21px " + FONT;
      const note = "Relaya is setting up. Please don't click anything in this window.";
      const nw = g.measureText(note).width + 56;
      pill(cx - nw / 2, 506, nw, 48, "rgba(255,255,255,0.92)", "rgba(233,220,216,1)");
      g.fillStyle = INK; g.fillText(note, cx, 531);
    };
    draw();
    setInterval(draw, 66);
    card = canvas.captureStream(15);
    return card;
  };

  // Meet's round mic and camera buttons sit on top of the name card. Make them
  // invisible but keep them in place: the agent still clicks them to turn the
  // mic and camera off (transparent elements still count as visible and clickable).
  const hideToggles = () => {
    const style = document.createElement("style");
    style.textContent = 'button[aria-label*="microphone" i], button[aria-label*="camera" i], [role="button"][aria-label*="microphone" i], [role="button"][aria-label*="camera" i] { opacity: 0 !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hideToggles, { once: true });
  else hideToggles();

  // Chrome calls the stand-in devices "Fake Default Audio Input" and the like.
  // Give them names that say what they are; ids and everything else stay the same.
  const LABELS = { audioinput: "Relaya voice", audiooutput: "Relaya speaker", videoinput: "Relaya name card" };
  const listDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () => (await listDevices()).map((device) => new Proxy(device, {
    get(target, prop) {
      if (prop === "label") return target.label ? LABELS[target.kind] || target.label : "";
      if (prop === "toJSON") return () => ({ deviceId: target.deviceId, groupId: target.groupId, kind: target.kind, label: target.label ? LABELS[target.kind] || target.label : "" });
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }));

  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const out = new MediaStream();
    if (constraints && constraints.audio) {
      const a = audio();
      const destination = a.ctx.createMediaStreamDestination();
      a.bus.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => out.addTrack(track));
    }
    if (constraints && constraints.video) {
      cardStream().getVideoTracks().forEach((track) => out.addTrack(track.clone()));
    }
    return out;
  };

  const stop = () => {
    if (!current) return;
    const c = current;
    current = null;
    c.source.onended = null;
    try { c.source.stop(); } catch (e) { /* already stopped */ }
    c.done("stopped");
  };

  window.__relaya = {
    play(base64, sampleRate) {
      stop();
      const a = audio();
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const samples = new Float32Array(bytes.buffer);
      const buffer = a.ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = a.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(a.bus);
      return new Promise((resolve) => {
        current = { source, done: resolve };
        source.onended = () => { if (current && current.source === source) { current = null; resolve("ended"); } };
        source.start();
      });
    },
    stop,
    playing: () => current !== null,
  };
})();`;

/** The Relaya mark, shown on the name card. */
const LOGO = `data:image/png;base64,${readFileSync(fileURLToPath(new URL("../../../frontend/public/assets/relaya-logo.png", import.meta.url))).toString("base64")}`;

/** Give every page in this context the agent's microphone and name-card camera. Call before opening Meet. */
export async function installAudioBridge(context: BrowserContext, cardName?: string): Promise<void> {
  await context.addInitScript({ content: `window.__relayaLogo = ${JSON.stringify(LOGO)};${cardName ? ` window.__relayaCardName = ${JSON.stringify(cardName)};` : ""}` });
  await context.addInitScript({ content: BRIDGE_SOURCE });
}

/** Play speech into the agent's microphone. Resolves when it finishes or is stopped. */
export async function playInPage(page: Page, speech: Speech): Promise<"ended" | "stopped"> {
  const bytes = Buffer.from(speech.samples.buffer, speech.samples.byteOffset, speech.samples.byteLength);
  return page.evaluate(
    ([base64, rate]) => (window as unknown as { __relaya: { play(b: string, r: number): Promise<"ended" | "stopped"> } }).__relaya.play(base64, rate),
    [bytes.toString("base64"), speech.sampleRate] as const,
  );
}

/** Cut the current speech immediately. */
export async function stopInPage(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __relaya?: { stop(): void } }).__relaya?.stop()).catch(() => undefined);
}
