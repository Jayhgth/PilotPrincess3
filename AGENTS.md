# Project Notes

- Treat the linked Spec Sheet tab as the product source of truth.
- Keep Git current at meaningful milestones: inspect status, commit scoped changes, and never commit secrets.
- Use Astro for the app.
- Build independently from the Spec Sheet; do not use PilotPrincess2 as a starting point.
- Use Supabase migrations for schema, RLS, auth, and storage; verify local and linked states before claiming success.
- After changing SMCCD catalog sources, regenerate the artifact and migration and run `pnpm smccd:validate`.
- Update `IMPLEMENTATION_STATUS.md` after each implementation pass with completed work, checks, gaps, and next steps.
- For UI work, use the documented semantic light/dark tokens, official institution assets, and clear d.tech versus dual-enrollment provenance; avoid decorative dividers, card overload, and color-only meaning.
- Validate representative authenticated desktop/mobile states in both themes. Motion must communicate state or feedback and respect reduced-motion preferences.
