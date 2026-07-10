import { describe, expect, it } from "vitest";

import {
  evaluateDtechPlannerPrerequisites,
  evaluateSmccdPlannerPrerequisites,
  plannerCourseInputs,
  plannerTargetTermIndex
} from "@/lib/prerequisites";
import type { Course, PlanCourse, SmccdCourse } from "@/lib/models";

function dtechCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "geometry",
    school_id: "dtech",
    catalog_version_id: "2025-26",
    source_id: "catalog",
    course_code: null,
    name: "Geometry / Geometry Honors",
    subject: "Mathematics",
    course_type: "high_school",
    grade_levels: [9, 10],
    credits: 10,
    college_units: null,
    term_type: "year",
    uc_ag_area: "C (Mathematics)",
    prerequisites: [],
    description: null,
    is_honors: true,
    is_weighted: true,
    confidence: "verified",
    review_status: "approved",
    ...overrides
  };
}

function planCourse(overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id: "planned-geometry",
    plan_version_id: "plan",
    user_id: "user",
    course_id: "geometry",
    custom_course_name: null,
    grade_level: 9,
    school_year: "2024-2025",
    term: "full_year",
    status: "completed",
    credits: 10,
    college_units: null,
    letter_grade: "B",
    is_weighted: true,
    mapping_verified: true,
    user_edited: false,
    notes: null,
    sort_order: 0,
    source_review_item_id: "transcript-row",
    smccd_course_id: null,
    requirement_area_override: null,
    ...overrides
  };
}

function smccdCourse(overrides: Partial<SmccdCourse> = {}): SmccdCourse {
  return {
    id: "CSM:ENGL C1000",
    college_code: "CSM",
    course_code: "ENGL C1000",
    subject: "ENGL",
    course_number: "C1000",
    title: "Academic Reading and Writing",
    units_min: 3,
    units_max: null,
    degree_applicable: true,
    transfer_credit: "CSU/UC",
    attributes: ["Cal-GETC Area 1A"],
    prerequisites: ["Placement as determined by the college's multiple measures assessment process."],
    corequisites: [],
    recommended_preparation: [],
    detail_status: "verified",
    degree_applicability_source: "course_detail",
    catalog_url: "https://catalog.collegeofsanmateo.edu/current/courses/english/engl-C1000.php",
    source_year: "2025-2026",
    ...overrides
  };
}

describe("planner prerequisite adapters", () => {
  it("uses transcript aliases and real plan chronology for d.tech checks", () => {
    const geometry = dtechCourse();
    const precalculus = dtechCourse({
      id: "precalculus",
      name: "Precalculus",
      grade_levels: [10, 11, 12],
      prerequisites: ["Geometry"]
    });
    const evaluation = evaluateDtechPlannerPrerequisites(
      precalculus,
      { gradeLevel: 10, term: "full_year" },
      [geometry, precalculus],
      [planCourse()],
      []
    );

    expect(evaluation.result.status).toBe("satisfied");
    expect(evaluation.result.evidence[0]).toMatchObject({ matchedBy: "id", satisfied: true });
  });

  it("does not claim chronology for current or planned full-year courses", () => {
    const geometry = dtechCourse();
    const precalculus = dtechCourse({ id: "precalculus", name: "Precalculus", prerequisites: ["Geometry"] });
    const currentGeometry = planCourse({ status: "current", source_review_item_id: null, letter_grade: null });
    const evaluation = evaluateDtechPlannerPrerequisites(
      precalculus,
      { gradeLevel: 10, term: "full_year" },
      [geometry, precalculus],
      [currentGeometry],
      []
    );

    expect(plannerCourseInputs([currentGeometry], [geometry], [])[0].termIndex).toBeUndefined();
    expect(evaluation.result.status).toBe("needs_review");
  });

  it("keeps SMCCD multiple-measures placement in counselor review", () => {
    const english = smccdCourse();
    const evaluation = evaluateSmccdPlannerPrerequisites(
      english,
      { gradeLevel: 11, term: "fall" },
      [english],
      [],
      []
    );

    expect(evaluation.result.status).toBe("needs_review");
    expect(evaluation.result.evidence[0]).toMatchObject({ kind: "clearance", satisfied: null });
  });

  it("assigns monotonically ordered planner term indexes", () => {
    expect(plannerTargetTermIndex(9, "fall")).toBeLessThan(plannerTargetTermIndex(9, "spring"));
    expect(plannerTargetTermIndex(9, "summer")).toBeLessThan(plannerTargetTermIndex(10, "fall"));
  });
});
