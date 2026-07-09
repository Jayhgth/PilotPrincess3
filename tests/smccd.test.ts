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
});
