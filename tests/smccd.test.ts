import { describe, expect, it } from "vitest";
import { calculateSmccdGeEvidence, calculateSmccdProgramProgress, createSmccdProgramProgressContext, normalizeSmccdCourseCode } from "@/lib/smccd";
import type { PlanCourse, SmccdCourse, SmccdProgram, SmccdProgramRequirement, SmccdRequirementCourse } from "@/lib/models";

describe("SMCCD curriculum planning", () => {
  it("normalizes district course identifiers", () => {
    expect(normalizeSmccdCourseCode("bus 100")).toBe("BUS. 100");
    expect(normalizeSmccdCourseCode("CIS   255")).toBe("CIS 255");
  });

  it("calculates projected major progress from completed and planned district courses", () => {
    const program = {
      id: "CSM:computer-science-as",
      total_major_units_text: "12 units"
    } as SmccdProgram;
    const requirements = [
      { id: "core", program_id: program.id, label: "Core", kind: "all", min_units: null, min_count: null, raw_text: null, sort_order: 0 },
      { id: "select", program_id: program.id, label: "Selectives", kind: "choose_units", min_units: 4, min_count: null, raw_text: null, sort_order: 1 }
    ] as SmccdProgramRequirement[];
    const options = [
      { requirement_id: "core", course_code: "CIS 117" },
      { requirement_id: "core", course_code: "CIS 255" },
      { requirement_id: "select", course_code: "CIS 256" }
    ] as SmccdRequirementCourse[];
    const courses = [
      { id: "CSM:CIS 117", course_code: "CIS 117" },
      { id: "CSM:CIS 255", course_code: "CIS 255" },
      { id: "CSM:CIS 256", course_code: "CIS 256" }
    ] as SmccdCourse[];
    const planRows = [
      { smccd_course_id: "CSM:CIS 117", status: "completed", college_units: 4, letter_grade: "A" },
      { smccd_course_id: "CSM:CIS 255", status: "completed", college_units: 4, letter_grade: "B" },
      { smccd_course_id: "CSM:CIS 256", status: "planned", college_units: 4 }
    ] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, planRows, courses);

    expect(result).toMatchObject({
      completedCollegeUnits: 8,
      projectedCollegeUnits: 12,
      completedMajorUnits: 8,
      projectedMajorUnits: 12,
      requiredMajorUnits: 12,
      satisfiedRequirements: 2,
      majorPercent: 100
    });
  });

  it("separates completed and projected degree evidence", () => {
    const program = {
      id: "CSM:biology-as",
      college_code: "CSM",
      total_degree_units: 60,
      total_major_units_text: "8 units"
    } as SmccdProgram;
    const requirements = [
      { id: "core", program_id: program.id, label: "Core", kind: "all", min_units: null, min_count: null, raw_text: null, sort_order: 0 }
    ] as SmccdProgramRequirement[];
    const options = [
      { requirement_id: "core", course_code: "BIOL 100" },
      { requirement_id: "core", course_code: "CHEM 110" }
    ] as SmccdRequirementCourse[];
    const courses = [
      { id: "CSM:BIOL 100", college_code: "CSM", course_code: "BIOL 100", title: "Introduction to Biology", units_min: 4, units_max: 4, degree_applicable: true, attributes: ["AA/AS Degree Requirements: Area 5A"], catalog_url: "https://example.com/biol" },
      { id: "CSM:CHEM 110", college_code: "CSM", course_code: "CHEM 110", title: "General Chemistry", units_min: 4, units_max: 4, degree_applicable: true, attributes: ["AA/AS Degree Requirements: Area 5A"], catalog_url: "https://example.com/chem" }
    ] as SmccdCourse[];
    const planRows = [
      { smccd_course_id: "CSM:BIOL 100", status: "completed", college_units: 4, grade_level: 11, term: "fall", letter_grade: "A" },
      { smccd_course_id: "CSM:CHEM 110", status: "planned", college_units: 4, grade_level: 12, term: "spring", letter_grade: null }
    ] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, planRows, courses);

    expect(result).toMatchObject({
      completedDegreeApplicableUnits: 4,
      projectedDegreeApplicableUnits: 8,
      totalDegreeUnits: 60,
      completedRequirements: 0,
      satisfiedRequirements: 1,
      geEvidence: [{ area: "5A", completedCourseCodes: ["BIOL 100"], projectedCourseCodes: ["BIOL 100", "CHEM 110"] }]
    });
    expect(result.requirements[0]).toMatchObject({
      completedStatus: "partial",
      status: "satisfied",
      missingSummary: "Requirement covered"
    });
    expect(calculateSmccdGeEvidence(createSmccdProgramProgressContext([], [], planRows, courses))).toEqual([
      { area: "5A", label: "Area 5A", completedCourseCodes: ["BIOL 100"], projectedCourseCodes: ["BIOL 100", "CHEM 110"] }
    ]);
  });

  it("enforces a discipline condition alongside the unit total", () => {
    const program = { id: "CSM:interdisciplinary", college_code: "CSM", total_degree_units: 60, total_major_units_text: "18 units" } as SmccdProgram;
    const requirements = [{
      id: "breadth",
      program_id: program.id,
      label: "Select 18 units in at least three different disciplines",
      kind: "choose_units",
      min_units: 18,
      min_count: null,
      raw_text: null,
      sort_order: 0
    }] as SmccdProgramRequirement[];
    const options = ["CIS 110", "CIS 117", "CIS 255"].map((course_code) => ({ requirement_id: "breadth", course_code })) as SmccdRequirementCourse[];
    const courses = options.map((option) => ({
      id: `CSM:${option.course_code}`,
      college_code: "CSM",
      course_code: option.course_code,
      subject: option.course_code.split(" ")[0],
      course_number: option.course_code.split(" ")[1],
      title: option.course_code,
      units_min: 6,
      units_max: 6,
      degree_applicable: true,
      transfer_credit: null,
      attributes: [],
      prerequisites: [],
      corequisites: [],
      recommended_preparation: [],
      detail_status: "verified",
      degree_applicability_source: "course_detail",
      catalog_url: "https://example.com",
      source_year: "2025-2026"
    })) satisfies SmccdCourse[];
    const rows = courses.map((course) => ({ smccd_course_id: course.id, status: "completed", college_units: 6, grade_level: 11, term: "fall", letter_grade: "A" })) as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result.requirements[0]).toMatchObject({
      status: "partial",
      remainingUnits: 0,
      remainingDisciplines: 2,
      missingSummary: "0 more units and 2 more disciplines needed from the options"
    });
    expect(result.requirements[0].manualReviewReason).toBeNull();
    expect(result.manualReviewRequirements).toBe(0);
  });

  it("counts D grades toward degree units but not major requirements", () => {
    const program = { id: "CSM:accounting", college_code: "CSM", total_degree_units: 60, total_major_units_text: "3 units" } as SmccdProgram;
    const requirements = [{
      id: "core",
      program_id: program.id,
      label: "Required core",
      kind: "all",
      min_units: null,
      min_count: null,
      raw_text: null,
      sort_order: 0
    }] as SmccdProgramRequirement[];
    const options = [{ requirement_id: "core", course_code: "ACTG 100", units_text: "3 units" }] as SmccdRequirementCourse[];
    const courses = [course("ACTG 100", 3)];
    const rows = [{ smccd_course_id: "CSM:ACTG 100", status: "completed", college_units: 3, letter_grade: "D" }] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result).toMatchObject({
      completedCollegeUnits: 3,
      completedDegreeApplicableUnits: 3,
      completedMajorUnits: 0,
      projectedMajorUnits: 0
    });
    expect(result.requirements[0]).toMatchObject({ status: "missing", selectedCourseCodes: [], remainingCount: 1 });
  });

  it("uses only the best attempt and never double-applies a course across major groups", () => {
    const program = { id: "CSM:business", college_code: "CSM", total_degree_units: 60, total_major_units_text: "6 units" } as SmccdProgram;
    const requirements = ["core", "concentration"].map((id, sort_order) => ({
      id,
      program_id: program.id,
      label: id === "core" ? "Core" : "Concentration",
      kind: "all",
      min_units: null,
      min_count: null,
      raw_text: null,
      sort_order
    })) as SmccdProgramRequirement[];
    const options = requirements.map((requirement) => ({ requirement_id: requirement.id, course_code: "BUS. 100", units_text: "3 units" })) as SmccdRequirementCourse[];
    const courses = [course("BUS. 100", 3)];
    const rows = [
      { smccd_course_id: "CSM:BUS. 100", status: "planned", college_units: 3, letter_grade: null },
      { smccd_course_id: "CSM:BUS. 100", status: "current", college_units: 3, letter_grade: null }
    ] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result.projectedCollegeUnits).toBe(3);
    expect(result.projectedMajorUnits).toBe(3);
    expect(result.requirements.map((requirement) => requirement.status)).toEqual(["satisfied", "missing"]);
    expect(result.requirements[0].selectedCourses[0].status).toBe("current");
    expect(result.requirements[1].remainingOptions.map((option) => option.courseCode)).toEqual(["BUS. 100"]);
  });

  it("infers selective-unit all groups and exposes the exact remaining choices", () => {
    const program = { id: "CSM:design", college_code: "CSM", total_degree_units: 60, total_major_units_text: "6 units" } as SmccdProgram;
    const requirements = [{
      id: "selective",
      program_id: program.id,
      label: "Select 6 units from the following",
      kind: "all",
      min_units: null,
      min_count: null,
      raw_text: null,
      sort_order: 0
    }] as SmccdProgramRequirement[];
    const options = ["ART 101", "ART 102", "ART 103"].map((course_code) => ({ requirement_id: "selective", course_code, units_text: "3 units" })) as SmccdRequirementCourse[];
    const courses = options.map((option) => course(option.course_code, 3));
    const rows = [{ smccd_course_id: "CSM:ART 101", status: "completed", college_units: 3, letter_grade: "P" }] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result.requirements[0]).toMatchObject({
      status: "partial",
      selectedCourseCodes: ["ART 101"],
      requiredUnits: 6,
      remainingUnits: 3,
      missingSummary: "3 more units needed from the options"
    });
    expect(result.requirements[0].remainingOptions.map((option) => option.courseCode)).toEqual(["ART 102", "ART 103"]);
  });

  it("honors choose-count and or-group course limits", () => {
    const program = { id: "CSM:media", college_code: "CSM", total_degree_units: 60, total_major_units_text: "9 units" } as SmccdProgram;
    const requirements = [
      { id: "choose", program_id: program.id, label: "Choose two", kind: "choose_count", min_units: null, min_count: 2, raw_text: null, sort_order: 0 },
      { id: "or", program_id: program.id, label: "Production option", kind: "or_group", min_units: null, min_count: null, raw_text: null, sort_order: 1 }
    ] as SmccdProgramRequirement[];
    const options = [
      ...["ART 101", "ART 102", "ART 103"].map((course_code) => ({ requirement_id: "choose", course_code, units_text: "3 units" })),
      ...["MUS. 101", "MUS. 102"].map((course_code) => ({ requirement_id: "or", course_code, units_text: "3 units" }))
    ] as SmccdRequirementCourse[];
    const courses = options.map((option) => course(option.course_code, 3));
    const rows = ["ART 101", "ART 102", "ART 103", "MUS. 102"].map((code) => ({
      smccd_course_id: `CSM:${code}`,
      status: "completed",
      college_units: 3,
      letter_grade: "A"
    })) as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result.requirements[0]).toMatchObject({ status: "satisfied", selectedCourseCodes: ["ART 101", "ART 102"], remainingCount: 0 });
    expect(result.requirements[0].remainingOptions).toEqual([]);
    expect(result.requirements[1]).toMatchObject({ status: "satisfied", selectedCourseCodes: ["MUS. 102"], remainingCount: 0 });
    expect(result.projectedMajorUnits).toBe(9);
  });

  it("keeps text rules manual instead of guessing from unrelated courses", () => {
    const program = { id: "CSM:manual", college_code: "CSM", total_degree_units: 60, total_major_units_text: "3 units" } as SmccdProgram;
    const requirements = [{
      id: "manual",
      program_id: program.id,
      label: "Additional coursework",
      kind: "text_rule",
      min_units: 3,
      min_count: null,
      raw_text: "Complete approved BUS. or ACTG coursework.",
      sort_order: 0
    }] as SmccdProgramRequirement[];
    const courses = [course("BUS. 100", 3)];
    const rows = [{ smccd_course_id: "CSM:BUS. 100", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, [], rows, courses);

    expect(result.requirements[0]).toMatchObject({ status: "manual_review", selectedCourseCodes: [], earnedUnits: 0 });
    expect(result.requirements[0].manualReviewReason).toContain("approved BUS. or ACTG");
    expect(result.manualReviewRequirements).toBe(1);
  });
});

function course(courseCode: string, units: number): SmccdCourse {
  return {
    id: `CSM:${courseCode}`,
    college_code: "CSM",
    course_code: courseCode,
    subject: courseCode.split(" ")[0],
    course_number: courseCode.split(" ")[1],
    title: courseCode,
    units_min: units,
    units_max: units,
    degree_applicable: true,
    transfer_credit: null,
    attributes: [],
    prerequisites: [],
    corequisites: [],
    recommended_preparation: [],
    detail_status: "verified",
    degree_applicability_source: "course_detail",
    catalog_url: "https://example.com",
    source_year: "2025-2026"
  };
}
