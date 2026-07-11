# Academic data and rule reference

Last reviewed: 2026-07-10

This is the durable implementation reference for transcript, GPA, graduation, course eligibility, prerequisites, equivalencies, A-G, and SMCCD degree evidence.

## Authority and confidence

The checked-in d.tech and SMCCD curriculum is labeled 2025-26. The d.tech-to-SMCCD equivalency chart is dated 2021. Preserve source year, URL, institution, confidence, and review status. Curriculum inclusion does not prove a live section, seat, schedule fit, counselor approval, or award eligibility.

`verified` requires explicit reviewed evidence. `likely` is a supported interpretation. `uncertain` and `needs_review` remain visible and never become success through broad matching.

## Transcript and GPA

- Parse readable PDF/document text deterministically. Use Codex vision only when no usable text layer exists.
- Source rows enter a review queue; nothing counts until selected and imported.
- Preserve exact printed course name, mark, credit, school year, institution, and source link.
- Quarter-coded P/F courses are d.tech intersession records, are not expected to match the annual catalog, and map passed credit to Personal Development.
- `P` earns credit but does not enter GPA. `F` earns neither credit nor GPA points under the supplied d.tech transcript behavior.
- `A+`, `A`, and `A-` share four grade points; B, C, and D variants share their integer band.
- A d.tech `*` indicates UC A-G approval, not Honors.
- d.tech weighting requires reviewed Honors evidence. SMCCD rows use the transcript's college-course weighting behavior.
- Transcript audits compare any printed cumulative GPA and earned-credit totals with the fully reviewed/imported rows. A `needs_review` source status is workflow state, not evidence of an error; catalog-link, parsed-row, import, and downstream graduation issues remain separate.

The UC planning GPA lens is deliberately narrower: only completed grade 10-11 rows linked to an official d.tech A-G course are included. Plus/minus marks are ignored and eligible honors points are capped at eight semesters, with at most four from grade 10. Custom and college rows remain unresolved until an exact reviewed A-G link exists.

The GPA planner may apply user-supplied expected grades to current and planned courses without changing saved course or transcript records. Its all-A result is the ceiling of the currently included saved schedule, not a prediction or proof that the schedule is advisable. A schedule comparison must keep transcript grades locked and show missing grade assumptions. Pilot may explain the deterministic result, but any saved-plan change remains a normal reviewed proposal.

## Graduation and A-G

Diploma progress keeps completed, current, planned, unverified, unused, and remaining credits separate.

- Laboratory Science requires Biology, Chemistry, and a third lab science at 10 credits each.
- A verified Level 3/III world-language course satisfies the full 20-credit sequence, even without lower levels in the record.
- SMCCD high-school credit requires a reviewed directional equivalency; college units alone do not invent a d.tech requirement mapping.
- A-G uses the official d.tech A-G course list and reviewed exact equivalencies. A grade below C does not satisfy subject preparation.

## Catalog eligibility

The catalogs answer: what can the student still take in the planning year, why is it available, what evidence controls readiness, and what will be added?

Hide from selectable results:

- exact or normalized courses already represented in Done, In progress, or Planned;
- d.tech courses outside the selected planning grade;
- lower sequential mathematics after a higher demonstrated level;
- courses with a deterministically blocked prerequisite; and
- unavailable duplicate Standard/Honors family variants.

Keep `needs_review` visible when placement, permission, external evidence, or a human exception could make the course possible. Report hidden counts in plain language. Re-run eligibility in the add handler so a stale selection cannot bypass the rule.

## Prerequisite engine

The deterministic engine lives in `src/lib/prerequisites/`. It supports course references, minimum grades, concurrent enrollment, equivalent course groups, advisory preparation, and boolean AND/OR combinations. Adapters map d.tech and SMCCD plan evidence into the same evaluator.

Conservative policies:

- Recommended/preferred preparation never blocks.
- Unknown prose does not pass.
- A course cannot satisfy its own prerequisite unless the source explicitly defines a corequisite relationship.
- Later courses do not back-satisfy earlier prerequisites.
- Directional d.tech-to-SMCCD equivalencies are not reversed.
- Placement, program admission, licensing, tests, work experience, portfolios, and malformed source clauses remain review items.

Catalog details show source wording, matched evidence, missing/out-of-order requirements, and questions. Next steps links unresolved planned courses back to the relevant catalog record.

## SMCCD curriculum and degree evidence

The checked-in district artifact contains official course identity, college, units, degree applicability, transfer/general-education tags, detail URL/status, prerequisites, corequisites, and recommended preparation. Common Course Numbering relies on official detail-page applicability rather than a number heuristic.

Associate-degree progress distinguishes completed major units, projected major units, degree-applicable units, parsed requirement options, and text rules requiring review. It is not a complete GE, residency, catalog-rights, waiver, substitution, or award-eligibility audit.

The reference-app ideas adopted from DegreeDoesntWorks are indexed search, course-code ranking, college/degree filters, requirement-level evidence, missing-option discovery, and explicit unresolved discipline rules. Promotional ranking, hidden heuristic substitutions, and unsupported certification were not copied.

## Concurrent and dual-enrollment limits

Unit limits are stored in `enrollment_policies` by provider, program type, term, and semester or quarter system. `student_enrollment_preferences` stores which source-backed threshold the student wants enforced. Do not hardcode one district's number into planning logic.

For the reviewed 2026 SMCCD sources:

- concurrent enrollment uses 11 units as the conservative planning threshold because the current CSM page says 11 or fewer avoids enrollment and health fees;
- the district FAQ lists 11.5 fee-free concurrent units;
- dual enrollment uses 15 as the conservative threshold and 15.5 as the district fee-free figure; and
- the district K-12 maximum is 19 units.

Aggregate CSM, Skyline, and Cañada units across the same school year and term. A full-year row counts in fall and spring. Completed rows do not consume a future-term limit. Crossing a selected or fee-free limit produces review, while crossing the sourced absolute maximum blocks the scenario. Unit count never proves course eligibility: prerequisites, placement, school and college approval, impacted-course restrictions, materials, fees, and seat availability stay separate. Other districts require their own reviewed policy rows; do not infer them from SMCCD.

## Maintenance gate

After changing SMCCD source data:

```sh
pnpm smccd:scrape
pnpm smccd:migration
pnpm smccd:validate
pnpm test
supabase db lint --linked
supabase db push --linked --dry-run
```

Review artifact/migration diffs, unresolved counts, and linked schema history before applying. Update this file when an academic rule changes; do not create a one-off integration note.
