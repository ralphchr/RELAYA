# Local setup

[← Back to Relaya](../../README.md)

## 🚀 Run locally

Choose **preview** to explore the interface, or **live speech** to use your microphone with your own API keys. The live setup runs the web app and API on your computer and connects to your personal hosted Supabase project and AI provider accounts.

### 1. Install the project

You need **Git**, **Node.js 24.x**, and **pnpm 9.15.9**. The versions are pinned in [.nvmrc](../../.nvmrc) and [package.json](../../package.json).

```sh
npm install --global pnpm@9.15.9
git clone https://github.com/ralphchr/RELAYA.git
cd RELAYA
pnpm install
```

Already cloned the project? Run `pnpm install` from its root folder. Run all commands below from that same folder.

### 2. Try the preview — no API keys needed

```sh
pnpm --filter @relaya/web dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), go to **Sign up / Login**, and choose **Continue as Guest**. Guest preview uses scripted speech and a simulated meeting agent, so it does not transcribe your recording or join a real call.

For real speech, continue below and sign in to your own account instead of using Guest.

### 3. Get your personal service credentials

| Service | What to get | Where it goes |
| :--- | :--- | :--- |
| **Supabase** | Create your own project. Copy its project URL and public **publishable** or legacy **anon** key. See the [API key guide](https://supabase.com/docs/guides/getting-started/api-keys). | `frontend/.env.local` |
| **Supabase server access** | From that same project's API key settings, copy the legacy **service_role** key. The current backend uses it as a bearer token for database calls. | `backend/.env.local` only |
| **Groq** | Create a personal key in [GroqCloud → API Keys](https://console.groq.com/keys). Required for the English rewrite and the default Whisper transcription path. | `backend/.env.local` only |
| **Gemini** *(optional)* | Create a key in [Google AI Studio](https://aistudio.google.com/apikey); see the [Gemini key guide](https://ai.google.dev/gemini-api/docs/api-key). Enables the preferred Bisaya transcription path and fallback. | `backend/.env.local` only |

Use credentials from your own projects. Provider quotas, model access, and any usage charges belong to those accounts. The Supabase backend key must be the legacy `service_role` JWT for this implementation; do not substitute a publishable key or an `sb_secret_…` key without adapting the backend's authorization headers.

### 4. Prepare Supabase

1. Open your project's **SQL Editor** and run every file in [database/migrations](../../database/migrations) in numerical order, from `0001_profiles.sql` through `0012_spoken_languages.sql`. For an existing project, apply only migrations it has not received. These create profiles, settings, plans, usage tracking, storage policies, and language preferences.
2. Enable the **Email** authentication provider. Email/password is enough to test locally. If email confirmation is enabled, confirm your address before signing in.
3. Set the local **Site URL** to `http://127.0.0.1:5173` and add these exact redirect URLs in **Authentication → URL Configuration**:

   ```text
   http://127.0.0.1:5173/auth/callback
   http://127.0.0.1:5173/auth/callback?next=/email-confirmed
   ```

See [authentication setup](../../docs/setup/AUTH_SETUP.md) for email codes, Google/Facebook OAuth, and production callbacks, and the [database guide](../../database/README.md) for migration details. OAuth provider credentials are optional for local email/password testing.

### 5. Create your local environment files

Create the following files manually and replace the placeholder values. If they already exist, edit them in place. The root [.env.example](../../.env.example) is a variable reference; the local servers read the files in their own package folders.

**`frontend/.env.local` — browser configuration**

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
VITE_API_URL=http://127.0.0.1:8787/api
```

**`backend/.env.local` — private API credentials**

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_LEGACY_SERVICE_ROLE_KEY
GROQ_API_KEY=YOUR_GROQ_API_KEY
ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
STT_PROVIDER=auto

# Optional: enables Gemini transcription and fallback.
GEMINI_API_KEY=
```

> [!IMPORTANT]
> Only public browser configuration belongs in `VITE_` variables. Never put a Groq key, Gemini key, Supabase service-role key, or agent secret there. Local `.env.local` files are Git-ignored; keep their real values out of commits, screenshots, and issue reports.

