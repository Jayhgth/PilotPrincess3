import { describe, expect, it } from "vitest";

import {
  buildReviewedDtechToSmccdPrerequisiteEquivalencies,
  createSmccdPlannerPrerequisiteEvaluator,
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

  it("accepts a completed honors variant when the catalog prerequisite names the standard course", () => {
    const standardPrecalculus = dtechCourse({
      id: "precalculus",
      name: "Precalculus",
      grade_levels: [10, 11, 12]
    });
    const honorsPrecalculus = dtechCourse({
      id: "precalculus-honors",
      name: "Precalculus Honors",
      grade_levels: [10, 11, 12]
    });
    const calculus = dtechCourse({
      id: "calculus",
      name: "Calculus / Calculus Honors",
      grade_levels: [11, 12],
      prerequisites: ["Precalculus"]
    });
    const completedHonors = planCourse({ course_id: honorsPrecalculus.id, grade_level: 10 });
    const evaluation = evaluateDtechPlannerPrerequisites(
      calculus,
      { gradeLevel: 11, term: "full_year" },
      [standardPrecalculus, honorsPrecalculus, calculus],
      [completedHonors],
      []
    );

    expect(evaluation.result.status).toBe("satisfied");
    expect(evaluation.result.evidence[0]).toMatchObject({ matchedBy: "alias", satisfied: true });
  });

  it("uses grade chronology for current or planned full-year courses", () => {
    const geometry = dtechCourse();
    const precalculus = dtechCourse({ id: "precalculus", name: "Precalculus", prerequisites: ["Geometry"] });
    const currentGeometry = planCourse({ status: "current", source_review_item_id: null, letter_grade: null });
    const evaluation = evaluateDtechPlannerPrerequisites(
      precalculus,
      { gradeLevel: 11, term: "full_year" },
      [geometry, precalculus],
      [currentGeometry],
      []
    );

    expect(plannerCourseInputs([currentGeometry], [geometry], [])[0].termIndex).toBe(plannerTargetTermIndex(9, "fall"));
    expect(evaluation.result.status).toBe("satisfied");
  });

  it("does not accept a full-year prerequisite in the same grade unless concurrent enrollment is allowed", () => {
    const geometry = dtechCourse();
    const precalculus = dtechCourse({ id: "precalculus", name: "Precalculus", prerequisites: ["Geometry"] });
    const currentGeometry = planCourse({ status: "current", source_review_item_id: null, letter_grade: null, grade_level: 10 });
    const evaluation = evaluateDtechPlannerPrerequisites(
      precalculus,
      { gradeLevel: 10, term: "full_year" },
      [geometry, precalculus],
      [currentGeometry],
      []
    );

    expect(evaluation.result.status).toBe("blocked");
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

  it("reuses a browsing evaluator without changing SMCCD prerequisite results", () => {
    const prerequisite = smccdCourse({ id: "CSM:MATH 120", course_code: "MATH 120", prerequisites: [] });
    const target = smccdCourse({ id: "CSM:MATH 200", course_code: "MATH 200", prerequisites: ["MATH 120"] });
    const completed = planCourse({ smccd_course_id: prerequisite.id, course_id: null });
    const evaluator = createSmccdPlannerPrerequisiteEvaluator([prerequisite, target], [completed], []);

    expect(evaluator(target, { gradeLevel: 11, term: "fall" }).result.status).toBe("satisfied");
    expect(evaluator(target, { gradeLevel: 11, term: "fall" }).result.status).toBe("satisfied");
  });

  it("uses a d.tech course for an SMCCD prerequisite only through a reviewed reverse mapping", () => {
    const algebra = dtechCourse({ id: "algebra-2", name: "Algebra 2", grade_levels: [9, 10, 11] });
    const prerequisite = smccdCourse({
      id: "CSM:MATH 120",
      course_code: "MATH 120",
      course_number: "120",
      subject: "MATH",
      title: "Intermediate Algebra",
      prerequisites: []
    });
    const target = smccdCourse({
      id: "CSM:MATH 200",
      course_code: "MATH 200",
      course_number: "200",
      subject: "MATH",
      title: "Statistics",
      prerequisites: ["MATH 120"]
    });
    const completedAlgebra = planCourse({ course_id: algebra.id });
    const reviewedMappings = buildReviewedDtechToSmccdPrerequisiteEquivalencies([
      {
        id: "reviewed-algebra",
        from: { id: algebra.id, name: algebra.name },
        toSmccdCourseId: prerequisite.id,
        status: "approved",
        verificationStatus: "approved",
        authority: "SMCCD counselor"
      }
    ], [prerequisite, target].map((course) => ({
      id: course.id,
      collegeCode: course.college_code,
      courseCode: course.course_code,
      title: course.title,
      prerequisites: course.prerequisites,
      corequisites: course.corequisites,
      recommendedPreparation: course.recommended_preparation,
      catalogUrl: course.catalog_url,
      sourceYear: course.source_year,
      detailStatus: course.detail_status
    })));

    const withoutReview = evaluateSmccdPlannerPrerequisites(
      target,
      { gradeLevel: 11, term: "fall" },
      [prerequisite, target],
      [completedAlgebra],
      [algebra]
    );
    const withReview = evaluateSmccdPlannerPrerequisites(
      target,
      { gradeLevel: 11, term: "fall" },
      [prerequisite, target],
      [completedAlgebra],
      [algebra],
      reviewedMappings
    );

    expect(withoutReview.result.status).toBe("blocked");
    expect(withReview.result.status).toBe("satisfied");
    expect(withReview.result.evidence[0]).toMatchObject({ matchedBy: "equivalency", satisfied: true });
  });

  it("assigns monotonically ordered planner term indexes", () => {
    expect(plannerTargetTermIndex(9, "fall")).toBeLessThan(plannerTargetTermIndex(9, "spring"));
    expect(plannerTargetTermIndex(9, "summer")).toBeLessThan(plannerTargetTermIndex(10, "fall"));
  });
});
