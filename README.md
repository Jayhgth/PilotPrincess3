# Pilot Princess

Pilot Princess is a source-backed academic planning workspace for Design Tech High School students. It combines d.tech graduation tracking, deterministic transcript import, course planning, SMCCD concurrent-enrollment discovery, workload constraints, and narrowly scoped Codex assistance.

Current reference data is labeled 2025-26. Registration accepts any valid email address. Planning results are advisory and preserve source age, verification, and uncertainty.

## Stack

- Astro 7 SSR and React 19
- Supabase Auth, Postgres, Row Level Security, and Storage
- Official Codex SDK for language or image-understanding tasks only
- TypeScript, Zod, Vitest, and Playwright

## Local setup

Requirements: Node 24+, pnpm 11, Supabase CLI, and access to the linked project or another migrated project.

```sh
pnpm install
cp .env.example .env
```

Set browser-safe Supabase values in `.env`:

```env
PUBLIC_SUPABASE_URL=https://zqkzgmwptdsaqbzrjngt.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
CODEX_MODEL=gpt-5.6-luna
CODEX_TIMEOUT_MS=9000
```

Never expose an AI credential through a `PUBLIC_` variable. A production host needs `OPENAI_API_KEY` or `CODEX_API_KEY`; local development may use an authenticated Codex installation. The current runtime requests `low` reasoning, which Codex surfaces describe as Light.

```sh
supabase login
supabase link --project-ref zqkzgmwptdsaqbzrjngt
supabase db push --linked --include-seed
supabase db lint --linked
pnpm dev
```

New accounts are auto-confirmed in the linked MVP project because custom SMTP is not configured. Before production, configure SMTP and restore email confirmation without reintroducing an email-domain restriction.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm smccd:validate
supabase db lint --linked
```

See [TEST_CHECKLIST.md](./TEST_CHECKLIST.md) for release gates and [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for the current evidence and gaps.

## Data refreshes

The checked-in SMCCD catalog is generated from official 2025-26 Cañada College, College of San Mateo, and Skyline College catalogs.

```sh
pnpm smccd:scrape
pnpm smccd:migration
pnpm smccd:validate
```

The d.tech-to-SMCCD equivalency artifact is a dated transcription of the published 2021 chart. After replacing it with a reviewed source:

```sh
pnpm equivalencies:generate
pnpm smccd:validate
```

Review generated diffs before applying migrations. Curriculum inclusion does not prove that a section is currently offered.

## Architecture

- `src/components/OnboardingFlow.tsx`: guided student and tracker setup.
- `src/components/PlanningWorkspace.tsx`: authenticated navigation, data loading, and mutations.
- `src/components/OverviewPath.tsx`: the selected Finished/In progress/Next Overview.
- `src/components/GraduationWorkspace.tsx`: diploma, A-G, and selected AA/AS evidence views.
- `src/components/SmccdPlanner.tsx`: district course and associate-degree discovery.
- `src/lib/planning.ts`: deterministic graduation, GPA, workload, timeline, and simulation logic.
- `src/lib/transcript.ts` and `src/server/transcript-parser.ts`: deterministic text-layer transcript parsing and reconciliation.
- `src/lib/prerequisites/`: exact prerequisite parsing, evaluation, and audits.
- `src/pages/api/ai/` and `src/server/codex.ts`: authenticated, server-only Codex boundaries.
- `supabase/migrations/`: schema, RLS, auth, and storage source of truth.
- `supabase/catalog/`: reviewed catalog and equivalency artifacts.

## Decision rules

- Text-layer PDF extraction, catalog matching, GPA, graduation, workload, and SMCCD progress are deterministic.
- Codex is used for requested explanations, wording assistance, unstructured policy review, and scanned transcripts without a usable text layer.
- `P` earns credit but does not enter GPA. Quarter-coded pass/fail rows are intersession records.
- `A+`, `A`, and `A-` use the same four-point band while preserving the exact mark.
- A d.tech `*` means UC A-G approval, not Honors. d.tech weighting requires reviewed Honors evidence; every SMCCD course is weighted.
- Laboratory Science requires Biology, Chemistry, and a third lab science at 10 credits each.
- A verified Level 3/III world-language course satisfies the full 20-credit sequence.
- Workload includes recorded activities and current-year SMCCD study time. It does not invent d.tech homework or unrecorded responsibilities.

## Production release

1. Choose and deploy a Node host. Run `HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs` after `pnpm build`.
2. Configure Supabase redirects for the production origin, `/app`, and `/reset-password`.
3. Configure custom SMTP, email confirmation, server-only Codex credentials, HTTPS, monitoring, backups, and retention.
4. Run the full checklist against the deployed origin.
5. Confirm institutional trademark use and current counseling approval for dated equivalencies.

The permanent UI rules are in [UI_DESIGN_SYSTEM.md](./UI_DESIGN_SYSTEM.md). Current product risks and decisions needing owner input are in [UX_AUDIT.md](./UX_AUDIT.md).
