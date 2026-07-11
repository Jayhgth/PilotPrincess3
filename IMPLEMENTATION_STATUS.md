# Implementation status

Last updated: 2026-07-11

## Current state

The end-to-end local MVP is implemented in Astro and backed by Supabase project `zqkzgmwptdsaqbzrjngt`. It supports open email registration, onboarding, deterministic transcript import, one course workspace, d.tech graduation/A-G tracking, SMCCD course and AA/AS discovery, student decision tools, and a persistent server-only Pilot Assistant.

Jay selected the temporal Path concept as the production Overview. The review switcher and four unused alternatives are removed; the page now follows Finished, In progress, and Next with compact GPA/workload context, tasks, and the latest plan note.

## Product decisions in force

- Astro overrides the older stack reference in the Spec Sheet.
- The app was built independently and does not use PilotPrincess2.
- Any valid email may register. Accounts are temporarily auto-confirmed until custom SMTP exists.
- Parent accounts are out of MVP scope; summaries are lightweight student-facing notes.
- Text-layer transcript parsing and every planning calculation are deterministic.
- Codex is server-only. It may read allowlisted student records after a message, but every write is an exact proposal routed through the selected Manual or separate Auto-review path and then server-side revalidated. It never owns planning calculations or silently bypasses review.
- Current official reference data is labeled 2025-26; the d.tech/SMCCD equivalency chart is labeled 2021.

## Implemented flow

### Identity and setup

- Sign in, create account, recover/reset password, sign out, and per-user RLS.
- Administrator membership is stored outside resettable student data. `jiachenhuo55@gmail.com` is provisioned as the initial administrator; only verified admins see the demo login/onboarding shortcuts or Admin settings.
- Admin settings has a guarded self-reset for QA. It removes the current admin's profile answers, plans, transcript sources and private uploads, activities, tasks, simulations, summaries, prerequisite/degree goals, logs, and Pilot conversations/images, then recreates clean onboarding defaults. The auth account and administrator membership remain.
- Six-stage onboarding and replayable setup for grade, plan window, tracker scope, direction, interests, career ideas, stress, workload limits, and optional Codex connection.
- Codex setup requires an explicit consent checkbox and successful live test before connection can be saved. Students choose from allowlisted models; GPT-5.6 Luna with Light reasoning is the recommended default, and deterministic features remain available when AI is declined.
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
- GPA is now a schedule calculator rather than a static lens page. It locks completed transcript evidence, applies student-supplied grades only to current/planned rows, compares weighted and unweighted results, exposes the saved-schedule all-A ceiling, solves the lowest uniform grade band for a target, and keeps the conservative completed-work UC estimate distinct.
- Concurrent-enrollment guardrails are source-backed database records rather than UI constants. The SMCCD seed distinguishes 11 conservative, 11.5 district fee-free, and 19 absolute concurrent thresholds; dual-enrollment thresholds are separate. CSM, Skyline, and Cañada units aggregate by term, and the schema can add other districts, terms, and quarter systems.
- Experiences and planning preferences no longer consume navigation destinations. They share one centered Student profile dialog and retain the factual active/past register, workload integration, planning brief, capacity, matching, and onboarding-review controls.
- Next steps no longer consumes a destination. Overview owns the visible queue, plan reconciliation, add, complete, and student-owned delete controls.
- The standalone Load check destination and component were removed. Workload context and source-backed college-unit limits now sit beside the GPA schedule decision they constrain; the deterministic assistant load tool remains available for conversational comparisons.
- Primary navigation is now Overview, Courses, Graduation, and GPA planner. Transcript import is entered from Courses, and Student profile is a footer utility rather than another page.

### AI boundary

