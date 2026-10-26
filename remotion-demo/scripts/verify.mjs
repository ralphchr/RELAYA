import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
const videoPath = path.join(out, 'relaya-demo.mp4');
const binaries = path.join(root, 'node_modules/@remotion/compositor-win32-x64-msvc');
const probe = JSON.parse(execFileSync(path.join(binaries, 'ffprobe.exe'), ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', videoPath], { encoding: 'utf8' }));
const video = probe.streams.find(s => s.codec_type === 'video');
const audio = probe.streams.find(s => s.codec_type === 'audio');
if (video.width !== 1920 || video.height !== 1080 || video.r_frame_rate !== '30/1' || Number(video.nb_read_frames) !== 600 || video.codec_name !== 'h264' || audio?.codec_name !== 'aac' || Math.abs(Number(probe.format.duration) - 20) > .05) throw new Error('Unexpected video/audio metadata');
// Decode the complete file; fail immediately on a corrupted frame or audio packet.
execFileSync(path.join(binaries, 'ffmpeg.exe'), ['-v', 'error', '-xerror', '-i', videoPath, '-c:v', 'rawvideo', '-c:a', 'pcm_s16le', '-f', 'null', '-'], { stdio: 'pipe' });

const require = createRequire(import.meta.url);
const pnpmStore = path.join(root, '../node_modules/.pnpm');
const pw = fs.readdirSync(pnpmStore).find(name => name.startsWith('playwright-core@'));
if (!pw) throw new Error('Repository Playwright dependency was not found');
const { chromium } = require(path.join(pnpmStore, pw, 'node_modules/playwright-core'));
const size = fs.statSync(videoPath).size;
const server = http.createServer((req, res) => {
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : size - 1;
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  fs.createReadStream(videoPath, { start, end }).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(`<body style="margin:0"><video crossorigin="anonymous" muted playsinline preload="auto" style="width:1920px;height:1080px;display:block" src="http://127.0.0.1:${server.address().port}/video.mp4"></video></body>`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 3);
  const frames = [['problem', 2.8], ['recognition', 5.5], ['translation', 10.1], ['languages', 13.6], ['closing', 17.8], ['fade', 19.95]];
  for (const [name, time] of frames) {
    await page.evaluate(time => new Promise(resolve => { const v = document.querySelector('video'); v.addEventListener('seeked', resolve, { once: true }); v.currentTime = time; }), time);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; c.getContext('2d').drawImage(document.querySelector('video'), 0, 0); return c.toDataURL('image/png').split(',')[1]; });
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(png, 'base64'));
  }
  const playback = await page.evaluate(async () => {
    const v = document.querySelector('video');
    v.currentTime = 0;
    v.playbackRate = 1;
    await v.play();
    await new Promise((resolve, reject) => { v.addEventListener('ended', resolve, { once: true }); v.addEventListener('error', () => reject(new Error('Video playback error')), { once: true }); });
    const quality = v.getVideoPlaybackQuality();
    return { ended: v.ended, currentTime: v.currentTime, duration: v.duration, width: v.videoWidth, height: v.videoHeight, error: v.error, totalVideoFrames: quality.totalVideoFrames, droppedVideoFrames: quality.droppedVideoFrames, corruptedVideoFrames: quality.corruptedVideoFrames };
  });
  if (!playback.ended || playback.error || playback.currentTime < 19.9) throw new Error('Browser playback failed');
  const result = { verifiedAt: new Date().toISOString(), duration: Number(probe.format.duration), bytes: size, video: { codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_read_frames), pixelFormat: video.pix_fmt }, audio: { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels }, fullDecode: 'passed', playback, inspectedFrames: frames.map(([name, time]) => ({ name, time })) };
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
