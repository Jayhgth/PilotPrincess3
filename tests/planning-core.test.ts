import { describe, expect, it } from "vitest";
import type { Course, CourseRequirementMapping, GraduationRequirement, PlanCourse, StudentSettings } from "@/lib/models";
import { appliedCreditBreakdown, calculateGpa, calculateRequirementProgress, generateSuggestedPlan, planCourseMovePatch } from "@/lib/planning";

const settings: StudentSettings = {
  id: "student", school_id: "school", preferred_name: "Jay", age: 14, grade_level: 9, graduation_year: 2030,
  school_confirmed: true, school_selected_at: null, onboarding_complete: true, ai_enabled: true,
  ai_model: "gpt-5.6-luna", ai_reasoning_effort: "low", ai_review_mode: "auto_review",
  ai_connection_approved_at: null, ai_setup_tested_at: null, plan_start_grade: 9, plan_end_grade: 12,
  tracker_mode: "full", tracked_requirement_areas: []
};

function course(id: string, name: string, subject = "Math", grades = [9, 10, 11, 12], weighted = false): Course {
  return {
    id, school_id: "school", catalog_version_id: "catalog", source_id: "source", course_code: null,
    name, subject, course_type: "high_school", grade_levels: grades, credits: 10, college_units: null,
    term_type: "year", uc_ag_area: null, prerequisites: [], description: null, is_honors: weighted,
    is_weighted: weighted, confidence: "verified", review_status: "approved"
  };
}

function plan(overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id: "plan", plan_version_id: "version", user_id: "student", course_id: "english", custom_course_name: null,
    grade_level: 9, school_year: "2026-2027", term: "full_year", status: "completed", credits: 10,
    college_units: null, letter_grade: "A", is_weighted: false, mapping_verified: true, user_edited: false,
    notes: null, sort_order: 0, source_review_item_id: null, smccd_course_id: null,
    college_provider_code: null, requirement_area_override: null, ...overrides
  };
}

const requirement: GraduationRequirement = {
  id: "math-requirement", area: "math", name: "Math", credits_required: 30, years_required: 3,
  notes: null, confidence: "verified", review_status: "approved"
};

describe("core academic planning contracts", () => {
  it("caps completed, current, and planned credit at the requirement", () => {
    expect(appliedCreditBreakdown({ required: 30, completed: 10, current: 20, planned: 20 })).toEqual({
      completed: 10, current: 20, planned: 0, remaining: 0, total: 30, unverified: 0
    });
  });

  it("counts only verified course mappings toward diploma progress", () => {
    const mappings: CourseRequirementMapping[] = [
      { id: "map", course_id: "math", requirement_id: requirement.id, confidence: "verified", is_user_override: false },
      { id: "likely-map", course_id: "other", requirement_id: requirement.id, confidence: "likely", is_user_override: false }
    ];
    const [progress] = calculateRequirementProgress([requirement], [plan({ course_id: "math" }), plan({ id: "unknown", course_id: "other", status: "planned", mapping_verified: false })], mappings);
    expect(progress).toMatchObject({ completedCredits: 10, plannedCredits: 0, unverifiedCredits: 10, percent: 33, status: "missing" });
  });

  it("derives weighted GPA from course variables and automatically weights college rows", () => {
    const summary = calculateGpa([
      plan({ id: "hs", letter_grade: "A", credits: 5, is_weighted: false }),
      plan({ id: "college", letter_grade: "A", credits: 5, college_units: 3, smccd_course_id: "CSM:MATH 251", is_weighted: false })
    ]);
    expect(summary.currentUnweighted).toBe(4);
    expect(summary.currentWeighted).toBe(4.5);
  });

  it("places an explicitly requested starting math course in the planning start grade", () => {
    const precalculus = course("precalc", "Precalculus", "Mathematics", [11, 12], true);
    const generated = generateSuggestedPlan(settings, [precalculus], [], null, true, {
      schoolSlug: "carlmont-high", requirements: [requirement], mappings: [{ id: "map", course_id: precalculus.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false }],
      startGrade: 9, startingMathCourse: "pre-calc", rigor: "advanced", maxCoursesPerTerm: 7
    });
    expect(generated[0]).toMatchObject({ course_id: "precalc", grade_level: 9, is_weighted: true });
    expect(generated.every((row) => row.course_id === "precalc")).toBe(true);
  });

  it("uses only the selected school's mapped catalog rather than the d.tech flow", () => {
    const local = course("local-math", "Integrated Math 1");
    const generated = generateSuggestedPlan(settings, [local, course("english-1", "English 1", "English")], [], null, true, {
      schoolSlug: "another-school", requirements: [requirement], mappings: [{ id: "map", course_id: local.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false }]
    });
    expect(generated.map((row) => row.course_id)).toEqual(["local-math"]);
  });

  it("locks transcript-backed rows while keeping editable plan moves deterministic", () => {
    expect(planCourseMovePatch(settings, plan({ source_review_item_id: "review" }), "planned", 3)).toBeNull();
    expect(planCourseMovePatch(settings, plan(), "planned", 3)).toMatchObject({ status: "planned", grade_level: 10, sort_order: 3, letter_grade: null });
  });
});
