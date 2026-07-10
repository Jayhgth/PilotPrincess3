# Implementation Status

Last updated: 2026-07-10

## Current State

- Strict local-MVP implementation grade: `90/100`; the separate audit grades UI/UX at `91/100` and student usefulness at `86/100`.
- The complete student flow is implemented in Astro and backed by the linked Supabase project `zqkzgmwptdsaqbzrjngt`.
- No code or data was copied from PilotPrincess2. The implementation was built from the linked Spec Sheet, the user's clarifications, official d.tech sources, official Codex SDK documentation, and architectural review of `t3code`.
- The production build, 73 unit tests, six browser tests, remote schema lint, remote auth/RLS/storage smoke checks, open-email signup, password login, recovery-token flow, actual-PDF transcript import, SMCCD catalog/equivalency/prerequisite validation, and Codex connectivity check all pass.

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
- A transparent Pilot Princess brand mark now combines an abstract `P`, upward route arrow, and restrained three-point crown in the existing burgundy/graphite palette. The reusable mark replaces every temporary `PP` box across authentication, recovery, onboarding, loading, and the workspace sidebar, with SVG and PNG favicon assets included.
- Three primary destinations (`Overview`, `Courses`, and `Graduation`) and seven secondary tools behind `More tools`, with a measured 1,044 px desktop content canvas, no audited horizontal overflow, and no authenticated product text below 12 px.
- A coherent academic-workspace visual system now replaces repeated full-width metric and record cards: Overview uses one earned-credit snapshot, a compact requirement index, and an explicit Course plan action; Courses uses a three-stage done/current/planned board; Graduation uses one benchmark-style earned/scheduled/open comparison matrix; and GPA uses one current/projected comparison table.
- A documented product UI system in `UI_DESIGN_SYSTEM.md` defines the typography roles, spacing scale, control sizes, surface hierarchy, separator rules, form rules, responsive page patterns, and review checklist. It is grounded in current Linear, Atlassian, Carbon, and USWDS product guidance rather than one-off page styling.
- Product typography now resolves to shared 12 px supporting/label, 14 px body/control, 16 px section, 20 px numeric, 28 px page-title, and 40 px single-display-metric roles. One-off 10, 11, 13, 15, 17, 18, 21, and 23 px app roles and arbitrary font weights were removed.
- Activity, Timeline, Simulator, Student profile, GPA, transcript import, AI connection, and onboarding now use the same page header, form rhythm, label hierarchy, helper-text tone, surface hierarchy, and compact responsive sizing as the primary academic views.
- Student profile is split into keyboard-accessible Basics, Direction, and Capacity tabs, so one editing task is visible at a time. A compact Planning impact panel explains only the active section's downstream effects, school confirmation stays with Basics, and one consistent save bar replaces the previous 2,749 px all-at-once form.
- Activities and Timeline now lead with one decision summary and place the current register before the quieter composer. Timeline prerequisite issues use one disclosure. Simulator uses a stable current-versus-scenario matrix without carding every row, and GPA keeps its complete per-course calculation ledger behind an evidence disclosure.
- AI connection now shares the full authenticated page frame and groups status, runtime metadata, access policy, live testing, and feature boundaries without a cell-divider grid. Transcript import remains deliberately narrower and minimal because its task does not benefit from a dashboard summary.
- Repeated page-header rules, form-card outlines, per-row dividers, and unselected choice borders were removed from the revised tools. Softer global separator tokens remain only for control boundaries, selected states, and major structural divisions.
- Motion-powered workspace tabs provide one restrained shared-state transition, respect reduced-motion preferences, and support Left/Right/Home/End keyboard navigation. The rest of the UI remains static so motion communicates state instead of decorating the page.
- Open email/password account creation, clear sign-in errors, forgot-password requests, and a secure password-update callback page.
- The public sign-in hero now uses a separately loaded, locally owned React Bits Floating Lines adaptation tuned to the product's near-black graphite and deep-rose palette. The shader renders its darker base and saturated line colors directly across the full page, without a gray veil or grid-boundary tint. The sign-in task and CSS fallback render independently of the Three.js chunk, while the shader pauses when hidden or off-screen, limits pixel density, uses gentle fine-pointer response, and renders a static reduced-motion frame.
- Authentication now sits in a compact, left-biased translucent graphite React Bits Spotlight Card instead of filling or whitening the right column. Its neutral-white spotlight follows fine-pointer movement without React re-renders, relocates to keyboard focus, preserves form contrast across root themes, and pairs with one reduced-motion-safe entrance transition.
- Five-stage onboarding for student details, planning priorities, a 1-4 year planning window, full or selected graduation tracker areas, and optional transcript import.
- Completed users can replay onboarding from Student profile for preference changes. Two temporary demo shortcuts sit together above the sidebar theme control: one replays onboarding and the other previews the full hero/sign-in page without ending the active session. Both carry demo-placement metadata, and the login preview includes a direct return to the workspace. Replay edits stay local until the final save, exiting discards them, and existing course records remain untouched.
- The onboarding priorities step groups each choice section with explicit responsive spacing so legends, helper text, and capacity controls remain visually separate in both themes.
- Student profile editing for name, age, grade, graduation year, structured academic interests, other interests, major direction, career ideas, planning intensity, a demanding-course limit, a weekly commitment limit, stress baseline, plan window, and tracker scope. Every field states and exposes the planning output it changes.
- Minimal transcript import for PDF, DOCX, TXT, CSV, PNG, JPEG, WebP, and pasted text, with a private 15 MB bucket. One file row and one `Read transcript` action replace the previous generic source-management form.
- Compact transcript review ledger with useful course fields, select-all and per-row selection, editable structured corrections behind disclosure, one bulk import action, preserved raw material, manual fallback, and a direct handoff to Done after import.
- Transcript-specific deterministic parsing for completed course names, institution, grade level, school year, term, exact final grade, high-school credits, college units, and weighting, with deterministic d.tech and SMCCD catalog matching. d.tech `P` intersession rows are separated from GPA and map to Personal Development; `A-` is preserved but uses the same four-point GPA band as `A`; every SMCCD row is weighted.
- One consolidated Courses workspace replaces the separate academic-plan, d.tech catalog, and SMCCD destinations. Its kanban order is `Done`, `In progress`, then `Planned`; all three remain visible in one horizontal board on desktop and narrow screens. The entire collapsed surface of an editable card is draggable, with clear grab/pickup/drop feedback and destination-aware grade/year changes. Edit remains an independent action. Transcript-backed rows are visibly locked in Done and cannot move.
- Searchable/filterable/paginated official d.tech catalog with 41 source-backed courses, one explicit `Add to Planned` action, compact existing-status markers, profile-specific match reasons only, and a shared list-and-detail browser that keeps prerequisite evidence beside the selected course.
- Deterministic, plan-aware prerequisite evaluation now supports exact course requirements, AND/OR groups, minimum grades, prior/concurrent timing, grade-level rules, and independently reviewed placement/equivalency clearances. It reports `Ready`, `Missing prerequisite`, or `Counselor review` without treating ambiguous catalog prose as satisfied; the Timeline links unresolved planned courses back to the relevant catalog.
- Graduation tracker with separate earned, current, planned, open, and unverified values across all eight requirements. The primary percentage counts earned credit only; scheduled credit is not presented as completion. Compact requirement rows replace decorative and misleading progress bars.
- Overview and Graduation were rebuilt from a documented benchmark review of Artificial Analysis, LiveBench, ARC Prize, Tailwind application data-display patterns, and React Bits. Both pages now lead with one primary answer, keep supporting measures aligned in shared groups, expose source/rule evidence beside the relevant data, and reserve borders for structural or interactive boundaries.
- Two locally owned React Bits adaptations provide restrained entrance/number behavior with reduced-motion support. Critical credit percentages render their exact final values immediately rather than animating through inaccurate intermediate states.
- Laboratory Science applies the official 10-credit Biology + 10-credit Chemistry + 10-credit third-science structure, so duplicate science credit cannot falsely complete the requirement. A verified Level 3/III world-language course satisfies the full 20-credit sequence without requiring lower levels, while remaining at its actual Done/In progress/Planned stage.
- GPA tracker with current/projected and weighted/unweighted values, separate GPA/weighted/pass credit totals, and an on-screen explanation of the d.tech method.
- Non-destructive source-backed variable-length plan suggestions, compact inline editing for status/year/grade/weighting, grade-grouped transcript history, removal, collapsed plan versions, snapshots, and real active-versus-snapshot comparison.
- Suggestions compare canonical course names as well as catalog IDs, so transcript variants such as `Pre-Calculus Honors` cannot be suggested again as `Precalculus Honors` even when an older import lacks a catalog ID. The linked duplicate was removed and its transcript-backed row was mapped to the verified catalog course.
- Source-backed SMCCD concurrent-enrollment planning with 2,461 exact district courses across Cañada College, College of San Mateo, and Skyline College. The catalog stays empty until the student searches, uses the same stable list-and-detail selection flow as d.tech, separates course search from associate-degree planning, and exposes official prerequisite, corequisite, recommended-preparation, general-education, transfer, and degree-applicability context.
- Searchable, ranked AA/AS discovery across 131 programs, with separate views for profile matches, existing-course progress, and the complete district set. Match reasons, persisted student goals, and deterministic major-requirement progress are visible; general education, residency, waivers, and substitutions are explicitly excluded from the estimate.
- Activities and weekly-hour workload tracking. SMCCD load uses the official three-hours-of-total-work-per-unit convention, only the current plan year is treated as simultaneous, and unknown d.tech homework time is not fabricated.
- Editable grade-aware timeline generation.
- Four-control simulator for major direction, path intensity, course style, and activity load, with current/simulated metrics, risks, tradeoffs, and saved runs.
- Lightweight generated student summaries with a deterministic fallback.

