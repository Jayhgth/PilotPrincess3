# Academic data and rule reference

Last reviewed: 2026-07-14

This is the durable implementation reference for transcript, GPA, graduation, course eligibility, prerequisites, equivalencies, statewide school data, and college evidence.

## Authority and confidence

The checked-in d.tech and SMCCD curriculum is labeled 2025-26. The d.tech-to-SMCCD equivalency chart is dated 2021. Preserve source year, URL, institution, confidence, and review status. Curriculum inclusion does not prove a live section, seat, schedule fit, counselor approval, or award eligibility.

Statewide discovery keeps institutional authorities separate:

- CDE supplies public and charter school identity and public school address data;
- UCOP supplies school identities, A–G subject areas, approved course lists, and UC honors markers for catalog identity and designation evidence; and
- each school or district supplies local graduation rules, course availability, credits, terms, prerequisites, and local designations.

UCOP approval does not prove a current section, seat, local grade restriction, or diploma requirement. UCOP rows remain searchable when a local catalog is unavailable, but the interface marks missing grade availability for verification. A discovered official local catalog can add non-A–G courses and supply grade, term, description, and prerequisite evidence. AP, IB, UC honors, school honors, CTE, and dual enrollment are separate designations; one label does not imply another.

`verified` requires explicit reviewed evidence. `likely` is a supported interpretation. `uncertain` and `needs_review` remain visible and never become success through broad matching.

## Transcript and GPA

- Parse readable PDF/document text deterministically. Use Codex vision only when no usable text layer exists.
- Source rows enter a review queue; nothing counts until selected and imported.
- Preserve exact printed course name, mark, credit, school year, institution, and source link.
- Quarter-coded P/F courses are d.tech intersession records, are not expected to match the annual catalog, and map passed credit to Personal Development.
- `P` earns credit but does not enter GPA. `F` earns neither credit nor GPA points under the supplied d.tech transcript behavior.
- `A+`, `A`, and `A-` share four grade points; B, C, and D variants share their integer band.
- A d.tech `*` is a UC course-list marker, not Honors.
- d.tech weighting requires reviewed Honors evidence. SMCCD rows use the transcript's college-course weighting behavior.
- Transcript audits compare any printed cumulative GPA and earned-credit totals with the fully reviewed/imported rows. A `needs_review` source status is workflow state, not evidence of an error; catalog-link, parsed-row, import, and downstream graduation issues remain separate.

The GPA planner may apply user-supplied expected grades to current and planned courses without changing saved course or transcript records. Its all-A result is the ceiling of the currently included saved schedule, not a prediction or proof that the schedule is advisable. A schedule comparison must keep transcript grades locked and show missing grade assumptions. Pilot may explain the deterministic result, but any saved-plan change remains a normal reviewed proposal.

## Graduation

Diploma progress keeps completed, current, planned, unverified, unused, and remaining credits separate.

- Laboratory Science requires Biology, Chemistry, and a third lab science at 10 credits each.
- A verified Level 3/III world-language course satisfies the full 20-credit sequence, even without lower levels in the record.
- SMCCD high-school credit requires a reviewed directional equivalency; college units alone do not invent a d.tech requirement mapping.

Only the selected school's published official diploma requirements are calculated. If those rules are unavailable, Pilot reports that limitation and does not fall back to California minimums or UC A–G.

Local requirements are versioned by academic authority: district schools share their district rules and charter schools use their own CDS-scoped authority. The source discovery job follows official school-to-district navigation, checks official site maps and linked document hosts, records content hashes and exact evidence, and publishes only when all four core areas plus a complete local set validate. Default all-student plans are kept separate from transfer, foster-youth, or other exception plans. Required pathways whose credits are already part of electives are tracked as constraints and excluded from aggregate credit totals.

## School planning profiles

`school_planning_profiles` keeps scheduling guidance separate from diploma-credit rules. A verified profile supplies grade-specific minimum and target loads, required subject areas, normal course names, subjects that must remain at the high school, and the school's sourced posture toward college coursework. Pilot retrieves only the selected school's compact profile with the workspace; school-specific prose is not copied into the global prompt.

d.tech's profile preserves annual on-campus English and Design Lab plus its integrated concurrent-enrollment model. Carlmont's profile preserves its six-course norm, five-course senior minimum, and restricted seventh-course exceptions. Schools without a verified profile use only their verified catalog and diploma mappings and cannot receive unsupported school-specific claims.

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
- Within SMCCD, the same normalized district course code is prerequisite evidence across Cañada, CSM, and Skyline. Campus is preserved as provenance; different course codes still require a reviewed directional equivalency.
- A provider-wide canonical course code may satisfy a prerequisite across campuses only when an official district/provider identity connects those campuses. Similar titles across unrelated colleges do not pass automatically.
- Directional d.tech-to-SMCCD equivalencies are not reversed.
- Placement, program admission, licensing, tests, work experience, portfolios, and malformed source clauses remain review items.

