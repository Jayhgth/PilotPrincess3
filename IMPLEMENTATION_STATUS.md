# Implementation Status

Last updated: 2026-07-09

## Current State

- Strict implementation grade: `98/100` for the clarified MVP scope; the separate final UX audit is `97/100`.
- The complete student flow is implemented in Astro and backed by the linked Supabase project `zqkzgmwptdsaqbzrjngt`.
- No code or data was copied from PilotPrincess2. The implementation was built from the linked Spec Sheet, the user's clarifications, official d.tech sources, official Codex SDK documentation, and architectural review of `t3code`.
- The production build, 30 unit tests, four browser tests, remote schema lint, remote auth/RLS/storage smoke checks, open-email signup, password login, recovery-token flow, actual-PDF transcript import, SMCCD catalog validation, and Codex connectivity check all pass.

## Clarified Product Decisions

- Astro overrides the older stack line in the Spec Sheet.
- Registration accepts any valid email address. The earlier domain trigger was removed by migration; its metadata table remains available if a future enrollment policy needs it.
- New accounts are currently auto-confirmed because the linked project has no custom SMTP provider. Production should configure SMTP and restore email confirmation without reintroducing a domain restriction.
- There are no parent accounts in this MVP. Students can generate a lightweight plain-language summary.
- Codex runs only on the Node server. Production can use `OPENAI_API_KEY` or `CODEX_API_KEY`; local Codex authentication is also supported.
- Text-layer PDF transcripts never use Codex. Deterministic extraction and parsing are the default; Codex vision is reserved for scans and images without usable text.
- Official reference data is the latest currently published 2025-26 data, visibly labeled by source year. Later catalogs can be imported as new catalog versions.

## Completed MVP

### Application and UX

- Astro 7 SSR application with React islands and the Node standalone adapter.
- Calm utilitarian student workspace with neutral graphite/silver surfaces, one restrained burgundy accent, Manrope typography, compact desktop/mobile navigation, light/dark themes, empty/loading/error states, and keyboard focus treatment.
- Three primary destinations (`Overview`, `Courses`, and `Graduation`) and seven secondary tools behind `More tools`, with a measured 1,044 px desktop content canvas, no audited horizontal overflow, and no visible text below 10 px.
- Open email/password account creation, clear sign-in errors, forgot-password requests, and a secure password-update callback page.
- Five-stage onboarding for student details, planning priorities, a 1-4 year planning window, full or selected graduation tracker areas, and optional transcript import.
- Student profile editing for name, age, grade, graduation year, structured academic interests, other interests, major direction, career ideas, planning intensity, a demanding-course limit, a weekly commitment limit, stress baseline, plan window, and tracker scope. Every field states and exposes the planning output it changes.
- Minimal transcript import for PDF, DOCX, TXT, CSV, PNG, JPEG, WebP, and pasted text, with a private 15 MB bucket. One file row and one `Read transcript` action replace the previous generic source-management form.
- Compact transcript review ledger with useful course fields, select-all and per-row selection, editable structured corrections behind disclosure, one bulk import action, preserved raw material, manual fallback, and a direct handoff to Done after import.
- Transcript-specific deterministic parsing for completed course names, institution, grade level, school year, term, exact final grade, high-school credits, college units, and weighting, with deterministic d.tech and SMCCD catalog matching. d.tech `P` intersession rows are separated from GPA and map to Personal Development; `A-` is preserved but uses the same four-point GPA band as `A`; every SMCCD row is weighted.
- One consolidated Courses workspace replaces the separate academic-plan, d.tech catalog, and SMCCD destinations. `In progress`, `Planned`, and `Done` are count-backed primary states; records are grouped by grade, reduced to useful metadata, and expose editing controls only on request.
- Searchable/filterable/paginated official d.tech catalog with 41 source-backed courses, one explicit `Add to Planned` action, existing-status labels, profile-specific match reasons only, and secondary details disclosed on demand.
- Graduation tracker with completed/current/planned/unverified ledgers and verified-only projections across all eight requirements.
- GPA tracker with current/projected and weighted/unweighted values, separate GPA/weighted/pass credit totals, and an on-screen explanation of the d.tech method.
- Non-destructive source-backed variable-length plan suggestions, compact inline editing for status/year/grade/weighting, grade-grouped transcript history, removal, collapsed plan versions, snapshots, and real active-versus-snapshot comparison.
- Source-backed SMCCD concurrent-enrollment planning with 2,461 exact district courses across Cañada College, College of San Mateo, and Skyline College. The catalog stays empty until the student searches, uses a stable list-and-detail selection flow, and separates course search from associate-degree planning.
- Searchable, ranked AA/AS discovery across 131 programs, with separate views for profile matches, existing-course progress, and the complete district set. Match reasons, persisted student goals, and deterministic major-requirement progress are visible; general education, residency, waivers, and substitutions are explicitly excluded from the estimate.
- Activities and weekly-hour workload tracking. SMCCD load uses the official three-hours-of-total-work-per-unit convention, only the current plan year is treated as simultaneous, and unknown d.tech homework time is not fabricated.
- Editable grade-aware timeline generation.
- Four-control simulator for major direction, path intensity, course style, and activity load, with current/simulated metrics, risks, tradeoffs, and saved runs.
- Lightweight generated student summaries with a deterministic fallback.

