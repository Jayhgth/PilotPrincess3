# Implementation status

Last updated: 2026-07-10

## Current state

The end-to-end local MVP is implemented in Astro and backed by Supabase project `zqkzgmwptdsaqbzrjngt`. It supports open email registration, onboarding, deterministic transcript import, one course workspace, d.tech graduation/A-G tracking, SMCCD course and AA/AS discovery, student decision tools, and transparent server-only Codex reviews.

Jay selected the temporal Path concept as the production Overview. The review switcher and four unused alternatives are removed; the page now follows Finished, In progress, and Next with compact GPA/workload context, tasks, and the latest plan note.

## Product decisions in force

- Astro overrides the older stack reference in the Spec Sheet.
- The app was built independently and does not use PilotPrincess2.
- Any valid email may register. Accounts are temporarily auto-confirmed until custom SMTP exists.
- Parent accounts are out of MVP scope; summaries are lightweight student-facing notes.
- Text-layer transcript parsing and every planning calculation are deterministic.
- Codex is server-only and limited to explicit transparent reviews, unstructured policy review, and scan/image interpretation. It never owns planning calculations or silently mutates a plan.
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
- d.tech and SMCCD use a researched search-first catalog pattern with visible planning-year context, official institution selectors, decision-sized rows, one detail panel, and reduced-motion-safe React Bits transitions.
- Catalog eligibility removes already represented courses, d.tech courses outside the selected planning grade, lower sequential math, and prerequisite-blocked options. Standard/Honors aliases and full-year chronology are covered by tests and repeated in add-handler guards. See [docs/ACADEMIC_RULES.md](./docs/ACADEMIC_RULES.md).
- Official SMCCD catalog, prerequisite/corequisite evidence, directional equivalency rules, and a three-college AA/AS planning audit.
- SMCCD catalog search now uses a deferred normalized index, exact-code ranking, bounded evaluation, and a cached prerequisite graph instead of rebuilding the 2,461-course graph for every result on every keystroke.
- Associate-degree planning has AA/AS and college filters, progress/profile/all discovery, completed-versus-projected degree-applicable and major units, requirement-level course evidence, missing catalog options, conservative next-course links, and catalog-tagged GE evidence. Interdisciplinary, GPA, grade, and residency text conditions remain visibly flagged for review.

### Outcomes and decisions

- Graduation distinguishes earned, current, planned, unverified, and open credit and exposes applied courses and source limits.
- Deterministic science lanes, Level 3 language sequence completion, conservative A-G mapping, and exact GPA reproduction for the supplied PDF.
- Selected four-year Path Overview aligned to the Done/In progress/Planned course model.
- GPA is now a two-lens evidence workspace: exact d.tech transcript methodology and a conservative UC capped-weighted grade 10-11 A-G estimate.
- Activities is an experience portfolio with time, duration, organization, role, contribution/growth, active/past state, editing, and workload integration.
- Timeline is a decision sequence separating academic/admin checks from exploration work and bringing prerequisite blockers into the action flow.
- Simulator is a deterministic Scenario lab. It runs without AI, states exact assumptions, preserves the real plan, and offers a separate optional tradeoff review.
- Student profile is now a Student compass with academic interests, RIASEC-inspired self-selected work interests, work values, exploration questions, and capacity constraints.
- Workload uses recorded activities and current-year college-unit study time and never invents d.tech homework.

### AI boundary

- Codex SDK runs on authenticated Node routes with streamed structured output, timeout, concurrency, event sanitization, and no browser credential exposure.
- Overview, GPA, Activities, Timeline, Scenario lab, and Student compass have explicit Run transparent review actions. Each run exposes the exact instruction/snapshot, SDK lifecycle, safe reasoning summaries, tool/file events, structured evidence, proposed navigation actions, usage, latency, model, thread, and limits.
- Student review threads disable network, tools, file access, and mutations. The UI explicitly reports zero tools/files when none occur. `show_raw_agent_reasoning` remains false.
- Image-only transcript and unstructured-source responses return an inspectable AI disclosure and still write only to the manual review boundary.
- Plan generation and scenario calculation no longer trigger AI automatically.
- AI connection reports provider, credential mode, model, reasoning, runtime, latency, diagnostics input, transparency contract, and the exact used/not-used feature matrix.
- The app requests `gpt-5.6-luna` with `low` reasoning, displayed to users as Light.

## Verification evidence

- `pnpm lint`: passing.
- `pnpm typecheck`: passing with zero errors.
- `pnpm test`: 110 tests passing across 15 files, including catalog eligibility, math progression, cached SMCCD prerequisite evaluation, associate-degree evidence, transcript GPA, the conservative UC GPA lens, Codex prompt/access boundaries, unresolved discipline rules, and the selected Path contract.
- `pnpm test:e2e`: 6 Chromium tests passing.
- Authenticated browser QA passes Overview, GPA lenses, Experience portfolio, Decision timeline, Scenario lab, Student compass, and AI connection at desktop light/dark and 390px with no horizontal overflow. The Scenario lab remains deterministic before the optional review appears.
- A live `gpt-5.6-luna` review completed with Light reasoning, grounded structured output, an inspectable instruction/snapshot, lifecycle rows, and explicit zero-tool/zero-file states.
- Production build, all four palette contrast validations, linked schema lint, SMCCD catalog validation, and linked migration dry-run pass. Migration `20260710035000_student_decision_tools.sql` is applied and local/remote histories match.

## Known limitations

1. No production host, production URL, monitoring, backup drill, or retention policy is configured.
2. Custom SMTP is absent, so production confirmation and recovery delivery are not ready.
3. Production Codex needs a server credential or authenticated host runtime.
4. The 2026-27 d.tech catalog has not been published in the reviewed source set.
5. The equivalency chart is dated 2021 and needs a current counselor-approved replacement.
6. SMCCD data is curriculum, not live sections, seats, times, or instructors.
7. AA/AS progress covers parsed major requirements and catalog-tagged GE evidence, not a complete college-specific GE audit, residency, catalog rights, waivers, substitutions, or award eligibility.
8. Workload omits unentered homework, commute, employment, caregiving, sleep, and recovery.
9. Student compass is a stronger exploration workflow, but course and degree ranking still uses transparent keyword matching rather than a validated counseling model.
10. The UI has no transcript archive picker, generalized substitution/waiver/repeat engine, or one-click kanban undo.
11. Production accessibility and student usability studies have not been conducted.
12. Official logo use needs final trademark review before public launch.
13. The production build passes but still reports a client chunk above 500 kB; route-level code splitting remains a performance follow-up.

## Next steps

1. Choose hosting and configure production Supabase redirects, SMTP, Codex secret, monitoring, backups, and retention.
2. Obtain a current d.tech catalog/equivalency source and counselor authority for exceptions and SMCCD clearance decisions.
3. Run accessibility and task-based usability tests with representative d.tech students.

Release gates are in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md). Durable product, academic, and AI rules are in `docs/`; this file is the single current-state and owner-attention record.
