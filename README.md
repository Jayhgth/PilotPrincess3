# Pilot Princess

Pilot Princess is a source-backed academic planning workspace for Design Tech High School students. It combines a guided 1-4 year plan setup, configurable graduation tracking, transcript import, editable planning tools, workload simulation, and a server-side Codex review layer without treating uncertain information as verified.

The planning data is intentionally focused on d.tech and currently uses clearly labeled 2025-26 official sources. Account registration accepts any valid email address.

## Stack

- Astro 7 SSR with React 19 islands
- Node standalone adapter
- Supabase Auth, Postgres, Row Level Security, and Storage
- Official OpenAI Codex SDK with structured output
- TypeScript, Zod, Vitest, and Playwright

## Prerequisites

- Node.js 24 or newer
- pnpm 11
- Supabase CLI
- Access to Supabase project `zqkzgmwptdsaqbzrjngt`, or a separate project where you can apply the migration
- For AI features: an `OPENAI_API_KEY`, a `CODEX_API_KEY`, or a locally authenticated Codex installation

## Local Setup

1. Install dependencies.

   ```sh
   pnpm install
   ```

2. Create `.env` from `.env.example` and set the Supabase URL and publishable/anon key.

   ```env
   PUBLIC_SUPABASE_URL=https://zqkzgmwptdsaqbzrjngt.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   CODEX_MODEL=gpt-5.4
   CODEX_TIMEOUT_MS=9000
   ```

3. Configure the database. The repository is already initialized for Supabase.

   ```sh
   supabase login
   supabase link --project-ref zqkzgmwptdsaqbzrjngt
   supabase db push --linked --include-seed
   supabase db lint --linked
   ```

4. Configure Codex on the server. For production, add one of these secrets to the host; never expose it through a `PUBLIC_` variable.

   ```env
   OPENAI_API_KEY=your-server-key
   # or CODEX_API_KEY=your-server-key
   ```

   For local development, an existing Codex login can be used when no key is set.

5. Start the app.

   ```sh
   pnpm dev
   ```

   Open the URL printed by Astro. The linked MVP project accepts any valid email address and immediately activates new accounts because custom SMTP is not configured yet.

6. For production email confirmation and password recovery, configure a custom SMTP provider in Supabase Authentication settings. Then enable email confirmation while keeping open email registration. Without custom SMTP, Supabase's hosted mailer only delivers to project team addresses and is limited to two messages per hour.

## Commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Run the production artifact after building:

```sh
HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs
```

## Architecture

- `src/components/OnboardingFlow.tsx` owns the guided student, plan-window, tracker, and transcript setup flow.
- `src/components/PlanningWorkspace.tsx` contains the authenticated planning workspace and Supabase mutations.
- `src/lib/planning.ts` contains deterministic graduation, GPA, workload, timeline, plan generation, and simulation logic.
- `src/lib/transcript.ts` contains deterministic catalog matching and reviewed transcript-to-plan conversion.
- `src/pages/api/ai/` contains bearer-authenticated Node routes for Codex parsing and explanations.
- `src/server/codex.ts` owns Codex isolation, structured runs, concurrency, timeouts, and cleanup.
- `supabase/migrations/` is the source of truth for schema, triggers, RLS, and storage.
- `supabase/seed.sql` contains official, source-labeled d.tech reference data.

The browser never receives an AI key. User-owned tables and uploads are protected by Supabase RLS. Registration is open to any valid email; the retained domain metadata table is not enforced and can support a future enrollment policy if the product scope changes.

## Official Seed Sources

- [25/26 Graduation Requirements](https://docs.google.com/document/d/1N351ZQzwGakGiFf5ax7i7NE1BEA2k_civOL9atMWXJo/edit)
- [25/26 Course Catalog](https://docs.google.com/spreadsheets/d/11iRo_SuYTb0_WxaZ2vB1H3L9qtT0Ecbmkj960XvCuB4/edit)
- [23/24 Flow of Classes](https://docs.google.com/document/d/1dX4WLEyikPmDjZVWMF3sIYjwGiwmCmSZRYfbdywiQuM/edit)
- [24/25 Concurrent Enrollment Policy](https://docs.google.com/presentation/d/1cVyDYDya2lGkOymkEbmWaNpjOYkn8iBBCGpowiL4xhI/edit)

## Production Checklist

- Configure `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and the server-only Codex key.
- Add the production site URL, `/app`, and `/reset-password` callbacks to the Supabase Auth redirect allowlist.
- Configure custom SMTP, test confirmation and recovery delivery, then enable email confirmation for production.
- Run `supabase db push --linked --include-seed` against the intended project.
- Run all commands in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md).
- Enable host-level HTTPS, logs, error monitoring, and backups.

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for completed scope and current limitations.