### Supabase

- Six applied migrations containing 27 application tables, enums, constraints, indexes, triggers, helper functions, RLS, storage policies, onboarding preferences, transcript provenance, SMCCD curriculum and goals, open email registration, repaired transcript requirement mappings, workload limits, and explicit requirement overrides.
- Retained `allowed_email_domains` metadata seeded with `dtechhs.org`, with no auth trigger or registration enforcement.
- New-user trigger provisions a student profile, active four-year plan, and active version transactionally.
- Per-user RLS on profiles, sources, parse jobs, review items, plans, versions, courses, grades, activities, timeline tasks, simulations, summaries, and event logs.
- Read-only authenticated reference policies for catalog data and user-prefix policies for private uploads.
- Source-backed seed with 4 official sources, 1 versioned catalog, 41 courses, 8 graduation requirements totaling 225 credits, and 41 verified mappings.
- Migration and seed applied to linked project `zqkzgmwptdsaqbzrjngt`.
- Plan start/end grades, tracker mode/areas, transcript document type, transcript review entities, and one-import-per-review-item provenance are persisted in the linked project.
- Design Lab and Personal Development transcript aliases are normalized deterministically, verified mappings are seeded, and previously imported affected rows are repaired by migration.
- Existing SMCCD imports are repaired to weighted, and qualifying previously imported `P` intersession rows are repaired to verified Personal Development credit.
- SMCCD seeds include 3 colleges, 2,461 courses, 131 AA/AS programs, 228 requirement groups, and 2,779 parsed requirement-course options.

### Codex SDK

- Official `@openai/codex-sdk` integration isolated behind authenticated Astro API routes.
- Structured-output Zod and JSON schemas for source extraction, summaries, plan explanations, and simulator explanations.
- T3code-inspired server boundary and lifecycle management without copying its code.
- Maximum two concurrent turns, bounded timeouts, per-turn scratch directories, cleanup, read-only sandbox, no network/web search, and no approvals.
- Prompt-injection boundaries treat all uploads as untrusted data and forbid invention or tool use.
- Authenticated source parsing accepts extracted text and local image attachments, records jobs/results/latency/fallback state, and always creates a reviewable result.
- A dedicated transcript prompt excludes planned or in-progress rows, preserves explicit evidence, and never imports a course until the student confirms it.
- Deterministic planners and calculators remain functional when Codex is unavailable.
- The authenticated AI connection screen exposes credential mode, model, concurrency, the complete feature boundary, and a bounded conversational test with model and latency on each response.
- The AI conversation explicitly cannot access student records, files, the browser, or tools and explains that a successful message proves only the authenticated server-side Codex path and structured response.
- Codex is explicitly excluded from text-based transcript parsing, graduation, GPA, workload, SMCCD progress, and other deterministic planning calculations.

## Verification Results

