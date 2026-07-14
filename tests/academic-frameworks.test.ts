import { describe, expect, it } from "vitest";
import { calculateAcademicFrameworkProgress, frameworkRuleCredits, ruleAppliesToStudent } from "@/lib/academic-frameworks";
import type { AcademicFramework, AcademicRequirementRule, Course, CourseFrameworkMapping, PlanCourse } from "@/lib/models";

const framework: AcademicFramework = {
  id: "framework-1",
  school_id: null,
  framework_type: "uc_ag",
  jurisdiction_key: "uc",
  name: "A–G",
  academic_year: "2026-27",
  source_url: "https://example.edu/ag",
  source_label: "UC",
  status: "published",
  effective_graduation_year_start: null,
  effective_graduation_year_end: null
};

function rule(overrides: Partial<AcademicRequirementRule> = {}): AcademicRequirementRule {
  return {
    id: "rule-b",
    framework_id: framework.id,
    rule_key: "b",
    parent_rule_key: null,
    subject_area: "B",
    title: "English",
    credits_required: null,
    years_required: 4,
    courses_required: null,
    minimum_grade: "C",
    required_before_grade: null,
    effective_graduation_year_start: null,
    effective_graduation_year_end: null,
    notes: null,
    sort_order: 10,
    ...overrides
  };
}

function course(): Course {
  return {
    id: "course-1", school_id: "school-1", catalog_version_id: "catalog-1", source_id: null,
    course_code: "ENGL 1", name: "English 1", subject: "English", course_type: "high_school",
    grade_levels: [9], credits: 10, college_units: null, term_type: "year", uc_ag_area: "b",
    prerequisites: [], description: null, is_honors: false, is_weighted: false,
    confidence: "verified", review_status: "approved"
  };
}

function planCourse(overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id: "plan-1", plan_version_id: "version-1", user_id: "user-1", course_id: "course-1",
    custom_course_name: null, grade_level: 9, school_year: "2023-2024", term: "full_year",
    status: "completed", credits: 10, college_units: null, letter_grade: "B", is_weighted: false,
    mapping_verified: true, user_edited: false, notes: null, sort_order: 0,
    source_review_item_id: null, smccd_course_id: null, requirement_area_override: null,
    ...overrides
  };
}

const mapping: CourseFrameworkMapping = {
  id: "mapping-1", course_id: "course-1", framework_id: framework.id,
  requirement_rule_id: "rule-b", source_url: null, confidence: "verified", review_status: "approved"
};

describe("academic framework progress", () => {
  it("normalizes years to high-school credits and applies graduation-year rules", () => {
    expect(frameworkRuleCredits(rule())).toBe(40);
    expect(ruleAppliesToStudent(rule({ effective_graduation_year_start: 2030 }), 2029)).toBe(false);
    expect(ruleAppliesToStudent(rule({ effective_graduation_year_start: 2030 }), 2030)).toBe(true);
  });

  it("counts only approved mappings and minimum-grade evidence", () => {
    const [progress] = calculateAcademicFrameworkProgress({
      frameworks: [framework], rules: [rule()], mappings: [mapping], courses: [course()],
      planCourses: [planCourse(), planCourse({ id: "plan-2", status: "current", letter_grade: null })], graduationYear: 2027
    });
    expect(progress.mappingCoverage).toBe("available");
    expect(progress.completedCredits).toBe(10);
    expect(progress.scheduledCredits).toBe(10);
    expect(progress.remainingCredits).toBe(20);

    const [belowMinimum] = calculateAcademicFrameworkProgress({
      frameworks: [framework], rules: [rule()], mappings: [mapping], courses: [course()],
      planCourses: [planCourse({ letter_grade: "D" })], graduationYear: 2027
    });
    expect(belowMinimum.completedCredits).toBe(0);
    expect(belowMinimum.rules[0]?.excludedCourseIds).toEqual(["plan-1"]);
  });

  it("reports missing catalog mappings instead of false completion", () => {
    const [progress] = calculateAcademicFrameworkProgress({
      frameworks: [framework], rules: [rule()], mappings: [], courses: [], planCourses: [], graduationYear: 2027
    });
    expect(progress.mappingCoverage).toBe("missing");
    expect(progress.totalRules).toBe(1);
    expect(progress.remainingCredits).toBe(40);
  });
});
