import { describe, expect, it } from "vitest";
import type { PlanCourse } from "@/lib/models";
import { evaluateGpaScenario, initialGpaScenarioChoices, scenarioRows } from "@/lib/gpa-planner";

function row(id: string, status: PlanCourse["status"], grade: string | null, weighted = false): PlanCourse {
  return {
    id,
    plan_version_id: "v1",
    user_id: "u1",
    course_id: null,
    custom_course_name: id,
    grade_level: 11,
    school_year: "2025-2026",
    term: "full_year",
    status,
    credits: 10,
    college_units: null,
    letter_grade: grade,
    is_weighted: weighted,
    mapping_verified: true,
    user_edited: true,
    notes: null,
    sort_order: 0,
    source_review_item_id: null,
    smccd_course_id: null,
    college_provider_code: null,
    requirement_area_override: null
  };
}

describe("GPA scenario planning", () => {
  it("never removes or overwrites completed evidence", () => {
    const rows = [row("done", "completed", "B"), row("plan", "planned", null)];
    const result = scenarioRows(rows, [
      { planCourseId: "done", included: false, expectedGrade: "A" },
      { planCourseId: "plan", included: false, expectedGrade: "A" }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "done", letter_grade: "B" });
  });

  it("calculates the selected schedule and its A-grade ceiling", () => {
    const rows = [row("done", "completed", "B"), row("honors", "planned", null, true)];
    const result = evaluateGpaScenario(rows, [{ planCourseId: "honors", included: true, expectedGrade: "B" }], 4);
    expect(result.baseline.projectedWeighted).toBe(3);
    expect(result.scenario.projectedWeighted).toBe(3.5);
    expect(result.bestCase.projectedWeighted).toBe(4);
    expect(result.targetReachable).toBe(true);
    expect(result.targetGrade).toBe("A");
    expect(result.targetAlreadyReached).toBe(false);
  });

  it("reports missing grade assumptions and unreachable targets", () => {
    const rows = [row("done", "completed", "C"), row("plan", "planned", null)];
    const choices = initialGpaScenarioChoices(rows);
    const result = evaluateGpaScenario(rows, choices, 4.5);
    expect(result.missingExpectedGrades).toBe(1);
    expect(result.targetReachable).toBe(false);
  });
});
