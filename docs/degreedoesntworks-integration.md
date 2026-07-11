# DegreeDoesntWorks integration audit

Date: 2026-07-10

This audit compares `/Users/jiachen/Documents/Repos/DegreeDoesntWorks` with Pilot Princess. The reference app is treated as a feature reference, not as a codebase or product source of truth. Pilot Princess keeps its Astro, Supabase, three-college SMCCD catalog, prerequisite evidence, d.tech equivalencies, and shared academic plan.

## Reference-app inventory

| Area | DegreeDoesntWorks behavior | Pilot Princess decision |
| --- | --- | --- |
| Transcript | Uploads a PDF, parses it, stores the result in browser session storage, and feeds audits | Keep Pilot Princess's persistent transcript workflow and Supabase-backed plan. Do not restore session-only state. |
| Course catalog | Local CSM catalog with an indexed search across code, subject, title, and attributes | Adopt the cheap precomputed search index, exact-code ranking, immediate default results, and a bounded result set for all three colleges. |
| Manual courses | Separate catalog and selected tabs, completed/in-progress selection, list/card modes | Do not duplicate this page. Pilot Princess already has one course workspace, a kanban status model, transcript-backed records, and manual fallback. |
| Degree discovery | Search, AA/AS filtering, all/with-progress modes, compact degree list | Adopt search, award and college filters, course-progress/profile/all modes, and compact list/detail navigation. |
| Degree audit | Program source, major units, 60-unit degree total, GE, parsed requirement groups, fulfilled courses, missing options, warnings | Adopt the source-backed pieces available in the district catalog. Keep completed and projected evidence separate. |
| Requirement evidence | Shows applied course, status, grade, units, and term | Adopt within expandable requirement groups. |
| Missing requirements | Shows units/count still needed and eligible catalog choices | Adopt with direct “find in catalog” actions. |
| GE audit | CSM 2025-26 local AA/AS worksheet, including area-specific rules | Use district catalog tags only as GE evidence for now. Do not claim a complete district-wide GE audit from a CSM-only worksheet. |
| Recommendations | Scores unused courses against missing major and GE groups, with prerequisites flagged | Adopt a conservative “useful next course options” list from unresolved parsed major groups. The prerequisite engine still determines whether a course can be shown or added. |
| Progress display | Uses progress bars for degree and requirement coverage | Do not copy. Jay has repeatedly rejected ambiguous bars. Use completed/projected numbers and explicit state labels. |
| Authority boundaries | Warns about residency, substitutions, counseling, and manual text rules | Adopt and preserve official source links. Never present the audit as a petition or counselor approval. |
| Persistence | Browser session storage | Do not adopt. Supabase is the application source of student state. |
| Institutional scope | College of San Mateo only | Expand the useful interaction model across CSM, Skyline, and Cañada with official institution marks and campus filters. |

## Implemented in Pilot Princess

### Catalog performance

- A normalized search index is built once after the SMCCD catalog loads.
- Search input uses a deferred query so keystrokes paint before the catalog calculation.
- Exact course codes and code prefixes rank before broad title matches.
- The prerequisite catalog and planned-course evidence are built once per plan state.
- Each course prerequisite parse is cached for the browsing session.
- Eligibility is evaluated once per bounded candidate, not once during filtering and again during rendering.
- The catalog opens with eligible courses instead of requiring a search before showing any inventory.

### Associate-degree workspace

- Program search supports title, award, and college.
- Filters cover AA/AS, all three colleges, course-progress matches, profile matches, and all programs.
- The selected program has a stable detail pane rather than pushing a second audit below the list.
- Summary facts separate completed from projected major units, degree-applicable units, and parsed requirement groups.
- Requirement groups show completed/projected state, applied course evidence, the remaining count or units, and unresolved catalog options.
- Missing options link back into the filtered college catalog.
- A short next-course list derives only from unresolved parsed major requirements.
- Official catalog links and manual-review warnings remain adjacent to the evidence they qualify.
- General education is labeled as catalog-tagged evidence, not full completion, because local worksheet rules are not yet modeled consistently for all three colleges.

## Deliberately not copied

- CSM-only course data and program rules.
- Browser session storage.
- A second selected-course state outside the shared academic plan.
- Manual completed/in-progress controls that bypass the existing course workflow.
- Progress bars that combine completed and planned work into one ambiguous percentage.
- A claim that catalog attributes alone constitute an official GE, residency, or degree petition audit.
- SMCCD sign-in placeholders or enrollment automation without an approved district integration.

## Remaining source work

1. Model the official 2025-26 local AA/AS GE worksheet for each college, including minimum units, grades, course reuse, and sub-area rules.
2. Model residency, catalog-rights, GPA, grade-minimum, and petition rules with official sources.
3. Confirm whether cross-college courses with the same common course number satisfy a selected college's local program requirement automatically or require an equivalency decision.
4. Add counselor-reviewed substitutions and waivers as evidence records rather than free-text overrides.
5. Add schedule availability only when a stable official schedule source and term semantics are available.

Until those sources are modeled, the product should say “catalog evidence” or “planning audit,” never “degree complete.”
