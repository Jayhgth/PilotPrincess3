# Pilot Princess

Pilot Princess is a source-backed academic planning workspace for Design Tech High School students. It combines a guided 1-4 year plan setup, configurable graduation tracking, deterministic transcript import, profile-ranked course and associate-degree discovery, SMCCD concurrent-enrollment planning, explicit workload limits, and narrowly scoped Codex assistance without treating uncertain information as verified.

The planning data is intentionally focused on d.tech and currently uses clearly labeled 2025-26 official sources. Account registration accepts any valid email address.

## Stack

- Astro 7 SSR with React 19 islands
- Node standalone adapter
- Supabase Auth, Postgres, Row Level Security, and Storage
- Official OpenAI Codex SDK with structured output for language and image-understanding tasks only
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
   CODEX_MODEL=gpt-5.6-luna
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
   The application defaults to `gpt-5.6-luna` with reasoning set to `low` (shown as Light in Codex app surfaces); `CODEX_MODEL` may override the model on a deployment.

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
pnpm smccd:validate
```

The checked-in SMCCD dataset is generated from the official 2025-2026 Cañada College, College of San Mateo, and Skyline College catalogs. To deliberately refresh it for a new catalog year, update the source configuration in `scripts/scrape-smccd-catalog.mjs`, then run:

```sh
pnpm smccd:scrape
pnpm smccd:migration
pnpm smccd:validate
```

The separate `supabase/catalog/dtech-smccd-equivalencies-2021.json` artifact is an exact, dated transcription of d.tech's published equivalency chart. After intentionally replacing that artifact with a reviewed newer source, regenerate its migration and validate both datasets:

```sh
pnpm equivalencies:generate
pnpm smccd:validate
```

Run the production artifact after building:

```sh
HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs
```

## Architecture

- `src/components/OnboardingFlow.tsx` owns the guided student, plan-window, tracker, and transcript setup flow.
- `src/components/PlanningWorkspace.tsx` contains the authenticated planning workspace and Supabase mutations.
- The `Courses` destination in `PlanningWorkspace.tsx` is the single course-management surface: My courses, d.tech discovery, and SMCCD discovery share one status model and navigation context.
- `src/lib/planning.ts` contains deterministic graduation, GPA, workload, timeline, plan generation, and simulation logic.
- `src/lib/profile-planning.ts` contains deterministic course and associate-degree fit scoring with visible match reasons.
- `src/lib/transcript.ts` contains deterministic catalog matching and reviewed transcript-to-plan conversion.
- `src/server/transcript-parser.ts` parses text-layer d.tech transcripts without AI, classifies quarter-coded pass/fail intersession rows separately from the annual catalog, and preserves genuinely ambiguous rows for review.
- `src/components/SmccdPlanner.tsx` provides the embedded official district search, exact-course planning, and separately disclosed AA/AS major-progress tracking.
- `src/pages/api/ai/` contains bearer-authenticated Node routes for Codex parsing and explanations.
- `src/server/codex.ts` owns Codex isolation, structured runs, concurrency, timeouts, and cleanup.
- `supabase/migrations/` is the source of truth for schema, triggers, RLS, and storage.
- `supabase/catalog/smccd-2025-2026.json` is the validated, source-backed SMCCD curriculum artifact used to generate the database migration.
- `supabase/catalog/dtech-smccd-equivalencies-2021.json` is the validated 120-row d.tech conversion artifact used for exact high-school credits and requirement areas.
- `supabase/seed.sql` contains official, source-labeled d.tech reference data.

The browser never receives an AI key. User-owned tables and uploads are protected by Supabase RLS. Registration is open to any valid email; the retained domain metadata table is not enforced and can support a future enrollment policy if the product scope changes.

### Transcript and workload rules

Text-layer PDF extraction, transcript row parsing, catalog matching, GPA, graduation, workload, and SMCCD progress are deterministic. On d.tech transcripts, `P` earns credit but does not enter GPA; d.tech pass/fail rows and quarter-coded `F` rows are classified as intersession rather than incorrectly treated as missing catalog courses. Passed intersession rows map to Personal Development, while failed attempts earn zero credit and remain outside GPA. Exact marks such as `A-` stay visible, while `A+`, `A`, and `A-` share the four-point GPA band. The transcript `*` marker means UC A-G approval, not Honors; a d.tech course is weighted only when its reviewed title explicitly says Honors. Every SMCCD course receives the weighted point.

Laboratory Science requires 10 Biology credits, 10 Chemistry credits, and 10 additional lab-science credits. A verified Level 3/III world-language course satisfies the complete 20-credit sequence even when lower levels are absent. The 2021 equivalency chart is visibly labeled and must be confirmed for current approval.

Known weekly workload includes recorded activity time and the current plan year's SMCCD courses at three total class/study hours per unit. The app does not invent d.tech homework time or other unrecorded responsibilities; the student supplies a weekly commitment limit and a demanding-course limit instead.

### Where Codex is used

The authenticated **AI connection** tab is the runtime source of truth. It displays the active model and credential mode, lists every AI boundary, and provides a bounded conversational test that reports the model and response latency without exposing credentials or student records.

Codex is used for requested plan/simulator explanations, lightweight wording assistance, semantic review of unstructured student-added policy sources, and interpreting scanned transcript tables only when no usable text layer exists. It is not used for text-based PDF transcript parsing, catalog matching, graduation calculations, GPA, workload, SMCCD requirement progress, or other planning math. Those paths are deterministic and continue to work with no Codex connection.

## Official Seed Sources

- [25/26 Graduation Requirements](https://docs.google.com/document/d/1N351ZQzwGakGiFf5ax7i7NE1BEA2k_civOL9atMWXJo/edit)
- [25/26 Course Catalog](https://docs.google.com/spreadsheets/d/11iRo_SuYTb0_WxaZ2vB1H3L9qtT0Ecbmkj960XvCuB4/edit)
- [23/24 Flow of Classes](https://docs.google.com/document/d/1dX4WLEyikPmDjZVWMF3sIYjwGiwmCmSZRYfbdywiQuM/edit)
- [24/25 Concurrent Enrollment Policy](https://docs.google.com/presentation/d/1cVyDYDya2lGkOymkEbmWaNpjOYkn8iBBCGpowiL4xhI/edit)
- [d.tech / SMCCD College Equivalency Chart](https://docs.google.com/spreadsheets/d/1DShfEovBYe-N9VlR1QM6Pyy3pmJ4cMMc6bE91QUzLIw/edit)
- [SMCCD Concurrent Enrollment](https://smccd.edu/k-12/)
- [College of San Mateo Work and Credit](https://collegeofsanmateo.edu/grades/workandcredit.asp)
- [Cañada College Catalog](https://catalog.canadacollege.edu/current/courses/)
- [College of San Mateo Catalog](https://catalog.collegeofsanmateo.edu/current/courses/)
- [Skyline College Catalog](https://catalog.skylinecollege.edu/current/courses/)

## Production Checklist

- Configure `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and the server-only Codex key.
- Add the production site URL, `/app`, and `/reset-password` callbacks to the Supabase Auth redirect allowlist.
- Configure custom SMTP, test confirmation and recovery delivery, then enable email confirmation for production.
- Run `supabase db push --linked --include-seed` against the intended project.
- Run all commands in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md).
- Enable host-level HTTPS, logs, error monitoring, and backups.

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for completed scope and current limitations, and [UX_AUDIT.md](./UX_AUDIT.md) for the strict final usability grade and evidence.