Catalog details show source wording, matched evidence, missing/out-of-order requirements, and questions. Next steps links unresolved planned courses back to the relevant catalog record.

## SMCCD curriculum and degree evidence

The checked-in district artifacts contain official course identity, college, units, degree applicability, detail URL/status, prerequisites, corequisites, recommended preparation, and complete local-GE rosters from each college's 2025-2026 worksheet. College-wide GE rosters control area eligibility because course-detail tags omit valid secondary designations. Common Course Numbering relies on official detail-page applicability rather than a number heuristic.

The local degree patterns are separate source-backed definitions, not one district template: CSM requires 27 local-GE units and keeps American History & Institutions in GE Area 8; Skyline requires 24 local-GE units and tracks Information Literacy plus American History & Institutions as separate graduation requirements; Cañada requires 25 local-GE units, including four units of natural science with laboratory work, and has neither of Skyline's separate requirements on its worksheet. Pilot and the UI must report the selected awarding college's exact pattern.

Associate-degree progress distinguishes completed major units, projected major units, degree-applicable units, parsed requirement options, mandatory core-group constraints, and conditional rules requiring review. Every AA/AS source table and official course option is audited during catalog refresh; missing sections fail validation. A progress percentage is capped by missing groups, selective rules, and unresolved conditions, so surplus units cannot conceal an unmet core. Supported course-family and discipline-breadth rules are evaluated by normalized subject and number while preventing the same course from being reused.

SMCCCD Board Policy 6.26 provides reciprocity among Cañada, CSM, and Skyline: a course satisfying a GE, elective, statutory, or specific-area requirement at one district college is accepted for that same requirement by the others, and a completed GE pattern transfers wholesale. Reciprocity carries recognized credit; it does not make the three local patterns identical. The engine keeps actual earned units visible when reciprocity satisfies an area with a different unit structure. Major-field credit transfers, but the destination college's exact major requirements still control the award. Residency, catalog rights, waivers, external transcripts, substitutions, and final award certification remain outside automatic completion.

The reference-app ideas adopted from DegreeDoesntWorks are indexed search, course-code ranking, college/degree filters, requirement-level evidence, missing-option discovery, and explicit unresolved discipline rules. Promotional ranking, hidden heuristic substitutions, and unsupported certification were not copied.

## Concurrent and dual-enrollment limits

Unit limits are stored in `enrollment_policies` by provider, program type, term, and semester or quarter system. `student_enrollment_preferences` stores the student's concurrent- or dual-enrollment context; it does not let the student invent a different policy threshold. Course planning shows a warning only when an open term crosses the matching district threshold. Do not hardcode one district's number into planning logic.

For the reviewed 2026 SMCCD sources:

- concurrent enrollment uses 11 units as the conservative planning threshold because the current CSM page says 11 or fewer avoids enrollment and health fees;
- the district FAQ lists 11.5 fee-free concurrent units;
- dual enrollment uses 15 as the conservative threshold and 15.5 as the district fee-free figure; and
- the district K-12 maximum is 19 units.

Aggregate CSM, Skyline, and Cañada units across the same school year and term. A full-year row counts in fall and spring. Completed rows do not consume a future-term limit. Crossing a selected or fee-free limit produces review, while crossing the sourced absolute maximum blocks the scenario. Unit count never proves course eligibility: prerequisites, placement, school and college approval, impacted-course restrictions, materials, fees, and seat availability stay separate. Other districts require their own reviewed policy rows; do not infer them from SMCCD.

Nearby-provider discovery uses the selected school's public CDE address and official provider coordinates. Colleges are normalized into their official community-college district before suggestions are ranked. `student_college_district_preferences` stores one suggested, student-selected, or Pilot-selected district; this is separate from the source-backed concurrent/dual-enrollment policy and never implies eligibility. A manual student or Pilot choice persists across high-school changes, while an untouched suggestion follows the newly selected school's public address. Institution marks use checked-in official assets where available, then the official institution website favicon, then a neutral accessible fallback. Discovery is not a claim of articulation or a current course offering and never requests precise student location.

## Shared-data corrections

Students and Pilot may submit an exact, evidence-backed correction to shared school, course, mapping, requirement, provider, policy, or source data. The submission remains pending and changes no shared data. An application administrator must review the evidence and may approve and publish the allowlisted patch or reject it. Student-owned plan and transcript corrections continue through their existing RLS-protected flows.

## Maintenance gate

After changing SMCCD source data:

```sh
pnpm smccd:scrape
pnpm smccd:requirements-migration
pnpm smccd:validate
pnpm schools:academics --discover-only --school-name "Carlmont High"
pnpm schools:academics --selected
pnpm schools:academics --all
pnpm test
supabase db lint --linked
supabase db push --linked --dry-run
```

Review artifact/migration diffs, unresolved counts, and linked schema history before applying. Update this file when an academic rule changes; do not create a one-off integration note.
