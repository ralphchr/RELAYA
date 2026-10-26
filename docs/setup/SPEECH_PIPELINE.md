# Live speech pipeline

[← Back to the README](../../README.md)

For first-time setup, follow the [local setup walkthrough](../../README.md#-run-locally), including migrations, authentication callbacks, and `ALLOWED_ORIGINS`.

Local development uses the scripted pipeline so the UI works without paid service credentials. Production builds (or local builds with `VITE_API_URL` set) use `POST /api/reconstruct` for audio and `POST /api/reconstruct/text` after a user corrects the transcript. Configure `GROQ_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` on the API deployment; configure the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on the web app. Optionally configure `GEMINI_API_KEY` on the API for Bisaya speech recognition and provider fallback. The default fast path uses Groq Whisper for other language preferences; see **Speech latency** below for provider selection. Model names can be overridden with `GEMINI_STT_MODEL`, `GROQ_STT_MODEL`, and `GROQ_RECONSTRUCT_MODEL` (see `.env.example`). Never put provider or service role keys in a `VITE_` variable. Error reporting is off until you set `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (web) to a Sentry project's DSN; reports never include recordings, sentences or request bodies.

Neither endpoint stores recordings or transcript text. Deploy the API and web app to the same origin or set `VITE_API_URL` to the API base URL and add the web origin to `ALLOWED_ORIGINS`.

Choose **Settings → Preferences → Spoken languages** to select a language with English, or leave auto-detection enabled for mixed speech. These are spoken input languages; the interface, reconstructed text, and agent voice output remain English. Japanese and Mandarin transcripts keep their original scripts. Apply `database/migrations/0012_spoken_languages.sql` before saving the new preferences against an existing Supabase project. Japanese, Mandarin, and Spanish drafts require user review: Context Guard's deterministic meaning checks currently cover Tagalog, Bisaya, and English. The reconstruction prompt preserves uncertainty for the new languages, and their drafts do not show a fully checked verdict. Preview mode still uses scripted speech.

## Test real transcription locally

1. In `backend/.env.local`, set `SUPABASE_URL` to the project URL and `SUPABASE_SERVICE_ROLE_KEY` to the legacy `service_role` key from Supabase **Project Settings → API Keys → Legacy anon, service_role API keys**. Keep this server key private; never put it in a `VITE_` variable. Set `GROQ_API_KEY` to your Groq key and optionally `GEMINI_API_KEY` to enable Gemini Transcribe.
2. In `frontend/.env.local`, set `VITE_API_URL=http://127.0.0.1:8787/api`. The public Supabase URL and publishable key belong there too.
3. Start the API in one terminal: `pnpm --filter @relaya/backend dev`.
4. Start the web app in another terminal: `pnpm --filter @relaya/web dev`.
5. Sign into Relaya, start a **Say it yourself** session, hold **Space** while speaking, and release it. The transcript should reflect your recording rather than the scripted demo text.

The browser sends audio to the local API on port 8787; only the API contacts speech providers. Both servers must stay running while you test.

## Speech latency

`STT_PROVIDER=auto` (the default) uses Groq Whisper first for auto-detection, Tagalog, Japanese, Mandarin, and Spanish. Selecting **Bisaya and English** uses Gemini 3.5 Transcribe Live when its key is configured: the browser converts the finished recording to mono 16 kHz PCM WAV, and the API sends it with explicit speech start/end boundaries. Only finalized transcript events reach the existing GPT-OSS rewrite and Context Guard. This avoids the batch recognizer's finalization wait. Browsers that cannot convert their recording retain batch Gemini transcription. If you usually speak Bisaya, select that preference rather than relying on auto-detection. Set `STT_PROVIDER=gemini` to prefer batch Gemini for every language, or `STT_PROVIDER=whisper` to use only Whisper. Set `GEMINI_LIVE_STT_MODEL` to override the live recognizer model. The automatic path tries Gemini if Whisper fails; the Gemini live path falls back to Whisper after a failure or a four-second deadline, while the batch Gemini path retains its six-second deadline. Selecting a faster provider can affect recognition quality, so review the transcript.

The backend logs provider stage, elapsed time, and HTTP status without recordings or transcripts. In browser DevTools, inspect the reconstruction request's `Server-Timing` header for authentication, quota lookup, usage metering, transcription, rewrite, guard, pipeline, and total API time. Authentication and the quota lookup run concurrently; the quota query uses the user's bearer token and row-level security. Both must pass before speech processing starts, and successful results are still metered atomically before they return. The response JSON also includes `timings`. A large transcription duration means speech recognition is slow; a large rewrite duration means English generation is slow. A large gap between pipeline and API time points to authentication or quota calls. Browser time beyond API time includes upload, network, browser work, and any server startup delay. Provider network failures and timeouts are logged separately from HTTP errors. Deadlines cover both response headers and the response body.
