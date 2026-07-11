# Test checklist

Last updated: 2026-07-10

This file is a release gate, not a historical log. Detailed implementation evidence belongs in `IMPLEMENTATION_STATUS.md`.

## Automated gate

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test` with 97 tests passing.
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
- [x] AI credentials remain server-only; authenticated diagnostics cannot access student files or browser state.
- [ ] Production SMTP, confirmation delivery, redirect allowlist, HTTPS, and recovery delivery pass on the deployed origin.

## Core student flow

- [x] Onboarding saves student, planning-window, tracker, direction, and capacity settings.
- [x] Transcript PDF/paste parses without Codex when text is available, preserves source data, supports review, and imports selected rows to Done.
- [x] Imported records preserve exact grade, credits, weighting, institution, school year, match evidence, and transcript lock.
- [x] Courses uses one Done/In progress/Planned board; editable cards move by drag or status control and transcript rows do not move.
- [x] Suggestions exclude completed aliases and do not overwrite manual courses.
- [x] Graduation and GPA reproduce the supplied d.tech PDF rules, including pass/fail, A-minus bands, Honors evidence, science lanes, and Level 3 language completion.
- [x] SMCCD course and AA/AS discovery preserve college, units, transfer status, prerequisites, source year, and directional equivalency evidence.
- [x] Workload uses only recorded activities and current-year college study time and explains missing inputs.
- [x] Timeline, Activities, Simulator, Profile, GPA, and AI connection persist user-owned changes.

## Overview concept review

- [x] Five concepts render from one shared deterministic data model.
- [x] Priority, Scorecard, Path, Advisor, and Two systems have distinct reading models.
- [x] All five populated desktop captures have document width equal to a 1,440px viewport.
- [x] Priority and Two systems have document width equal to a 390px viewport.
- [x] Official d.tech and SMCCD identity appears only with text provenance.
- [x] React Bits motion is limited to concept selection, reveal, and numeric state and respects reduced motion.
- [ ] Jay chooses one production concept.
- [ ] Temporary selector and four unused concepts are removed after selection.
- [ ] Selected concept passes populated light/dark desktop/mobile keyboard and screen-reader review.

## Visual and accessibility gate

- [x] Semantic light/dark tokens and Manrope type roles are shared across authenticated pages.
- [x] Product text is at least 12px; controls retain visible focus and 44px touch targets where applicable.
- [x] Course, transcript, institution, loading, empty, and error states do not rely on color alone.
- [x] Workspace tabs support Left, Right, Home, and End.
- [x] Representative local desktop/mobile states show no horizontal overflow or console errors.
- [ ] Production automated accessibility scan passes.
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
