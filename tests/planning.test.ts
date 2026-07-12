import { describe, expect, it } from "vitest";

import type {
  Course,
  CourseRequirementMapping,
  GraduationRequirement,
  PlanCourse,
  SmccdHighSchoolEquivalency,
  StudentSettings,
  TimelineTask
} from "@/lib/models";
import {
  appliedCreditBreakdown,
  calculateGpa,
  calculateRequirementProgress,
  generateSuggestedPlan,
  generateTimeline,
  overallGraduationPercent,
  overallCompletedPercent,
  planCourseMovePatch,
  reconcileGeneratedTimelineTasks,
  requirementsForSettings,
  schoolYearForGrade,
  selectedPlanGrades
} from "@/lib/planning";
import {
  findTranscriptCatalogMatch,
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  visibleTranscriptUncertaintyNotes
} from "@/lib/transcript";

const settings: StudentSettings = {
  id: "student-1",
  school_id: "school-1",
  preferred_name: "Avery",
  age: 15,
  grade_level: 10,
  graduation_year: 2028,
  school_confirmed: true,
  onboarding_complete: true,
  ai_enabled: true,
  ai_model: "gpt-5.6-luna",
  ai_reasoning_effort: "low",
  ai_review_mode: "manual",
  ai_connection_approved_at: "2026-07-11T00:00:00.000Z",
  ai_setup_tested_at: "2026-07-11T00:00:00.000Z",
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
    smccd_course_id: null,
    requirement_area_override: null,
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
  it("applies completed, current, and planned credits without exceeding a requirement", () => {
    expect(appliedCreditBreakdown({ required: 40, completed: 0, current: 40, planned: 50 })).toEqual({
      completed: 0,
      current: 40,
      planned: 0,
      remaining: 0,
      total: 40,
      unverified: 0
    });
    expect(appliedCreditBreakdown({ required: 30, completed: 70, current: 10, planned: 10 })).toMatchObject({
      completed: 30,
      current: 0,
      planned: 0,
      remaining: 0,
      total: 30
    });
  });

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
    expect(progress[0].contributions[0].creditsApplied).toBe(40);
    expect(progress[0].unusedCourses[0].creditsAvailable - progress[0].unusedCourses[0].creditsApplied).toBe(20);
  });

  it("counts a verified intersession override toward Personal Development", () => {
    const personalDevelopment = {
      ...englishRequirement,
      id: "requirement-personal-development",
      area: "personal_development" as const,
      name: "Personal Development",
      credits_required: 25
    };
    const [progress] = calculateRequirementProgress(
      [personalDevelopment],
      [planCourse({
        course_id: null,
        custom_course_name: "Archery",
        letter_grade: "P",
        credits: 2.5,
        requirement_area_override: "personal_development"
      })],
      []
    );

    expect(progress.completedCredits).toBe(2.5);
    expect(progress.unverifiedCredits).toBe(0);
  });

  it("satisfies World Language from a verified Level 3 course", () => {
    const worldLanguage: GraduationRequirement = {
      ...englishRequirement,
      id: "requirement-world-language",
      area: "world_language",
      name: "World Language",
      credits_required: 20
    };
    const equivalency: SmccdHighSchoolEquivalency = {
      normalized_course_code: "CHIN 132",
      college_course_code: "Chinese 132",
      description: "Intermediate Chinese 2",
      college_units: 3,
      high_school_credits: 5,
      high_school_equivalent: "Mandarin 3 Spring",
      requirement_area: "world_language",
      pairing_note: null,
      source_id: "source-equivalency",
      confidence: "verified"
    };
    const [result] = calculateRequirementProgress(
      [worldLanguage],
      [planCourse({
        course_id: null,
        custom_course_name: "CHIN 132 Intermediate Chinese II",
        credits: 5,
        smccd_course_id: "CSM:CHIN 132",
        requirement_area_override: "world_language"
      })],
      [],
      [],
      [equivalency]
    );
    expect(result.completedCredits).toBe(20);
    expect(result.percent).toBe(100);
    expect(result.status).toBe("complete");
  });

  it("enforces the Biology, Chemistry, and third-science sequence", () => {
    const scienceRequirement: GraduationRequirement = {
      ...englishRequirement,
      id: "requirement-science",
      area: "lab_science",
      name: "Laboratory Science",
      credits_required: 30
    };
    const scienceCourses = [
      course({ id: "chemistry", name: "Chemistry", subject: "Laboratory Science" }),
      course({ id: "physics", name: "Advanced Physics", subject: "Laboratory Science" }),
      course({ id: "biology", name: "Biology", subject: "Laboratory Science" })
    ];
    const mappings = scienceCourses.map((item, index) => ({ ...verifiedMapping, id: `science-map-${index}`, course_id: item.id, requirement_id: scienceRequirement.id }));
    const withoutBiology = calculateRequirementProgress(
      [scienceRequirement],
      [
        planCourse({ id: "chemistry-row", course_id: "chemistry", credits: 20 }),
        planCourse({ id: "physics-row", course_id: "physics", credits: 10 })
      ],
      mappings,
      scienceCourses
    )[0];
    expect(withoutBiology.completedCredits).toBe(20);
    expect(withoutBiology.percent).toBe(67);
    expect(withoutBiology.ruleWarnings).toContain("10 Biology credits still need coverage.");

    const complete = calculateRequirementProgress(
      [scienceRequirement],
      [
        planCourse({ id: "chemistry-row", course_id: "chemistry", credits: 10 }),
        planCourse({ id: "physics-row", course_id: "physics", credits: 10 }),
        planCourse({ id: "biology-row", course_id: "biology", credits: 10 })
      ],
      mappings,
      scienceCourses
    )[0];
    expect(complete.completedCredits).toBe(30);
    expect(complete.status).toBe("complete");
    expect(complete.ruleWarnings).toEqual([]);
  });

  it("separates earned graduation progress from projected plan coverage", () => {
    const progress = calculateRequirementProgress(
      [englishRequirement],
      [
        planCourse({ credits: 20 }),
        planCourse({ id: "planned", status: "planned", credits: 20 })
      ],
      [verifiedMapping]
    );
    expect(overallCompletedPercent(progress)).toBe(50);
    expect(overallGraduationPercent(progress)).toBe(100);
  });
});

