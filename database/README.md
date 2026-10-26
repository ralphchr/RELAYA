# Database

Supabase Postgres migrations and their tests.

| File | What it adds |
|---|---|
| `migrations/0001_profiles.sql` | `profiles` (display name, birthday), created at signup |
| `migrations/0002_core.sql` | settings, name lists, call sessions, plans, subscriptions, usage ledger, `v_usage_current` view, `consume_usage()` |
| `migrations/0003_backfill_profiles.sql` | profiles for accounts created before `0001` ran |
| `migrations/0004_agent_consent.sql` | `user_settings.agent_consented_at`, set by the API at the first Speak for me join |
| `migrations/0005_agent_name_ai_suffix.sql` | the agent's name may end in "AI" or "(AI)" (Google names can't have parentheses) |
| `migrations/0006_default_voice_heart.sql` | new accounts start with the Heart voice |
| `migrations/0007_profile_avatars.sql` | profile photo URL and private-per-user upload policies for the public avatar bucket |
| `migrations/0008_voice_preference.sql` | initial default voice preference column and signup defaults |
| `migrations/0009_gender.sql` | stores gender as the required account setting and maps it to Michael or Heart by default |
| `migrations/0010_preserve_profile_name.sql` | keeps a user's edited display name when auth metadata refreshes |
| `migrations/0011_default_glossary.sql` | renames the starter list and adds Relaya to each default glossary |
| `migrations/0012_spoken_languages.sql` | allows Japanese, Mandarin Chinese, and Spanish spoken-language preferences |

## Apply to Supabase

In the Supabase dashboard, open **SQL Editor**, paste each migration in order
and run it. Only run the ones the project doesn't have yet. The profile photo
upload feature requires `0007_profile_avatars.sql`; without it, Storage rejects
uploads because the `relaya-avatars` bucket and its policies do not exist.
Gender-based defaults require `0008_voice_preference.sql` and
`0009_gender.sql`; apply both in order before using the updated signup and
profile settings. Apply `0011_default_glossary.sql` to rename the starter list
and add Relaya to existing and new users' default glossaries.
Apply `0012_spoken_languages.sql` before saving Japanese, Mandarin Chinese,
or Spanish as a spoken-language preference.

`0002_core.sql` also sets up accounts that already exist: each gets settings,
a default glossary and the free plan. Running it twice is harmless.

## What lives where

- **Users change directly** (through Supabase with their own login): their
  settings, name lists and names, their profile's agent name.
- **The API changes** (service role key, never in the browser): call sessions,
  usage, subscriptions. Users can read their own and delete their sessions.
- **Nobody stores** audio, transcripts or sentences.

Limits are enforced in the database, not only in the app:
- 30 names per list, 20 lists per user, one default list.
- The agent name must end with "AI" or "(AI)".
- Free plan: 60 sentences a month, at most 15 per 6 hours, 8 Speak for me
  sessions and 240 agent minutes a month. `consume_usage()` checks and records
  in one step so two requests can't both take the last one.

## Tests

```bash
bash database/tests/run.sh
```

Starts a throwaway Postgres, applies every migration on top of a small
stand-in for Supabase's auth schema (`tests/supabase-stub.sql`), then checks
that users can't see or change each other's data and that the limits hold.
Needs Postgres 15+ installed (Linux or macOS; on Windows use WSL).
