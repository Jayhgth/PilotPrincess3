# Pilot Princess

Pilot Princess is a source-backed academic planning workspace for California public and charter high-school students. It combines statewide school identity, official local diploma evidence, deterministic transcript import, course planning, nearby community-college discovery, and narrowly scoped Codex assistance. Every selected school uses the same versioned catalog, diploma, mapping, planning, and Pilot contracts; no school may borrow d.tech's sequence or another district's requirements.

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

Never expose an AI credential through a `PUBLIC_` variable. A production host needs `OPENAI_API_KEY` or `CODEX_API_KEY`; local development may use an authenticated Codex installation. Local-login fallback is blocked in production unless `CODEX_ALLOW_LOCAL_AUTH=true` is deliberately set. Students select an allowlisted model during onboarding or from the Pilot composer and can choose Light, Standard, or Deep reasoning in Settings; GPT-5.6 Luna with Light reasoning is recommended. `CODEX_MODEL` remains an optional server fallback for non-student calls.

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

## Data refreshes

California school identity comes from the official CDE public-school directory. UC A–G identities and approved course lists come from UCOP. The local-academics sync discovers each district or charter's official catalog and diploma source, reads public PDF, HTML, Google Doc, and Google Sheet formats, merges local grade/term/prerequisite evidence into UCOP identity, and refuses to publish incomplete diploma sets. If a current local catalog is unavailable, UCOP courses remain searchable with grade availability clearly marked for verification rather than being silently omitted. Nearby community colleges come from the official CCCCO directory and are geocoded from the school's public address, never a student's device location.

```sh
pnpm schools:sync
pnpm schools:academics --dry-run --school-name "Carlmont High"
pnpm schools:academics --selected
pnpm schools:academics --all
pnpm uc-ag:sync-schools
pnpm uc-ag:sync-courses
pnpm providers:sync
pnpm schools:audit
```

The syncs are idempotent and retain source URLs, source dates, content hashes, source evidence, confidence, and review state. `schools:academics` uses a service role only for publishing; `--discover-only` and `--dry-run` perform read-only audits. `--selected` refreshes every school currently used by a student account and is also run by the scheduled maintenance workflow. District schools share their district's requirement authority while charter schools remain isolated. `schools:audit` checks every synced high school, college, and normalized district for identity, provenance, district linkage, a deterministic public-address-based district default, and academic readiness for every selected school. Review ambiguous identities instead of selecting a fuzzy match.

The checked-in SMCCD catalog and college-specific local-degree patterns are generated from the official 2025-26 Cañada College, College of San Mateo, and Skyline College catalogs and degree worksheets. CSM's 27-unit GE, Skyline's 24-unit GE plus separate graduation requirements, and Cañada's 25-unit GE remain distinct. Program scraping audits every official requirement table and course option before validation.

```sh
pnpm smccd:scrape
pnpm smccd:ge-scrape
pnpm smccd:migration
pnpm smccd:requirements-migration
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
- `src/components/PlanningWorkspace.tsx`: authenticated navigation, state ownership, and mutations. Feature-heavy workspaces and Pilot are loaded only when opened; the overview does not warm the full college catalog in the background.
- `src/lib/workspace-bootstrap.ts` and the `get_workspace_bootstrap` / `get_assistant_workspace_bootstrap` database functions: typed, RLS-protected snapshots that keep the app and Pilot on the same canonical records without client query waterfalls.
- `src/components/AdminSettingsPanel.tsx` and `src/pages/api/admin/reset.ts`: administrator-only QA controls inside Settings, with a server- and database-enforced self-reset that preserves auth and role membership.
- `src/components/GlobalAssistant.tsx`: persistent t3code-inspired docked conversation rail with a compact model picker, concise sanitized GFM answers, timed and folded reasoning summaries, student-data tool activity, reversible conversation archiving, and Supervised/Auto-review access.
- `src/components/AppChrome.tsx`, `src/components/OverviewPath.tsx`, and `src/styles/t3code.css`: the retained t3code-inspired workspace shell and planning overview.
- `src/components/GraduationWorkspace.tsx`: official local diploma, selected AA/AS, and college general-education evidence views.
- `src/components/SmccdPlanner.tsx`: district course and associate-degree discovery.
- `src/lib/planning.ts`: deterministic graduation, GPA, and course-plan logic.
- `src/lib/transcript.ts` and `src/server/transcript-parser.ts`: deterministic text-layer transcript parsing and reconciliation.
- `src/lib/prerequisites/`: exact prerequisite parsing, evaluation, and audits.
- `src/pages/api/ai/`, `src/server/codex.ts`, `src/server/ai-knowledge.ts`, `src/server/ai-memory.ts`, `src/server/assistant-audits.ts`, `src/server/ai-auto-review.ts`, and `src/server/ai-tools.ts`: consent-gated conversations, retrieved versioned application guidance, lightweight per-student memory, private image context, isolated Codex turns, bounded evidence audits, separate risk review, student-data tools, streaming, and validated mutations.
- `supabase/migrations/`: schema, RLS, auth, and storage source of truth.
- `supabase/catalog/`: reviewed catalog and equivalency artifacts.
- `scripts/sync-california-schools.mjs`, `scripts/sync-school-academics.mjs`, `scripts/sync-uc-ag-schools.mjs`, `scripts/sync-uc-ag-courses.mjs`, and `scripts/sync-california-community-colleges.mjs`: official statewide identity, local-source discovery, and catalog ingestion.

## Decision rules

- Text-layer PDF extraction, catalog matching, GPA, official diploma progress, and SMCCD progress are deterministic. If a school's official diploma rules are unavailable, Pilot says so instead of substituting California minimums or UC A–G.
- Codex is opt-in. Onboarding explains the boundary, requires explicit approval, runs a real connection test, and saves the selected model before the assistant can run. The global rail reads only allowlisted, RLS-protected academic records. Transcript audits can compare bounded source text with parsed, reviewed, catalog-linked, and imported rows while keeping transcript-backed records read-only. Answers default to one to three short sentences and are schema-bounded to 900 characters. Every write is stored as an exact pending tool call. Manual mode waits for the student; Auto-review independently applies an approved exact proposal or declines it without asking for confirmation. Normal RLS, prerequisite, eligibility, transcript-lock, and record rules run again at execution. Hidden chain-of-thought, shell, files, network, MCP, plugins, skills, and subagents are disabled.
- `P` earns credit but does not enter GPA. Quarter-coded pass/fail rows are intersession records.
- `A+`, `A`, and `A-` use the same four-point band while preserving the exact mark.
- A d.tech `*` is a UC course-list marker, not Honors. d.tech weighting requires reviewed Honors evidence; every SMCCD course is weighted.
- Laboratory Science requires Biology, Chemistry, and a third lab science at 10 credits each.
- A verified Level 3/III world-language course satisfies the full 20-credit sequence.

## Production release

1. Choose and deploy a Node host. Run `HOST=0.0.0.0 PORT=4321 node dist/server/entry.mjs` after `pnpm build`.
2. Configure Supabase redirects for the production origin, `/app`, and `/reset-password`.
3. Configure custom SMTP, email confirmation, server-only Codex credentials, HTTPS, monitoring, backups, and retention.
4. Run `pnpm check:release` against the deployed origin.
5. Confirm institutional trademark use and current counseling approval for dated equivalencies.

Durable references are [product and design](./docs/PRODUCT_DESIGN.md), [academic rules](./docs/ACADEMIC_RULES.md), and [Codex transparency](./docs/AI_TRANSPARENCY.md). Do not add task-completion or implementation-status documents.
