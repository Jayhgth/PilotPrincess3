# Deterministic prerequisite engine

The prerequisite engine lives in `src/lib/prerequisites/`. It has no UI, database, or planner-model dependency. Callers provide structurally typed catalog and plan records, so a later Courses-board integration can adapt the current application models without coupling this engine to them.

## API

```ts
import {
  auditPrerequisiteGraph,
  evaluateParsedPrerequisites,
  parsePrerequisites
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
```

`termIndex` is an application-defined monotonic term number. A smaller number is earlier; the same number is concurrent. A completed transcript row without a term index is treated as historical. Current or planned rows without a term index cannot establish chronology and produce `needs_review`.

## Rule model

The AST supports:

- `all_of` and `any_of` boolean groups;
- exact course references with prior, prior-or-concurrent co-requisite, or strictly concurrent timing;
- explicit letter-grade minimums;
- minimum, maximum, and enumerated grade-level constraints; and
- unresolved clauses that retain the exact source text, source metadata, explanation, and counselor question.

Evaluation uses exact normalized IDs, codes, names, and declared aliases. It does not use substring or fuzzy matching. Transcript-backed and manual rows behave identically once those identifiers or aliases are supplied.

## Conservative parsing policy

The parser recognizes only narrow forms with explicit meaning: simple course labels, `and`, `or`, completion prefixes, supported grade-minimum wording, explicit co-requisite/concurrent wording, and grade 9–12 constraints. Multiple strings in a catalog array are treated as `all_of`.

The following remain manual review:

- recommendations such as `preferred`, `recommended`, or `suggested`;
- approvals, permissions, and consent;
- unspecified equivalents;
- placement, proficiency, assessment, or test language without a complete threshold;
- `and/or`, mixed ungrouped AND/OR expressions, exceptions, and unsupported punctuation/grouping; and
- prose that is not an exact catalog label or a safely recognizable course identifier.

Source confidence is preserved as evidence; it is never silently promoted. An unresolved branch evaluates to `needs_review` unless boolean logic proves another explicit `any_of` branch sufficient. For `all_of`, a known failed requirement remains `blocked` even if a separate clause also needs review.

Same-term courses never satisfy a prior prerequisite. They satisfy only a rule explicitly parsed or authored as `prior_or_concurrent` or `concurrent`. An earlier planned term can satisfy a course prerequisite, but an unearned grade cannot prove an explicit grade minimum.

## Graph audit

`auditPrerequisiteGraph` reports:

- prerequisite references that do not exactly resolve to a catalog ID, code, name, or declared alias;
- prerequisite and co-requisite cycles;
- course or grade-level rules with no feasible grade sequence; and
- every unresolved source clause.

The catalog-wide test reads the checked-in `supabase/seed.sql` without modifying it. The seed uses combined display names, so the test supplies explicit aliases for the shorter prerequisite labels (for example, `Geometry` for `Geometry / Geometry Honors`). These aliases must eventually come from reviewed catalog mapping data rather than inference.

As of the checked-in 2025–26 d.tech seed, all 41 courses and 25 deterministic course references audit cleanly after those explicit aliases. One phrase remains unresolved:

- `Precalculus preferred` on `Advanced Physics Honors`: “preferred” does not say whether Precalculus is required, nor what exception or alternate evidence is accepted.

## Later planner integration seam

The Courses board should add a small adapter, outside this module, that maps catalog rows to `CatalogCourse` and completed/current/planned rows to `PlannedCourseInput`. The adapter should assign a stable `termIndex`, preserve normalized IDs/codes/names, and load only reviewed aliases. It can then parse each catalog prerequisite array once, cache the AST by catalog version, evaluate each planned course, and render the structured result.

Do not convert `needs_review` to success in the UI. Show its source text and counselor question, and keep registration/graduation language explicitly advisory until the catalog language or a counselor resolves it.
