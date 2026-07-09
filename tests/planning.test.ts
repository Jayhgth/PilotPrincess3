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
  schoolYearForGrade,
  simulatePlan
} from "@/lib/planning";

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
  onboarding_complete: true
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
