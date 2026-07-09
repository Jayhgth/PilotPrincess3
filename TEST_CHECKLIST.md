# Test Checklist

Last run: 2026-07-09

## Automated

- [x] `pnpm lint`
- [x] `pnpm typecheck` with 0 errors, warnings, or hints
- [x] `pnpm test` with 21/21 unit tests passing
- [x] `pnpm test:e2e` with 4/4 Chromium tests passing
- [x] Narrow 390x844 authentication layout
- [x] `pnpm build` standalone Astro SSR output
- [x] `pnpm peers check`
- [x] `supabase db lint --linked` with no schema errors
- [x] Migration and seed applied to linked Supabase project
- [x] `pnpm smccd:validate` with 2,461 courses and 131 AA/AS programs

## Authentication and Security

- [x] Any valid email domain can create an immediately active account in the linked MVP project
- [x] Non-d.tech account receives automatic profile and plan provisioning
- [x] Email/password account can sign out and sign back in
- [x] Recovery redirect, token verification, password update, and replacement-password login pass remotely
- [x] Forgot-password and expired-link states are covered in Chromium
- [x] New account automatically receives its own profile, active plan, and active version
- [x] Student reference reads work through authenticated RLS
- [x] Private source file can be uploaded only under the signed-in user's folder
- [x] Private source file can be deleted by its owner
- [x] App event RPC records an authenticated event
- [x] Temporary QA account and data deleted after verification

## Student Flow

- [x] Sign-in screen renders official counts and 2025-26 source label
- [x] Onboarding saves grade, graduation year, planning pace, plan start/end grades, tracker mode/areas, and school confirmation
- [x] Plan length is constrained to the years available through grade 12
- [x] Focused tracker requires at least one selected requirement area
- [x] Overview recalculates graduation coverage and workload
- [x] Official catalog loads 41 courses and supports search/filter/add status
- [x] Official catalog paginates 12 courses per page and exposes one status selector plus one add action per row
- [x] Graduation tracker excludes unverified mappings
- [x] GPA calculations separate current/projected and weighted/unweighted results
- [x] Suggested plan is generated without overwriting manual rows
- [x] Suggested plan generates only grades inside the selected onboarding window
- [x] Completed courses before the selected window remain visible in transcript history
- [x] Plan rows can change status, grade, year, and weighting
- [x] Snapshot preserves a read-only course copy
- [x] Snapshot comparison shows counts, coverage, GPA, and added/removed/changed rows
- [x] Timeline, activity, SMCCD concurrent-enrollment, and simulator mutations are wired to user-owned tables
- [x] SMCCD catalog searches and filters 2,461 source-backed records across all three district colleges
- [x] Exact SMCCD course selection persists the district foreign key, college units, plan status, and proposed d.tech credit
- [x] AA/AS goal selection persists per student and computes parsed major-requirement progress deterministically
- [x] SMCCD browser flow and AI connection browser flow pass with no console errors
- [x] Every authenticated destination has zero audited horizontal overflow and zero visible text below 10 px at 1280x720
- [x] Mobile overview, navigation, catalog, SMCCD planner, and graduation tracker visually pass at 390x844
- [x] Lightweight summary works with deterministic fallback
- [x] Desktop dark-theme UI visually reviewed in the in-app browser

## Sources and Codex

- [x] Pasted source is preserved before parsing
- [x] Authenticated Codex parse returns structured output
- [x] Parse creates review items and sets the source to `needs_review`
- [x] Transcript parser extracts only completed/final-grade course rows
- [x] Actual d.tech text-layer PDF parses 50 completed rows deterministically with `aiUsed: false`
- [x] All 17 college rows in the regression PDF match exact SMCCD records
- [x] Exact transcript course names and aliases match official catalog records deterministically
- [x] Supplied d.tech PDF aliases produce 30/40 Design Lab and 10/25 Personal Development credits with verified mappings
- [x] Unmatched transcript courses remain custom and unverified
- [x] Reviewed transcript rows import as completed with final grade, credits, grade level, and source provenance
- [x] Existing planned catalog rows reconcile to completed instead of duplicating
- [x] Confidence and review state remain visible and editable
- [x] Codex runs server-side with structured schema validation
- [x] AI connection tab displays runtime configuration and an explicit used/not-used feature matrix
- [x] Authenticated Codex conversation succeeds, reports model and latency, and does not expose the credential or claim access to student data
- [x] Text PDF parsing and planning calculations are explicitly deterministic and do not call Codex
- [x] Upload content is treated as untrusted data with no network/tool access
- [x] Deterministic application remains usable if Codex fails or times out

## Before Production Release

- [ ] Add production URL, `/app`, and `/reset-password` callbacks to Supabase Auth redirects
- [ ] Configure custom SMTP and re-enable email confirmation without restricting email domains
- [ ] Configure production Codex secret and verify it is not exposed in browser assets
- [ ] Run the AI connection conversation on the production host
- [ ] Run the full authenticated flow on the deployed HTTPS origin
- [ ] Verify password reset and confirmation delivery on the production domain
- [ ] Confirm backup, restore, monitoring, and log-retention policies
- [ ] Re-run an accessibility audit with production browser tooling
