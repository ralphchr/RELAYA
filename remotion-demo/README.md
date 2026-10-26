# Relaya product demo

20 seconds · 1920 × 1080 · 30 FPS · H.264 MP4 with AAC audio.

## Preview and render

From the repository root, in PowerShell:

```powershell
cd remotion-demo
npm ci
npm run preview
npm run render
```

The final video is `out/relaya-demo.mp4`. The composition is `RelayaDemo`.
To render a representative image: `npm run still`.
The configuration automatically uses installed Windows Chrome when available.
To explicitly choose a browser executable:

```powershell
npm run render -- --browser-executable="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

## Storyboard

| Time | Scene |
| --- | --- |
| 0–4s | Illustrated simulated meeting, Filipino VA and UK client; original mixed Cebuano-English sentence. |
| 4–12s | Meeting moves aside for the actual Relaya panel; progressive transcript, language recognition, English translation, approval control and simulated meeting captions. |
| 12–16s | Animated Tagalog, Cebuano/Bisaya and English cards. |
| 16–20s | Original logo, application preview, “Relaya. Every conversation matters.” and fade to cream. |

## Application fidelity and demo scope

This isolated project imports the actual `PanelHeader`, `DraftCard`, `RelayaMark`,
`RelayaLockup`, design tokens, typography, UI primitives and session styles from
`../frontend/src`. The original logo and fonts are copied into `public`.
The existing application is not modified. Keep this folder inside the repository.

Only `tl`, `ceb` and `en` are verified in `shared/contracts/src/index.ts`.
The current `frontend/src/features/workspace/SettingsPage.tsx` exposes auto-detect,
Bisaya + English, and Tagalog + English; `backend/src/pipeline/reconstruct.ts`
contains prompts and recognition configuration for those languages.
Spanish, Mandarin and Japanese are not advertised.
Bisaya accuracy benchmarking is pending; this film makes no accuracy claim.

The current application uses hold-to-record, release-to-process and review before
approval. Progressive transcription and meeting captions in this film are
**simulated live-caption preview behavior**, not evidence that streaming captions
are shipped. The video carries an always-visible simulated-conversation label
and identifies that preview throughout the product sequence. No live meeting,
real people, customer data, authentication or backend/API calls are used.

## Audio

The included WAV files make normal preview/render fully local. Dialogue is
synthetic: Filipino `fil-PH-BlessicaNeural` for the VA and `en-US-JennyNeural` for
English translation and closing. A Filipino voice reads the scripted Cebuano
example; it is not a native Cebuano voice or a claim about Relaya's voice output.
The background music and transition sweeps are original deterministic synthesis.
No paid API key is required.

Optional audio regeneration (requires internet only for the free speech service):

```powershell
python -m pip install --target .python edge-tts
python scripts/make_audio.py --voices
```

`npm run audio` regenerates only the original music, using Python's standard library.
All animation is driven by Remotion frame values (`useCurrentFrame`, `interpolate`,
`spring` and `Sequence`); CSS animations are disabled for reproducible rendering.

## Verification

`npm run typecheck` checks TypeScript. `npm run verify` checks resolution, frame
count, FPS, duration and codecs; decodes the complete output; plays the MP4 through
to completion in installed Chrome; and saves six decoded scene screenshots plus
`out/verification.json`. This check uses the repository's existing Playwright
dependency and the Windows FFmpeg binaries bundled with Remotion.

Rendering uses lossless PNG source frames and explicit BT.709 conversion to keep
the original cream, pink and green colors consistent in standard video players.
The tiny AAC packet padding can make container duration report about 20.01 seconds;
the video itself is exactly 600 frames / 20 seconds.
