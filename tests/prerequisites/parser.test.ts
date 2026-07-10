import { describe, expect, it } from "vitest";

import { parsePrerequisites } from "@/lib/prerequisites";
import type { CatalogCourse, PrerequisiteRule } from "@/lib/prerequisites";

const catalog: CatalogCourse[] = [
  { id: "alg-1", name: "Algebra 1", aliases: ["Integrated Math I"], gradeLevels: [9] },
  { id: "geometry", name: "Geometry / Geometry Honors", aliases: ["Geometry"], gradeLevels: [9, 10] },
  { id: "precalc", name: "Precalculus", gradeLevels: [10, 11, 12] }
];

function leaves(rule: PrerequisiteRule): PrerequisiteRule[] {
  return rule.kind === "all_of" || rule.kind === "any_of" ? rule.rules.flatMap(leaves) : [rule];
}

describe("conservative prerequisite parser", () => {
  it("builds explicit AND and OR nodes without flattening their meaning", () => {
    const andRule = parsePrerequisites(["Algebra 1 and Geometry"], { catalog }).rule;
    const orRule = parsePrerequisites(["Algebra 1 or Geometry"], { catalog }).rule;

    expect(andRule).toMatchObject({ kind: "all_of", rules: [{ kind: "all_of" }] });
    expect(andRule.kind === "all_of" && andRule.rules[0]).toMatchObject({
      kind: "all_of",
      rules: [{ kind: "course" }, { kind: "course" }]
    });
    expect(orRule.kind === "all_of" && orRule.rules[0]).toMatchObject({
      kind: "any_of",
      rules: [{ kind: "course" }, { kind: "course" }]
    });
  });

  it("parses only explicit minimum grades, chronology, co-requisites, and grade levels", () => {
    const parsed = parsePrerequisites(
      [
        "Completion of Algebra 1 with a grade of C or better",
        "Precalculus co-requisite",
        "Grade 11 or 12"
      ],
      { catalog }
    );

    expect(leaves(parsed.rule)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "course",
          course: expect.objectContaining({ id: "alg-1" }),
          timing: "prior",
          minimumGrade: "C"
        }),
        expect.objectContaining({
          kind: "course",
          course: expect.objectContaining({ id: "precalc" }),
          timing: "prior_or_concurrent"
        }),
        expect.objectContaining({
          kind: "grade_level",
          constraint: { kind: "one_of", grades: [11, 12] }
        })
      ])
    );
    expect(parsed.parseConfidence).toBe("exact");
  });

  it("preserves source text and confidence on unresolved manual-review clauses", () => {
    const parsed = parsePrerequisites(["Precalculus preferred"], {
      catalog,
      sourceId: "dtech-catalog",
      sourceLabel: "Official d.tech course catalog",
      sourceYear: "2025-26",
      confidence: "verified"
    });

    expect(parsed).toMatchObject({
      parseConfidence: "unresolved",
      originalTexts: ["Precalculus preferred"],
      unresolvedClauses: [
        {
          kind: "unresolved",
          clauseText: "Precalculus preferred",
          reason: "ambiguous_recommendation",
          source: {
            originalText: "Precalculus preferred",
            sourceId: "dtech-catalog",
            sourceLabel: "Official d.tech course catalog",
            sourceYear: "2025-26",
            confidence: "verified"
          }
        }
      ]
    });
  });

  it("does not turn approvals, equivalencies, mixed boolean text, or prose into verified rules", () => {
    const phrases = [
      "Algebra 1 and/or Geometry",
      "One year of laboratory experience"
    ];

    for (const phrase of phrases) {
      const parsed = parsePrerequisites([phrase], { catalog });
      expect(parsed.parseConfidence, phrase).toBe("unresolved");
      expect(parsed.unresolvedClauses, phrase).toHaveLength(1);
    }
  });

  it("preserves an explicit equivalent path as a clearance instead of guessing a course", () => {
    const parsed = parsePrerequisites(["Algebra 1 or equivalent"], { catalog });

    expect(parsed.parseConfidence).toBe("exact");
    expect(parsed.rule.kind === "all_of" && parsed.rule.rules[0]).toMatchObject({
      kind: "any_of",
      rules: [
        expect.objectContaining({ kind: "course", course: expect.objectContaining({ id: "alg-1" }) }),
        expect.objectContaining({ kind: "clearance", clearanceType: "approved_equivalency" })
      ]
    });
    const approval = parsePrerequisites(["Instructor approval"], { catalog });
    expect(approval.rule.kind === "all_of" && approval.rule.rules[0]).toMatchObject({
      kind: "clearance",
      clearanceType: "instructor_approval"
    });
  });

  it("treats course eligibility as placement evidence rather than prior completion", () => {
    const parsed = parsePrerequisites(["Eligibility for ENGL C1000 or ENGL C1000E"], { catalog });

    expect(parsed.parseConfidence).toBe("exact");
    expect(parsed.rule.kind === "all_of" && parsed.rule.rules[0]).toMatchObject({
      kind: "clearance",
      clearanceType: "placement"
    });
    expect(leaves(parsed.rule)).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "course" })]));
  });

  it("does not silently discard an unsupported explicit grade threshold", () => {
    const parsed = parsePrerequisites(["Algebra 1 with a grade of F+ or better"], { catalog });

    expect(parsed.parseConfidence).toBe("unresolved");
    expect(parsed.unresolvedClauses[0]).toMatchObject({
      reason: "unsupported_language",
      explanation: expect.stringContaining("F+")
    });
  });
});
