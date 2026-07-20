# Production deployment

Pilot Princess deploys as an Astro server-rendered app on Vercel with Supabase providing Auth, Postgres, and private Storage.

## 1. Supabase

Create a separate production Supabase project and apply every migration in `supabase/migrations/` in order. Do not expose or add a Supabase service-role key to Vercel; the app uses the publishable key plus the signed-in student's JWT, and row-level security is the authorization boundary.

In the Supabase dashboard:

- set the Auth **Site URL** to the canonical HTTPS production origin;
- add exact redirect URLs for `https://YOUR_DOMAIN/auth/callback` and `https://YOUR_DOMAIN/reset-password`;
- add a Vercel preview wildcard only if preview deployments need real sign-in;
- enable email confirmations, leaked-password protection, and suitable Auth rate limits;
- enable CAPTCHA on sign-up and password-reset entry points exposed to the public;
- configure custom SMTP before relying on confirmation and reset email in production;
- enable Google in Auth Providers if Google sign-in is wanted; and
- run Database Security Advisor after applying migrations.

For Google OAuth, the Google Cloud authorized redirect URI is Supabase's callback (`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`), not the Vercel app callback. Keep the Google client secret in Supabase.

Before launch, enable database SSL enforcement, protect Supabase organization owners with MFA, review backup/PITR needs, and confirm the two private buckets created by migrations: `source-uploads` and `ai-attachments`.

## 2. Vercel

Import the GitHub repository as an Astro project. Node 24 and pnpm are pinned by `package.json`.

The repository pins Vercel's **Astro** framework preset and build command in `vercel.json`. In the Vercel dashboard, leave **Root Directory** at the repository root and leave **Output Directory** unconfigured. The Astro adapter writes Vercel's Build Output API routes itself; overriding the output directory can deploy an empty/static folder and produce a platform `404: NOT_FOUND` even when the build appears successful.

Configure these variables for Production and any Preview environment that should be functional:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Browser-safe | Production Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Browser-safe | Supabase publishable/anon key |
| `OPENAI_API_KEY` | Secret, server only | Pilot's production Codex credential |
| `CODEX_MODEL` | Server only | Pilot model selection |
| `CODEX_TIMEOUT_MS` | Server only | Pilot turn limit; use `285000` on Hobby or up to `350000` on Pro |
| `VERCEL_FUNCTION_MAX_DURATION` | Build-time | Use `300` on Hobby or `360` on Pro |
| `VERCEL_SUPPORT_LARGE_FUNCTIONS` | Build-time | Set to `1`; Pilot's bundled official Codex runtime puts the generated function above the standard 250 MB path |

Do not add `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`, database passwords, access tokens, or service-role keys to the Vercel runtime.

Use a project-scoped OpenAI key for production, restrict access to the models Pilot uses, and configure usage alerts before launch. Never expose the key through a `PUBLIC_` variable or browser bundle.

ChatGPT subscription login is supported by Codex CLI on a local or persistent trusted machine. It is not a browser OAuth provider for a third-party, multi-user Vercel application. T3 Code uses the machine's already-authenticated, persistent `CODEX_HOME` after the operator runs `codex login`; it does not proxy each web user through OpenAI OAuth. Pilot keeps that same local behavior for development, while Vercel must use a server-only API credential. Do not upload `~/.codex/auth.json` to Vercel or store it in the repository: it is password-equivalent, requires durable token refresh, and must not be shared across public users.

Enable Fluid Compute. The local production build currently produces one roughly 350 MB uncompressed function because Pilot includes the native Codex executable. Vercel Large Functions supports this size, but existing Vercel projects must opt in with `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; new projects are enrolled automatically. Hobby functions are limited to five minutes, so Pilot uses a slightly shorter timeout there. A Pro deployment can retain the app's full six-minute quality budget by setting `CODEX_TIMEOUT_MS=350000` and `VERCEL_FUNCTION_MAX_DURATION=360`.

## 3. Verify before promoting

Run:

```sh
pnpm deployment:check
pnpm lint
pnpm check
pnpm build
pnpm performance:budget
```

Then verify against an isolated QA account on the Vercel preview:

1. email/password signup, confirmation, reset, sign-out, and sign-in;
2. Google sign-in and callback provisioning;
3. onboarding and transcript upload/import;
4. plan creation, course mutation, refresh, and undo;
5. Pilot health, one read, one applied reversible write, and image attachment upload;
6. account export and account deletion; and
7. isolation: a second QA account cannot read the first account's rows or private objects.

Only promote the deployment after the latest migrations are present in the same Supabase project used by the Vercel environment.