The frontend and backend must use the **same Supabase project**. Keep `127.0.0.1` consistent when opening the app and configuring authentication. If you use `localhost` instead, add its exact callback URLs in Supabase too. Restart the affected server whenever you change an environment file.

### 6. Start live speech

**Terminal 1 — API**

```sh
pnpm --filter @relaya/backend dev
```

**Terminal 2 — web app**

```sh
pnpm --filter @relaya/web dev
```

1. Open [API health](http://127.0.0.1:8787/api/health). It should return JSON with `"ok": true`; this confirms the API is running, not that provider credentials are valid.
2. Open [Relaya locally](http://127.0.0.1:5173), create an account, and sign in.
3. Start a **Say it yourself** session and allow microphone access.
4. Hold **Space** while speaking, then release. Your draft should reflect your recording.
5. Review the transcript and English sentence before using them. Under **Settings → Preferences → Spoken languages**, select your input language; choose **Bisaya and English** to use the Gemini path when configured.

Keep both terminals running. The browser sends recordings to the local API; the API calls the speech providers. Local development uses the scripted pipeline when `VITE_API_URL` is unset, and Guest preview stays scripted even when it is set.

<details>
<summary id="meet-agent"><strong>🔊 Optional: run the Google Meet agent</strong></summary>

Complete the live setup above first. The agent runs separately on your laptop and uses Kokoro for local text-to-speech; its first voice-model download needs an internet connection. No extra TTS API key is required.

1. Use an installed Google Chrome, or install Playwright Chromium:

   ```sh
   pnpm --filter @relaya/agent exec playwright install chromium
   ```

2. Create a dedicated bot Google account named **RELAYA AI**, then sign it in:

   ```sh
   pnpm --filter @relaya/agent setup-account
   ```

3. Generate two different secrets by running this command twice. Use the first for `AGENT_TICKET_SECRET` and the second for `AGENT_SERVICE_KEY`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Add both values to `backend/.env.local`. Create `agent/.env.local` with the **same two values**:

   ```dotenv
   AGENT_TICKET_SECRET=YOUR_GENERATED_TICKET_SECRET
   AGENT_SERVICE_KEY=YOUR_GENERATED_SERVICE_KEY
   API_URL=http://127.0.0.1:8787
   AGENT_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
   ```

   `API_URL` here is the server origin, without `/api`.

5. Add `VITE_AGENT_URL=http://127.0.0.1:8788` to `frontend/.env.local`. Restart the API and web app, then start a third terminal:

   ```sh
   pnpm --filter @relaya/agent dev
   ```

6. Check [agent health](http://127.0.0.1:8788/healthz), then choose **Speak for me** in the app. Paste a Google Meet link, admit **RELAYA AI** as the host, and approve a draft to hear it in the meeting.

Without `VITE_AGENT_URL`, the app uses the simulated agent. See the [agent guide](../../agent/README.md) for join tests, voice selection, troubleshooting, and session limits.

</details>

### 🧩 Troubleshooting

| What you see | What to check |
| :--- | :--- |
| Scripted text instead of your words | Sign in instead of continuing as Guest, set `VITE_API_URL`, and restart Vite. |
| Browser network or CORS error | Keep both servers running. Include the exact browser origin in `ALLOWED_ORIGINS` and keep `/api` in `VITE_API_URL`. |
| Login or confirmation redirects fail | Match the Supabase project in both files; allow the exact local callback URLs and confirm your email if required. |
| Missing profile, plan, or language settings | Apply all outstanding database migrations in order. |
| Provider authentication, model, or quota error | Check your own Groq/Gemini credentials, model access, and provider quota. Check the API terminal for the failing stage. |
| `QUOTA_EXCEEDED` from Relaya | Relaya's database plan limits also apply locally, independently of your personal provider quota. |
| Microphone unavailable | Allow browser microphone permission and use the local loopback URL or HTTPS. |

For provider selection, model overrides, fallbacks, and latency debugging, see the [live speech pipeline guide](../../docs/setup/SPEECH_PIPELINE.md).
