# Test Checklist

Last run: 2026-07-09

## Automated

- [x] `pnpm lint`
- [x] `pnpm typecheck` with 0 errors, warnings, or hints
- [x] `pnpm test` with 31/31 unit tests passing
- [x] `pnpm test:e2e` with 4/4 Chromium tests passing
- [x] Narrow 390x844 authentication layout
- [x] `pnpm build` standalone Astro SSR output
- [x] `pnpm peers check`
- [x] `supabase db lint --linked` with no schema errors
- [x] All six migrations and seed applied to linked Supabase project; local and remote migration histories match
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
- [x] Onboarding saves grade, graduation year, academic direction/interests, career ideas, planning pace, workload/stress limits, plan start/end grades, tracker mode/areas, and school confirmation
- [x] Plan length is constrained to the years available through grade 12
- [x] Focused tracker requires at least one selected requirement area
- [x] Overview recalculates graduation coverage and workload
- [x] One Courses destination replaces separate academic-plan, d.tech catalog, and SMCCD navigation entries
- [x] My courses shows `In progress`, `Planned`, and `Done` simultaneously on desktop, uses count-backed single-stage tabs on mobile, and keeps rows grouped by grade
- [x] Course editing stays hidden until requested and supports status, final grade, grade level, weighting, and removal
- [x] Official d.tech catalog loads 41 courses and supports search/filter with one explicit `Add to Planned` action
- [x] Official d.tech catalog paginates 12 courses per page and uses compact markers for courses already in Done, In progress, or Planned
- [x] Graduation tracker excludes unverified mappings
- [x] Graduation headline totals and composition bars cap excess mapped credit at each requirement maximum while retaining the raw mapped breakdown
- [x] GPA calculations separate current/projected and weighted/unweighted results
- [x] Exact d.tech method reproduces 4.00 unweighted and 4.74 weighted from the supplied PDF
- [x] `P` is excluded from GPA and separated as intersession/Personal Development credit
- [x] `A-` remains visible but uses the same four-point band as `A`
- [x] Every exact or unmatched SMCCD course is weighted, including rows stored with an older false flag
- [x] Suggested plan is generated without overwriting manual rows
- [x] Suggested plan generates only grades inside the selected onboarding window
- [x] Completed courses before the selected window remain visible in transcript history
- [x] Plan rows can change status, grade, year, and weighting
- [x] Snapshot preserves a read-only course copy
- [x] Snapshot comparison shows counts, coverage, GPA, and added/removed/changed rows
- [x] Timeline, activity, SMCCD concurrent-enrollment, and simulator mutations are wired to user-owned tables
- [x] Workload uses only the current plan year, applies three total weekly hours per SMCCD unit, includes activity hours, and warns against the saved weekly and demanding-course limits
- [x] Academic interests, major direction, and career ideas produce visible course and degree match reasons
- [x] SMCCD catalog searches and filters 2,461 source-backed records across all three district colleges
- [x] SMCCD results stay empty before a search, and course search is separated from associate-degree planning
- [x] Exact SMCCD course selection persists the district foreign key, college units, plan status, and proposed d.tech credit
- [x] AA/AS discovery searches and ranks all 131 programs by profile fit or existing-course progress, exposes match reasons, persists a goal, and computes parsed major-requirement progress deterministically
- [x] Computer Science interest does not create a false Political Science match
- [x] d.tech add-to-Planned and Planned-to-In-progress browser flows pass with live count updates
- [x] Overview course summary and transcript-import handoff open the correct destination and state
- [x] Transcript import uses one file row, an optional paste-text disclosure, and one parse action
- [x] Deterministic pasted-text parsing populates the compact ledger without Codex
- [x] Select-all imports five reviewed rows to Done in one action and the completed state opens the Done list
- [x] Unified Courses, SMCCD, and AI connection browser flows pass with no console errors
- [x] Every authenticated destination has zero audited horizontal overflow and zero visible text below 10 px at 1280x720
- [x] Mobile Courses status lists, inline editor, d.tech discovery, SMCCD search, overview, navigation, and graduation visually pass at 390x844
- [x] Unified Courses workspace visually passes in both light and dark themes
- [x] Motion workspace tabs respect reduced-motion preferences and pass Left/Right/Home/End keyboard navigation
- [x] Twenty-six populated desktop/mobile/light/dark states across every authenticated destination have zero horizontal overflow, zero rendered text below 10 px, and zero browser console errors
- [x] Transcript empty, populated, and completed states visually pass at desktop and 390x844 in light and dark themes
- [x] Lightweight summary works with deterministic fallback
- [x] Desktop dark-theme UI visually reviewed in the in-app browser

## Sources and Codex

- [x] Pasted source is preserved before parsing
- [x] Authenticated Codex parse returns structured output
- [x] Parse creates review items and sets the source to `needs_review`
- [x] Transcript parser extracts only completed/final-grade course rows
- [x] Actual d.tech text-layer PDF parses 50 completed rows with no parser conflicts and `aiUsed: false`
- [x] Actual d.tech PDF produces 270 GPA credits, 200 weighted credits, and 45 excluded pass credits
- [x] All 17 college rows in the regression PDF match exact SMCCD records
- [x] Exact transcript course names and aliases match official catalog records deterministically
- [x] Supplied d.tech PDF aliases produce 30/40 Design Lab and 10/25 Personal Development credits with verified mappings
- [x] Unmatched transcript courses remain custom and unverified
- [x] Reviewed transcript rows import as completed with final grade, credits, grade level, and source provenance
- [x] Existing planned catalog rows reconcile to completed instead of duplicating
- [x] Confidence and review state remain visible and editable
- [x] Codex runs server-side with structured schema validation
- [x] AI connection tab displays provider/auth status, model, reasoning effort, CLI version, last check, access policy, concurrency, and an explicit used/not-used feature matrix
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
