import { describe, expect, it } from "vitest";

import type {
  Activity,
  Course,
  CourseRequirementMapping,
  GraduationRequirement,
  PlanCourse,
  StudentProfile
} from "@/lib/models";
import {
  calculateGpa,
  calculateRequirementProgress,
  calculateWorkload,
  generateSuggestedPlan,
  generateTimeline,
  overallGraduationPercent,
  requirementsForProfile,
  schoolYearForGrade,
  selectedPlanGrades,
  simulatePlan
} from "@/lib/planning";
import { findTranscriptCatalogMatch, transcriptPlanCourseDraft } from "@/lib/transcript";

const profile: StudentProfile = {
  id: "student-1",
  school_id: "school-1",
  preferred_name: "Avery",
  age: 15,
  grade_level: 10,
  graduation_year: 2028,
  academic_interests: ["engineering"],
  major_direction: "stem",
  career_direction: "",
  goal_intensity: "balanced",
  workload_tolerance: "balanced",
  stress_level: 3,
  activity_load_hours: 4,
  school_confirmed: true,
  onboarding_complete: true,
  plan_start_grade: 10,
  plan_end_grade: 12,
  tracker_mode: "full",
  tracked_requirement_areas: ["english", "social_science", "math", "lab_science", "world_language", "design_lab", "visual_performing_arts", "personal_development"]
};

const englishRequirement: GraduationRequirement = {
  id: "requirement-english",
  area: "english",
  name: "English",
  credits_required: 40,
  years_required: 4,
  notes: null,
  confidence: "verified",
  review_status: "approved"
};

function planCourse(overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id: "plan-course-1",
    plan_version_id: "version-1",
    user_id: "student-1",
    course_id: "course-english-1",
    custom_course_name: null,
    grade_level: 9,
    school_year: "2024-2025",
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
    ...overrides
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-english-1",
    school_id: "school-1",
    catalog_version_id: "catalog-1",
    source_id: "source-1",
    course_code: null,
    name: "English 1",
    subject: "English",
    course_type: "high_school",
    grade_levels: [9],
    credits: 10,
    college_units: null,
    term_type: "year",
    uc_ag_area: "b",
    prerequisites: [],
    description: null,
    is_honors: false,
    is_weighted: false,
    confidence: "verified",
    review_status: "approved",
    ...overrides
  };
}

const verifiedMapping: CourseRequirementMapping = {
  id: "mapping-1",
  course_id: "course-english-1",
  requirement_id: englishRequirement.id,
  confidence: "verified",
  is_user_override: false
};

describe("graduation requirement calculations", () => {
  it("counts only verified mappings toward progress", () => {
    const rows = [
      planCourse(),
      planCourse({ id: "unverified", course_id: "course-english-2", status: "planned", mapping_verified: false })
    ];
    const mappings = [
      verifiedMapping,
      { ...verifiedMapping, id: "mapping-2", course_id: "course-english-2", confidence: "likely" as const }
    ];

    const [progress] = calculateRequirementProgress([englishRequirement], rows, mappings);

    expect(progress.completedCredits).toBe(10);
    expect(progress.plannedCredits).toBe(0);
    expect(progress.unverifiedCredits).toBe(10);
    expect(progress.verifiedProjectedCredits).toBe(10);
    expect(progress.percent).toBe(25);
    expect(progress.status).toBe("missing");
  });

  it("caps overall graduation progress at each requirement maximum", () => {
    const progress = calculateRequirementProgress(
      [englishRequirement],
      [planCourse({ credits: 60 })],
      [verifiedMapping]
    );

    expect(progress[0].percent).toBe(100);
    expect(overallGraduationPercent(progress)).toBe(100);
  });
});

describe("GPA and workload calculations", () => {
  it("separates current and projected GPA and applies a capped honors point", () => {
    const summary = calculateGpa([
      planCourse({ letter_grade: "A", credits: 10 }),
      planCourse({ id: "planned", status: "planned", letter_grade: "B", credits: 10, is_weighted: true })
    ]);

    expect(summary.currentUnweighted).toBe(4);
    expect(summary.currentWeighted).toBe(4);
    expect(summary.projectedUnweighted).toBe(3.5);
    expect(summary.projectedWeighted).toBe(4);
    expect(summary.gradedCredits).toBe(20);
  });

  it("combines academic and activity load and warns above profile tolerance", () => {
    const activities: Activity[] = [{
      id: "activity-1",
      user_id: profile.id,
      name: "Robotics",
      kind: "club",
      role: null,
      weekly_hours: 30,
      start_grade: 10,
      end_grade: 12,
      notes: null
    }];
    const workload = calculateWorkload(
      { ...profile, workload_tolerance: "light" },
      [planCourse({ status: "current", is_weighted: true, college_units: 3 })],
      [course()],
      activities
    );

    expect(workload.level).toBe("balanced");
    expect(workload.warning).toContain("above the workload tolerance");
  });
});

