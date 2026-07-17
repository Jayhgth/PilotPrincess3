import { describe, expect, it } from "vitest";
import { compareCourseBoardRowsForTerm, courseTermForBoardDrop, orderedCourseIdsForAutomaticBoardSort } from "@/lib/course-board";
import { selectedSchoolCatalogEligibility, selectedSchoolCourseAllowsGradePlacement, selectedSchoolCourseGradeOptions, selectedSchoolCourseTermOptions } from "@/lib/catalog-eligibility";
import type { Course, CourseRequirementMapping, GraduationRequirement, PlanCourse, SchoolPlanningProfile, SmccdHighSchoolEquivalency, StudentSettings } from "@/lib/models";
import { appliedCreditBreakdown, calculateGpa, calculateRequirementProgress, generateSuggestedPlan, mathSequenceRankFromText, planCourseMovePatch, scheduleTermLoad } from "@/lib/planning";
import { visibleTranscriptUncertaintyNotes } from "@/lib/transcript";
import { normalizeWorkspaceBootstrap } from "@/lib/workspace-bootstrap";

const settings: StudentSettings = {
  id: "student", school_id: "school", preferred_name: "Jay", age: 14, grade_level: 9, graduation_year: 2030,
  school_confirmed: true, school_selected_at: null, onboarding_complete: true, ai_enabled: true,
  ai_model: "gpt-5.6-luna", ai_reasoning_effort: "low",
  ui_theme: "light",
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

function equivalency(
  normalizedCourseCode: string,
  highSchoolEquivalent: string,
  requirementArea: SmccdHighSchoolEquivalency["requirement_area"],
  highSchoolCredits: number
): SmccdHighSchoolEquivalency {
  return {
    normalized_course_code: normalizedCourseCode,
    college_course_code: normalizedCourseCode,
    description: highSchoolEquivalent,
    college_units: highSchoolCredits >= 10 ? 5 : 3,
    high_school_credits: highSchoolCredits,
    high_school_equivalent: highSchoolEquivalent,
    requirement_area: requirementArea,
    pairing_note: null,
    source_id: "equivalency-source",
    confidence: "verified"
  };
}

const requirement: GraduationRequirement = {
  id: "math-requirement", area: "math", name: "Math", credits_required: 30, years_required: 3,
  notes: null, confidence: "verified", review_status: "approved"
};

describe("core academic planning contracts", () => {
  it("moves manual courses between school years and semester lanes", () => {
    expect(courseTermForBoardDrop("full_year", false, "year", "fall")).toBe("full_year");
    expect(courseTermForBoardDrop("full_year", false, "lane", "spring")).toBe("spring");
    expect(courseTermForBoardDrop("fall", false, "lane", "summer")).toBe("summer");
    expect(courseTermForBoardDrop("full_year", true, "lane", "spring")).toBe("full_year");
  });

  it("allows user placement when local grade and term availability need verification", () => {
    const ucopOnly = course("ucop-physics", "AP Physics C: Electricity and Magnetism", "Physics", []);
    expect(selectedSchoolCourseGradeOptions(ucopOnly, [9, 10, 11, 12])).toEqual([9, 10, 11, 12]);
    expect(selectedSchoolCourseAllowsGradePlacement(ucopOnly, 12)).toBe(true);
    expect(selectedSchoolCourseTermOptions(ucopOnly, 9)).toEqual(["full_year", "fall", "spring", "summer"]);
    expect(selectedSchoolCourseTermOptions(ucopOnly, 12)).toEqual(["full_year", "fall", "spring"]);
    expect(selectedSchoolCatalogEligibility(ucopOnly, 12, [], [ucopOnly])).toEqual({ eligible: true });

    const locallyVerified = course("local-physics", "AP Physics C", "Physics", [11, 12]);
    expect(selectedSchoolCourseAllowsGradePlacement(locallyVerified, 9)).toBe(false);
    expect(selectedSchoolCourseGradeOptions(locallyVerified, [9, 10, 11, 12])).toEqual([11, 12]);
    expect(selectedSchoolCourseTermOptions(locallyVerified, 11)).toEqual(["full_year"]);
  });

  it("recognizes one cohesive high-school and college math ladder", () => {
    expect(["Algebra 1", "Geometry", "Algebra 2", "MATH 225 Path to Calculus", "MATH 251 Calculus with Analytic Geometry I", "MATH 252 Calculus with Analytic Geometry II", "MATH 253 Calculus with Analytic Geometry III"].map(mathSequenceRankFromText)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(["CSM:MATH 251", "SKY:MATH 252", "CAN:MATH 253"].map(mathSequenceRankFromText)).toEqual([5, 6, 7]);
    expect(mathSequenceRankFromText("MATH 270 Linear Algebra")).toBeNull();
    expect([
      "PHYS 250 Physics with Calculus I",
      "PHYS 260 Physics with Calculus II",
      "PHYS 270 Physics with Calculus III",
      "Physics with Calculus I"
    ].map(mathSequenceRankFromText)).toEqual([null, null, null, null]);

    const dtechCalculus = course("dtech-calculus", "Calculus / Calculus Honors", "Mathematics", [11, 12], true);
    expect(selectedSchoolCatalogEligibility(
      dtechCalculus,
      12,
      [plan({ id: "college-calculus-two", status: "planned", course_id: null, smccd_course_id: "CSM:MATH 252" })],
      [dtechCalculus],
      { schoolSlug: "design-tech-high-school" }
    )).toEqual({ eligible: false, reason: "below_math_level" });
  });
  it("enforces ordering, credit, mapping, and GPA invariants", () => {
    {
    const rows = [
      plan({ id: "pass-fail", grade_level: 11, term: "spring", status: "completed", letter_grade: "P", sort_order: 0 }),
      plan({ id: "high-school", grade_level: 11, term: "spring", status: "current", letter_grade: null, sort_order: 2 }),
      plan({ id: "full-year", grade_level: 11, term: "full_year", status: "current", letter_grade: null, sort_order: 1 }),
      plan({ id: "college", grade_level: 11, term: "spring", status: "current", letter_grade: null, sort_order: 4, smccd_course_id: "CSM:MATH 251", college_units: 5 })
    ];
    const orderedIds = orderedCourseIdsForAutomaticBoardSort(rows, 11);
    expect(orderedIds).toEqual(["college", "full-year", "high-school", "pass-fail"]);

    const savedOrder = new Map(orderedIds.map((id, index) => [id, index]));
    const rendered = rows
      .map((row) => ({ ...row, sort_order: savedOrder.get(row.id)! }))
      .sort(compareCourseBoardRowsForTerm("spring"));
    expect(rendered.at(-1)?.id).toBe("pass-fail");
    }

    {
    expect(appliedCreditBreakdown({ required: 30, completed: 10, current: 20, planned: 20 })).toEqual({
      completed: 10, current: 20, planned: 0, remaining: 0, total: 30, unverified: 0
    });
    }

    {
    const labRequirement: GraduationRequirement = { ...requirement, id: "lab", area: "lab_science", name: "Laboratory Science", credits_required: 30, years_required: 3 };
    const languageRequirement: GraduationRequirement = { ...requirement, id: "language", area: "world_language", name: "World Language", credits_required: 20, years_required: 2 };
    const historyRequirement: GraduationRequirement = { ...requirement, id: "history", area: "social_science", name: "Social Science", credits_required: 30, years_required: 3 };
    const environmental = course("environmental", "Environmental Science", "Laboratory Science");
    const chemistry = course("chemistry", "Chemistry", "Laboratory Science");
    const worldHistory = course("world-history", "World History", "Social Science");
    const governmentEconomics = course("government-economics", "Government & Economics", "Social Science");
    const requirementMappings: CourseRequirementMapping[] = [
      { id: "environmental-map", course_id: environmental.id, requirement_id: labRequirement.id, confidence: "verified", is_user_override: false },
      { id: "chemistry-map", course_id: chemistry.id, requirement_id: labRequirement.id, confidence: "verified", is_user_override: false },
      { id: "world-map", course_id: worldHistory.id, requirement_id: historyRequirement.id, confidence: "verified", is_user_override: false },
      { id: "government-map", course_id: governmentEconomics.id, requirement_id: historyRequirement.id, confidence: "verified", is_user_override: false }
    ];
    const verifiedEquivalencies = [
      equivalency("BIOL 110", "Biology", "lab_science", 10),
      equivalency("ASL 100", "ASL 100 meets the requirement for the 2nd year of a high school language.", "world_language", 10),
      equivalency("HIST 201", "US History Fall", "social_science", 5),
      equivalency("HIST 202", "US History Spring", "social_science", 5)
    ];
    const staleImportedCollegeRow = (id: string, name: string, units: number) => plan({
      id,
      course_id: null,
      custom_course_name: name,
      smccd_course_id: crypto.randomUUID(),
      college_provider_code: "SMCCD",
      college_units: units,
      credits: units,
      mapping_verified: false,
      requirement_area_override: null,
      source_review_item_id: `review-${id}`
    });
    const rows = [
      plan({ id: "environmental-row", course_id: environmental.id }),
      plan({ id: "chemistry-row", course_id: chemistry.id }),
      plan({ id: "world-row", course_id: worldHistory.id }),
      plan({ id: "government-row", course_id: governmentEconomics.id }),
      staleImportedCollegeRow("biology-row", "BIOL 110 General Principles of Biology", 4),
      staleImportedCollegeRow("language-row", "ASL 100 American Sign Language I", 5),
      staleImportedCollegeRow("history-one-row", "HIST 201 United States History I", 3),
      staleImportedCollegeRow("history-two-row", "HIST 202 United States History II", 3)
    ];
    const progress = calculateRequirementProgress(
      [labRequirement, languageRequirement, historyRequirement],
      rows,
      requirementMappings,
      [environmental, chemistry, worldHistory, governmentEconomics],
      verifiedEquivalencies
    );
    expect(progress.find((item) => item.requirement.area === "lab_science")).toMatchObject({
      completedCredits: 30,
      ruleWarnings: []
    });
    expect(progress.find((item) => item.requirement.area === "lab_science")?.contributions.map((row) => row.planCourseId)).toContain("biology-row");
    expect(progress.find((item) => item.requirement.area === "world_language")).toMatchObject({ completedCredits: 20, ruleWarnings: [] });
    expect(progress.find((item) => item.requirement.area === "social_science")).toMatchObject({ completedCredits: 30, ruleWarnings: [] });
    }
  });

  it("honors starting placement and school-specific planning profiles", () => {
    {
    const mappings: CourseRequirementMapping[] = [
      { id: "map", course_id: "math", requirement_id: requirement.id, confidence: "verified", is_user_override: false },
      { id: "likely-map", course_id: "other", requirement_id: requirement.id, confidence: "likely", is_user_override: false }
    ];
    const [progress] = calculateRequirementProgress([requirement], [plan({ course_id: "math" }), plan({ id: "unknown", course_id: "other", status: "planned", mapping_verified: false })], mappings);
    expect(progress).toMatchObject({ completedCredits: 10, plannedCredits: 0, unverifiedCredits: 10, percent: 33, status: "missing" });

    const [reconciledProgress] = calculateRequirementProgress(
      [requirement],
      [plan({ course_id: "math", mapping_verified: false })],
      [{ id: "verified-map", course_id: "math", requirement_id: requirement.id, confidence: "verified", is_user_override: false }]
    );
    expect(reconciledProgress).toMatchObject({ completedCredits: 10, unverifiedCredits: 0 });

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

    const english = course("english-2", "English 2 / English 2 Honors", "English", [10]);
    const reconciledTranscript = normalizeWorkspaceBootstrap({
      requirements: [{ ...requirement, catalog_version_id: "catalog" }],
      courses: [english],
      mappings: [{ id: "english-map", course_id: english.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false }],
      plan_courses: [plan({ course_id: null, custom_course_name: "English 2 Honors", source_review_item_id: "review", mapping_verified: false })],
      review_items: [{
        id: "review", user_id: "student", source_id: "source", entity_type: "transcript_course",
        proposed_payload: { course_name: "English 2 Honors", institution_name: "Design Tech High School" }, corrected_payload: null,
        status: "approved", confidence: "uncertain", uncertainty_notes: ["No exact selected-school catalog match was found for Design Tech High School. This course will remain custom until reviewed."], created_at: "2026-07-15"
      }]
    });
    expect(reconciledTranscript.plan_courses[0]).toMatchObject({ course_id: english.id, mapping_verified: true });
    expect(visibleTranscriptUncertaintyNotes(
      { course_name: "English 2 Honors", institution_name: "Design Tech High School" },
      reconciledTranscript.review_items[0].uncertainty_notes,
      [english]
    )).toEqual([]);

    const reconciledCollegeTranscript = normalizeWorkspaceBootstrap({
      requirements: [{ ...requirement, catalog_version_id: "catalog" }],
      courses: [english],
      mappings: [],
      plan_courses: [plan({
        course_id: null, custom_course_name: "BIOL 110 Principles of Biology", source_review_item_id: "college-review",
        smccd_course_id: "SKY:BIOL 110", college_units: 4, credits: 5, mapping_verified: false, requirement_area_override: null
      })],
      review_items: [{
        id: "college-review", user_id: "student", source_id: "source", entity_type: "transcript_course",
        proposed_payload: { course_name: "BIOL 110 Principles of Biology", course_code: "BIOL 110", institution_name: "Skyline College", matched_smccd_course_id: "SKY:BIOL 110" }, corrected_payload: null,
        status: "approved", confidence: "verified", uncertainty_notes: [], created_at: "2026-07-15"
      }],
      equivalencies: [{
        normalized_course_code: "BIOL 110", college_course_code: "Biology 110", description: "Principles of Biology", college_units: 4,
        high_school_credits: 10, high_school_equivalent: "Biology", requirement_area: "lab_science", pairing_note: null,
        source_id: "equivalency-source", confidence: "verified"
      }]
    });
    expect(reconciledCollegeTranscript.plan_courses[0]).toMatchObject({
      credits: 10, mapping_verified: true, requirement_area_override: "lab_science"
    });

    const electiveRequirement: GraduationRequirement = { ...requirement, id: "electives", area: "electives", name: "Electives", credits_required: 10, years_required: 1 };
    const overflow = calculateRequirementProgress(
      [{ ...requirement, credits_required: 10 }, electiveRequirement],
      [plan({ course_id: "math" }), plan({ id: "extra", course_id: "extra", mapping_verified: true })],
      [{ id: "math-only", course_id: "math", requirement_id: requirement.id, confidence: "verified", is_user_override: false }]
    );
    expect(overflow.find((item) => item.requirement.area === "electives")).toMatchObject({ completedCredits: 10, status: "complete" });
    }

    {
    const summary = calculateGpa([
      plan({ id: "hs", letter_grade: "A", credits: 5, is_weighted: false }),
      plan({ id: "college", letter_grade: "A", credits: 5, college_units: 3, smccd_course_id: "CSM:MATH 251", is_weighted: false })
    ]);
    expect(summary.currentUnweighted).toBe(4);
    expect(summary.currentWeighted).toBe(4.5);
    }

    {
    const precalculus = course("precalc", "Precalculus", "Mathematics", [11, 12], true);
    const generated = generateSuggestedPlan(settings, [precalculus], [], null, true, {
      schoolSlug: "carlmont-high", requirements: [requirement], mappings: [{ id: "map", course_id: precalculus.id, requirement_id: requirement.id, confidence: "verified", is_user_override: false }],
      startGrade: 9, startingMathCourse: "pre-calc", rigor: "advanced", maxCoursesPerTerm: 7
    });
    expect(generated[0]).toMatchObject({ course_id: "precalc", grade_level: 9, is_weighted: true });
    expect(generated.every((row) => row.course_id === "precalc")).toBe(true);
    }

    {
    const languageRequirement: GraduationRequirement = { ...requirement, id: "language", area: "world_language", name: "World Language", credits_required: 20, years_required: 2 };
    const spanishOne = course("spanish-1", "Spanish 1", "World Language", [9]);
    const spanishTwo = course("spanish-2", "Spanish 2", "World Language", [10]);
    const languageMappings: CourseRequirementMapping[] = [spanishOne, spanishTwo].map((row, index) => ({
      id: `language-map-${index}`, course_id: row.id, requirement_id: languageRequirement.id, confidence: "verified", is_user_override: false
    }));
    const profile: SchoolPlanningProfile = {
      id: "integrated-profile", school_id: "school", academic_year: "2026-27", title: "Integrated planning guide", source_urls: ["https://school.example/guide"], status: "verified",
      college_course_posture: "integrated", college_eligible_grades: [9, 10, 11, 12], always_high_school_areas: [], guidance_notes: [], created_at: "2026-07-15", updated_at: "2026-07-15",
      grade_rules: {
        "9": { minimum_high_school_courses: 0, target_total_courses: 0, required_areas: ["world_language"], preferred_course_names: ["Spanish 1"] },
        "10": { minimum_high_school_courses: 0, target_total_courses: 0, required_areas: ["world_language"], preferred_course_names: ["Spanish 2"] }
      }
    };
    const equivalencies: SmccdHighSchoolEquivalency[] = ["ASL 100"].map((code) => ({
      normalized_course_code: code, college_course_code: code, description: "American Sign Language", college_units: 5,
      high_school_credits: 10, high_school_equivalent: "ASL 100 meets the requirement for the 2nd year of a high school language.", requirement_area: "world_language", pairing_note: null,
      source_id: "source", confidence: "verified"
    }));
    const collegeLanguage = equivalencies.map((equivalency, index) => plan({
      id: `college-language-${index}`, course_id: null, custom_course_name: equivalency.college_course_code,
      smccd_course_id: `CSM:${equivalency.normalized_course_code}`, grade_level: index === 0 ? 9 : 10,
      school_year: index === 0 ? "2026-2027" : "2027-2028", term: "fall", status: "planned",
      credits: 10, college_units: 5, letter_grade: null, college_provider_code: "SMCCD",
      requirement_area_override: "world_language", mapping_verified: true
    }));
    const generated = generateSuggestedPlan(settings, [spanishOne, spanishTwo], collegeLanguage, null, true, {
      schoolSlug: "integrated-school", planningProfile: profile, requirements: [languageRequirement], mappings: languageMappings,
      equivalencies, startGrade: 9, includeCollegeCourses: true
    });
    expect(generated.map((row) => row.course_id)).not.toContain("spanish-1");
    expect(generated.map((row) => row.course_id)).not.toContain("spanish-2");
    }
  });

  it("builds balanced plans and locks transcript evidence", async () => {
    {
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
    }

    {
    const requirements: GraduationRequirement[] = [
      { ...requirement, id: "english-req", area: "english", name: "English", credits_required: 40, years_required: 4 },
      { ...requirement, id: "math-req", credits_required: 20, years_required: 2 },
      { ...requirement, id: "social-req", area: "social_science", name: "Social Studies", credits_required: 30, years_required: 3 },
      { ...requirement, id: "science-req", area: "lab_science", name: "Science", credits_required: 20, years_required: 2 },
      { ...requirement, id: "pe-req", area: "physical_education", name: "PE", credits_required: 20, years_required: 2 },
      { ...requirement, id: "ethnic-req", area: "ethnic_studies", name: "Ethnic Studies", credits_required: 10, years_required: 1 },
      { ...requirement, id: "life-req", area: "personal_development", name: "Life Skills", credits_required: 2.5, years_required: null },
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
      course("calc-ab", "AP Calculus AB", "Math", [11, 12], true),
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
      { ...semester(course("life", "Life Skills", "Social Studies", [9])), credits: 2.5 },
      course("art", "Art", "Visual and Performing Arts", [9, 10, 11, 12]),
      { ...course("spanish-1", "Spanish I", "World Language", [10]), uc_ag_area: "E" },
      { ...course("spanish-2", "Spanish II", "World Language", [11]), uc_ag_area: "E" },
      course("psych", "AP Psychology", "Elective", [11, 12], true),
      course("seminar", "AP Seminar", "Elective", [11, 12], true),
      course("computer", "Computer Science", "Elective", [12], true),
      course("journalism", "Journalism", "Elective", [12]),
      course("business", "Business", "Elective", [12]),
      course("research", "Research Seminar", "Elective", [12]),
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
      ["ethnic", "ethnic_studies"], ["life", "personal_development"], ["art", "visual_performing_arts"]
    ]);
    const mappings: CourseRequirementMapping[] = localCourses.map((row, index) => ({
      id: `map-${index}`,
      course_id: row.id,
      requirement_id: requirementIdByArea.get(areaByCourseId.get(row.id) ?? "electives")!,
      confidence: "verified",
      is_user_override: false
    }));
    const profile: SchoolPlanningProfile = {
      id: "carlmont-profile", school_id: "school", academic_year: "2026-27", title: "Carlmont planning guide", source_urls: ["https://school.example/guide"], status: "verified",
      college_course_posture: "supplemental", college_eligible_grades: [10, 11, 12], always_high_school_areas: [], guidance_notes: [], created_at: "2026-07-15", updated_at: "2026-07-15",
      grade_rules: {
        "9": { minimum_high_school_courses: 6, target_total_courses: 6, required_areas: ["english", "social_science", "math", "lab_science", "physical_education"], preferred_course_names: ["English I", "Life Skills", "Ethnic Studies", "PE 1", "Biology"] },
        "10": { minimum_high_school_courses: 6, target_total_courses: 6, required_areas: ["english", "social_science", "math", "lab_science", "physical_education"], preferred_course_names: ["English II", "AP World History", "PE 2"] },
        "11": { minimum_high_school_courses: 6, target_total_courses: 6, required_areas: ["english", "social_science"], preferred_course_names: ["AP Language & Composition", "AP US History"] },
        "12": { minimum_high_school_courses: 5, target_total_courses: 6, required_areas: ["english", "social_science"], preferred_course_names: ["AP Literature & Composition", "American Government", "Economics"] }
      }
    };
    const generated = generateSuggestedPlan(settings, localCourses, [], null, true, {
      schoolSlug: "carlmont-high", planningProfile: profile, requirements, mappings, startGrade: 9, startingMathCourse: "pre-calc", startingLanguageCourse: "Spanish I",
      rigor: "advanced", maxCoursesPerTerm: 6, includeCollegeCourses: false
    });
    const names = new Map(localCourses.map((row) => [row.id, row.name]));
    for (const grade of [9, 10, 11, 12] as const) {
      const rows = generated.filter((row) => row.grade_level === grade);
      expect(scheduleTermLoad(generated.map((row) => ({ ...row, custom_course_name: null, smccd_course_id: null })), localCourses, grade, "fall"), `Grade ${grade} fall`).toBe(6);
      expect(scheduleTermLoad(generated.map((row) => ({ ...row, custom_course_name: null, smccd_course_id: null })), localCourses, grade, "spring"), `Grade ${grade} spring`).toBe(6);
      expect(rows.filter((row) => areaByCourseId.get(row.course_id) === "english")).toHaveLength(1);
      expect(rows.filter((row) => areaByCourseId.get(row.course_id) === "math")).toHaveLength(1);
    }
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "physical_education").map((row) => [row.grade_level, names.get(row.course_id)])).toEqual([[9, "PE 1"], [10, "PE 2"]]);
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "math").map((row) => [row.grade_level, names.get(row.course_id)])).toEqual([[9, "Pre-Calc Honors"], [10, "AP Calculus AB"], [11, "AP Calculus BC"], [12, "Multivariable Calculus"]]);
    expect(generated.filter((row) => ["spanish-1", "spanish-2"].includes(row.course_id)).map((row) => [row.grade_level, names.get(row.course_id)])).toEqual([[9, "Spanish I"]]);
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "social_science").map((row) => names.get(row.course_id))).toEqual(["AP World History", "AP US History", "American Government", "Economics"]);
    expect(generated.filter((row) => areaByCourseId.get(row.course_id) === "visual_performing_arts")).toHaveLength(1);
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
    }

    {
    expect(planCourseMovePatch(settings, plan({ source_review_item_id: "review" }), "planned", 3)).toBeNull();
    expect(planCourseMovePatch(settings, plan(), "planned", 3)).toMatchObject({ status: "planned", grade_level: 10, sort_order: 3, letter_grade: null });
    }
  });
});
