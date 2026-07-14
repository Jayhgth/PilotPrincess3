import { describe, expect, it } from "vitest";
import { calculateSmccdGeEvidence, calculateSmccdGeProgress, calculateSmccdLocalDegreeProgress, calculateSmccdProgramProgress, createSmccdProgramProgressContext, normalizeSmccdCourseCode } from "@/lib/smccd";
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
      { requirement_id: "core", course_code: "CHEM 210" }
    ] as SmccdRequirementCourse[];
    const courses = [
      { id: "CSM:BIOL 100", college_code: "CSM", course_code: "BIOL 100", title: "Introduction to Biology", units_min: 4, units_max: 4, degree_applicable: true, attributes: ["AA/AS Degree Requirements: Area 5A"], catalog_url: "https://example.com/biol" },
      { id: "CSM:CHEM 210", college_code: "CSM", course_code: "CHEM 210", title: "General Chemistry", units_min: 5, units_max: 5, degree_applicable: true, attributes: [], catalog_url: "https://example.com/chem" }
    ] as SmccdCourse[];
    const planRows = [
      { smccd_course_id: "CSM:BIOL 100", status: "completed", college_units: 4, grade_level: 11, term: "fall", letter_grade: "A" },
      { smccd_course_id: "CSM:CHEM 210", status: "planned", college_units: 4, grade_level: 12, term: "spring", letter_grade: null }
    ] as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, options, planRows, courses);

    expect(result).toMatchObject({
      completedDegreeApplicableUnits: 4,
      projectedDegreeApplicableUnits: 8,
      totalDegreeUnits: 60,
      completedRequirements: 0,
      satisfiedRequirements: 1,
      geEvidence: [{ area: "5", completedCourseCodes: ["BIOL 100"], projectedCourseCodes: ["BIOL 100", "CHEM 210"] }]
    });
    expect(result.requirements[0]).toMatchObject({
      completedStatus: "partial",
      status: "satisfied",
      missingSummary: "Requirement covered"
    });
    expect(calculateSmccdGeEvidence(createSmccdProgramProgressContext([], [], planRows, courses))).toEqual([
      { area: "5", label: "Area 5", completedCourseCodes: ["BIOL 100"], projectedCourseCodes: ["BIOL 100", "CHEM 210"] }
    ]);
  });

  it("audits every CSM local GE area, including communication, activity, and Area 8", () => {
    const courses = [
      { id: "CSM:COMM C1000", course_code: "COMM C1000", attributes: ["AA/AS Degree Requirements: Area 1B"], units_min: 3, units_max: 3 },
      { id: "CSM:ADAP 110", course_code: "ADAP 110", attributes: ["AA/AS Degree Requirements: Area 7A"], units_min: 1, units_max: 1 }
    ] as SmccdCourse[];
    const rows = [
      { smccd_course_id: "CSM:COMM C1000", status: "planned", college_units: 3 },
      { smccd_course_id: "CSM:ADAP 110", status: "completed", college_units: 1, letter_grade: "P" }
    ] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CSM");

    expect(progress).toHaveLength(10);
    expect(progress.find((area) => area.area === "1B")).toMatchObject({
      description: "Oral Communication & Critical Thinking",
      status: "planned",
      projectedCourseCodes: ["COMM C1000"]
    });
    expect(progress.find((area) => area.area === "7A")).toMatchObject({
      description: "Wellness & Kinesiology Activity",
      status: "completed",
      completedCourseCodes: ["ADAP 110"]
    });
    expect(progress.find((area) => area.area === "7B")).toMatchObject({ status: "missing", requiredUnits: 2 });
    expect(progress.find((area) => area.area === "8")).toMatchObject({ status: "missing", requiredUnits: 3 });
  });

  it("uses the awarding college's local GE pattern", () => {
    const context = createSmccdProgramProgressContext([], [], [], []);
    const csm = calculateSmccdLocalDegreeProgress(context, "CSM");
    const skyline = calculateSmccdLocalDegreeProgress(context, "SKY");
    const canada = calculateSmccdLocalDegreeProgress(context, "CAN");

    expect(csm).toMatchObject({ minimumGeUnits: 27 });
    expect(csm.geAreas).toHaveLength(10);
    expect(csm.graduationRequirements.map((requirement) => requirement.id)).toEqual(["information_literacy"]);
    expect(skyline).toMatchObject({ minimumGeUnits: 24 });
    expect(skyline.geAreas).toHaveLength(9);
    expect(skyline.geAreas.some((area) => area.area === "8")).toBe(false);
    expect(skyline.graduationRequirements.map((requirement) => requirement.id)).toEqual(["information_literacy", "american_history_institutions"]);
    expect(canada).toMatchObject({ minimumGeUnits: 25, graduationRequirements: [] });
    expect(canada.geAreas).toHaveLength(9);
    expect(canada.geAreas.find((area) => area.area === "5")).toMatchObject({
      description: "Natural Science with Lab",
      requiredUnits: 4,
      status: "missing"
    });
  });

  it("supports a student-confirmed PE completion without double-counting Area 7", () => {
    const progress = calculateSmccdGeProgress(
      createSmccdProgramProgressContext([], [], [], []),
      "CSM",
      new Set(["7A"])
    );

    expect(progress.find((area) => area.area === "7A")).toMatchObject({
      status: "completed",
      requiredUnits: 1,
      manuallyCompleted: true,
      completedCourseCodes: []
    });
    expect(progress.find((area) => area.area === "7B")).toMatchObject({
      status: "missing",
      requiredUnits: 2,
      manuallyCompleted: false
    });
  });

  it("restores official secondary GE designations and assigns constrained areas first", () => {
    const courses = [{
      id: "CSM:ETHN 103",
      college_code: "CSM",
      course_code: "ETHN 103",
      attributes: ["AA/AS Degree Requirements: Area 4"],
      units_min: 3,
      units_max: 3
    }] as SmccdCourse[];
    const rows = [{ smccd_course_id: "CSM:ETHN 103", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CSM");

    expect(progress.find((area) => area.area === "6")).toMatchObject({ status: "completed", completedCourseCodes: ["ETHN 103"] });
    expect(progress.find((area) => area.area === "4")).toMatchObject({ status: "missing", completedCourseCodes: [] });
  });

  it("applies the awarding college GE rules to transcript courses from another SMCCD college", () => {
    const courses = [
      {
        id: "SKY:HIST 201",
        college_code: "SKY",
        course_code: "HIST 201",
        attributes: ["AA/AS Degree Requirements: Area 4"],
        units_min: 3,
        units_max: 3
      },
      {
        id: "SKY:BIOL 110",
        college_code: "SKY",
        course_code: "BIOL 110",
        attributes: ["AA/AS Degree Requirements: Area 5"],
        units_min: 4,
        units_max: 4
      }
    ] as SmccdCourse[];
    const rows = [
      { smccd_course_id: "SKY:HIST 201", status: "completed", college_units: 3, letter_grade: "A" },
      { smccd_course_id: "SKY:BIOL 110", status: "completed", college_units: 4, letter_grade: "A" }
    ] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CSM");

    expect(progress.find((area) => area.area === "8")).toMatchObject({ status: "completed", completedCourseCodes: ["HIST 201"] });
    expect(progress.find((area) => area.area === "5")).toMatchObject({ status: "completed", completedCourseCodes: ["BIOL 110"] });
  });

  it("counts HIST 101 in CSM Area 4 and recovers legacy district transcript links by course code", () => {
    const courses = [{
      id: "CSM:HIST 101",
      college_code: "CSM",
      course_code: "HIST 101",
      title: "History of Western Civilization II",
      units_min: 3,
      units_max: 3,
      degree_applicable: true,
      attributes: ["AA/AS Degree Requirements: Area 3"]
    }] as SmccdCourse[];
    const rows = [{
      id: "legacy-history",
      smccd_course_id: null,
      custom_course_name: "History 101 - History of Western Civilization II",
      college_provider_code: "SMCCD",
      status: "completed",
      college_units: 3,
      letter_grade: "A",
      notes: "Imported from a reviewed transcript (College of San Mateo)."
    }] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CSM");

    expect(progress.find((area) => area.area === "4")).toMatchObject({
      status: "completed",
      completedCourseCodes: ["HIST 101"]
    });
  });

  it("uses the official college-wide GE roster when course-detail tags are incomplete", () => {
    const courses = [{
      id: "CSM:ANTH 180",
      college_code: "CSM",
      course_code: "ANTH 180",
      attributes: ["AA/AS Degree Requirements: Area 3"],
      units_min: 3,
      units_max: 3
    }] as SmccdCourse[];
    const rows = [{ smccd_course_id: "CSM:ANTH 180", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CSM");

    expect(progress.find((area) => area.area === "4")).toMatchObject({ status: "completed", completedCourseCodes: ["ANTH 180"] });
  });

  it("applies district GE reciprocity when a source-college area has a different unit structure", () => {
    const courses = [{ ...course("ASTR 100", 3), id: "SKY:ASTR 100", college_code: "SKY" }] as SmccdCourse[];
    const rows = [{ smccd_course_id: "SKY:ASTR 100", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];

    const progress = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], rows, courses), "CAN");

    expect(progress.find((area) => area.area === "5")).toMatchObject({
      status: "completed",
      requiredUnits: 4,
      projectedUnits: 3,
      completedCourseCodes: ["ASTR 100"],
      reciprocityApplied: true,
      missingSummary: "Covered by SMCCCD reciprocity"
    });
  });

  it("requires a lab when completing Cañada Area 5 with Cañada coursework", () => {
    const courses = [
      { ...course("ASTR 100", 3), id: "CAN:ASTR 100", college_code: "CAN" },
      { ...course("ASTR 101", 1), id: "CAN:ASTR 101", college_code: "CAN" }
    ] as SmccdCourse[];
    const lecture = { smccd_course_id: "CAN:ASTR 100", status: "completed", college_units: 3, letter_grade: "A" } as PlanCourse;
    const lab = { smccd_course_id: "CAN:ASTR 101", status: "completed", college_units: 1, letter_grade: "A" } as PlanCourse;

    const withoutLab = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], [lecture], courses), "CAN");
    const withLab = calculateSmccdGeProgress(createSmccdProgramProgressContext([], [], [lecture, lab], courses), "CAN");

    expect(withoutLab.find((area) => area.area === "5")).toMatchObject({ status: "partial", missingSummary: "A laboratory science course is still needed" });
    expect(withLab.find((area) => area.area === "5")).toMatchObject({ status: "completed", completedCourseCodes: ["ASTR 101", "ASTR 100"] });
  });

  it("tracks Skyline's history and institutions requirement without consuming its GE use", () => {
    const courses = [{ ...course("HIST 201", 3), id: "SKY:HIST 201", college_code: "SKY" }] as SmccdCourse[];
    const rows = [{ smccd_course_id: "SKY:HIST 201", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];

    const progress = calculateSmccdLocalDegreeProgress(createSmccdProgramProgressContext([], [], rows, courses), "SKY");

    expect(progress.graduationRequirements.find((requirement) => requirement.id === "american_history_institutions")).toMatchObject({ status: "completed", completedCourseCodes: ["HIST 201"], allowsGeReuse: true });
    expect(progress.geAreas.find((area) => area.area === "4")).toMatchObject({ status: "completed", completedCourseCodes: ["HIST 201"] });
  });

  it("tracks college-specific information-literacy requirements separately from GE", () => {
    const courses = [{ ...course("CIS 110", 3), id: "CSM:CIS 110", college_code: "CSM" }] as SmccdCourse[];
    const rows = [{ smccd_course_id: "CSM:CIS 110", status: "completed", college_units: 3, letter_grade: "A" }] as PlanCourse[];
    const context = createSmccdProgramProgressContext([], [], rows, courses);

    const csm = calculateSmccdLocalDegreeProgress(context, "CSM");
    const skyline = calculateSmccdLocalDegreeProgress(context, "SKY");
    const canada = calculateSmccdLocalDegreeProgress(context, "CAN");

    expect(csm.graduationRequirements[0]).toMatchObject({ id: "information_literacy", status: "completed", completedCourseCodes: ["CIS 110"] });
    expect(skyline.graduationRequirements[0]).toMatchObject({ id: "information_literacy", status: "completed", completedCourseCodes: ["CIS 110"] });
    expect(canada.graduationRequirements).toEqual([]);
  });

  it("keeps source-specific information-literacy grade rules", () => {
    const courses = [
      { ...course("CIS 110", 3), id: "CSM:CIS 110", college_code: "CSM" },
      { ...course("ENGL C1000", 3), id: "SKY:ENGL C1000", college_code: "SKY" }
    ] as SmccdCourse[];
    const csmCourse = [{ smccd_course_id: "CSM:CIS 110", status: "completed", college_units: 3, letter_grade: "C-" }] as PlanCourse[];
    const skylineCourse = [{ smccd_course_id: "SKY:ENGL C1000", status: "completed", college_units: 3, letter_grade: "C-" }] as PlanCourse[];

    const csmEvidence = calculateSmccdLocalDegreeProgress(createSmccdProgramProgressContext([], [], csmCourse, courses), "SKY");
    const skylineEvidence = calculateSmccdLocalDegreeProgress(createSmccdProgramProgressContext([], [], skylineCourse, courses), "SKY");

    expect(csmEvidence.graduationRequirements[0]).toMatchObject({ status: "missing" });
    expect(skylineEvidence.graduationRequirements[0]).toMatchObject({ status: "completed", completedCourseCodes: ["ENGL C1000"] });
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

  it("evaluates the CSM Social Science subject breadth and concentration rule", () => {
    const program = { id: "CSM:social-science-aa", college_code: "CSM", total_degree_units: 60, total_major_units_text: "18 units" } as SmccdProgram;
    const requirements = [{
      id: "breadth",
      program_id: program.id,
      label: "Required Core Courses: 18 units Select courses from at least three of the subject areas listed below. In one of the subject areas you must select at least two courses.",
      kind: "text_rule",
      min_units: 18,
      min_count: null,
      raw_text: "Anthropology Economics Ethnic Studies Geography History Political Science Psychology Social Science Sociology",
      sort_order: 0
    }] as SmccdProgramRequirement[];
    const codes = ["ANTH 110", "ANTH 180", "ECON 100", "HIST 100", "PSYC C1000", "SOCI 100"];
    const courses = codes.map((code) => course(code, 3));
    const rows = codes.map((code) => ({ smccd_course_id: `CSM:${code}`, status: "completed", college_units: 3, letter_grade: "A" })) as PlanCourse[];

    const result = calculateSmccdProgramProgress(program, requirements, [], rows, courses);

    expect(result.requirements[0]).toMatchObject({ status: "satisfied", earnedUnits: 18, remainingDisciplines: 0 });
    expect(result.majorPercent).toBe(100);
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

  it("does not mark Physical Science complete when the four required core groups are missing", () => {
    const program = { id: "CSM:physical-science-as", college_code: "CSM", total_degree_units: 60, total_major_units_text: "18 units" } as SmccdProgram;
    const groupCodes = [["ASTR 100"], ["CHEM 210"], ["GEOL 100"], ["PHYS 250"]];
    const supplementalCodes = ["CIS 255", "MATH 251", "MATH 252", "PHYS 260"];
    const requirements = [
      ...groupCodes.map((_, index) => ({ id: `group-${index + 1}`, program_id: program.id, label: `Required core: Group ${index + 1}`, kind: "or_group", min_units: null, min_count: 1, raw_text: null, constraint_only: true, sort_order: index })),
      { id: "units", program_id: program.id, label: "Required core unit total: 18 units", kind: "choose_units", min_units: 18, min_count: null, raw_text: null, constraint_only: false, sort_order: 4 }
    ] as SmccdProgramRequirement[];
    const allCodes = [...groupCodes.flat(), ...supplementalCodes];
    const options = [
      ...groupCodes.flatMap((codes, index) => codes.map((course_code) => ({ requirement_id: `group-${index + 1}`, course_code, units_text: "4 units" }))),
      ...allCodes.map((course_code) => ({ requirement_id: "units", course_code, units_text: "5 units" }))
    ] as SmccdRequirementCourse[];
    const courses = allCodes.map((code) => course(code, code === "CIS 255" || code.startsWith("PHYS") ? 4 : 5));
    const supplementOnly = supplementalCodes.map((code) => ({ smccd_course_id: `CSM:${code}`, status: "planned", college_units: code === "CIS 255" || code.startsWith("PHYS") ? 4 : 5 })) as PlanCourse[];

    const missingCore = calculateSmccdProgramProgress(program, requirements, options, supplementOnly, courses);
    expect(missingCore.projectedMajorUnits).toBeGreaterThanOrEqual(18);
    expect(missingCore.majorPercent).toBe(0);
    expect(missingCore.requirements.slice(0, 4).every((item) => item.status === "missing")).toBe(true);

    const withEveryCore = calculateSmccdProgramProgress(program, requirements, options, groupCodes.flat().map((code) => ({ smccd_course_id: `CSM:${code}`, status: "planned", college_units: code === "ASTR 100" || code === "GEOL 100" ? 3 : code === "CHEM 210" ? 5 : 4 })) as PlanCourse[], courses);
    expect(withEveryCore.requirements.slice(0, 4).every((item) => item.status === "satisfied")).toBe(true);
    expect(withEveryCore.majorPercent).toBeLessThan(100);
  });

  it("applies CIS 110-level selective coursework without reusing required core courses", () => {
    const program = { id: "CSM:computer-and-information-science-as", college_code: "CSM", total_degree_units: 60, total_major_units_text: "31 units" } as SmccdProgram;
    const requirements = [
      { id: "pair-1", program_id: program.id, label: "Programming option", kind: "or_group", min_units: null, min_count: 1, raw_text: null, constraint_only: false, sort_order: 0 },
      { id: "pair-2", program_id: program.id, label: "Data structures option", kind: "or_group", min_units: null, min_count: 1, raw_text: null, constraint_only: false, sort_order: 1 },
      { id: "fixed", program_id: program.id, label: "Remaining required courses", kind: "all", min_units: 13, min_count: null, raw_text: null, constraint_only: false, sort_order: 2 },
      { id: "cis-selective", program_id: program.id, label: "Required Selective Courses: 4", kind: "text_rule", min_units: 4, min_count: null, raw_text: "4 or more units from CIS courses numbered 110 or higher", constraint_only: false, sort_order: 3 },
      { id: "math-selective", program_id: program.id, label: "Required Selective Courses: 6 or more units", kind: "choose_units", min_units: 6, min_count: null, raw_text: null, constraint_only: false, sort_order: 4 }
    ] as SmccdProgramRequirement[];
    const options = [
      ...["CIS 255", "CIS 278"].map((course_code) => ({ requirement_id: "pair-1", course_code, units_text: "4 units" })),
      ...["CIS 256", "CIS 279"].map((course_code) => ({ requirement_id: "pair-2", course_code, units_text: "4 units" })),
      ...[["MATH 251", "5 units"], ["MATH 252", "5 units"], ["ENGL C1000", "3 units"]].map(([course_code, units_text]) => ({ requirement_id: "fixed", course_code, units_text })),
      ...[["MATH 253", "5 units"], ["MATH 270", "3 units"]].map(([course_code, units_text]) => ({ requirement_id: "math-selective", course_code, units_text }))
    ] as SmccdRequirementCourse[];
    const units = new Map([["CIS 255", 4], ["CIS 256", 4], ["CIS 117", 4], ["MATH 251", 5], ["MATH 252", 5], ["ENGL C1000", 3], ["MATH 253", 5], ["MATH 270", 3]]);
    const courses = [...units].map(([code, value]) => course(code, value));
    const coreRows = ["CIS 255", "CIS 256", "MATH 251", "MATH 252", "ENGL C1000", "MATH 253", "MATH 270"].map((code) => ({ smccd_course_id: `CSM:${code}`, status: "planned", college_units: units.get(code) })) as PlanCourse[];

    const withoutSeparateCisSelective = calculateSmccdProgramProgress(program, requirements, options, coreRows, courses);
    expect(withoutSeparateCisSelective.requirements.find((item) => item.requirement.id === "cis-selective")).toMatchObject({ status: "missing", earnedUnits: 0 });
    expect(withoutSeparateCisSelective.majorPercent).toBeLessThan(100);

    const complete = calculateSmccdProgramProgress(program, requirements, options, [...coreRows, { smccd_course_id: "CSM:CIS 117", status: "planned", college_units: 4 }] as PlanCourse[], courses);
    expect(complete.requirements.find((item) => item.requirement.id === "cis-selective")).toMatchObject({ status: "satisfied", selectedCourseCodes: ["CIS 117"] });
    expect(complete.majorPercent).toBe(100);
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