### Supabase

- Eleven applied migrations containing 29 application tables, enums, constraints, indexes, triggers, helper functions, RLS, storage policies, onboarding preferences, transcript provenance, SMCCD curriculum/goals/equivalencies/prerequisites, open email registration, repaired transcript requirement mappings, workload limits, explicit requirement overrides, transcript/catalog name reconciliation, and reviewed prerequisite-clearance submissions.
- Retained `allowed_email_domains` metadata seeded with `dtechhs.org`, with no auth trigger or registration enforcement.
- New-user trigger provisions a student profile, active four-year plan, and active version transactionally.
- Per-user RLS on profiles, sources, parse jobs, review items, plans, versions, courses, grades, activities, timeline tasks, simulations, summaries, and event logs.
- Read-only authenticated reference policies for catalog data and user-prefix policies for private uploads.
- Source-backed seed with 5 official sources, 1 versioned catalog, 41 courses, 8 graduation requirements totaling 225 credits, and 41 verified d.tech mappings.
- Migration and seed applied to linked project `zqkzgmwptdsaqbzrjngt`.
- Plan start/end grades, tracker mode/areas, transcript document type, transcript review entities, and one-import-per-review-item provenance are persisted in the linked project.
- Design Lab and Personal Development transcript aliases are normalized deterministically, verified mappings are seeded, and previously imported affected rows are repaired by migration.
- Existing SMCCD imports are repaired to weighted, and qualifying previously imported `P` intersession rows are repaired to verified Personal Development credit.
- SMCCD seeds include 3 colleges, 2,461 courses, 131 AA/AS programs, 228 requirement groups, and 2,779 parsed requirement-course options.
- SMCCD course-detail enrichment preserves official prerequisites, corequisites, recommended preparation, general-education attributes, detail verification state, and the authoritative degree-applicability source. Student-submitted prerequisite clearances remain pending under RLS until independently reviewed; students cannot self-approve them.
- The official d.tech/SMCCD equivalency chart is preserved as a 120-row dated artifact and linked read-only table. Exact matches set d.tech credits and requirement area; the UI states that the chart was last updated in 2021 and still requires current approval confirmation.
- Transcript evidence repairs now treat the d.tech `*` marker as UC A-G approval rather than Honors. Only an explicit Honors course title weights a d.tech course; every SMCCD course remains weighted. Exact reviewed transcript labels are preserved for display even when a broader catalog row supplies the mapping.

