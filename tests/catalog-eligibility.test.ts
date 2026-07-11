import { describe, expect, it } from "vitest";

import {
  dtechCatalogEligibility,
  dtechMathRank,
  highestDemonstratedDtechMathRank,
  smccdCourseAlreadyInPlan
} from "@/lib/catalog-eligibility";
import type { Course, PlanCourse, SmccdCourse } from "@/lib/models";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "geometry",
    school_id: "dtech",
    catalog_version_id: "catalog",
    source_id: "source",
    course_code: null,
    name: "Geometry / Geometry Honors",
    subject: "Mathematics",
    course_type: "high_school",
    grade_levels: [9, 10],
    credits: 10,
    college_units: null,
    term_type: "year",
    uc_ag_area: "C",
    prerequisites: ["Algebra 1"],
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
    id: "plan-course",
    plan_version_id: "plan",
    user_id: "user",
    course_id: "algebra-2",
    custom_course_name: null,
    grade_level: 10,
    school_year: "2024-2025",
    term: "full_year",
    status: "completed",
    credits: 10,
    college_units: null,
    letter_grade: "A",
    is_weighted: true,
    mapping_verified: true,
    user_edited: false,
    notes: null,
    sort_order: 0,
    source_review_item_id: "transcript",
    smccd_course_id: null,
    requirement_area_override: null,
    ...overrides
  };
}

function smccd(overrides: Partial<SmccdCourse> = {}): SmccdCourse {
  return {
    id: "CSM:MATH 200",
    college_code: "CSM",
    course_code: "MATH 200",
    subject: "MATH",
    course_number: "200",
    title: "Statistics",
    units_min: 4,
    units_max: null,
    degree_applicable: true,
    transfer_credit: "CSU/UC",
    attributes: [],
    prerequisites: [],
    corequisites: [],
    recommended_preparation: [],
    detail_status: "verified",
    degree_applicability_source: "course_detail",
    catalog_url: "https://example.com",
    source_year: "2025-2026",
    ...overrides
  };
}

describe("catalog eligibility", () => {
  const algebra1 = course({ id: "algebra-1", name: "Algebra 1", grade_levels: [9] });
  const geometry = course();
  const algebra2 = course({
    id: "algebra-2",
    name: "Algebra 2 / Algebra 2-Trigonometry Honors",
    grade_levels: [10, 11],
    prerequisites: ["Geometry"]
  });
  const precalculus = course({ id: "precalculus", name: "Precalculus", grade_levels: [10, 11, 12] });
  const catalog = [algebra1, geometry, algebra2, precalculus];

  it("recognizes the reviewed d.tech math sequence without ranking lateral electives", () => {
    expect(dtechMathRank("Algebra II")).toBe(3);
    expect(dtechMathRank("Algebra 2 / Algebra 2-Trigonometry Honors")).toBe(3);
    expect(dtechMathRank("Advanced Statistics / Advanced Statistics Honors")).toBeNull();
  });

  it("hides lower math after a higher completed course", () => {
    const plan = [planCourse()];
    expect(highestDemonstratedDtechMathRank(plan, catalog)).toBe(3);
    expect(dtechCatalogEligibility(geometry, 10, plan, catalog)).toEqual({ eligible: false, reason: "below_math_level" });
    expect(dtechCatalogEligibility(precalculus, 10, plan, catalog)).toEqual({ eligible: true });
  });

  it("hides an alternate spine course at a level already demonstrated", () => {
    const compressed = course({ id: "compressed", name: "Algebra 2 + Pre-Calculus Honors", grade_levels: [11] });
    const completedPrecalculus = planCourse({ course_id: precalculus.id, grade_level: 10 });
    expect(dtechCatalogEligibility(compressed, 11, [completedPrecalculus], [...catalog, compressed])).toEqual({ eligible: false, reason: "below_math_level" });
  });

  it("hides exact and normalized already-taken courses", () => {
    const imported = planCourse({ course_id: null, custom_course_name: "Pre-Calculus Honors" });
    const honors = course({ id: "precalc-h", name: "Precalculus Honors", grade_levels: [11, 12] });
    expect(dtechCatalogEligibility(honors, 11, [imported], [...catalog, honors])).toEqual({ eligible: false, reason: "already_in_plan" });
  });

  it("hides courses outside the selected planning year", () => {
    expect(dtechCatalogEligibility(algebra1, 11, [], catalog)).toEqual({ eligible: false, reason: "outside_grade" });
  });

  it("treats the same SMCCD course code across colleges as already taken", () => {
    const skyline = smccd({ id: "SKY:MATH 200", college_code: "SKY" });
    const completedAtCsm = planCourse({ course_id: null, smccd_course_id: "CSM:MATH 200", custom_course_name: "MATH 200 Statistics" });
    expect(smccdCourseAlreadyInPlan(skyline, [completedAtCsm], [smccd(), skyline])).toBe(true);
  });
});