- One lazy global assistant rail replaces repeated metadata-heavy review panels. A top-right control keeps it available throughout the workspace. At 1440px and wider it has a persisted t3code-style resize rail and can detach into a draggable, natively resizable floating panel; narrower desktop widths use a 420px overlay and phones use a full-width surface so the course workspace is never crushed beside the rail. The timeline uses compact user bubbles, unboxed sanitized GFM answers, copyable timestamped messages, retry-as-new-turn, streaming progress with live elapsed time, automatically folded completed reasoning labeled with its measured duration, grouped older tool calls, readable active tools, and focused approval cards.
- The composer is now one t3code-inspired floating prompt card rather than a bordered footer block. Prompt, image previews, attachment control, page-context label, review mode, stop, and circular send action share one responsive surface. Permanent instructional copy was removed; only active work or queue state appears below it.
- The composer remains interactive during a turn and clears submitted text immediately. Up to five text/image follow-ups can queue and run automatically in order; each can be removed or promoted to Steer next. Stop is a separate control, and cancelled turns persist a readable lifecycle record rather than disappearing from history.
- Conversations, messages, sanitized events, and tool calls persist in RLS-protected Supabase tables. A reloaded or newly opened page can continue the same conversation. Conversations can be renamed, archived without deletion, and later restored from the centered Pilot settings dialog. Unsent text drafts persist locally per user and conversation but are never sent before submission.
- Pilot can return one to three bounded structured questions when a missing preference blocks a useful answer. Answers are sent back as readable conversation text and linked to the originating question. Confirmed mutations produce compact Change applied receipts from the server-validated tool result and changed fields.
- Seventeen read tools cover record inventory, overview, course plan, plan versions, catalog search, graduation, course-level GPA evidence, saved-schedule GPA scenarios, provider enrollment constraints, next steps, experiences, profile, transcript sources, transcript source-to-import auditing, college goals, selected-degree progress, and deterministic load checks. They use fixed RLS-protected queries rather than model-authored SQL. Seventeen write tools cover plan snapshots, eligible plan-course changes, profile data, source-bounded enrollment preferences, experiences, next steps, and associate-degree goals.
- Read tools run automatically within a turn. Write tools persist as exact pending proposals and follow the selected review route; execution always rechecks RLS, eligibility, prerequisites, transcript locks, and record state.
- A compact review-mode control now sits in the chat composer. Manual remains the default. Auto-review uses a second isolated Codex turn with a conservative approve/manual/deny schema, visible risk summary, and normal mutation revalidation. Product policy forces removals, grade edits, identity edits, and marking a course Done back to manual confirmation.
- The chat composer now supports up to eight PNG, JPEG, or WebP images through selection, paste, or drag and drop. It shows removable local thumbnails and a focused full-image preview, accepts image-only turns, persists originals in a private RLS-scoped storage bucket, restores history with signed previews, and records readable attachment lifecycle context without logging image bytes.
- Each turn retrieves a small set of tagged, source-controlled role and academic guidance chunks through Postgres full-text search. The role/style guidance now requires one-to-three-sentence default answers, at most three bullets, only decision-changing evidence, no student ratings or generic motivation, and no repeated dashboard data. The structured output schema enforces a 900-character ceiling and repairs violations before persistence. Retrieved titles remain visible as App guidance; student records remain live tool reads rather than duplicated embeddings.
- Codex SDK runs on authenticated Node routes with structured streaming, cancellation, recursive secret redaction, payload limits, isolated temporary runtime homes, and no browser credential exposure.
- Student assistant turns disable network, browser/computer tools, shell, files, MCP/plugins, skills, image generation, workspace tools, and subagents. `show_raw_agent_reasoning` remains false; only safe reasoning summaries are displayed.
- Image-only transcript and unstructured-source interpretation retain the manual-review boundary and run only for students who enabled Codex. Plan calculations and text-layer PDF extraction remain deterministic.
- The dedicated AI connection page remains a transparent runtime diagnostic. Consent, model choice, archived conversations, and interface layout live in onboarding or the centered Pilot settings dialog, not inside the chat rail.
- GPT-5.6 Luna with `low` reasoning, displayed to users as Light, is the recommended default; GPT-5.5 and GPT-5.4 Mini remain selectable fallbacks.

## Verification evidence

