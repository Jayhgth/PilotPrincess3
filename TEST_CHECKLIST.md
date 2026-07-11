# Verification policy

Last reviewed: 2026-07-11

This file defines when checks are required. It is not a command history, and the full release gate is not required after every edit. Completed command results belong in `IMPLEMENTATION_STATUS.md`.

## Working loop

Use the smallest check that can catch a regression in the changed system:

| Change | During implementation | Before handoff |
| --- | --- | --- |
| Planning, transcript, GPA, prerequisite, or parser logic | Directly affected Vitest file | Full unit suite at a milestone |
| React or Astro UI | Typecheck plus the affected browser state | Lint, typecheck, unit suite, build, and one representative user flow |
| Codex consent, prompt, retrieval, review mode, tool, persistence, or stream | `tests/codex-boundaries.test.ts` plus the changed API/tool path | Milestone gate; verify the consent/test gate and one live read. When approval routing changes, test Manual, one low-risk Auto-review, and one forced-manual proposal |
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
- [ ] A live assistant turn persists across reload, shows readable reasoning/tool activity, and answers from an allowlisted student-data read.
- [ ] Codex remains unavailable until the student explicitly approves, successfully tests the selected model, and saves; declining AI leaves deterministic planning usable.
- [ ] Pilot image input accepts PNG, JPEG, and WebP by picker, paste, and drag/drop; shows removable previews; enforces eight images and 10 MB each; supports an image-only message; restores private signed previews after reload; and never sends a draft image before submit.
- [ ] Pilot conversations can be archived from active history and restored from centered settings without deleting messages, attachments, events, or tool calls. Docked width and floating size/position survive reload; mobile removes movement and resize controls.
- [ ] Conversation rename, per-conversation text drafts, copy actions, timestamps, and retry-as-new-turn work across reload without rewriting prior messages; attached-image prompts do not offer a misleading text-only retry.
- [ ] While Pilot is working, the composer remains enabled, Enter queues text or images, queued items run in order, remove does not send, and Steer records the interrupted turn before starting the selected follow-up. Stop remains a separate control.
- [ ] At 1300px the assistant uses the 420px overlay without shrinking the workspace; at 1440px it docks at 360px with no horizontal overflow; 390px remains full width. Header, timeline, Markdown, queue, and composer scroll widths never exceed the panel.
- [ ] Structured questions accept only bounded options or an allowed custom answer, persist the student's response in history, and never bypass the normal write-approval route. Older settled tool calls fold under Show more while pending approvals remain visible.
- [ ] A confirmed or auto-applied mutation renders a readable Change applied receipt from the server tool result, including the validated changed fields without exposing raw transport JSON.
- [ ] Student accounts do not render administrator or demo shortcuts. An administrator can open Admin settings, but reset remains disabled until `RESET`; an authorized reset clears owned database/storage records, restarts onboarding, and preserves the auth account and administrator membership.
- [ ] Retrieved app-guidance titles are readable, relevant to the active page, and do not replace live student-data reads.
- [ ] Manual mode shows exact arguments, does nothing when rejected, and revalidates normal product rules when confirmed.
- [ ] Auto-review shows its separate risk decision, applies only an approved low-risk proposal, and leaves destructive, grade-changing, identity-sensitive, uncertain, or high-risk proposals for the student.
- [ ] Production SMTP, redirect allowlist, HTTPS, monitoring, backups, and retention are configured.
- [ ] Automated accessibility, screen-reader review, and a task-based student usability study have been completed.
- [ ] No secret, private transcript, local `.env`, or generated test credential is staged.

## Source-specific release checks

Only when the referenced data is published or changed:

- replace or reapprove the 2021 d.tech/SMCCD equivalency chart;
- import and review the 2026-27 d.tech catalog;
- confirm official-logo use for the intended production context.