- `pnpm lint`: pass.
- `pnpm typecheck`: pass with 0 errors, 0 warnings, and 0 hints.
- `pnpm test`: 30/30 unit tests pass, including the exact 4.00/4.74 transcript GPA method, pass-credit exclusion, A/A-minus equivalence, forced SMCCD weighting, current-year workload isolation, profile ranking, false-positive prevention, transcript layout parsing, Design Lab alias import verification, and SMCCD requirement progress.
- `pnpm test:e2e`: 4/4 Chromium tests pass, including open-email signup UI, recovery states, and a 390x844 viewport.
- `pnpm build`: Astro standalone SSR build passes.
- `pnpm peers check`: pass.
- `supabase db lint --linked`: no schema errors.
- `supabase db push --linked --include-seed --yes`: migration and seed applied.
- `pnpm smccd:validate`: 2,461 courses and 131 programs pass catalog integrity checks.
- Remote reference counts: 27 application tables, 41 d.tech courses, 8 graduation requirements, 4 d.tech official sources, 41 mappings, 2,461 SMCCD courses, and 131 SMCCD programs.
- Remote auth smoke test: an `example.com` address creates an active account, receives automatic profile/plan provisioning, signs out, and signs back in with its password.
- Remote recovery smoke test: recovery redirect generation, token verification, password update, and login with the replacement password all pass.
- Supabase Auth site URL and redirect allowlist now target Astro on port 4321, including `/reset-password` through the local wildcard entries.
- Authenticated Codex source parse: HTTP 200, structured output, 2 review items, `needs_review`, and `likely` confidence.
- Authenticated Codex connectivity test: HTTP 200 with the configured `gpt-5.4` runtime; the live diagnostics UI returned the requested response in 5,938 ms and kept the server credential private.
- Live transcript onboarding: 7 completed rows parsed and catalog matched, all 7 imported with provenance, all stored as grade 9 completions, GPA recalculated to 3.67, and selected English/Mathematics progress recalculated.
- Actual `DTech June 2026.pdf` regression: deterministic text extraction returned 50 completed rows with no parser conflicts and `aiUsed` false. The calculation reproduces the PDF's 4.00 unweighted and 4.74 weighted GPA from 270 GPA credits, 200 weighted credits, and 45 excluded pass credits; all 17 community-college rows matched exact SMCCD catalog records.
- Live import against the linked project matched the four shortened Design Lab and Personal Development labels from the supplied PDF and produced 30/40 Design Lab credits and 10/25 Personal Development credits with no unverified credits in either area.
- Live plan-window check: a grade 10-11 plan generated grades 10 and 11 only, while grade 9 transcript history remained visible and counted.
- Authenticated browser QA: the consolidated course navigation, all three status lists, compact editors, d.tech add-to-Planned flow, Planned-to-In-progress movement, transcript handoff, SMCCD search/degree separation, profile-ranked AA/AS discovery, and overview handoff pass with no browser console errors. A ranking regression check confirms that a Computer Science interest no longer treats Political Science as a match.
- Minimal importer browser QA: pasted transcript text was parsed deterministically without Codex into five selected rows, all five imported to Done in one action, and the completed state opened the Done list. Empty, populated, completed, 390x844 mobile, light, and dark states were visually reviewed.
- Final layout audit: 1,044 px desktop content canvas, zero audited horizontal overflow at 1,280 px and 390 px, compact light/dark course and transcript ledgers, mobile editing, and a bounded 12-row d.tech catalog pass. See `UX_AUDIT.md`.
- Manual browser flow: guided onboarding, focused tracker, minimal transcript upload/review/import, overview, lightweight summary, plan suggestion, snapshot creation/comparison, dark UI, and desktop layout pass.
- All temporary remote QA users and cascaded data were removed after testing.

## Known Limitations

- The official 2026-27 d.tech catalog was not published in the reviewed source set. The app intentionally uses labeled 2025-26 data until a newer official source is available.
- Production hosting has not been selected or deployed. The artifact is a working standalone Node build and needs the documented environment variables at the chosen host.
- The linked Supabase project has no custom SMTP provider. New accounts are auto-confirmed so open signup works, but confirmation and password-reset email delivery to arbitrary addresses is not production-ready until SMTP is configured.
- Production Codex calls require a server-side API key or an authenticated Codex runtime on the host. The deterministic application remains usable when AI is unavailable, and the AI connection tab reports the connection state.
- SMCCD catalog inclusion does not prove a live section is offered. Equivalencies, approvals, prerequisites, schedules, d.tech credit conversion, and transcript delivery are intentionally not inferred; students must confirm them with d.tech and the college.
- AA/AS progress covers parsed major requirements only. It does not certify general education, residency, substitutions, waivers, catalog rights, or award eligibility.
- Workload counts recorded activity hours and SMCCD class/study load. It deliberately does not guess d.tech homework time, commute time, employment, caregiving, or recovery needs; students must include those when choosing a weekly limit.
- Academic-interest, major, and career matching is deterministic discovery support based on subjects and explicit keywords. It does not predict admission, career outcomes, or personal fit and is not a counselor recommendation.
- GPA and graduation outputs reproduce the implemented source rules but remain planning tools, not transcript or counselor-of-record determinations.
- The minimal import surface focuses on the latest uploaded transcript. Previous source records remain preserved in Supabase and imported classes remain in Done, but the UI does not currently expose a transcript archive picker.

## Next Steps After MVP

1. Deploy the Node standalone build, configure production secrets, custom SMTP, email confirmation, and the Supabase redirect allowlist.
2. Import and manually review the official 2026-27 catalog when d.tech publishes it.
3. Refresh the checked-in SMCCD artifact when the district publishes the next catalog and review parser diffs before applying its migration.
4. Add live class-section and prerequisite feeds only after the colleges expose a stable approved source.
5. Add scheduled backup/restore drills, error monitoring, and production telemetry retention rules before broader rollout.
