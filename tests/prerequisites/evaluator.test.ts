import { describe, expect, it } from "vitest";

import { evaluateParsedPrerequisites, parsePrerequisites } from "@/lib/prerequisites";
import type { CatalogCourse, PlannedCourseInput, PrerequisiteEvaluationInput } from "@/lib/prerequisites";

const catalog: CatalogCourse[] = [
  { id: "alg-1", code: "MATH 100", name: "Algebra 1", aliases: ["Integrated Math I"], gradeLevels: [9] },
  { id: "geometry", name: "Geometry", gradeLevels: [9, 10] },
  { id: "precalc", name: "Precalculus", gradeLevels: [10, 11, 12] },
  { id: "target", name: "Target Course", gradeLevels: [11, 12] }
];

function evaluate(texts: string[], courses: PlannedCourseInput[], target: Partial<PrerequisiteEvaluationInput["target"]> = {}) {
  const parsed = parsePrerequisites(texts, { catalog, confidence: "verified" });
  return evaluateParsedPrerequisites(parsed, {
    target: { name: "Target Course", courseId: "target", termIndex: 4, gradeLevel: 11, ...target },
    courses
  });
}

function course(overrides: Partial<PlannedCourseInput> = {}): PlannedCourseInput {
  return {
    instanceId: "alg-instance",
    courseId: "alg-1",
    name: "Algebra 1",
    status: "completed",
    termIndex: 1,
    grade: "B",
    source: "transcript",
    ...overrides
  };
}

describe("deterministic prerequisite evaluation", () => {
  it("requires every AND branch and accepts one satisfied OR branch", () => {
    const andResult = evaluate(["Algebra 1 and Geometry"], [course()]);
    const orResult = evaluate(["Algebra 1 or Geometry"], [course()]);

    expect(andResult.status).toBe("blocked");
    expect(andResult.missingCourses.map((missing) => missing.course.name)).toEqual(["Geometry"]);
    expect(orResult.status).toBe("satisfied");
    expect(orResult.missingCourses).toEqual([]);
  });

  it("enforces explicit grade minimums and reviews unknown grades", () => {
    expect(evaluate(["Algebra 1 with a grade of C or better"], [course({ grade: "B-" })]).status).toBe("satisfied");

    const below = evaluate(["Algebra 1 with a grade of C or better"], [course({ grade: "C-" })]);
    expect(below.status).toBe("blocked");
    expect(below.missingCourses[0]).toMatchObject({ reason: "minimum_grade_not_met", minimumGrade: "C" });

    const unknown = evaluate(["Algebra 1 with a grade of C or better"], [course({ grade: "P" })]);
    expect(unknown.status).toBe("needs_review");
    expect(unknown.suggestedCounselorQuestions[0]).toContain("verified grade");
  });

  it("allows completed and earlier planned courses but blocks same-term prior prerequisites", () => {
    const transcriptWithoutTerm = course({ termIndex: undefined, source: "transcript" });
    const earlierPlan = course({ status: "planned", termIndex: 3, grade: null, source: "manual" });
    const sameTerm = course({ status: "current", termIndex: 4 });

    expect(evaluate(["Algebra 1"], [transcriptWithoutTerm]).status).toBe("satisfied");
    expect(evaluate(["Algebra 1"], [earlierPlan]).status).toBe("satisfied");

    const sameTermResult = evaluate(["Algebra 1"], [sameTerm]);
    expect(sameTermResult.status).toBe("blocked");
    expect(sameTermResult.orderingViolations).toHaveLength(1);
    expect(sameTermResult.missingCourses).toEqual([]);
  });

  it("allows same-term courses only for explicit co-requisites", () => {
    const sameTermPrecalc = course({
      instanceId: "precalc-instance",
      courseId: "precalc",
      name: "Precalculus",
      status: "planned",
      termIndex: 4,
      grade: null
    });

    expect(evaluate(["Precalculus co-requisite"], [sameTermPrecalc]).status).toBe("satisfied");
    expect(evaluate(["Precalculus"], [sameTermPrecalc]).status).toBe("blocked");

    const earlierPrecalc = { ...sameTermPrecalc, termIndex: 3 };
    expect(evaluate(["Concurrent enrollment in Precalculus"], [sameTermPrecalc]).status).toBe("satisfied");
    expect(evaluate(["Concurrent enrollment in Precalculus"], [earlierPrecalc]).status).toBe("blocked");
  });

  it("matches normalized identifiers and declared aliases for transcript and manual rows", () => {
    const transcriptAlias = course({ courseId: undefined, code: null, name: " integrated math i ", source: "transcript" });
    const manualCode = course({ courseId: undefined, code: "math-100", name: "Custom math row", source: "manual" });

    const aliasResult = evaluate(["Algebra 1"], [transcriptAlias]);
    const codeResult = evaluate(["Algebra 1"], [manualCode]);
    expect(aliasResult.status).toBe("satisfied");
    expect(aliasResult.evidence[0].matchedBy).toBe("alias");
    expect(codeResult.status).toBe("satisfied");
    expect(codeResult.evidence[0].matchedBy).toBe("code");
  });

  it("evaluates explicit grade-level rules and returns explainable review results", () => {
    expect(evaluate(["Grade 11 or 12"], [], { gradeLevel: 11 }).status).toBe("satisfied");
    expect(evaluate(["Grade 11 or 12"], [], { gradeLevel: 10 }).status).toBe("blocked");

    const ambiguous = evaluate(["Precalculus preferred"], []);
    expect(ambiguous.status).toBe("needs_review");
    expect(ambiguous.evidence[0]).toMatchObject({ kind: "manual_review", satisfied: null });
    expect(ambiguous.suggestedCounselorQuestions[0]).toContain("recommended or strictly required");
  });

  it("prevents substring and same-term false positives", () => {
    const wrongName = course({ courseId: undefined, code: null, name: "Advanced Algebra 1" });
    const wrongNumber = course({ courseId: undefined, code: null, name: "Algebra 10" });

    expect(evaluate(["Algebra 1"], [wrongName]).status).toBe("blocked");
    expect(evaluate(["Algebra 1"], [wrongNumber]).status).toBe("blocked");
    expect(evaluate(["Algebra 1"], [course({ termIndex: 4 })]).status).toBe("blocked");
  });
});
