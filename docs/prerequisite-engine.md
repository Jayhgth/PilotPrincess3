# Deterministic prerequisite engine

The engine in `src/lib/prerequisites/` parses and evaluates exact d.tech and SMCCD prerequisite evidence. `planner.ts` is the application adapter. The engine never uses fuzzy matching or an LLM.

## Main API

```ts
import {
  auditPrerequisiteGraph,
  auditSmccdPrerequisites,
  evaluateParsedPrerequisites,
  parsePrerequisites,
  parseSmccdCoursePrerequisites
} from "@/lib/prerequisites";

const parsed = parsePrerequisites(sourceRules, {
  catalog,
  sourceId: "dtech-catalog",
  sourceLabel: "Official d.tech course catalog",
  sourceYear: "2025-26",
  confidence: "verified"
});

const result = evaluateParsedPrerequisites(parsed, {
  target: { courseId: "advanced-math", name: "Advanced Math", termIndex: 5, gradeLevel: 11 },
  courses: plannedAndCompletedCourses
});
```

Results are `satisfied`, `blocked`, or `needs_review` and include matched evidence, missing courses, chronology problems, source text, and counselor questions.

`termIndex` is monotonic. A smaller number is earlier and the same number is concurrent. Historical transcript rows may omit a term. Current/planned rows without a term cannot prove chronology.

## Supported rules

- exact `all_of` and `any_of` groups;
- prior, prior-or-concurrent, and strictly concurrent course timing;
- explicit minimum letter grades;
- minimum, maximum, and enumerated grade levels; and
- reviewed placement, equivalency, challenge, instructor, admission, audition, or portfolio clearances.

Only exact normalized IDs, codes, names, and reviewed aliases count. Same-term courses never satisfy a prior rule. A planned earlier term may satisfy a course prerequisite, but cannot prove an explicit grade minimum.

## Conservative policy

The parser leaves these as `needs_review`:

- recommended, preferred, or suggested preparation;
- unstated equivalents, proficiency, tests, credentials, or experience;
- mixed ungrouped AND/OR, `and/or`, exceptions, or ambiguous punctuation;
- approvals or placement without an independently reviewed decision; and
- prose that cannot resolve to an exact catalog course or named clearance.

SMCCD recommended preparation is displayed but never enforced. Separate corequisite text is strictly concurrent. Source confidence is preserved and never promoted. A known failure in `all_of` remains blocked even if another clause needs review.

Students cannot approve their own clearance evidence. Stored claims remain pending until an independent reviewer approves them; RLS prevents students from editing reviewed status.

## Equivalency direction

The published d.tech chart maps an SMCCD course to its d.tech credit. It is never reversed automatically to prove that a d.tech course satisfies an SMCCD prerequisite.

A d.tech course satisfies an SMCCD prerequisite only through a separate reviewed decision passed to `buildReviewedDtechToSmccdPrerequisiteEquivalencies`. A decision may be limited to one target course. Pending or unverified mappings remain `needs_review`.

## SMCCD ingestion

The scraper reads official course-detail pages and stores prerequisites, corequisites, recommended preparation, degree applicability, transfer/general-education attributes, detail status, and source URL. Failed detail reads remain partial or unavailable.

Common Course Numbering values such as `ENGL C1000` use official detail-page degree applicability instead of the old numeric heuristic. ENGL C1000 is degree applicable and CSU/UC transferable in the checked-in district data, but it does not prove d.tech English credit because the 2021 d.tech chart has no reviewed mapping.

## Data health

Checked-in 2025-26 d.tech data: 41 courses and 25 deterministic references audit cleanly with reviewed aliases. `Precalculus preferred` for Advanced Physics Honors remains unresolved because preference is not a requirement.

Checked-in SMCCD data: 2,461 courses, 846 deterministic references, 246 unresolved AST clauses, 109 missing exact references, 16 cycle components, and no impossible grade sequences. Most cycles are explicit corequisite groups. Catalog-review errors remain for the CSM NURS 231/232/235 group and Skyline MUS. 430.4 self-reference.

Typical unresolved cases are program admission, licensing, tests, work experience, mixed AND/OR, portfolio/audition criteria, external courses, and malformed source text. They require source correction or human interpretation, not broader parsing guesses.

## Product integration

`evaluateDtechPlannerPrerequisites` and `evaluateSmccdPlannerPrerequisites` map plan records, term order, reviewed aliases, clearances, and directional equivalencies into the engine.

Catalog results expose Ready, Missing prerequisite, Counselor review, or No prerequisite listed. Selected details show source wording, matched evidence, missing/out-of-order courses, recommended preparation, and questions. Timeline links unresolved planned courses back to the relevant catalog record.

Do not convert `needs_review` to success in UI copy. If performance becomes measurable, cache parsed ASTs by catalog version at the adapter seam rather than weakening exact matching.

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

Review catalog diffs, unresolved counts, and migration output before applying any change.
