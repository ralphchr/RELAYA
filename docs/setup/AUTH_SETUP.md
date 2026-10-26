# Authentication setup

The web app uses Supabase Auth for email/password accounts, email one-time codes, Google OAuth, and Facebook OAuth. Phone/SMS sign-in is not used. The client only needs the project URL and public anon key; never put the service-role key in `VITE_*` variables.

## Web environment

Set these values in `frontend/.env.local` for local development and in the web deployment environment:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Restart Vite after changing environment variables. If either value is missing, the login page explains that auth is not configured and does not send user data.

## Supabase Auth URLs

In **Authentication → URL Configuration**, set the Site URL and allow each exact app callback URL, for example:

- `http://localhost:5173/auth/callback`
- `http://localhost:5173/auth/callback?next=/email-confirmed`
- `https://<your-web-domain>/auth/callback`
- `https://<your-web-domain>/auth/callback?next=/email-confirmed`

Add preview deployment callback URLs while testing previews. Keep the allowlist limited to app domains you control.

## Google and Facebook

Create OAuth apps with Google Cloud and Meta for Developers. In each provider's redirect URI settings, add the Supabase callback:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Then add the provider client ID and secret under **Authentication → Providers** in Supabase and enable the provider. Facebook needs the `email` permission for email addresses to be returned. The app redirects to Supabase using PKCE and returns to `/auth/callback`.

## Email and phone codes

- To use email and password, enable the **Email provider** under **Authentication → Sign In / Providers** in Supabase. Signup asks for a full name, birthday, password and password confirmation. Supabase Auth stores the password securely; the app never writes it into the profile table. The database migration `database/migrations/0001_profiles.sql` creates `public.profiles` and stores the full name and birthday with per-user RLS. Apply this migration to the Supabase project before testing signup.
- If **Confirm email** is enabled, Supabase sends its configured confirmation email and the user must confirm before password sign-in works. The app displays a message after signup and returns the user to password sign-in. If you need signup confirmation as a six-digit code, the Supabase email template must use `{{ .Token }}` and the project must permit editing templates (custom SMTP on hosted Supabase).

- Enable email sign-ups in Supabase Auth. Under **Authentication → Email Templates**, update both **Magic Link** and **Confirm signup** templates. Use `{{ .Token }}` and remove `{{ .ConfirmationURL }}`; Supabase sends a link when a template uses `{{ .ConfirmationURL }}` and a code when it uses `{{ .Token }}`.
- Set the **Magic Link** subject to `Your Relaya sign-in code` and use this HTML body:

  ```html
  <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #352b31;">
    <h1 style="color: #a34663;">Your Relaya sign-in code</h1>
    <p>Enter this code in Relaya to finish signing in:</p>
    <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 16px; background: #fff5f3; border-radius: 8px; text-align: center;">
      {{ .Token }}
    </p>
    <p>This code expires soon and can only be used once. If you didn’t request it, you can ignore this email.</p>
    <p style="color: #81747a;">— The Relaya team</p>
  </div>
  ```

- Use the same subject and body for **Confirm signup**, so new accounts also receive a six-digit code instead of a confirmation link. Save both templates, then request a fresh code to verify the change; emails already sent keep their original behavior.
- In **Authentication → URL Configuration**, set the app Site URL and add the exact callback URLs listed above to the redirect allowlist. For production email delivery beyond Supabase's limited default sender, configure a custom SMTP provider under **Project Settings → Authentication → SMTP Settings** (menu labels can vary slightly). Keep the SMTP password in Supabase, not in this repository.
- This template change must be saved in the Supabase project used by `VITE_SUPABASE_URL`. The app requests an email OTP and cannot override the format configured in that project’s email templates.
- Configure OTP expiry and rate limits for your rollout. Email delivery is controlled by your Supabase configuration.

The verification screen accepts numeric email OTPs. Email confirmation links are also directed to `/auth/callback`; the callback exchanges PKCE codes or token hashes and saves the returned session before returning to the workspace.
