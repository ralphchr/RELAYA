# Relaya agent (`@relaya/agent`)

The Speak for me agent. It joins a Google Meet as "RELAYA AI", stays muted,
and speaks a sentence only after the
user approves it. It runs on a laptop (not Vercel), because it has to stay in
the call for the whole meeting.

## Run it

```bash
pnpm install
pnpm --filter @relaya/agent dev
```

Then open http://127.0.0.1:8788/healthz. You should see `{"ok":true,...}`.

## One-time setup: the bot's Google account

Meet turns away automated browsers that aren't signed in ("You can't join
this video call"). So the agent signs in with its own Google account:

1. Create a new Gmail just for the bot (not your personal account). Set its
   first name to `RELAYA` and last name to `AI`.
2. Run `pnpm --filter @relaya/agent setup-account` and sign in to that Gmail
   in the window that opens. When Google reaches Meet, the window closes by
   itself and the terminal prints "✅ Signed in as …".

The sign-in is saved in `agent/.profile/google-session.json` (ignored by
git). Delete that file to sign out.

**Signed-in Meet uses the Google profile name.** It has no per-meeting name
override. For an existing demo account, open https://myaccount.google.com/name
while signed into that bot account and set its name to `RELAYA AI`.
This changes the name across that Google account's services.
The agent checks the name before asking to join and explains a mismatch in
the Joining screen. Guests also join as `RELAYA AI` when Meet permits guest
access. Personal names and saved app nicknames do not change the Meet name.

Google sign-ins expire. The agent checks at start and every 30 minutes and
warns "The bot's Google sign-in expired" when it has. If Meet turns the bot
away for that reason, the web app says "Relaya's Google account is signed
out". Either way, run `setup-account` again.

## Step 2: join test

Create a test meeting (meet.google.com → New meeting → Create a meeting for
later), join it yourself in a normal tab as the host, then run:

```bash
pnpm --filter @relaya/agent try-join https://meet.google.com/abc-defg-hij
```

A Chrome window opens and asks to join as "RELAYA AI" with mic and
camera off. Click **Admit** in your meeting. It stays 30 seconds (`--stay 60`
to change), then leaves. If anything goes wrong, a screenshot of what the
agent saw is saved in `agent/.debug/`.

When the app sends the agent (not `try-join`), its window minimizes to the
taskbar as soon as it asks to join: it needs no more clicks, and it keeps
talking and can still leave from there. Don't close it. To keep it on screen,
for example while debugging, add `AGENT_SHOW_WINDOW=1` to `agent/.env.local`.

It uses your installed Google Chrome. Without Chrome, run once:
`pnpm --filter @relaya/agent exec playwright install chromium`.

## Step 3: the agent's voice

```bash
pnpm --filter @relaya/agent say "We'll probably finish next week."
```

Makes a `.wav` in `agent/.audio/` with Kokoro-82M, which runs offline on the
laptop's CPU (free, no key). The first run downloads the model (~80 MB) and
caches it. Try other voices with `--voice am_michael` (also `af_bella`,
`bf_emma`, `bm_george`) and `--speed 0.9`.

## Step 4: speak in the call

```bash
pnpm --filter @relaya/agent try-speak https://meet.google.com/abc-defg-hij
```

Joins like try-join (click Admit). Then type a sentence in the terminal and
press Enter: the agent unmutes, says it, and mutes again. Type `s` + Enter to
stop it mid-sentence, `q` + Enter to leave. Default voice is `af_heart`
(`--voice` to change).

The agent's microphone is a silent virtual channel that only Relaya plays
into: the laptop's real mic and Chrome's test-tone mic are never used.

## Step 5: use it from the web app

1. Start the agent and leave that terminal open:
   ```bash
   pnpm --filter @relaya/agent dev
   ```
2. Add this line to `frontend/.env.local`, then restart the web app
   (`pnpm --filter @relaya/web dev`):
   ```
   VITE_AGENT_URL=http://127.0.0.1:8788
   ```
3. In the app: New session, Speak for me, paste the Meet link, Join Meeting.
   The Joining screen follows the real bot. Admit it in Meet, Start session,
   record a sentence, then Approve & speak for me. Stop cuts it off, Quit
   session makes it leave the call.

Without `VITE_AGENT_URL` the app uses the fake agent, so nothing changes for
teammates who don't run the bot.

The agent only accepts requests from the web app's address. If you open the
app somewhere other than `localhost:5173`, list it, comma separated:
`AGENT_ALLOWED_ORIGINS=http://localhost:5173,https://your-app.vercel.app`.
It handles one meeting at a time: a new Join replaces the old one.

## Plans, tickets and leaving on its own

When the web app talks to a real API (`VITE_API_URL` set, or production), it
asks the API for a ticket before every join. The API checks that the user is
signed in, has agreed to the Speak for me terms, and has a session left on
their plan. A session is only used up once the host admits the agent, so a
declined join costs nothing.

The agent leaves the call by itself, closes its browser, and the panel shows
"isn't in the meeting anymore" with **Rejoin** and **Use Say it yourself**,
when:
- the host removes it,
- it reaches the plan's time limit (30 minutes on Free), or
- the user runs out of sessions while it waits to be admitted.

| Setting | Where | What it does |
|---|---|---|
| `AGENT_TICKET_SECRET` | backend and agent, same value, 32+ characters | Agent refuses joins without a valid ticket. Leave unset on a single dev laptop. **Required on a server.** |
| `AGENT_SERVICE_KEY` | backend and agent, same value | Lets the agent report "admitted" so the session is counted |
| `API_URL` | agent | Where the API is, e.g. `http://127.0.0.1:8787` |

Without `AGENT_TICKET_SECRET` the API still checks the plan before a join,
but the agent accepts any join and nothing is counted. That's fine on your own
laptop and never OK on a server.

To preview these screens without the bot, open the web app with
`?mockAgent=quota`, `offline` or `left` (no `VITE_AGENT_URL`), then
`?mockAgent=off` to go back.

## Voice samples for the web app

The Voice page plays a short sample of each voice. Make them once on a
machine that can download the voice model, then commit them:

```bash
pnpm --filter @relaya/agent voice-samples
```

This writes `frontend/public/voices/<voice>.wav` (6 files, about 150 KB each).

## Build steps

1. Server + `/healthz` ✅
2. Join a Meet and wait to be admitted (`try-join`) ✅
3. Text to speech (`say`) ✅
4. Speak the approved sentence in the call, with Stop (`try-speak`) ✅
5. Connect to the web app (Join Meeting, Joining screen, Approve & speak, Stop) ✅
