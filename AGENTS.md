# Project Notes

- Use the current code and Jay's latest decisions as product truth. Do not fetch the old Spec Sheet or other Google Docs unless Jay explicitly asks.
- Keep the app on Astro and put Supabase schema, RLS, auth, and storage changes in migrations. Never commit secrets.
- Preserve every working student flow, official institution asset, written d.tech/SMCCD provenance, and accessible light/dark behavior when changing UI.
- Keep Pilot Assistant opt-in and within `docs/AI_TRANSPARENCY.md`: validated reads, exact proposed writes, normal product rules at execution, and no hidden chain-of-thought.
- Treat Pilot Princess as a student-first academic planning product. Application features may expand later, but do not introduce counselor/guardian collaboration, live enrollment, or admissions claims without an explicit product decision.
- Register cross-feature reads and writes in `src/lib/app-capabilities.ts`. UI and Pilot mutations must share normal validation, affected-domain invalidation, receipts, and undo behavior. Preserve RAG and student memory when reorganizing Pilot.
- Use `get_workspace_snapshot_v1` for initial authenticated state, targeted workspace refreshes after mutations, and atomic RPCs for multi-row course or transcript changes.
- Keep school readiness explicit: discovery, partial support, and complete support are different states. Never borrow another school's catalog, diploma rules, or planning profile.
- Keep authentication provider-neutral and PKCE-based. Provision every verified Supabase user through `ensure_current_user_workspace_v1`, keep RLS ownership as the feature-access boundary, and never commit OAuth or service-role secrets.
- Run `pnpm check` for normal changes. Run focused, full, browser, catalog, or linked-Supabase checks only when the changed system or a release actually needs them.
- Any Pilot schedule-generation change must keep a focused live read → proposal → validated apply → undo test. A prose preview or read-tool assertion alone is not sufficient, and at least one supported four-year rebuild must finish with an applied, reversible schedule.
- Keep the normal Vitest suite at 70 tests or fewer. Prefer academic invariants, auth boundaries, command contracts, and one canonical live Pilot workflow over prompt-string duplication.
- Keep documentation limited to `README.md` and durable references in `docs/`. Do not create task logs, completion reports, implementation-status files, or extra checklists.
- Inspect Git status and commit coherent milestones without including unrelated work.