describe("planning and simulation", () => {
  it("generates the source-backed flow without duplicating manual courses", () => {
    const catalog = [
      course({ id: "english-2", name: "English 2", grade_levels: [10] }),
      course({ id: "world-history", name: "World History", subject: "Social Science", grade_levels: [10] }),
      course({ id: "geometry", name: "Geometry", subject: "Mathematics", grade_levels: [10] })
    ];
    const existing = [planCourse({ id: "manual", course_id: "english-2", user_edited: true })];

    const generated = generateSuggestedPlan(profile, catalog, existing);

    expect(generated.map((row) => row.course_id)).toEqual(["world-history", "geometry"]);
    expect(generated.every((row) => row.status === "current" && row.grade_level === 10)).toBe(true);
    expect(existing[0].user_edited).toBe(true);
  });

  it("uses the student's graduation year to label school years", () => {
    expect(schoolYearForGrade(2028, 9)).toBe("2024-2025");
    expect(schoolYearForGrade(2028, 12)).toBe("2027-2028");
  });

  it("limits plan generation to the onboarding plan window", () => {
    const shortenedProfile = { ...profile, plan_start_grade: 10 as const, plan_end_grade: 11 as const };
    const catalog = [
      course({ id: "english-2", name: "English 2 / English 2 Honors", grade_levels: [10] }),
      course({ id: "english-3", name: "English 3 / English 3 Honors", grade_levels: [11] }),
      course({ id: "english-4", name: "English 4 / English 4 Honors", grade_levels: [12] })
    ];

    expect(selectedPlanGrades(shortenedProfile)).toEqual([10, 11]);
    expect(generateSuggestedPlan(shortenedProfile, catalog, []).map((row) => row.course_id)).toEqual(["english-2", "english-3"]);
  });

  it("filters the tracker to onboarding-selected requirement areas", () => {
    const mathRequirement: GraduationRequirement = {
      ...englishRequirement,
      id: "requirement-math",
      area: "math",
      name: "Mathematics"
    };

    expect(requirementsForProfile(
      [englishRequirement, mathRequirement],
      { ...profile, tracker_mode: "selected", tracked_requirement_areas: ["math"] }
    )).toEqual([mathRequirement]);
  });

  it("produces grade-aware timeline tasks from missing verified coverage", () => {
    const progress = calculateRequirementProgress([englishRequirement], [], []);
    const tasks = generateTimeline(profile, progress);

    expect(tasks.some((task) => task.title === "Choose a course for English")).toBe(true);
    expect(tasks.some((task) => task.title === "Record two academic or career interests")).toBe(true);
    expect(tasks.some((task) => task.category === "summer")).toBe(true);
  });

  it("keeps simulation changes bounded and exposes risks", () => {
    const progress = calculateRequirementProgress([englishRequirement], [planCourse()], [verifiedMapping]);
    const gpa = calculateGpa([planCourse()]);
    const workload = calculateWorkload(profile, [planCourse({ status: "current" })], [course()], []);
    const result = simulatePlan(
      {
        majorDirection: "stem",
        pathIntensity: "competitive",
        courseStyle: "more_honors",
        activityLoad: "higher"
      },
      { ...profile, stress_level: 5 },
      progress,
      gpa,
      workload
    );

    expect(result.simulated.projectedWeightedGpa).toBe(4.12);
    expect(result.simulated.stressLevel).toBe(5);
    expect(result.simulated.activityHours).toBe(4);
    expect(result.risks.length).toBeGreaterThan(0);
  });
});

describe("transcript import", () => {
  it("matches an exact catalog alias and creates a verified completed course", () => {
    const catalogCourse = course({
      id: "english-2",
      name: "English 2 / English 2 Honors",
      grade_levels: [10],
      is_honors: true,
      is_weighted: true
    });
    const mapping = { ...verifiedMapping, course_id: catalogCourse.id };

    expect(findTranscriptCatalogMatch("English 2 Honors", [catalogCourse])?.id).toBe(catalogCourse.id);
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "English 2 Honors",
        grade_level: 10,
        school_year: "2025-2026",
        term: "full_year",
        letter_grade: "a-",
        credits: 10,
        weighted: true,
        matched_course_id: catalogCourse.id,
        matched_course_name: catalogCourse.name
      },
      profile,
      [catalogCourse],
      [mapping],
      "review-1"
    );

    expect(draft.course_id).toBe(catalogCourse.id);
    expect(draft.status).toBe("completed");
    expect(draft.letter_grade).toBe("A-");
    expect(draft.mapping_verified).toBe(true);
    expect(draft.source_review_item_id).toBe("review-1");
  });

  it("keeps an unmatched transcript row custom and unverified", () => {
    const draft = transcriptPlanCourseDraft(
      { course_name: "Independent Study in Robotics", grade_level: 9, credits: 5 },
      profile,
      [],
      [],
      "review-2"
    );

    expect(draft.course_id).toBeNull();
    expect(draft.custom_course_name).toBe("Independent Study in Robotics");
    expect(draft.mapping_verified).toBe(false);
    expect(draft.status).toBe("completed");
  });
});
