# Implementation Status

Last updated: 2026-07-09

## Current State

- Strict implementation grade: `98/100` for the clarified MVP scope.
- The complete student flow is implemented in Astro and backed by the linked Supabase project `zqkzgmwptdsaqbzrjngt`.
- No code or data was copied from PilotPrincess2. The implementation was built from the linked Spec Sheet, the user's clarifications, official d.tech sources, official Codex SDK documentation, and architectural review of `t3code`.
- The production build, unit tests, browser tests, remote schema lint, remote auth/RLS/storage smoke checks, and authenticated Codex source parse all pass.

## Clarified Product Decisions

- Astro overrides the older stack line in the Spec Sheet.
- Sign-up is limited to `@dtechhs.org` for now. The database-backed allowed-domain table makes this expandable without rewriting auth.
- There are no parent accounts in this MVP. Students can generate a lightweight plain-language summary.
- Codex runs only on the Node server. Production can use `OPENAI_API_KEY` or `CODEX_API_KEY`; local Codex authentication is also supported.
- Official reference data is the latest currently published 2025-26 data, visibly labeled by source year. Later catalogs can be imported as new catalog versions.

## Completed MVP

### Application and UX

- Astro 7 SSR application with React islands and the Node standalone adapter.
- Distinct editorial aviation-inspired design with graphite/silver surfaces, restrained burgundy accents, Manrope typography, desktop/mobile navigation, light/dark themes, empty/loading/error states, and keyboard focus treatment.
- d.tech-only sign-in and account creation.
- Four-stage onboarding for student details, a 1-4 year planning window, full or selected graduation tracker areas, and optional transcript import.
- Student profile editing for name, age, grade, graduation year, interests, direction, intensity, workload tolerance, stress, plan window, and tracker scope.
- Source import for PDF, DOCX, TXT, CSV, PNG, JPEG, WebP, pasted text, and screenshots, with a private 15 MB bucket.
- AI extraction review queue with editable JSON corrections, confidence labels, approve/reject decisions, preserved raw material, and manual fallback.
- Transcript-specific parsing for completed course names, grade level, school year, term, final grade, credits, and weighting, with deterministic official catalog matching.
- Searchable/filterable official d.tech catalog with 41 source-backed courses.
- Graduation tracker with completed/current/planned/unverified ledgers and verified-only projections across all eight requirements.
- GPA tracker with current/projected and weighted/unweighted estimates.
- Non-destructive source-backed variable-length plan suggestions, editable status/year/grade/weighting, prior transcript history, removal, snapshots, and real active-versus-snapshot comparison.
- Dual-enrollment exact-course entry with college units, proposed d.tech credits, associate-degree goal notes, and required verification warnings.
- Activities and weekly-hour workload tracking.
- Editable grade-aware timeline generation.
- Four-control simulator for major direction, path intensity, course style, and activity load, with current/simulated metrics, risks, tradeoffs, and saved runs.
- Lightweight generated student summaries with a deterministic fallback.

### Supabase

- Two applied migrations containing 21 application tables, enums, constraints, indexes, triggers, helper functions, RLS, storage policies, onboarding preferences, and transcript provenance.
- Expandable `allowed_email_domains` table seeded with `dtechhs.org` and a database trigger that rejects all other auth domains.
- New-user trigger provisions a student profile, active four-year plan, and active version transactionally.
- Per-user RLS on profiles, sources, parse jobs, review items, plans, versions, courses, grades, activities, timeline tasks, simulations, summaries, and event logs.
- Read-only authenticated reference policies for catalog data and user-prefix policies for private uploads.
- Source-backed seed with 4 official sources, 1 versioned catalog, 41 courses, 8 graduation requirements totaling 225 credits, and 41 verified mappings.
- Migration and seed applied to linked project `zqkzgmwptdsaqbzrjngt`.
- Plan start/end grades, tracker mode/areas, transcript document type, transcript review entities, and one-import-per-review-item provenance are persisted in the linked project.

### Codex SDK

- Official `@openai/codex-sdk` integration isolated behind authenticated Astro API routes.
- Structured-output Zod and JSON schemas for source extraction, summaries, plan explanations, and simulator explanations.
- T3code-inspired server boundary and lifecycle management without copying its code.
- Maximum two concurrent turns, bounded timeouts, per-turn scratch directories, cleanup, read-only sandbox, no network/web search, and no approvals.
- Prompt-injection boundaries treat all uploads as untrusted data and forbid invention or tool use.
- Authenticated source parsing accepts extracted text and local image attachments, records jobs/results/latency/fallback state, and always creates a reviewable result.
- A dedicated transcript prompt excludes planned or in-progress rows, preserves explicit evidence, and never imports a course until the student confirms it.
- Deterministic planners and calculators remain functional when Codex is unavailable.

## Verification Results

- `pnpm lint`: pass.
- `pnpm typecheck`: pass with 0 errors, 0 warnings, and 0 hints.
- `pnpm test`: 12/12 unit tests pass.
- `pnpm test:e2e`: 2/2 Chromium tests pass, including a 390x844 viewport.
- `pnpm build`: Astro standalone SSR build passes.
- `pnpm peers check`: pass.
- `supabase db lint --linked`: no schema errors.
- `supabase db push --linked --include-seed --yes`: migration and seed applied.
- Remote reference counts: 21 application tables, 41 courses, 8 requirements, 4 official sources, and 41 mappings.
- Remote smoke test: non-d.tech rejection, d.tech account creation, password login, automatic profile/plan provisioning, RLS reads, private upload/remove, and event logging all pass.
- Authenticated Codex source parse: HTTP 200, structured output, 2 review items, `needs_review`, and `likely` confidence.
- Live transcript onboarding: 7 completed rows parsed and catalog matched, all 7 imported with provenance, all stored as grade 9 completions, GPA recalculated to 3.67, and selected English/Mathematics progress recalculated.
- Live plan-window check: a grade 10-11 plan generated grades 10 and 11 only, while grade 9 transcript history remained visible and counted.
- Manual browser flow: guided onboarding, focused tracker, transcript review/import, overview, lightweight summary, source addition, plan suggestion, snapshot creation/comparison, dark UI, and desktop layout pass.
- All temporary remote QA users and cascaded data were removed after testing.

## Known Limitations

- The official 2026-27 d.tech catalog was not published in the reviewed source set. The app intentionally uses labeled 2025-26 data until a newer official source is available.
- Production hosting has not been selected or deployed. The artifact is a working standalone Node build and needs the documented environment variables at the chosen host.
- Production Codex calls require a server-side API key or an authenticated Codex runtime on the host. The deterministic application remains usable when AI is unavailable.
- Dual-enrollment equivalencies, approvals, college prerequisites, calendars, and transcript delivery are intentionally not inferred. Students enter exact courses and confirm them with d.tech and the college.
- GPA and graduation outputs are planning estimates, not transcript or counselor-of-record determinations.

## Next Steps After MVP

1. Deploy the Node standalone build and configure production secrets and the Supabase redirect allowlist.
2. Import and manually review the official 2026-27 catalog when d.tech publishes it.
3. Add institution-specific community-college catalog connectors only after product approval and source/licensing review.
4. Add scheduled backup/restore drills, error monitoring, and production telemetry retention rules before broader rollout.
