# Implementation status

Last updated: 2026-07-10

## Current state

The end-to-end local MVP is implemented in Astro and backed by Supabase project `zqkzgmwptdsaqbzrjngt`. It supports open email registration, onboarding, deterministic transcript import, one course workspace, d.tech graduation/A-G tracking, SMCCD course and AA/AS discovery, workload planning, timeline/activity/simulator tools, and transparent server-only Codex assistance.

This pass replaces the previous Overview with five live, data-equivalent concepts for owner review. Option A is the implementation recommendation. No concept is considered final until Jay chooses the production reading model.

## Product decisions in force

- Astro overrides the older stack reference in the Spec Sheet.
- The app was built independently and does not use PilotPrincess2.
- Any valid email may register. Accounts are temporarily auto-confirmed until custom SMTP exists.
- Parent accounts are out of MVP scope; summaries are lightweight student-facing notes.
- Text-layer transcript parsing and every planning calculation are deterministic.
- Codex is server-only and limited to requested explanations, wording, unstructured policy review, and scan/image interpretation.
- Current official reference data is labeled 2025-26; the d.tech/SMCCD equivalency chart is labeled 2021.

## Implemented flow

### Identity and setup

- Sign in, create account, recover/reset password, sign out, and per-user RLS.
- Five-stage onboarding and replayable setup for grade, plan window, tracker scope, direction, interests, career ideas, stress, and workload limits.
- Demo-only sidebar shortcuts for onboarding and login preview carry intended-placement metadata.

### Course and transcript planning

- Minimal transcript upload/paste, deterministic text-layer PDF extraction, structured review, correction, bulk import, and private storage.
- d.tech transcript semantics for pass/fail intersession, exact grades, Honors evidence, SMCCD weighting, aliases, reconciliation, and source provenance.
- One Courses destination with a `Done`, `In progress`, `Planned` kanban, full-card dragging, keyboard/mobile status fallback, locked transcript rows, editing, suggestions, and snapshots.
- d.tech and SMCCD catalog browsers share one list/detail/prerequisite pattern.
- Official SMCCD catalog, prerequisite/corequisite evidence, directional equivalency rules, and AA/AS major-requirement discovery.

### Outcomes and decisions

- Graduation distinguishes earned, current, planned, unverified, and open credit and exposes applied courses and source limits.
- Deterministic science lanes, Level 3 language sequence completion, conservative A-G mapping, and exact GPA reproduction for the supplied PDF.
- Five Overview concepts: Priority, Scorecard, Path, Advisor, and d.tech/SMCCD. See [docs/overview-options.md](./docs/overview-options.md).
- Activity, Timeline, Simulator, GPA, Student profile, and AI connection share the current visual and interaction system.
- Workload uses recorded activities and current-year college-unit study time and never invents d.tech homework.

### AI boundary

- Codex SDK runs on authenticated Node routes with structured output, timeout, concurrency, and no browser credential exposure.
- AI connection reports provider, credential mode, model, reasoning, runtime, latency, and the exact used/not-used feature matrix.
- The app requests `gpt-5.6-luna` with `low` reasoning, displayed to users as Light.
- Summary generation removes the previous note while loading and restores it on failure.

## Verification evidence

- `pnpm lint`: passing.
- `pnpm typecheck`: passing with zero errors.
- `pnpm test`: 97 tests passing across 14 files, including the shared Overview concept contract.
- `pnpm test:e2e`: 6 Chromium tests passing.
- Overview concept QA: all five synthetic populated concepts at 1,440px with no horizontal overflow; Priority and Two systems also pass at 390px.
- Production build, color contrast validation, linked schema lint, SMCCD catalog validation, and linked migration dry-run pass. Supabase auth/RLS/storage, actual-PDF parsing, and Codex connectivity passed in the latest infrastructure pass.

## Known limitations

1. No production host, production URL, monitoring, backup drill, or retention policy is configured.
2. Custom SMTP is absent, so production confirmation and recovery delivery are not ready.
3. Production Codex needs a server credential or authenticated host runtime.
4. The 2026-27 d.tech catalog has not been published in the reviewed source set.
5. The equivalency chart is dated 2021 and needs a current counselor-approved replacement.
6. SMCCD data is curriculum, not live sections, seats, times, or instructors.
7. AA/AS progress covers parsed major requirements, not GE, residency, catalog rights, waivers, substitutions, or award eligibility.
8. Workload omits unentered homework, commute, employment, caregiving, sleep, and recovery.
9. Interest/major/career ranking is transparent keyword discovery, not a developed exploration or counseling workflow.
10. The UI has no transcript archive picker, generalized substitution/waiver/repeat engine, or one-click kanban undo.
11. Production accessibility and student usability studies have not been conducted.
12. Official logo use needs final trademark review before public launch.

## Next steps

1. Jay selects one Overview concept and whether concurrent enrollment should be a first-screen priority.
2. Remove the temporary concept switcher and unused compositions, then rerun full visual QA.
3. Choose hosting and configure production Supabase redirects, SMTP, Codex secret, monitoring, backups, and retention.
4. Obtain a current d.tech catalog/equivalency source and counselor authority for exceptions and SMCCD clearance decisions.
5. Run accessibility and task-based usability tests with representative d.tech students.

Release gates are in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md). Product decisions and risks needing owner input are in [UX_AUDIT.md](./UX_AUDIT.md).
