# Deterministic prerequisite engine

The prerequisite engine lives in `src/lib/prerequisites/`. Its parser and evaluator remain independent of application models. `planner.ts` is the explicit application adapter: it maps the current catalog and plan records into structurally typed engine inputs. The same deterministic engine evaluates d.tech and SMCCD rules.

## API

```ts
import {
  auditPrerequisiteGraph,
  auditSmccdPrerequisites,
  buildReviewedDtechToSmccdPrerequisiteEquivalencies,
  evaluateParsedPrerequisites,
  parsePrerequisites,
  parseSmccdCoursePrerequisites
} from "@/lib/prerequisites";

const parsed = parsePrerequisites(
  ["Algebra 1 with a grade of C or better", "Precalculus co-requisite"],
  {
    catalog,
    sourceId: "dtech-catalog",
    sourceLabel: "Official d.tech course catalog",
    sourceYear: "2025-26",
    confidence: "verified"
  }
);

const result = evaluateParsedPrerequisites(parsed, {
  target: {
    courseId: "advanced-math",
    name: "Advanced Math",
    termIndex: 5,
    gradeLevel: 11
  },
  courses: [
    {
      instanceId: "transcript-algebra",
      courseId: "algebra-1",
      name: "Algebra 1",
      status: "completed",
      grade: "B",
      source: "transcript"
    },
    {
      instanceId: "planned-precalc",
      courseId: "precalculus",
      name: "Precalculus",
      status: "planned",
      termIndex: 5,
      source: "manual"
    }
  ]
});

// result.status is "satisfied", "blocked", or "needs_review".
// The other fields contain missing courses, ordering violations, evidence,
// and counselor questions suitable for a user-facing explanation.

const audit = auditPrerequisiteGraph(catalog);

const smccdParsed = parseSmccdCoursePrerequisites(selectedSmccdCourse, allSmccdCourses);
const smccdResult = evaluateParsedPrerequisites(smccdParsed, smccdPlanInput);
const districtAudit = auditSmccdPrerequisites(allSmccdCourses);
```

`termIndex` is an application-defined monotonic term number. A smaller number is earlier; the same number is concurrent. A completed transcript row without a term index is treated as historical. Current or planned rows without a term index cannot establish chronology and produce `needs_review`.

## Rule model

The AST supports:

- `all_of` and `any_of` boolean groups;
- exact course references with prior, prior-or-concurrent co-requisite, or strictly concurrent timing;
- explicit letter-grade minimums;
- minimum, maximum, and enumerated grade-level constraints; and
- placement, approved-equivalency, prerequisite-challenge, instructor-approval, program-admission, and audition/portfolio clearances; and
- unresolved clauses that retain the exact source text, source metadata, explanation, and counselor question.

Evaluation uses exact normalized IDs, codes, names, and declared aliases. It does not use substring or fuzzy matching. Transcript-backed and manual rows behave identically once those identifiers or aliases are supplied.

## Conservative parsing policy

The parser recognizes only narrow forms with explicit meaning: simple course labels, unambiguous `and` or `or`, completion prefixes, supported grade-minimum wording, explicit co-requisite/concurrent wording, grade 9–12 constraints, and explicitly named administrative clearances. Multiple prerequisite strings are treated as `all_of`. SMCCD's separate corequisite field is parsed as strictly concurrent; recommended preparation is preserved in catalog data but never evaluated as a requirement.

The following remain manual review:

- recommendations such as `preferred`, `recommended`, or `suggested`;
- approvals, placement, challenges, and unspecified equivalents without an independently verified clearance decision;
- proficiency, assessment, test, experience, or credential language that cannot be represented as an exact course or named clearance;
- `and/or`, mixed ungrouped AND/OR expressions, exceptions, and unsupported punctuation/grouping; and
- prose that is not an exact catalog label or a safely recognizable course identifier.

Source confidence is preserved as evidence; it is never silently promoted. An unresolved branch evaluates to `needs_review` unless boolean logic proves another explicit `any_of` branch sufficient. For `all_of`, a known failed requirement remains `blocked` even if a separate clause also needs review.

An explicit placement or equivalency alternative is a structured rule, but an absent or student-reported decision remains `needs_review`. Stored clearance submissions carry a separate verification status. `clearanceFromStoredRecord` converts a claimed approval to `pending` until it has been independently approved; the migration's RLS policies also prevent an authenticated student from promoting or editing a reviewed record.

Same-term courses never satisfy a prior prerequisite. They satisfy only a rule explicitly parsed or authored as `prior_or_concurrent` or `concurrent`. An earlier planned term can satisfy a course prerequisite, but an unearned grade cannot prove an explicit grade minimum.

## SMCCD catalog ingestion and ENGL C1000

The SMCCD scraper now reads every official course-detail page, not just the subject index. It stores verbatim prerequisite, corequisite, and recommended-preparation text separately, plus exact degree applicability, general-education attributes, detail status, and source URL. A failed or incomplete detail read stays `partial` or `unavailable`; the engine does not manufacture missing rules.

The previous numeric heuristic incorrectly treated Common Course Numbering codes such as `C1000` as non-degree courses because `1000` is greater than 800. The detail-page value now wins. At all three colleges, `ENGL C1000 Academic Reading and Writing` is recorded as:

