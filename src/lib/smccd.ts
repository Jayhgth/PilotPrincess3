import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse
} from "@/lib/models";

const DOTTED_SUBJECTS = new Set(["BUS", "EMC", "LIT", "MUS", "P.E", "RE", "BCM", "ECE", "HTM"]);

export const SMCCD_COLLEGE_NAMES = {
  CSM: "College of San Mateo",
  SKY: "Skyline College",
  CAN: "Cañada College"
} as const;

export function normalizeSmccdCourseCode(input: string) {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/^([A-Z]{2,5})\s*\.\s*/, "$1. ");
  const match = cleaned.match(/^([A-Z]{2,5}|P\.E\.|R\.E\.)(\.?)\s*([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)$/);
  if (!match) return cleaned;
  const rawSubject = match[1].replace(/\.$/, "");
  const subject = DOTTED_SUBJECTS.has(rawSubject) ? `${rawSubject}.` : rawSubject;
  return `${subject} ${match[3]}`;
}

export interface SmccdRequirementProgress {
  requirement: SmccdProgramRequirement;
  status: "satisfied" | "partial" | "missing" | "manual_review";
  selectedCourseCodes: string[];
  optionCourseCodes: string[];
  earnedUnits: number;
  requiredUnits: number | null;
}

export interface SmccdProgramProgress {
  completedCollegeUnits: number;
  projectedCollegeUnits: number;
  completedMajorUnits: number;
  projectedMajorUnits: number;
  requiredMajorUnits: number;
  satisfiedRequirements: number;
  totalRequirements: number;
  majorPercent: number;
  requirements: SmccdRequirementProgress[];
}

export function calculateSmccdProgramProgress(
  program: SmccdProgram,
  requirements: SmccdProgramRequirement[],
  options: SmccdRequirementCourse[],
  planCourses: PlanCourse[],
  courses: SmccdCourse[]
): SmccdProgramProgress {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const smccdRows = planCourses.filter((row) => row.smccd_course_id && courseById.has(row.smccd_course_id));
  const rowsByCode = new Map<string, PlanCourse[]>();
  for (const row of smccdRows) {
    const code = courseById.get(row.smccd_course_id!)?.course_code;
    if (!code) continue;
    rowsByCode.set(code, [...(rowsByCode.get(code) ?? []), row]);
  }
  const optionsByRequirement = new Map<string, SmccdRequirementCourse[]>();
  for (const option of options) {
    optionsByRequirement.set(option.requirement_id, [...(optionsByRequirement.get(option.requirement_id) ?? []), option]);
  }

  const requirementProgress = requirements
    .filter((requirement) => requirement.program_id === program.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((requirement): SmccdRequirementProgress => {
      const requirementOptions = optionsByRequirement.get(requirement.id) ?? [];
      const optionCodes = [...new Set(requirementOptions.map((option) => normalizeSmccdCourseCode(option.course_code)))];
      const selectedCodes = optionCodes.filter((code) => rowsByCode.has(code));
      const earnedUnits = round(selectedCodes.reduce((total, code) => {
        const best = bestPlanRow(rowsByCode.get(code) ?? []);
        return total + Number(best?.college_units ?? 0);
      }, 0));
      const minUnits = requirement.min_units === null ? null : Number(requirement.min_units);
      const minCount = requirement.min_count ?? (requirement.kind === "or_group" ? 1 : null);
      let status: SmccdRequirementProgress["status"];
      if (requirement.kind === "text_rule") status = "manual_review";
      else if (requirement.kind === "all") {
        status = optionCodes.length > 0 && selectedCodes.length === optionCodes.length ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
      } else if (requirement.kind === "choose_count" || requirement.kind === "or_group") {
        status = selectedCodes.length >= (minCount ?? 1) ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
      } else {
        status = earnedUnits >= (minUnits ?? Number.POSITIVE_INFINITY) ? "satisfied" : earnedUnits > 0 ? "partial" : "missing";
      }
      return {
        requirement,
        status,
        selectedCourseCodes: selectedCodes,
        optionCourseCodes: optionCodes,
        earnedUnits,
        requiredUnits: minUnits
      };
    });

  const majorCourseCodes = new Set(requirementProgress.flatMap((progress) => progress.optionCourseCodes));
  const completedMajorUnits = sumRows(smccdRows.filter((row) => row.status === "completed"), courseById, majorCourseCodes);
  const projectedMajorUnits = sumRows(smccdRows, courseById, majorCourseCodes);
  const completedCollegeUnits = round(smccdRows.filter((row) => row.status === "completed").reduce((sum, row) => sum + Number(row.college_units ?? 0), 0));
  const projectedCollegeUnits = round(smccdRows.reduce((sum, row) => sum + Number(row.college_units ?? 0), 0));
  const fromCatalog = Number(program.total_major_units_text.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const requiredMajorUnits = fromCatalog || round(requirementProgress.reduce((sum, progress) => sum + Number(progress.requiredUnits ?? 0), 0));

  return {
    completedCollegeUnits,
    projectedCollegeUnits,
    completedMajorUnits,
    projectedMajorUnits,
    requiredMajorUnits,
    satisfiedRequirements: requirementProgress.filter((progress) => progress.status === "satisfied").length,
    totalRequirements: requirementProgress.length,
    majorPercent: requiredMajorUnits > 0 ? Math.min(100, Math.round((projectedMajorUnits / requiredMajorUnits) * 100)) : 0,
    requirements: requirementProgress
  };
}

function bestPlanRow(rows: PlanCourse[]) {
  return [...rows].sort((a, b) => planRowRank(b) - planRowRank(a))[0];
}

function planRowRank(row: PlanCourse) {
  return row.status === "completed" ? 3 : row.status === "current" ? 2 : 1;
}

function sumRows(rows: PlanCourse[], courseById: Map<string, SmccdCourse>, allowedCodes: Set<string>) {
  const usedCodes = new Set<string>();
  let units = 0;
  for (const row of [...rows].sort((a, b) => planRowRank(b) - planRowRank(a))) {
    const code = row.smccd_course_id ? courseById.get(row.smccd_course_id)?.course_code : null;
    if (!code || !allowedCodes.has(code) || usedCodes.has(code)) continue;
    usedCodes.add(code);
    units += Number(row.college_units ?? 0);
  }
  return round(units);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