describe("GPA calculations", () => {
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

  it("reproduces the d.tech transcript GPA method", () => {
    const summary = calculateGpa([
      planCourse({ id: "weighted-a", letter_grade: "A", credits: 190, is_weighted: true }),
      planCourse({ id: "weighted-a-minus", letter_grade: "A-", credits: 10, is_weighted: true }),
      planCourse({ id: "standard-a", letter_grade: "A", credits: 70, is_weighted: false }),
      planCourse({ id: "pass-credit", letter_grade: "P", credits: 45, is_weighted: false })
    ]);

    expect(summary.currentUnweighted).toBe(4);
    expect(summary.currentWeighted).toBe(4.74);
    expect(summary.gradedCredits).toBe(270);
    expect(summary.weightedCredits).toBe(200);
    expect(summary.passCredits).toBe(45);
  });

  it("weights SMCCD rows even when an older stored flag is false", () => {
    const summary = calculateGpa([
      planCourse({ letter_grade: "A", credits: 10, is_weighted: false, smccd_course_id: "CSM:CIS 117", college_units: 4 })
    ]);

    expect(summary.currentWeighted).toBe(5);
    expect(summary.weightedCredits).toBe(10);
  });

});

describe("planning", () => {
  it("moves editable courses to the status grade and locks transcript rows", () => {
    const planned = planCourseMovePatch(settings, planCourse({ status: "current", letter_grade: "A" }), "planned", 3);
    expect(planned).toMatchObject({ status: "planned", grade_level: 11, school_year: "2026-2027", letter_grade: null, sort_order: 3 });
    const current = planCourseMovePatch(settings, planCourse({ grade_level: 12, status: "planned" }), "current", 1);
    expect(current).toMatchObject({ status: "current", grade_level: 10, school_year: "2025-2026" });
    expect(planCourseMovePatch(settings, planCourse({ source_review_item_id: "review-locked" }), "planned", 0)).toBeNull();
  });

  it("generates the source-backed flow without duplicating manual courses", () => {
    const catalog = [
      course({ id: "english-2", name: "English 2", grade_levels: [10] }),
      course({ id: "world-history", name: "World History", subject: "Social Science", grade_levels: [10] }),
      course({ id: "geometry", name: "Geometry", subject: "Mathematics", grade_levels: [10] })
    ];
    const existing = [planCourse({ id: "manual", course_id: "english-2", user_edited: true })];

    const generated = generateSuggestedPlan(settings, catalog, existing);

    expect(generated.map((row) => row.course_id)).toEqual(["world-history", "geometry"]);
    expect(generated.every((row) => row.status === "current" && row.grade_level === 10)).toBe(true);
    expect(existing[0].user_edited).toBe(true);
  });

  it("does not suggest a completed transcript alias with a missing catalog ID", () => {
    const seniorSettings: StudentSettings = {
      ...settings,
      grade_level: 12,
      graduation_year: 2026,
      plan_start_grade: 12,
      plan_end_grade: 12
    };
    const catalog = [
      course({ id: "precalculus", name: "Precalculus", subject: "Mathematics", grade_levels: [12] }),
      course({ id: "precalculus-honors", name: "Precalculus Honors", subject: "Mathematics", grade_levels: [12], is_honors: true, is_weighted: true })
    ];
    const completedTranscript = [planCourse({
      id: "completed-precalculus",
      course_id: null,
      custom_course_name: "Pre-Calculus Honors",
      source_review_item_id: "review-precalculus",
      grade_level: 10
    })];

    expect(generateSuggestedPlan(seniorSettings, catalog, completedTranscript)).toEqual([]);
  });

  it("uses the student's graduation year to label school years", () => {
    expect(schoolYearForGrade(2028, 9)).toBe("2024-2025");
    expect(schoolYearForGrade(2028, 12)).toBe("2027-2028");
  });

  it("limits plan generation to the onboarding plan window", () => {
    const shortenedSettings = { ...settings, plan_start_grade: 10 as const, plan_end_grade: 11 as const };
    const catalog = [
      course({ id: "english-2", name: "English 2 / English 2 Honors", grade_levels: [10] }),
      course({ id: "english-3", name: "English 3 / English 3 Honors", grade_levels: [11] }),
      course({ id: "english-4", name: "English 4 / English 4 Honors", grade_levels: [12] })
    ];

    expect(selectedPlanGrades(shortenedSettings)).toEqual([10, 11]);
    expect(generateSuggestedPlan(shortenedSettings, catalog, []).map((row) => row.course_id)).toEqual(["english-2", "english-3"]);
  });

  it("filters the tracker to onboarding-selected requirement areas", () => {
    const mathRequirement: GraduationRequirement = {
      ...englishRequirement,
      id: "requirement-math",
      area: "math",
      name: "Mathematics"
    };

    expect(requirementsForSettings(
      [englishRequirement, mathRequirement],
      { ...settings, tracker_mode: "selected", tracked_requirement_areas: ["math"] }
    )).toEqual([mathRequirement]);
  });

  it("produces requirement and summer next steps without removed profile prompts", () => {
    const progress = calculateRequirementProgress([englishRequirement], [], []);
    const tasks = generateTimeline(settings, progress);

    expect(tasks.some((task) => task.title === "Choose a course for English")).toBe(true);
    expect(tasks.some((task) => task.title === "Record two academic or career interests")).toBe(false);
    expect(tasks.some((task) => task.category === "summer")).toBe(true);
  });

  it("reconciles generated next steps with the current deterministic set", () => {
    const task = (overrides: Partial<TimelineTask>): TimelineTask => ({
      id: "task-default",
      user_id: settings.id,
      plan_version_id: "version-1",
      title: "Manual step",
      category: "admin",
      due_date: null,
      due_label: null,
      is_completed: false,
      is_generated: false,
      explanation: null,
      ...overrides
    });
    const saved = [
      task({ id: "manual", title: "Ask my counselor", is_generated: false }),
      task({ id: "obsolete", title: "Choose a course for English", is_generated: true }),
      task({ id: "retained", title: "Plan one restorative summer goal", is_generated: true, due_label: "Old timing" }),
      task({ id: "duplicate", title: "Plan one restorative summer goal", is_generated: true })
    ];
    const desired = [
      {
        title: "Plan one restorative summer goal",
        category: "summer" as const,
        due_label: "Before summer",
        explanation: "Balance the plan."
      },
      {
        title: "Review senior-year rigor with a counselor",
        category: "college" as const,
        due_label: "Before registration",
        explanation: "Verify the course sequence."
      }
    ];

    const result = reconcileGeneratedTimelineTasks(saved, desired);

    expect(result.obsoleteIds).toEqual(["obsolete", "duplicate"]);
    expect(result.visibleTasks.map((item) => item.id)).toEqual(["manual", "retained"]);
    expect(result.updateTasks).toEqual([{
      id: "retained",
      patch: { category: "summer", due_label: "Before summer", explanation: "Balance the plan." }
    }]);
    expect(result.insertTasks.map((item) => item.title)).toEqual(["Review senior-year rigor with a counselor"]);
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
      settings,
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
      settings,
      [],
      [],
      "review-2"
    );

    expect(draft.course_id).toBeNull();
    expect(draft.custom_course_name).toBe("Independent Study in Robotics");
    expect(draft.mapping_verified).toBe(false);
    expect(draft.status).toBe("completed");
  });

  it("weights an unmatched district course from its institution", () => {
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "CIS 999 New Topics",
        course_code: "CIS 999",
        institution_name: "College of San Mateo",
        grade_level: 10,
        credits: 5,
        letter_grade: "A",
        weighted: false
      },
      settings,
      [],
      [],
      "review-smccd"
    );

    expect(draft.is_weighted).toBe(true);
    expect(draft.mapping_verified).toBe(false);
  });

  it("applies the official Chinese equivalency to world-language credit", () => {
    const equivalency: SmccdHighSchoolEquivalency = {
      normalized_course_code: "CHIN 132",
      college_course_code: "Chinese 132",
      description: "Intermediate Chinese 2",
      college_units: 3,
      high_school_credits: 5,
      high_school_equivalent: "Mandarin 3 Spring",
      requirement_area: "world_language",
      pairing_note: null,
      source_id: "source-equivalency",
      confidence: "verified"
    };
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "CHIN 132 Intermediate Chinese II",
        course_code: "CHIN 132",
        institution_name: "College of San Mateo",
        credits: 0,
        letter_grade: "A",
        matched_smccd_course_id: "CSM:CHIN 132"
      },
      settings,
      [],
      [],
      "review-chinese",
      [equivalency]
    );
    expect(draft.credits).toBe(5);
    expect(draft.requirement_area_override).toBe("world_language");
    expect(draft.mapping_verified).toBe(true);
    expect(draft.notes).toContain("Mandarin 3 Spring");
  });

  it("keeps a UC-approved standard Chemistry row unweighted", () => {
    const chemistry = course({
      id: "chemistry",
      name: "Chemistry / Chemistry Honors",
      subject: "Laboratory Science",
      is_honors: true,
      is_weighted: true
    });
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "Chemistry",
        institution_name: "Design Tech High School",
        credits: 10,
        letter_grade: "A",
        weighted: false,
        matched_course_id: chemistry.id
      },
      settings,
      [chemistry],
      [{ ...verifiedMapping, course_id: chemistry.id }],
      "review-chemistry"
    );
    expect(draft.is_weighted).toBe(false);
  });

  it("imports an intersession pass as Personal Development outside GPA", () => {
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "Archery",
        subject: "Personal Development",
        institution_name: "Design Tech High School",
        grade_level: 11,
        credits: 2.5,
        letter_grade: "P"
      },
      settings,
      [],
      [],
      "review-pass"
    );

    expect(draft.requirement_area_override).toBe("personal_development");
    expect(draft.mapping_verified).toBe(true);
    expect(calculateGpa([{ ...planCourse(), ...draft }]).passCredits).toBe(2.5);
  });

  it("matches transcript aliases for Design Lab and Personal Development", () => {
    const catalogCourses = [
      course({ id: "foundation", name: "Foundation in Design Thinking", subject: "Design Lab" }),
      course({ id: "codesigners", name: "Co-designers", subject: "Design Lab" }),
      course({ id: "innovation", name: "Innovation Diploma", subject: "Design Lab" }),
      course({ id: "prototyping", name: "Introduction to Prototyping and Fabrication", subject: "Personal Development" })
    ];

    expect(findTranscriptCatalogMatch("Foundation Design Thinking", catalogCourses)?.id).toBe("foundation");
    expect(findTranscriptCatalogMatch("D.Lab: CoDesigners Honors", catalogCourses)?.id).toBe("codesigners");
    expect(findTranscriptCatalogMatch("D.Lab: Innovation Diploma Honors", catalogCourses)?.id).toBe("innovation");
    expect(findTranscriptCatalogMatch("Intro to Prototyping and Fabrication", catalogCourses)?.id).toBe("prototyping");
  });

  it("uses a unique relaxed catalog key only after exact matching", () => {
    const catalogCourses = [
      course({ id: "precalculus", name: "Precalculus" }),
      course({ id: "precalculus-honors", name: "Precalculus Honors", is_honors: true, is_weighted: true }),
      course({ id: "advanced-physics", name: "Advanced Physics Honors", subject: "Laboratory Science", is_honors: true, is_weighted: true })
    ];

    expect(findTranscriptCatalogMatch("Pre-Calculus", catalogCourses)?.id).toBe("precalculus");
    expect(findTranscriptCatalogMatch("Pre-Calculus Honors", catalogCourses)?.id).toBe("precalculus-honors");
    expect(findTranscriptCatalogMatch("Advanced Physics", catalogCourses)?.id).toBe("advanced-physics");
  });

  it("resolves d.tech intersession rows without treating absent catalog membership as uncertainty", () => {
    const payload = {
      course_name: "Documentary Film",
      subject: "Personal Development",
      institution_name: "Design Tech High School",
      letter_grade: "P",
      credits: 2.5
    };
    const warning = "No exact d.tech catalog match was found. This course will remain custom until reviewed.";
    const resolution = resolveTranscriptCourse(payload, []);

    expect(resolution).toMatchObject({
      classification: "dtech_intersession",
      gradingBasis: "pass_fail",
      identityResolved: true
    });
    expect(visibleTranscriptUncertaintyNotes(payload, [warning], [])).toEqual([]);
  });

  it("reconciles legacy d.tech P rows even when an older review payload omitted the subject", () => {
    const payload = {
      course_name: "Documentary Film",
      subject: null,
      institution_name: "Design Tech High School",
      letter_grade: "P",
      credits: 2.5
    };
    const warning = "No exact d.tech catalog match was found. This course will remain custom until reviewed.";

    expect(resolveTranscriptCourse(payload, []).classification).toBe("dtech_intersession");
    expect(visibleTranscriptUncertaintyNotes(payload, [warning], [])).toEqual([]);
  });

  it("does not mistake an ordinary d.tech academic F for intersession without supporting evidence", () => {
    const payload = {
      course_name: "English 2",
      subject: null,
      institution_name: "Design Tech High School",
      letter_grade: "F",
      credits: 10
    };

    expect(resolveTranscriptCourse(payload, []).classification).toBe("custom");
  });

  it("removes stale catalog warnings when a current unique course match exists", () => {
    const catalogCourse = course({ id: "physics", name: "Advanced Physics Honors", subject: "Laboratory Science" });
    const payload = {
      course_name: "Advanced Physics",
      institution_name: "Design Tech High School",
      letter_grade: "A",
      credits: 10
    };
    const warning = "No exact d.tech catalog match was found. This course will remain custom until reviewed.";

    expect(resolveTranscriptCourse(payload, [catalogCourse]).classification).toBe("dtech_catalog");
    expect(visibleTranscriptUncertaintyNotes(payload, [warning], [catalogCourse])).toEqual([]);
  });

  it("keeps true custom-course warnings visible", () => {
    const payload = {
      course_name: "Independent Study in Robotics",
      institution_name: "Design Tech High School",
      letter_grade: "A",
      credits: 5
    };
    const warning = "No exact d.tech catalog match was found. This course will remain custom until reviewed.";

    expect(resolveTranscriptCourse(payload, []).classification).toBe("custom");
    expect(visibleTranscriptUncertaintyNotes(payload, [warning], [])).toEqual([warning]);
  });

  it("imports a failed intersession attempt outside GPA and without earned credit", () => {
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "Experimental Studio",
        subject: "Personal Development",
        institution_name: "Design Tech High School",
        grade_level: 11,
        credits: 2.5,
        letter_grade: "F"
      },
      settings,
      [],
      [],
      "review-failed-intersession"
    );

    expect(draft.credits).toBe(0);
    expect(draft.requirement_area_override).toBe("personal_development");
    expect(draft.mapping_verified).toBe(false);
    expect(calculateGpa([{ ...planCourse(), ...draft }]).gradedCredits).toBe(0);
    expect(draft.notes).toContain("no Personal Development credit is earned for an F");
  });

  it("preserves honors distinctions outside Design Lab transcript labels", () => {
    const catalogCourses = [
      course({ id: "precalculus", name: "Precalculus" }),
      course({ id: "precalculus-honors", name: "Precalculus Honors", is_honors: true })
    ];

    expect(findTranscriptCatalogMatch("Precalculus", catalogCourses)?.id).toBe("precalculus");
    expect(findTranscriptCatalogMatch("Precalculus Honors", catalogCourses)?.id).toBe("precalculus-honors");
    expect(findTranscriptCatalogMatch("Pre-Calculus Honors", catalogCourses)?.id).toBe("precalculus-honors");
  });

  it("imports a matched Design Lab alias with verified requirement credit", () => {
    const designLabCourse = course({
      id: "innovation",
      name: "Innovation Diploma",
      subject: "Design Lab",
      credits: 10
    });
    const draft = transcriptPlanCourseDraft(
      {
        course_name: "D.Lab: Innovation Diploma Honors",
        grade_level: 10,
        credits: 10,
        letter_grade: "A"
      },
      settings,
      [designLabCourse],
      [{ ...verifiedMapping, course_id: designLabCourse.id }],
      "review-design-lab"
    );

    expect(draft.course_id).toBe(designLabCourse.id);
    expect(draft.custom_course_name).toBe("D.Lab: Innovation Diploma Honors");
    expect(draft.mapping_verified).toBe(true);
    expect(draft.credits).toBe(10);
  });
});
