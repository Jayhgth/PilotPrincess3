# Project Notes

- Use the current code and Jay's latest decisions as product truth. Do not fetch the old Spec Sheet or other Google Docs unless Jay explicitly asks.
- Keep the app on Astro and put Supabase schema, RLS, auth, and storage changes in migrations. Never commit secrets.
- Preserve every working student flow, official institution asset, written d.tech/SMCCD provenance, and accessible light/dark behavior when changing UI.
- Keep Pilot Assistant opt-in and within `docs/AI_TRANSPARENCY.md`: validated reads, exact proposed writes, normal product rules at execution, and no hidden chain-of-thought.
- Run `pnpm check` for normal changes. Run focused, full, browser, catalog, or linked-Supabase checks only when the changed system or a release actually needs them.
- Any Pilot schedule-generation change must keep a focused live read → proposal → selected-review-mode apply → undo test. A prose preview or read-tool assertion alone is not sufficient, and at least one supported four-year rebuild must finish with an applied, reversible schedule.
- Keep documentation limited to `README.md` and durable references in `docs/`. Do not create task logs, completion reports, implementation-status files, or extra checklists.
- Inspect Git status and commit coherent milestones without including unrelated work.
