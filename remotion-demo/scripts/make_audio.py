"""Deterministic original music; optional free Edge speech generation.
The finished WAV assets are included, so rendering never calls a speech API.
Run `python scripts/make_audio.py --voices` to replace all audio assets.
"""
from pathlib import Path
import argparse
import asyncio
import math
import random
import struct
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'audio'
RATE = 48000


def soundtrack():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(122)
    total = RATE * 20
    data = [0.0] * total
    # Original 108 BPM, gently voiced major-seventh arpeggios.
    chords = [(146.83, 220.0, 277.18, 369.99), (123.47, 185.0, 246.94, 311.13),
              (164.81, 246.94, 329.63, 415.30), (138.59, 207.65, 277.18, 349.23)]
    beat = 60 / 108
    for step in range(70):
        at = 0.07 + step * beat / 2
        if at > 19.25:
            break
        chord = chords[(step // 16) % len(chords)]
        hz = chord[(step * 3) % 4] * (2 if step % 4 == 2 else 1)
        start = int(at * RATE)
        for j in range(min(int(1.1 * RATE), total - start)):
            t = j / RATE
            env = (1 - math.exp(-t * 170)) * math.exp(-t * 6.2)
            data[start + j] += .115 * env * (math.sin(2 * math.pi * hz * t) + .22 * math.sin(4 * math.pi * hz * t))
        if step % 4 == 0:
            for j in range(min(int(.15 * RATE), total - start)):
                t = j / RATE
                data[start + j] += .075 * math.exp(-t * 29) * math.sin(2 * math.pi * (65 * t - 50 * t * t))
    # Restrained transition sweeps, with no random state during video rendering.
    for at in (3.65, 11.65, 15.65):
        start = int(at * RATE)
        last = 0.0
        for j in range(int(.6 * RATE)):
            t = j / (.6 * RATE)
            last = .86 * last + .14 * rng.uniform(-1, 1)
            data[start + j] += last * .19 * math.sin(math.pi * t) ** 2
    pcm = bytearray()
    for i, value in enumerate(data):
        t = i / RATE
        fade = min(1, t / .4, max(0, (19.8 - t) / 1.3))
        pcm.extend(struct.pack('<h', round(max(-1, min(1, value * fade)) * 32767)))
    with wave.open(str(OUT / 'soundtrack.wav'), 'wb') as target:
        target.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        target.writeframes(pcm)
    print('Created original soundtrack.wav')


async def voices():
    sys.path.insert(0, str(ROOT / '.python'))
    import edge_tts
    ffmpeg = ROOT / 'node_modules' / '@remotion' / 'compositor-win32-x64-msvc' / 'ffmpeg.exe'
    jobs = [
        ('maya', 'fil-PH-BlessicaNeural', 'Sir, nahuman na nako ang report, pero I need to double-check the data.', '+12%', 5.1),
        ('english', 'en-US-JennyNeural', "Sir, I've finished the report, but I need to double-check the data.", '+16%', 3.65),
        ('closing', 'en-US-JennyNeural', 'Relaya. Every conversation matters.', '-4%', 2.65),
    ]
    for name, voice, text, rate, duration in jobs:
        raw = OUT / f'{name}-raw.mp3'
        if not raw.exists():
            await edge_tts.Communicate(text, voice, rate=rate).save(str(raw))
        probe = ffmpeg.with_name('ffprobe.exe')
        length = float(subprocess.check_output([str(probe), '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(raw)], text=True).strip())
        speed = max(1.0, length / duration)
        target = OUT / f'{name}.wav'
        subprocess.run([str(ffmpeg), '-y', '-v', 'error', '-i', str(raw), '-af', f'atempo={speed:.6f}', '-ar', str(RATE), '-ac', '1', str(target)], check=True)
        with wave.open(str(target), 'rb') as wav:
            params = wav.getparams()
            samples = list(struct.unpack(f'<{wav.getnframes()}h', wav.readframes(wav.getnframes())))
        for j in range(min(2160, len(samples))):
            samples[-1-j] = round(samples[-1-j] * j / 2160)
        with wave.open(str(target), 'wb') as wav:
            wav.setparams(params)
            wav.writeframes(struct.pack(f'<{len(samples)}h', *samples))
        print(f'Created {name}.wav ({length / speed:.2f}s), synthetic {voice}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--voices', action='store_true')
    options = parser.parse_args()
    soundtrack()
    if options.voices:
        asyncio.run(voices())
