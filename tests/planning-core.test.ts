import { describe, expect, it } from "vitest";
import type { Course, CourseRequirementMapping, GraduationRequirement, PlanCourse, SchoolPlanningProfile, StudentSettings } from "@/lib/models";
import { appliedCreditBreakdown, calculateGpa, calculateRequirementProgress, generateSuggestedPlan, planCourseMovePatch } from "@/lib/planning";
import { normalizeWorkspaceBootstrap } from "@/lib/workspace-bootstrap";

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

    const current = { ...course("current", "Current Math"), catalog_version_id: "current-catalog" };
    const stale = { ...course("stale", "Stale Math"), catalog_version_id: "stale-catalog" };
    const normalized = normalizeWorkspaceBootstrap({
      requirements: [{ ...requirement, catalog_version_id: "current-catalog" }],
      courses: [stale, current],
      mappings: [
        { id: "current-map", course_id: current.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false },
        { id: "stale-map", course_id: stale.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false }
      ]
    });
    expect(normalized.courses.map((row) => row.id)).toEqual(["current"]);
    expect(normalized.mappings.map((row) => row.id)).toEqual(["current-map"]);

    const electiveRequirement: GraduationRequirement = { ...requirement, id: "electives", area: "electives", name: "Electives", credits_required: 10, years_required: 1 };
    const overflow = calculateRequirementProgress(
      [{ ...requirement, credits_required: 10 }, electiveRequirement],
      [plan({ course_id: "math" }), plan({ id: "extra", course_id: "extra", mapping_verified: true })],
      [{ id: "math-only", course_id: "math", requirement_id: requirement.id, confidence: "verified", is_user_override: false }]
    );
    expect(overflow.find((item) => item.requirement.area === "electives")).toMatchObject({ completedCredits: 10, status: "complete" });
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

  it("uses a retrieved school planning profile instead of a global course flow", () => {
    const geometry = course("geometry", "Geometry", "Mathematics", [9]);
    const algebra = course("algebra", "Algebra I", "Mathematics", [9]);
    const journalism = course("journalism", "Journalism", "Electives", [9]);
    const electiveRequirement: GraduationRequirement = { ...requirement, id: "electives", area: "electives", name: "Electives", credits_required: 10, years_required: 1 };
    const profile: SchoolPlanningProfile = {
      id: "profile", school_id: "school", academic_year: "2026-27", title: "Official planning guide", source_urls: ["https://school.example/guide"], status: "verified",
      college_course_posture: "supplemental", college_eligible_grades: [11, 12], always_high_school_areas: [], guidance_notes: [], created_at: "2026-07-15", updated_at: "2026-07-15",
      grade_rules: { "9": { minimum_high_school_courses: 2, target_total_courses: 2, required_areas: ["math"], preferred_course_names: ["Geometry"] } }
    };
    const generated = generateSuggestedPlan({ ...settings, plan_end_grade: 9 }, [algebra, geometry, journalism], [], null, true, {
      schoolSlug: "example-high", planningProfile: profile, requirements: [{ ...requirement, credits_required: 10, years_required: 1 }, electiveRequirement],
      mappings: [
        { id: "algebra-map", course_id: algebra.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false },
        { id: "geometry-map", course_id: geometry.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false },
        { id: "journalism-map", course_id: journalism.id, requirement_id: electiveRequirement.id, confidence: "verified", is_user_override: false }
      ], startGrade: 9
    });
    expect(generated.map((row) => row.course_id)).toEqual(["geometry", "journalism"]);
  });

  it("builds a balanced selected-school sequence before safe electives", async () => {
    const requirements: GraduationRequirement[] = [
      { ...requirement, id: "english-req", area: "english", name: "English", credits_required: 40, years_required: 4 },
      { ...requirement, id: "math-req", credits_required: 20, years_required: 2 },
      { ...requirement, id: "social-req", area: "social_science", name: "Social Studies", credits_required: 30, years_required: 3 },
      { ...requirement, id: "science-req", area: "lab_science", name: "Science", credits_required: 20, years_required: 2 },
      { ...requirement, id: "pe-req", area: "physical_education", name: "PE", credits_required: 20, years_required: 2 },
      { ...requirement, id: "ethnic-req", area: "ethnic_studies", name: "Ethnic Studies", credits_required: 10, years_required: 1 },
      { ...requirement, id: "arts-req", area: "visual_performing_arts", name: "Arts", credits_required: 10, years_required: 1 },
      { ...requirement, id: "elective-req", area: "electives", name: "Electives", credits_required: 50, years_required: 5 }
    ];
    const semester = (value: Course) => ({ ...value, term_type: "semester" as const, credits: 5 });
    const localCourses: Course[] = [
      course("english-1", "English I", "English", [9]),
      course("english-2", "English II", "English", [10]),
      course("english-3", "AP Language & Composition", "English", [11], true),
      course("english-4", "AP Literature & Composition", "English", [12], true),
      course("precalc", "Pre-Calc Honors", "Math", [10, 11, 12], true),
      course("calc-ab", "AP Calculus AB", "Math", [10, 11, 12], true),
      course("calc-bc", "AP Calculus BC", "Math", [11, 12], true),
      course("multi", "Multivariable Calculus", "Math", [12], true),
      course("world", "AP World History", "History", [10], true),
      course("us", "AP US History", "History", [11], true),
      semester(course("government", "American Government", "History", [12])),
      semester(course("economics", "Economics", "History", [12])),
      course("biology", "Biology", "Science", [9]),
      course("chemistry", "Chemistry", "Science", [10]),
      course("physics", "Physics", "Science", [11]),
      course("pe-1", "PE 1", "Physical Education", [9]),
      course("pe-2", "PE 2", "Physical Education", [10]),
      course("pe-weight", "PE Weight Training", "Physical Education", [10]),
      course("ethnic", "Ethnic Studies", "Social Studies", [9]),
      course("art", "Art", "Visual and Performing Arts", [9]),
      { ...course("spanish-1", "Spanish I", "World Language", [10]), uc_ag_area: "E" },
      { ...course("spanish-2", "Spanish II", "World Language", [11]), uc_ag_area: "E" },
      course("psych", "AP Psychology", "Elective", [11, 12], true),
      course("seminar", "AP Seminar", "Elective", [11, 12], true),
      course("computer", "Computer Science", "Elective", [12], true),
      course("journalism", "Journalism", "Elective", [12]),
      course("business", "Business", "Elective", [12]),
      course("phoenix", "Phoenix Credit Recovery", "Elective", [10, 11, 12]),
      course("ece", "Early Childhood Education", "Elective", [11, 12])
    ];
    const requirementIdByArea = new Map(requirements.map((row) => [row.area, row.id]));
    const areaByCourseId = new Map<string, GraduationRequirement["area"]>([
      ...["english-1", "english-2", "english-3", "english-4"].map((id) => [id, "english"] as const),
      ...["precalc", "calc-ab", "calc-bc", "multi"].map((id) => [id, "math"] as const),
      ...["world", "us", "government", "economics"].map((id) => [id, "social_science"] as const),
      ...["biology", "chemistry", "physics"].map((id) => [id, "lab_science"] as const),
      ...["pe-1", "pe-2", "pe-weight"].map((id) => [id, "physical_education"] as const),
      ["ethnic", "ethnic_studies"], ["art", "visual_performing_arts"]
    ]);
    const mappings: CourseRequirementMapping[] = localCourses.map((row, index) => ({
      id: `map-${index}`,
      course_id: row.id,
      requirement_id: requirementIdByArea.get(areaByCourseId.get(row.id) ?? "electives")!,
      confidence: "verified",
      is_user_override: false
    }));
    const generated = generateSuggestedPlan(settings, localCourses, [], null, true, {
      schoolSlug: "carlmont-high", requirements, mappings, startGrade: 9, startingMathCourse: "pre-calc",
      rigor: "advanced", maxCoursesPerTerm: 6, includeCollegeCourses: false
    });
    const names = new Map(localCourses.map((row) => [row.id, row.name]));
    for (const grade of [9, 10, 11, 12] as const) {
      const rows = generated.filter((row) => row.grade_level === grade);
      expect(rows.filter((row) => row.term === "fall" || row.term === "full_year")).toHaveLength(6);
      expect(rows.filter((row) => row.term === "spring" || row.term === "full_year")).toHaveLength(6);
      expect(rows.filter((row) => areaByCourseId.get(row.course_id) === "english")).toHaveLength(1);
      expect(rows.filter((row) => areaByCourseId.get(row.course_id) === "math")).toHaveLength(1);
    }
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "physical_education").map((row) => [row.grade_level, names.get(row.course_id)])).toEqual([[9, "PE 1"], [10, "PE 2"]]);
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "social_science").map((row) => names.get(row.course_id))).toEqual(["AP World History", "AP US History", "American Government", "Economics"]);
    expect(generated.map((row) => names.get(row.course_id))).not.toContain("Phoenix Credit Recovery");
    expect(generated.map((row) => names.get(row.course_id))).not.toContain("Early Childhood Education");

    const { extractCatalogCourses, extractGraduationRequirements } = await import("../scripts/lib/school-academic-sources.mjs");
    const extracted = extractCatalogCourses(`
PHYSICAL EDUCATION
PE 1
ALL 9th grade students will take PE 1
The first-year physical education sequence.
WORLD LANGUAGE
CHINESE I-P OR FRENCH I-P OR SPANISH I-P
Grades: 9-12
Students begin a single language sequence.
NON DEPARTMENTAL
LIFE SKILLS
Grades: 9
This quarter-long course supports student wellness.
`, { sourceUrl: "https://school.example/catalog" }) as Array<{ name: string; grade_levels: number[]; subject: string; credits: number; term_type: string }>;
    expect(extracted.find((row) => row.name === "PE 1")).toMatchObject({ grade_levels: [9], subject: "Physical Education" });
    expect(extracted.filter((row) => ["CHINESE I", "FRENCH I", "SPANISH I"].includes(row.name))).toHaveLength(3);
    expect(extracted.some((row) => /\bOR\b/.test(row.name))).toBe(false);
    expect(extracted.find((row) => row.name === "LIFE SKILLS")).toMatchObject({ credits: 2.5, term_type: "semester" });

    const extractedRequirements = extractGraduationRequirements(`
SUHSD Graduation Requirements
English
40 credits
Math
20 credits
Science
20 credits
10 credits of Life Science
10 credits of Physical Science
Social Studies
37.5 credits
Students take 7.5 credits of Ethnic Studies, 10 credits of World History
Life Skills
2.5 credits
Visual or Performing Art
10 credits
Physical Education
20 credits
Electives
60 credits
CTE (Career Tech Ed.) or a third level of World Language
10 credits
College Admissions Requirements
`);
    expect(extractedRequirements.find((row) => row.area === "social_science")?.notes).toMatch(/Ethnic Studies/i);
    expect(extractedRequirements.find((row) => row.area === "career_technical_education")).toMatchObject({ credits_required: 10, constraint_only: true });
    expect(extractedRequirements.filter((row) => !row.constraint_only).reduce((sum, row) => sum + row.credits_required, 0)).toBe(210);
  });

  it("locks transcript-backed rows while keeping editable plan moves deterministic", () => {
    expect(planCourseMovePatch(settings, plan({ source_review_item_id: "review" }), "planned", 3)).toBeNull();
    expect(planCourseMovePatch(settings, plan(), "planned", 3)).toMatchObject({ status: "planned", grade_level: 10, sort_order: 3, letter_grade: null });
  });
});
