# Verification policy

Last reviewed: 2026-07-11

This file defines when checks are required. It is not a command history, and the full release gate is not required after every edit. Completed command results belong in `IMPLEMENTATION_STATUS.md`.

## Working loop

Use the smallest check that can catch a regression in the changed system:

| Change | During implementation | Before handoff |
| --- | --- | --- |
| Planning, transcript, GPA, prerequisite, or parser logic | Directly affected Vitest file | Full unit suite at a milestone |
| React or Astro UI | Typecheck plus the affected browser state | Lint, typecheck, unit suite, build, and one representative user flow |
| Codex prompt, schema, runtime, or stream | `tests/codex-boundaries.test.ts` plus one streamed diagnostic when credentials are available | Milestone gate and an inspectable live run |
| Theme or semantic token | Affected light/dark pages | `pnpm colors:validate` and representative desktop/mobile review |
| SMCCD source or generated artifact | Focused catalog tests | `pnpm smccd:validate` and regeneration check |
| Migration, RLS, auth, or storage | Focused local test | Linked schema lint, migration-history check, dry-run push, and affected auth/RLS flow |
| Documentation only | Link and command review | No build unless the documentation changes executable configuration |

Do not run Playwright, SMCCD validation, color validation, or linked Supabase checks for unrelated changes.

## Command tiers

- `pnpm verify:fast`: typecheck and tests related to uncommitted changes. Use during a mixed implementation loop.
- `pnpm verify:milestone`: lint, typecheck, all unit tests, and production build. Use before a meaningful Git milestone.
- `pnpm verify:release`: milestone gate plus Playwright, palette, and SMCCD validation. Use for a release candidate.

Individual tests remain preferable while debugging, for example:

```bash
pnpm exec vitest run tests/planning.test.ts
pnpm exec vitest run tests/codex-boundaries.test.ts
```

## Release-only gate

Before a production release, confirm all applicable items once:

- [ ] `pnpm verify:release` passes.
- [ ] Linked Supabase schema lint passes, local and linked migration histories match, and dry-run push shows no unintended change.
- [ ] Sign-up, sign-in, recovery, transcript import, course planning, graduation interpretation, and SMCCD discovery work on the deployed origin.
- [ ] Representative authenticated desktop and 390px states pass in both themes with keyboard focus and no horizontal overflow.
- [ ] A live Codex diagnostic shows exact input, complete sanitized SDK lifecycle, reasoning summaries, capability limits, result, usage, and retention policy.
- [ ] Production SMTP, redirect allowlist, HTTPS, monitoring, backups, and retention are configured.
- [ ] Automated accessibility, screen-reader review, and a task-based student usability study have been completed.
- [ ] No secret, private transcript, local `.env`, or generated test credential is staged.

## Source-specific release checks

Only when the referenced data is published or changed:

- replace or reapprove the 2021 d.tech/SMCCD equivalency chart;
- import and review the 2026-27 d.tech catalog;
- confirm official-logo use for the intended production context.
