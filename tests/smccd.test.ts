import { describe, expect, it } from "vitest";
import { calculateSmccdProgramProgress, normalizeSmccdCourseCode } from "@/lib/smccd";
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
      { smccd_course_id: "CSM:CIS 117", status: "completed", college_units: 4 },
      { smccd_course_id: "CSM:CIS 255", status: "completed", college_units: 4 },
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
  });

  it("does not hide a discipline condition behind a satisfied unit total", () => {
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
    const rows = courses.map((course) => ({ smccd_course_id: course.id, status: "completed", college_units: 6, grade_level: 11, term: "fall" })) as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, rows, courses);

    expect(result.requirements[0]).toMatchObject({
      status: "satisfied",
      missingSummary: "Course minimum covered; verify the text rule"
    });
    expect(result.requirements[0].manualReviewReason).toContain("different disciplines");
    expect(result.manualReviewRequirements).toBe(1);
  });
});
