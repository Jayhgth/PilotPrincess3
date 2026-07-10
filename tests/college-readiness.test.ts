import { describe, expect, it } from "vitest";
import { calculateAgProgress } from "@/lib/college-readiness";
import type { Course, PlanCourse, SmccdCourse, SmccdHighSchoolEquivalency } from "@/lib/models";

function course(overrides: Partial<Course>): Course {
  return {
    id: "course",
    school_id: "school",
    catalog_version_id: "catalog",
    source_id: "source",
    course_code: null,
    name: "Course",
    subject: "Subject",
    course_type: "high_school",
    grade_levels: [9, 10, 11, 12],
    credits: 10,
    college_units: null,
    term_type: "year",
    uc_ag_area: null,
    prerequisites: [],
    description: null,
    is_honors: false,
    is_weighted: false,
    confidence: "verified",
    review_status: "approved",
    ...overrides
  };
}

function planCourse(overrides: Partial<PlanCourse>): PlanCourse {
  return {
    id: "row",
    user_id: "user",
    plan_version_id: "version",
    course_id: "course",
    custom_course_name: null,
    grade_level: 10,
    school_year: "2025-2026",
    term: "full_year",
    status: "completed",
    credits: 10,
    college_units: null,
    letter_grade: "A",
    is_weighted: false,
    mapping_verified: true,
    user_edited: false,
    notes: null,
    sort_order: 0,
    source_review_item_id: null,
    smccd_course_id: null,
    requirement_area_override: null,
    ...overrides
  };
}

describe("UC/CSU A-G progress", () => {
  it("separates earned and scheduled years and excludes grades below C", () => {
    const courses = [
      course({ id: "english-1", name: "English 1", uc_ag_area: "B (English)" }),
      course({ id: "english-2", name: "English 2", uc_ag_area: "B (English)" }),
      course({ id: "algebra-2", name: "Algebra 2", uc_ag_area: "C (Mathematics)" })
    ];
    const result = calculateAgProgress([
      planCourse({ id: "english-1-row", course_id: "english-1" }),
      planCourse({ id: "english-2-row", course_id: "english-2", status: "current", letter_grade: "IP", grade_level: 11 }),
      planCourse({ id: "algebra-row", course_id: "algebra-2", letter_grade: "D" })
    ], courses, [], []);

    const english = result.areas.find((area) => area.area === "b")!;
    expect(english.completedYears).toBe(1);
    expect(english.currentYears).toBe(1);
    expect(result.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ planCourseId: "algebra-row", reason: "A-G requires a final grade of C or better." })
    ]));
  });

  it("applies extra A-F coursework to G without double counting it", () => {
    const courses = [
      course({ id: "history-1", name: "Ethnic Studies", uc_ag_area: "A (History)" }),
      course({ id: "history-2", name: "World History", uc_ag_area: "A (History)" }),
      course({ id: "history-3", name: "US History", uc_ag_area: "A (History)" })
    ];
    const result = calculateAgProgress(courses.map((item, index) => planCourse({
      id: `row-${index}`,
      course_id: item.id,
      grade_level: (9 + index) as 9 | 10 | 11
    })), courses, [], []);

    expect(result.areas.find((area) => area.area === "a")?.completedYears).toBe(2);
    const elective = result.areas.find((area) => area.area === "g")!;
    expect(elective.completedYears).toBe(1);
    expect(elective.contributions[0].note).toContain("Additional A coursework");
    expect(result.completedYears).toBe(3);
  });

  it("uses verified language level and reviewed SMCCD evidence conservatively", () => {
    const language = course({ id: "mandarin-3", name: "Mandarin 3 Spring", subject: "World Language", uc_ag_area: "E (Language Other Than English)" });
    const collegeCourse: SmccdCourse = {
      id: "CSM:CHIN 132",
      college_code: "CSM",
      course_code: "CHIN 132",
      subject: "CHIN",
      course_number: "132",
      title: "Intermediate Chinese II",
      units_min: 3,
      units_max: 3,
      degree_applicable: true,
      transfer_credit: "CSU/UC",
      attributes: [],
      prerequisites: [],
      corequisites: [],
      recommended_preparation: [],
      detail_status: "verified",
      degree_applicability_source: "course_detail",
      catalog_url: "https://example.edu/chin132",
      source_year: "2025-26"
    };
    const equivalency: SmccdHighSchoolEquivalency = {
      normalized_course_code: "CHIN 132",
      college_course_code: "Chinese 132",
      description: "Intermediate Chinese II",
      college_units: 3,
      high_school_credits: 5,
      high_school_equivalent: "Mandarin 3 Spring",
      requirement_area: "world_language",
      pairing_note: null,
      source_id: "source",
      confidence: "verified"
    };
    const result = calculateAgProgress([
      planCourse({
        id: "chin-row",
        course_id: null,
        custom_course_name: "CHIN 132 Intermediate Chinese II",
        credits: 5,
        college_units: 3,
        smccd_course_id: collegeCourse.id,
        requirement_area_override: "world_language"
      })
    ], [language], [collegeCourse], [equivalency]);

    const languageProgress = result.areas.find((area) => area.area === "e")!;
    expect(languageProgress.completedYears).toBe(2);
    expect(languageProgress.status).toBe("complete");
    expect(languageProgress.contributions[0].note).toContain("second-level or higher");
  });

  it("does not count a college course without an exact reviewed A-G link", () => {
    const collegeCourse = {
      id: "SKY:PSYC 100",
      college_code: "SKY",
      course_code: "PSYC 100",
      subject: "PSYC",
      course_number: "100",
      title: "General Psychology",
      units_min: 3,
      units_max: 3,
      degree_applicable: true,
      transfer_credit: "CSU/UC",
      attributes: [],
      prerequisites: [],
      corequisites: [],
      recommended_preparation: [],
      detail_status: "verified",
      degree_applicability_source: "course_detail",
      catalog_url: "https://example.edu/psyc100",
      source_year: "2025-26"
    } satisfies SmccdCourse;
    const result = calculateAgProgress([
      planCourse({ id: "psych-row", course_id: null, custom_course_name: "PSYC 100", college_units: 3, smccd_course_id: collegeCourse.id })
    ], [], [collegeCourse], []);

    expect(result.projectedYears).toBe(0);
    expect(result.unresolved[0].reason).toContain("no exact reviewed link");
  });
});
