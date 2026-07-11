# Implementation status

Last updated: 2026-07-11

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
- Experiences is one factual active/past register for time, duration, organization, role, contribution/growth, editing, and workload integration. Past experiences no longer inflate current workload.
- Next steps is one ordered queue: prerequisite blockers, uncovered requirements, then dated student/plan tasks. Live requirement gaps are not duplicated as generated tasks.
- Next-step sync is now a reconciliation: obsolete or duplicate generated steps disappear when the underlying plan changes, retained steps refresh their plan-derived detail, and Overview uses the same visible task model.
- Load check answers one deterministic question about additional SMCCD units and changed activity hours. It states the three-hours-per-unit assumption, clamps impossible reductions, preserves the real plan, and does not claim a capacity judgment until a weekly limit exists.
- Planning preferences is one readable brief with progressively disclosed direction and capacity editors. It saves independently from onboarding, and its course-match count excludes completed, wrong-grade, below-level, and prerequisite-blocked d.tech courses.
- Workload uses active experiences and current-year college-unit study time and never invents d.tech homework. Load results invalidate when their underlying activity, course, capacity, or stress inputs change.

### AI boundary

- Codex SDK runs on authenticated Node routes with structured streaming, cancellation, a bounded two-active/four-waiting queue, recursive secret redaction, payload limits, isolated runtime homes, and no browser credential exposure.
- Reviews return one direct answer, at most three evidence-backed observations, one proposed action, and one verification note. Focused decision tools keep this optional review collapsed so AI does not become a second page feature.
- Every review exposes the exact instruction/snapshot, a monotonic sanitized SDK lifecycle, reasoning summaries when emitted, full observed command/MCP/file payloads, structured result, total/queue/execution timing, usage, model, thread, capability limits, and an explicit JSON export. Disabled capabilities are labeled Disabled rather than reported as zero activity.
- Student review threads explicitly disable network, browser/computer tools, shell, MCP/plugins, skills, file mutation, image generation, workspace tools, and subagents. `show_raw_agent_reasoning` remains false.
- Image-only transcript and unstructured-source parsing now buffer and return the same sanitized SDK lifecycle, usage, thread, capabilities, and observed tool/file activity. Onboarding and the later transcript workspace share the same progressively disclosed run inspector. They still write only to the manual review boundary.
- Plan generation and scenario calculation no longer trigger AI automatically.
- AI connection reports provider, credential mode, model, reasoning, runtime, diagnostics input, provider/local-retention boundary, trace coverage, and the exact used/not-used feature matrix.
- The app requests `gpt-5.6-luna` with `low` reasoning, displayed to users as Light.

## Verification evidence

- `pnpm lint`: passing.
- `pnpm typecheck`: passing with zero errors.
- `pnpm test`: 116 tests passing across 15 files, including generated next-step reconciliation, inactive-experience workload exclusion, bounded activity reduction, catalog eligibility, math progression, cached SMCCD prerequisite evaluation, associate-degree evidence, transcript GPA, the conservative UC GPA lens, Codex redaction/status boundaries, unresolved discipline rules, and the selected Path contract.
- `pnpm verify:fast`: passing. The broad working-tree dependency graph currently selects all 116 tests; the command remains the documented iterative entry point.
- Authenticated browser QA passes Experiences, Next steps, Load check, Planning preferences, and AI connection at 1800px and 390px in light/dark modes with no horizontal overflow or console errors. Focused editors, validation retention, deterministic load output, preference saving, and collapsed optional AI were checked.
- A final live `gpt-5.6-luna` diagnostic completed with Light reasoning in 8.1 seconds. It returned a moderated answer, seven monotonically sequenced lifecycle events, usage, a thread identifier, exact input, explicit disabled tool/file/skill/plugin/subagent states, a downloadable sanitized record, and no runtime error.
- Performance check: the authenticated `PlanningWorkspace` entry is now 156 kB raw instead of the previous 539 kB monolith; focused tools, onboarding, graduation, SMCCD, and AI status are lazy chunks. Global CSS decreased from 155 kB to 149 kB, and SMCCD duplicate checks use a memoized O(1) plan index.
- Current milestone gate (`lint`, typecheck, 116 unit tests, production build) passes. The previously recorded 6-test Chromium suite, palette validation, linked schema lint, SMCCD validation, and migration dry-run were not rerun because this milestone did not change catalog artifacts, semantic palette tokens, auth/RLS/storage, or schema; current user flows were checked directly in the authenticated browser instead.

## Known limitations

1. No production host, production URL, monitoring, backup drill, or retention policy is configured.
2. Custom SMTP is absent, so production confirmation and recovery delivery are not ready.
3. Production Codex needs a server credential or authenticated host runtime.
4. The 2026-27 d.tech catalog has not been published in the reviewed source set.
5. The equivalency chart is dated 2021 and needs a current counselor-approved replacement.
6. SMCCD data is curriculum, not live sections, seats, times, or instructors.
7. AA/AS progress covers parsed major requirements and catalog-tagged GE evidence, not a complete college-specific GE audit, residency, catalog rights, waivers, substitutions, or award eligibility.
8. Workload omits unentered homework, commute, employment, caregiving, sleep, and recovery.
9. Planning preferences supports exploration, but course and degree ranking still uses transparent keyword matching rather than a validated counseling model.
10. The UI has no transcript archive picker, generalized substitution/waiver/repeat engine, or one-click kanban undo.
11. Production accessibility and student usability studies have not been conducted.
12. Official logo use needs final trademark review before public launch.
13. The TypeScript Codex SDK does not expose the richer app-server deltas, approval flow, plugin attribution, or subagent events used by t3code. Those capabilities are disabled for student reviews; true protocol parity would require a separate app-server transport project.
14. The full SMCCD curriculum is still fetched when the college catalog is first opened. Client search and duplicate checks are substantially faster, but server-side pagination remains a production-scale follow-up.

## Next steps

1. Choose hosting and configure production Supabase redirects, SMTP, Codex secret, monitoring, backups, and retention.
2. Obtain a current d.tech catalog/equivalency source and counselor authority for exceptions and SMCCD clearance decisions.
3. Run accessibility and task-based usability tests with representative d.tech students.

Release gates are in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md). Durable product, academic, and AI rules are in `docs/`; this file is the single current-state and owner-attention record.
