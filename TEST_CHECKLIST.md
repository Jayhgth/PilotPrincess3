# Test checklist

Last updated: 2026-07-10

This file is a release gate, not a historical log. Detailed implementation evidence belongs in `IMPLEMENTATION_STATUS.md`.

## Automated gate

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test` with 110 tests passing.
- [x] `pnpm test:e2e` with 6 Chromium tests passing.
- [x] `pnpm build`
- [x] `pnpm colors:validate`
- [x] `pnpm smccd:validate`
- [x] `supabase db lint --linked`
- [x] Local and linked migration histories match.
- [x] `supabase db push --linked --dry-run` reports no unintended change.

## Authentication and security

- [x] Any valid email may register and receives a profile, active plan, and active version.
- [x] Sign-in, sign-out, recovery token, password update, and replacement-password login work.
- [x] User-owned records and private source files are isolated by RLS and storage policies.
- [x] AI credentials remain server-only; authenticated student reviews cannot access the browser, network, files, or tools and cannot mutate plan data.
- [x] Transparent reviews expose exact input, safe reasoning summaries, SDK lifecycle, tool/file state, structured output, usage, model, latency, thread, and limits.
- [ ] Production SMTP, confirmation delivery, redirect allowlist, HTTPS, and recovery delivery pass on the deployed origin.

## Core student flow

- [x] Onboarding saves student, planning-window, tracker, direction, and capacity settings.
- [x] Transcript PDF/paste parses without Codex when text is available, preserves source data, supports review, and imports selected rows to Done.
- [x] Imported records preserve exact grade, credits, weighting, institution, school year, match evidence, and transcript lock.
- [x] Courses uses one Done/In progress/Planned board; editable cards move by drag or status control and transcript rows do not move.
- [x] Suggestions exclude completed aliases and do not overwrite manual courses.
- [x] Catalog discovery excludes exact/normalized plan duplicates, courses outside the selected d.tech grade, lower sequential math, and prerequisite-blocked results.
- [x] Full-year courses preserve grade chronology; standard/Honors aliases satisfy reviewed course-family prerequisites without inventing lateral math ordering.
- [x] Catalog add handlers repeat the eligibility checks so stale selections cannot bypass the visible result rules.
- [x] Graduation and GPA reproduce the supplied d.tech PDF rules, including pass/fail, A-minus bands, Honors evidence, science lanes, and Level 3 language completion.
- [x] SMCCD course and AA/AS discovery preserve college, units, transfer status, prerequisites, source year, and directional equivalency evidence.
- [x] Workload uses only recorded activities and current-year college study time and explains missing inputs.
- [x] Experience portfolio, Decision timeline, Scenario lab, Student compass, GPA lenses, and AI connection persist user-owned changes.
- [x] UC GPA planning lens includes only verified grade 10-11 A-G coursework, ignores plus/minus distinctions, caps eligible honors semesters, and reports unresolved rows.

## Selected Overview

- [x] Jay selected the four-year Path concept.
- [x] The temporary selector and four unused concepts are removed.
- [x] Finished, In progress, and Next render from one deterministic data model.
- [x] Course source labels preserve d.tech or college provenance in text and scoped color.
- [x] React Bits motion is limited to reveal and numeric state and respects reduced motion.
- [x] Selected Path passes populated light/dark desktop/mobile semantic-DOM and overflow review.

## Visual and accessibility gate

- [x] Semantic light/dark tokens and Manrope type roles are shared across authenticated pages.
- [x] Product text is at least 12px; controls retain visible focus and 44px touch targets where applicable.
- [x] Course, transcript, institution, loading, empty, and error states do not rely on color alone.
- [x] Workspace tabs support Left, Right, Home, and End.
- [x] Representative local desktop/mobile states show no horizontal overflow or console errors.
- [x] Overview and every decision tool pass authenticated desktop light/dark and 390px composition checks; a live transparent review completes with inspectable lifecycle and input data.
- [x] d.tech and SMCCD catalog components pass light/dark 1,440px and 390px composition checks, including official marks, selected rows, details, and compact college filters.
- [ ] Production automated accessibility and screen-reader review passes.
- [ ] Task-based student usability study covers transcript import, course planning, graduation interpretation, and SMCCD discovery.

## Data and source gate

- [x] d.tech and SMCCD source years are visible.
- [x] SMCCD artifact validates 2,461 courses and 131 AA/AS programs.
- [x] d.tech/SMCCD equivalency artifact validates 120 reviewed rows and remains directional.
- [x] Unresolved prerequisite prose remains `needs_review` and never becomes success by inference.
- [ ] Replace or reapprove the 2021 equivalency chart before authoritative public use.
- [ ] Import and review the 2026-27 d.tech catalog when published.
- [ ] Confirm official-logo use for the intended production context.

## Cleanup

- [x] Temporary QA accounts and cascaded data are deleted.
- [ ] No secrets, private transcripts, local `.env`, or generated test credentials are staged.
- [ ] `IMPLEMENTATION_STATUS.md` records final command results and remaining gaps.
