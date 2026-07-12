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
CODEX_TIMEOUT_MS=9000
```

Never expose an AI credential through a `PUBLIC_` variable. A production host needs `OPENAI_API_KEY` or `CODEX_API_KEY`; local development may use an authenticated Codex installation. Local-login fallback is blocked in production unless `CODEX_ALLOW_LOCAL_AUTH=true` is deliberately set. Students select an allowlisted model during onboarding; GPT-5.6 Luna with Light reasoning is recommended. `CODEX_MODEL` remains an optional server fallback for non-student calls.

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
pnpm check          # normal work: typecheck plus 18 critical-path tests
pnpm test:full      # opt-in exhaustive unit suite
pnpm check:release  # opt-in release gate
```

Use focused tests while debugging. Run browser, SMCCD, migration, RLS, storage, or linked-Supabase checks only when that system changes. The default command intentionally avoids the old 148-test milestone loop.

## UI comparison lab

The authenticated dashboard and onboarding expose a test-only UI switcher. Open `/app?ui=t3code` or choose **UI Lab** in the workspace; the selection persists locally. Every version keeps the same student data, actions, institution marks, navigation destinations, onboarding flow, and Pilot Assistant.

- `t3code`: Base UI with a close adaptation of the MIT-licensed [t3code](https://github.com/pingdotgg/t3code) shell and visual language
- `material`: Material UI tonal rail
- `mantine`: Mantine modular workspace
- `chakra`: Chakra UI student-friendly planner
- `ant`: Ant Design campus portal
- `radix`: Radix Themes editorial workspace
- `aria`: React Aria high-contrast workspace
- `reactbits`: React Bits kinetic, asymmetric workspace
- `current`: the original Pilot Graphite interface, retained as the backup

This is a presentation comparison, not nine forks of product logic. Keep shared behavior in the existing feature components and scope experiments through `src/ui-lab/` and `src/styles/ui-lab.css`.

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

- `src/components/OnboardingFlow.tsx`: guided student, tracker, and optional Codex consent/setup.
- `src/components/PlanningWorkspace.tsx`: authenticated navigation, data loading, and mutations.
- `src/components/AdminSettingsDialog.tsx` and `src/pages/api/admin/reset.ts`: administrator-only QA controls with a server- and database-enforced self-reset that preserves auth and role membership.
- `src/components/student-tools/`: embedded Student profile sections for planning context and the factual experience register; next actions live on Overview and load constraints live in the GPA planner.
- `src/components/GlobalAssistant.tsx`: persistent t3code-inspired conversation rail with a compact floating composer, concise sanitized GFM answers, timed and folded reasoning summaries, student-data tool activity, reversible conversation archiving, Manual/Auto-review, centered settings, and persisted docked/floating layout.
- `src/components/OverviewPath.tsx`: the selected Finished/In progress/Next Overview.
- `src/components/GraduationWorkspace.tsx`: d.tech diploma and selected AA/AS evidence views.
- `src/components/SmccdPlanner.tsx`: district course and associate-degree discovery.
- `src/lib/planning.ts`: deterministic graduation, GPA, workload, next-step, and load-check logic.
- `src/lib/transcript.ts` and `src/server/transcript-parser.ts`: deterministic text-layer transcript parsing and reconciliation.
- `src/lib/prerequisites/`: exact prerequisite parsing, evaluation, and audits.
- `src/pages/api/ai/`, `src/server/codex.ts`, `src/server/assistant-knowledge.ts`, `src/server/assistant-audits.ts`, `src/server/ai-auto-review.ts`, and `src/server/ai-tools.ts`: consent-gated conversations, private image context, retrieved product guidance, isolated Codex turns, bounded evidence audits, separate risk review, student-data tools, streaming, and validated mutations.
- `supabase/migrations/`: schema, RLS, auth, and storage source of truth.
- `supabase/catalog/`: reviewed catalog and equivalency artifacts.

## Decision rules

- Text-layer PDF extraction, catalog matching, GPA, graduation, workload, and SMCCD progress are deterministic.
- Codex is opt-in. Onboarding explains the boundary, requires explicit approval, runs a real connection test, and saves the selected model before the assistant can run. The global rail may then read every student-facing planning domain through validated, RLS-protected tools—never arbitrary SQL, secrets, administrator data, or another user's records. Transcript audits can compare bounded source text with parsed, reviewed, catalog-linked, and imported rows while keeping transcript-backed records read-only. Answers default to one to three short sentences and are schema-bounded to 900 characters. Students may attach up to eight PNG, JPEG, or WebP images; local thumbnails appear before sending, the originals are stored in the private `ai-attachments` bucket, and history uses short-lived signed previews. Every write—including plan snapshots and supported dashboard edits—is stored as an exact pending tool call. Manual mode, the default, waits for the student. Auto-review sends eligible proposals to a separate risk reviewer; removals, grade changes, identity changes, and anything not clearly low-risk still wait for the student. Normal RLS, prerequisite, eligibility, transcript-lock, and record rules run again at execution. Curated product and academic guidance is retrieved from `ai_knowledge_chunks` for each turn, while conversations and readable activity persist in Supabase under per-user RLS. Hidden chain-of-thought, shell, files, network, MCP, plugins, skills, and subagents are not exposed or enabled. The selected context, tool results, and explicitly attached images are sent to OpenAI, whose provider-side handling follows the configured account.
- `P` earns credit but does not enter GPA. Quarter-coded pass/fail rows are intersession records.
- `A+`, `A`, and `A-` use the same four-point band while preserving the exact mark.
- A d.tech `*` is a UC course-list marker, not Honors. d.tech weighting requires reviewed Honors evidence; every SMCCD course is weighted.
- Laboratory Science requires Biology, Chemistry, and a third lab science at 10 credits each.
- A verified Level 3/III world-language course satisfies the full 20-credit sequence.
- Workload includes recorded activities and current-year SMCCD study time. It does not invent d.tech homework or unrecorded responsibilities.

## Production release

1. Choose and deploy a Node host. Run `HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs` after `pnpm build`.
2. Configure Supabase redirects for the production origin, `/app`, and `/reset-password`.
3. Configure custom SMTP, email confirmation, server-only Codex credentials, HTTPS, monitoring, backups, and retention.
4. Run `pnpm check:release` against the deployed origin.
5. Confirm institutional trademark use and current counseling approval for dated equivalencies.

Durable references are [product and design](./docs/PRODUCT_DESIGN.md), [academic rules](./docs/ACADEMIC_RULES.md), and [Codex transparency](./docs/AI_TRANSPARENCY.md). Do not add task-completion or implementation-status documents.