### Codex SDK

- Official `@openai/codex-sdk` 0.144.1 integration isolated behind authenticated Astro API routes.
- The required 0.144.1 runtime is pinned. Its official platform binaries have a temporary package-name exception from pnpm's 24-hour release-age quarantine so clean installs work during the GPT-5.6 launch window.
- Structured-output Zod and JSON schemas for source extraction, summaries, plan explanations, and simulator explanations.
- T3 Code-inspired server boundary and lifecycle management without copying its code.
- The default runtime is `gpt-5.6-luna` with `low` reasoning, the Codex SDK/CLI equivalent of the Light setting in Codex app surfaces. The bounded diagnostics path omits its synthetic welcome message from model history and disables unrelated Codex plugins, apps, shell tools, hooks, goals, and multi-agent features to reduce startup context and latency.
- Maximum two concurrent turns, bounded timeouts, per-turn scratch directories, cleanup, read-only sandbox, no network/web search, and no approvals.
- Prompt-injection boundaries treat all uploads as untrusted data and forbid invention or tool use.
- Authenticated source parsing accepts extracted text and local image attachments, records jobs/results/latency/fallback state, and always creates a reviewable result.
- A dedicated transcript prompt excludes planned or in-progress rows, preserves explicit evidence, and never imports a course until the student confirms it.
- Deterministic planners and calculators remain functional when Codex is unavailable.
- The authenticated AI connection screen uses a T3 Code-style provider probe and exposes connected/unavailable/checking states, authentication method, model, reasoning effort, Codex CLI version, last check time, concurrency, sandbox policy, the complete feature boundary, and a separate live generation check.
- Nested Codex runtime failures are decoded before reaching the UI; an outdated server now produces a direct restart instruction instead of exposing raw provider JSON.
- The AI conversation explicitly cannot access student records, files, the browser, or tools and explains that a successful message proves only the authenticated server-side Codex path and structured response.
- Codex is explicitly excluded from text-based transcript parsing, graduation, GPA, workload, SMCCD progress, and other deterministic planning calculations.

