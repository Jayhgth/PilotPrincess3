# Project Notes

- Treat the linked Spec Sheet tab as the product source of truth.
- Keep Git current at meaningful milestones: inspect status, commit scoped changes, and never commit secrets.
- Use Astro for the app.
- Build independently from the Spec Sheet; do not use PilotPrincess2 as a starting point.
- Use Supabase migrations for schema, RLS, auth, and storage; verify local and linked states before claiming success.
- After changing SMCCD catalog sources, regenerate the artifact and migration and run `pnpm smccd:validate`.
- Follow the trigger matrix in `TEST_CHECKLIST.md`: run focused checks while iterating, the milestone gate before meaningful commits, and specialized or release gates only when the changed system requires them.
- For UI work, use the documented semantic light/dark tokens, official institution assets, and clear d.tech versus dual-enrollment provenance; center each destination on one student job and avoid decorative dividers, card overload, and color-only meaning.
- Validate representative authenticated desktop/mobile states in both themes. Motion must communicate state or feedback and respect reduced-motion preferences.
- Codex follows `docs/AI_TRANSPARENCY.md`: use one persistent global chat, show safe reasoning summaries and readable tool activity, run allowlisted reads automatically, and require exact user confirmation before every write; never expose hidden chain-of-thought.
- Keep documentation fixed by ownership: `README.md` for setup, `IMPLEMENTATION_STATUS.md` for milestone state, `TEST_CHECKLIST.md` for release gates, and the three topic references in `docs/`. Update an owner file instead of creating per-task implementation or integration notes.
