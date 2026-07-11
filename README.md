# Pilot Princess

Pilot Princess is a source-backed academic planning workspace for Design Tech High School students. It combines d.tech graduation tracking, deterministic transcript import, course planning, SMCCD concurrent-enrollment discovery, workload constraints, and narrowly scoped Codex assistance.

Current reference data is labeled 2025-26. Registration accepts any valid email address. Planning results are advisory and preserve source age, verification, and uncertainty.

## Stack

- Astro 7 SSR and React 19
- Supabase Auth, Postgres, Row Level Security, and Storage
- Official Codex SDK for the persistent Pilot Assistant and image-understanding fallback
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

Never expose an AI credential through a `PUBLIC_` variable. A production host needs `OPENAI_API_KEY` or `CODEX_API_KEY`; local development may use an authenticated Codex installation. Local-login fallback is blocked in production unless `CODEX_ALLOW_LOCAL_AUTH=true` is deliberately set. The current runtime requests `low` reasoning, which Codex surfaces describe as Light.

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
pnpm verify:fast       # implementation loop
pnpm verify:milestone  # meaningful Git milestone
pnpm verify:release    # release candidate
```

Specialized SMCCD, theme, browser, and linked Supabase checks run only when that system changes or for a release. See [TEST_CHECKLIST.md](./TEST_CHECKLIST.md) for the trigger matrix and [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for current evidence and gaps.

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
- `src/components/student-tools/`: lazy-loaded, single-purpose Experiences, Next steps, Load check, and Planning preferences views.
- `src/components/GlobalAssistant.tsx`: persistent t3code-inspired conversation drawer with readable reasoning summaries, student-data tool activity, and exact-change approvals.
- `src/components/OverviewPath.tsx`: the selected Finished/In progress/Next Overview.
- `src/components/GraduationWorkspace.tsx`: diploma, A-G, and selected AA/AS evidence views.
- `src/components/SmccdPlanner.tsx`: district course and associate-degree discovery.
- `src/lib/planning.ts`: deterministic graduation, GPA, workload, next-step, and load-check logic.
- `src/lib/transcript.ts` and `src/server/transcript-parser.ts`: deterministic text-layer transcript parsing and reconciliation.
- `src/lib/prerequisites/`: exact prerequisite parsing, evaluation, and audits.
- `src/pages/api/ai/`, `src/server/codex.ts`, and `src/server/ai-tools.ts`: authenticated conversations, isolated Codex turns, student-data tools, streaming, and confirmed mutations.
- `supabase/migrations/`: schema, RLS, auth, and storage source of truth.
- `supabase/catalog/`: reviewed catalog and equivalency artifacts.

## Decision rules

- Text-layer PDF extraction, catalog matching, GPA, graduation, workload, and SMCCD progress are deterministic.
- Codex runs only after a student sends a message, requests unstructured-source review, or supplies a transcript without a usable text layer. The global assistant can read allowlisted records automatically. A write is stored as a pending tool call and runs only after the student confirms its exact arguments; normal RLS, prerequisite, eligibility, and transcript-lock rules run again at execution. Conversations and readable activity persist in Supabase under per-user RLS. Hidden chain-of-thought, shell, files, network, MCP, plugins, skills, and subagents are not exposed or enabled. The selected context is sent to OpenAI, whose provider-side handling follows the configured account.
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

Durable references are [product and design](./docs/PRODUCT_DESIGN.md), [academic rules](./docs/ACADEMIC_RULES.md), and [Codex transparency](./docs/AI_TRANSPARENCY.md). Current gaps and owner decisions stay in [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