## Verification Results

- `pnpm lint`: pass.
- `pnpm typecheck`: pass with 0 errors, 0 warnings, and 0 hints.
- `pnpm test`: 73/73 unit tests pass, including applied-credit capping, the exact 4.00/4.74 transcript GPA method, pass-credit exclusion, A/A-minus equivalence, evidence-based Honors detection, forced SMCCD weighting, locked transcript moves, kanban grade transitions, structured science coverage, Level 3 language proficiency, transcript layout parsing, Design Lab alias import verification, transcript/catalog alias suggestion deduplication, SMCCD requirement progress, prerequisite parsing/evaluation/graph audits, reviewed directional-equivalency behavior, and readable Codex runtime error decoding.
- `pnpm test:e2e`: 6/6 Chromium tests pass, including the full-page animated auth composition, translucent-card contrast and placement, neutral Spotlight response, open-email signup UI, recovery states, reduced motion, and a 390x844 viewport.
- `pnpm build`: Astro standalone SSR build passes.
- Brand-mark QA: the transparent SVG loads at its intended 34 x 34 px size on the live authentication page at 1,440 x 900 and 390 x 844, remains legible over the animated dark background, and introduces no horizontal overflow. The PNG fallback retains an RGBA alpha channel.
- `pnpm peers check`: pass.
- `supabase db lint --linked`: no schema errors.
- `supabase db push --linked --include-all --yes`: the prerequisite migration was applied after the later transcript-reconciliation migration; the existing seed remains applied.
- `pnpm smccd:validate`: 2,461 courses, 131 programs, and 120 d.tech equivalencies pass catalog integrity checks.
- Remote reference counts: 29 application tables, 41 d.tech courses, 8 graduation requirements, 5 official sources, 41 d.tech mappings, 2,461 SMCCD courses, 131 SMCCD programs, and 120 d.tech/SMCCD equivalencies.
- Linked prerequisite migration check: local and remote histories match through `20260710034000`; `student_prerequisite_clearances` exists with zero promoted claims; `CSM:ENGL C1000` is verified from its course-detail page as degree applicable with Cal-GETC/AA-AS Area 1A attributes and multiple-measures placement retained for review.
- Remote auth smoke test: an `example.com` address creates an active account, receives automatic profile/plan provisioning, signs out, and signs back in with its password.
- Remote recovery smoke test: recovery redirect generation, token verification, password update, and login with the replacement password all pass.
- Supabase Auth site URL and redirect allowlist now target Astro on port 4321, including `/reset-password` through the local wildcard entries.
- Authenticated Codex source parse: HTTP 200, structured output, 2 review items, `needs_review`, and `likely` confidence.
- Authenticated Codex SDK live smoke test: `gpt-5.6-luna` with `low` reasoning returned the exact requested response after the required SDK/CLI upgrade to 0.144.1. The AI connection API and UI read the same runtime model and reasoning values dynamically.
- AI connection browser QA: connected-provider metadata, live-check feedback, and model response metadata were reviewed in light and dark themes at desktop and 390x844 mobile sizes, with zero horizontal overflow.
- Onboarding replay browser QA: a completed profile reopened the five-stage walkthrough from Student profile, reached the save screen with all 50 completed courses preserved, and discarded temporary name and weekly-hour edits on exit. Light and dark mobile states had zero horizontal overflow and no console errors.
- Onboarding priorities layout QA: all five content groups maintain explicit 24 px desktop and 20 px mobile separation; the 1,800 px desktop, 720 px tablet, and 390 px mobile states passed in both themes with zero horizontal overflow and no console errors.
- Typography and quiet-structure browser QA: all ten authenticated destinations were measured at 1,280x720; their product copy uses only the documented 12/14/16/20/28/40 px roles, every view has zero horizontal overflow, and the console remained clear. Activity, Timeline, Simulator, and Student profile also pass at 390x844; the onboarding capacity controls resolve to three equal desktop columns and one mobile column.
- Live transcript onboarding: 7 completed rows parsed and catalog matched, all 7 imported with provenance, all stored as grade 9 completions, GPA recalculated to 3.67, and selected English/Mathematics progress recalculated.
- Actual `DTech June 2026.pdf` regression: deterministic text extraction returned 50 completed rows with no parser conflicts and `aiUsed` false. The calculation reproduces the PDF's 4.00 unweighted and 4.74 weighted GPA from 270 GPA credits, 200 weighted credits, and 45 excluded pass credits; all 17 community-college rows matched exact SMCCD catalog records.
- Linked-data repair check: the supplied account retains 50 transcript rows, 270 graded credits, 200 weighted credits, and 45 pass credits; Chemistry now remains unweighted and displays its reviewed `Chemistry` title.
- Live import against the linked project matched the four shortened Design Lab and Personal Development labels from the supplied PDF and produced 30/40 Design Lab credits and 10/25 Personal Development credits with no unverified credits in either area.
- Live plan-window check: a grade 10-11 plan generated grades 10 and 11 only, while grade 9 transcript history remained visible and counted.
- Authenticated browser QA: the consolidated course navigation, all three status lists, compact editors, d.tech add-to-Planned flow, Planned-to-In-progress movement, transcript handoff, SMCCD search/degree separation, profile-ranked AA/AS discovery, and overview handoff pass with no browser console errors. A ranking regression check confirms that a Computer Science interest no longer treats Political Science as a match.
- Kanban/equivalency browser QA: Done is the left column; the transcript Chemistry row exposes no drag control; editable courses move between columns and update grade; CHIN 132 exposes `Mandarin 3 Spring` and 5 d.tech credits from the dated source; one planned CHIN 132 produces 20 planned World Language credits and zero open credits. A separate populated-card pass verified center-of-card pointer dragging, keyboard pickup/cancel, the animated drag overlay, drop-column response, isolated Edit behavior, transcript locking, dark mode, and a 390x844 layout with no document overflow.
- Prerequisite/catalog browser QA: the shared d.tech and SMCCD list-and-detail selectors, readiness states, source language, plan evidence, counselor-review questions, existing-plan states, and Timeline follow-ups pass in light/dark themes and at 390 px without horizontal overflow.
- Minimal importer browser QA: pasted transcript text was parsed deterministically without Codex into five selected rows, all five imported to Done in one action, and the completed state opened the Done list. Empty, populated, completed, 390x844 mobile, light, and dark states were visually reviewed.
- Academic workspace browser QA: 26 populated states were reviewed at 1,440x1,000 and 390x844 across every destination, both themes, all three course stages, both catalogs, desktop/mobile course editing, and the redesigned Overview and Graduation views. Every state had zero horizontal overflow, zero rendered text below 10 px, and zero console errors; workspace tabs also passed keyboard navigation.
- Overview/Graduation five-loop browser QA: desktop dark hierarchy, desktop dark comparison, disclosure interaction/density, 390x844 dark responsiveness, and desktop light contrast were reviewed against the documented acceptance rules. The final views have zero horizontal overflow, exact 91% earned and 96% plan-coverage values in the populated regression account, compact 70 px desktop requirement rows, full-row evidence disclosures, and a clearly actionable Course plan destination.
- Secondary-page coherence QA: populated Student profile, Activities, Timeline, GPA, Simulator, transcript import, onboarding, and AI connection were reviewed at 1,280x720 plus a 541 px responsive viewport in light and dark themes. Every reviewed page had zero document overflow. Student profile fell from 2,749 px and 31 bordered descendants to 757 px and 9; GPA now fits the desktop viewport with 4 structural borders while its full course evidence remains available on demand.
- Final layout audit: 1,044 px desktop content canvas, zero audited horizontal overflow, compact light/dark course and transcript ledgers, mobile editing, an applied-credit Graduation reconciliation, and a bounded 12-row d.tech catalog pass. See `UX_AUDIT.md`.
- Manual browser flow: guided onboarding, focused tracker, minimal transcript upload/review/import, overview, lightweight summary, plan suggestion, snapshot creation/comparison, dark UI, and desktop layout pass.
- All temporary remote QA users and cascaded data were removed after testing.