- `pnpm lint`: passing.
- `pnpm typecheck`: passing with zero errors.
- `pnpm test`: 153 tests passing across 22 files, including printed transcript-total and catalog-identity auditing, GPA-scenario arithmetic, enrollment-policy aggregation, queue ordering, responsive width reservation, cancelled-turn timing, question/draft/tool-fold/change-receipt helpers, Markdown sanitization, assistant image boundaries, generated next-step reconciliation, inactive-experience workload exclusion, bounded activity reduction, catalog eligibility, math progression, cached SMCCD prerequisite evaluation, associate-degree evidence, transcript GPA, the conservative UC GPA lens, Codex model/tool/knowledge/review boundaries, unresolved discipline rules, and the selected Path contract.
- `pnpm build`: passing with the Astro Node server output.
- Authenticated browser QA verified the new four-destination navigation, GPA planner, Student profile dialog, and compact Pilot surface at desktop and 390px with no document overflow. Light/dark states were inspected and the light preference restored. The exact transcript-audit prompt now forces one `Audit transcript evidence` preflight and returned: no confirmed mismatch; printed 4.00 unweighted GPA, 4.74 weighted GPA, and 315 credits match the 50 parsed/imported rows; nine graduation mappings remain verification items; Design Lab is not transcript evidence. No academic-data mutation was applied.
- The Manual/Auto-review selector, expanded tool schema, separate reviewer prompt, risk coercion, forced-manual categories, 900-character answer ceiling, and plan-snapshot proposal are covered by boundary tests. A live mutation was intentionally not run against Jay's academic records.
- Linked migration history matches through `20260711027000_enrollment_policy_profiles.sql`. Source-backed enrollment policies, per-student guardrails, provider provenance, and updated RAG guidance are applied; linked schema lint reports no errors and a dry-run confirms the remote database is up to date.
- Authenticated browser QA confirmed the requested account resolves to `jiachenhuo55@gmail.com`, renders the three administrator-only controls, opens the centered settings panel, and keeps the destructive action disabled until the explicit `RESET` confirmation. The panel was checked in light/dark desktop states and at 390 px with no horizontal overflow; the light preference was restored. The reset itself was not submitted, so Jay's current workspace was preserved. An unauthenticated endpoint request returns `401` after the origin check.
- Performance check: the authenticated `PlanningWorkspace` entry is now 156 kB raw instead of the previous 539 kB monolith; focused tools, onboarding, graduation, SMCCD, and AI status are lazy chunks. Global CSS decreased from 155 kB to 149 kB, and SMCCD duplicate checks use a memoized O(1) plan index.
- The milestone gate (`lint`, typecheck, 153 unit tests, production build) passes without warnings. This pass exercised the authenticated transcript audit and the new GPA/profile architecture without changing academic evidence. The unrelated full Playwright, palette, and SMCCD catalog gates were not required for this milestone.

## Known limitations

1. No production host, production URL, monitoring, backup drill, or retention policy is configured.
2. Custom SMTP is absent, so production confirmation and recovery delivery are not ready.
3. Production Codex needs a server credential or authenticated host runtime.
4. The 2026-27 d.tech catalog has not been published in the reviewed source set.
5. The equivalency chart is dated 2021 and needs a current counselor-approved replacement.
6. SMCCD data is curriculum, not live sections, seats, times, or instructors.
7. AA/AS progress covers parsed major requirements and catalog-tagged GE evidence, not a complete college-specific GE audit, residency, catalog rights, waivers, substitutions, or award eligibility.
8. Workload omits unentered homework, commute, employment, caregiving, sleep, and recovery.
9. Student profile supports exploration, but course and degree ranking still uses transparent keyword matching rather than a validated counseling model.
10. The UI has no transcript archive picker, generalized substitution/waiver/repeat engine, or one-click kanban undo.
11. Production accessibility and student usability studies have not been conducted.
12. Official logo use needs final trademark review before public launch.
13. Product conversation persistence is implemented in Supabase by replaying bounded history into isolated SDK turns; it is not Codex app-server session persistence. Plugins, skills, workspace tools, files, and subagents remain intentionally unavailable to the student assistant.
14. The full SMCCD curriculum is still fetched when the college catalog is first opened. Client search and duplicate checks are substantially faster, but server-side pagination remains a production-scale follow-up.
15. The retrieval corpus is curated application guidance, not a substitute for live institutional publication updates; dated academic sources still require the normal catalog refresh and review process.

## Next steps

1. Choose hosting and configure production Supabase redirects, SMTP, Codex secret, monitoring, backups, and retention.
2. Obtain a current d.tech catalog/equivalency source and counselor authority for exceptions and SMCCD clearance decisions.
3. Run accessibility and task-based usability tests with representative d.tech students.

Release gates are in [TEST_CHECKLIST.md](./TEST_CHECKLIST.md). Durable product, academic, and AI rules are in `docs/`; this file is the single current-state and owner-attention record.