- degree applicable and CSU/UC transferable;
- Cal-GETC Area 1A and AA/AS Degree Requirements Area 1A; and
- requiring placement through the college's multiple-measures process.

That makes ENGL C1000 an SMCCD/Cal-GETC English-composition general-education course. It does not automatically prove d.tech high-school English graduation credit. The checked-in 2021 d.tech equivalency chart has no ENGL C1000 row, so any d.tech credit remains pending until d.tech supplies an approved mapping.

## Equivalency direction

Equivalency is directional:

- `buildDtechPrerequisiteEquivalencies` converts reviewed rows in the existing d.tech chart from an SMCCD course to the published d.tech equivalent. It never reverses them.
- `buildReviewedDtechToSmccdPrerequisiteEquivalencies` accepts a separately reviewed SMCCD decision that a d.tech course satisfies a named SMCCD prerequisite. Pending or unverified decisions stay `needs_review`. A mapping may be limited to one target SMCCD course.
- Explicit catalog wording such as `course or equivalent, or placement` becomes an `any_of` rule. Any exact course path can satisfy it; equivalency and placement paths require their own approved evidence.

This prevents a college-to-high-school credit conversion from being reused as proof that the high-school course meets college placement or prerequisite standards.

## Graph audit

`auditPrerequisiteGraph` reports:

- prerequisite references that do not exactly resolve to a catalog ID, code, name, or declared alias;
- prerequisite and co-requisite cycles;
- course or grade-level rules with no feasible grade sequence; and
- every unresolved source clause.

The d.tech catalog-wide test reads the checked-in `supabase/seed.sql` without modifying it. The seed uses combined display names, so the test supplies explicit aliases for shorter prerequisite labels (for example, `Geometry` for `Geometry / Geometry Honors`). These aliases must come from reviewed catalog mapping data rather than inference.

As of the checked-in 2025–26 d.tech seed, all 41 courses and 25 deterministic course references audit cleanly after those explicit aliases. One phrase remains unresolved:

- `Precalculus preferred` on `Advanced Physics Honors`: “preferred” does not say whether Precalculus is required, nor what exception or alternate evidence is accepted.

The checked-in SMCCD audit covers all 2,461 courses and currently finds 846 deterministic course references, 246 unresolved AST clauses (227 unique audit warnings), 109 unique missing exact references, 16 cycle components, and no impossible grade sequences. Fourteen cycles are explicit co-requisite groups; the CSM NURS 231/232/235 group and Skyline MUS. 430.4 self-reference include a prior edge and remain catalog-review errors. Remaining review cases are intentionally retained. Common categories include:

- long police, fire, nursing, dental, and apprenticeship eligibility prose containing applications, licenses, certificates, tests, work experience, or several administrative decisions;
- mixed ungrouped `AND`/`OR` expressions, `and/or`, and complex lab-sequence alternatives whose grouping cannot be safely inferred;
- portfolio, audition, program-admission, or instructor-review prose that combines a clearance with additional unstated criteria;
- historical, cross-campus, generic, or external course descriptions that do not exactly resolve to a catalog row; and
- malformed source text such as duplicated `Eligibility for` or a grade statement whose operator was lost on the catalog page.

Examples intentionally left unresolved include the full `AJPS 107` PELLETB/physical-agility/fingerprint/license clause, `ART 352 ... minimum grade of C and/or portfolio review`, the multi-sequence `BIOL 240` biology-and-chemistry rule, and course-specific program/certificate admission prose. These require a catalog correction or counselor interpretation, not another parser guess.

## Planner and catalog integration

`planner.ts` maps application rows to `CatalogCourse` and `PlannedCourseInput`, assigns a stable term index, preserves normalized IDs/codes/names, and loads only reviewed aliases and directional equivalencies. Its main entry points are `evaluateDtechPlannerPrerequisites` and `evaluateSmccdPlannerPrerequisites`.

The Courses area uses those adapters in both catalog browsers:

- every result row exposes the plan-aware state as ready, missing a prerequisite, counselor review, or no prerequisite listed;
- the selected-course panel shows verbatim catalog language, matched plan evidence, missing or out-of-order courses, and suggested counselor questions;
- SMCCD recommended preparation and general-education attributes remain separate from enforced prerequisites;
- a course already in the plan shows its current plan state instead of another add action; and
- the Timeline surfaces blocked and review-required planned courses as links back to the relevant catalog record.

The d.tech adapter may use the published SMCCD-to-d.tech equivalency chart in that published direction. The SMCCD adapter does not assume the reverse. A d.tech course can satisfy an SMCCD prerequisite only after a separately reviewed SMCCD decision is supplied through `buildReviewedDtechToSmccdPrerequisiteEquivalencies` and connected to the planner adapter.

Do not convert `needs_review` to success in the UI. Show its source text and counselor question, and keep registration and graduation language explicitly advisory until the catalog language or a counselor resolves it. If catalog evaluation later becomes a measurable rendering bottleneck, cache parsed ASTs by catalog version at this adapter seam rather than weakening the matching rules.