## Known Limitations

- The official 2026-27 d.tech catalog was not published in the reviewed source set. The app intentionally uses labeled 2025-26 data until a newer official source is available.
- Production hosting has not been selected or deployed. The artifact is a working standalone Node build and needs the documented environment variables at the chosen host.
- The linked Supabase project has no custom SMTP provider. New accounts are auto-confirmed so open signup works, but confirmation and password-reset email delivery to arbitrary addresses is not production-ready until SMTP is configured.
- Production Codex calls require a server-side API key or an authenticated Codex runtime on the host. The deterministic application remains usable when AI is unavailable, and the AI connection tab reports the connection state.
- SMCCD catalog inclusion does not prove a live section is offered. Official course-detail prerequisites are preserved and evaluated conservatively, but unresolved prose, placement, substitutions, approvals, schedules, and transcript delivery still require confirmation with d.tech and the college. The equivalency table remains an exact transcription of a chart last updated in 2021, not a claim of current approval.
- AA/AS progress covers parsed major requirements only. It does not certify general education, residency, substitutions, waivers, catalog rights, or award eligibility.
- Workload counts recorded activity hours and SMCCD class/study load. It deliberately does not guess d.tech homework time, commute time, employment, caregiving, or recovery needs; students must include those when choosing a weekly limit.
- Academic-interest, major, and career matching is deterministic discovery support based on subjects and explicit keywords. It does not predict admission, career outcomes, or personal fit and is not a counselor recommendation.
- GPA and graduation outputs reproduce the implemented source rules but remain planning tools, not transcript or counselor-of-record determinations.
- The minimal import surface focuses on the latest uploaded transcript. Previous source records remain preserved in Supabase and imported classes remain in Done, but the UI does not currently expose a transcript archive picker.
- The graduation engine explicitly models the documented science structure and Level 3 language proficiency rule. Counselor substitutions, waivers, repeated-course treatment, and future rule changes are not yet a generalized rule system.
- Kanban moves save immediately and can be changed again, but there is no one-click undo toast. On narrow screens the three-column board intentionally scrolls horizontally; cross-column dragging is less fluid than the desktop interaction, so the Edit status control remains the accessible fallback.

## Next Steps After MVP

1. Deploy the Node standalone build, configure production secrets, custom SMTP, email confirmation, and the Supabase redirect allowlist.
2. Import and manually review the official 2026-27 catalog when d.tech publishes it.
3. Refresh the checked-in SMCCD catalog and d.tech equivalency artifacts when their publishers release newer sources; review data diffs before applying generated migrations.
4. Add a live class-section feed and a staff review workflow for prerequisite clearances and unresolved catalog clauses when stable approved sources and reviewers are available.
5. Add scheduled backup/restore drills, error monitoring, and production telemetry retention rules before broader rollout.
6. Remove the temporary `@openai/codex` release-age exception after the pinned 0.144.1 platform binaries have cleared the 24-hour quarantine.
