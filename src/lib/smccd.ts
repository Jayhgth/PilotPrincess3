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

export type SmccdRequirementState = "satisfied" | "partial" | "missing" | "manual_review";

export interface SmccdProgressCourse {
  courseCode: string;
  title: string;
  collegeCode: SmccdCourse["college_code"];
  units: number;
  status: PlanCourse["status"];
  gradeLevel: PlanCourse["grade_level"];
  term: PlanCourse["term"];
  letterGrade: string | null;
  catalogUrl: string;
}

export interface SmccdRequirementOption {
  courseCode: string;
  title: string;
  collegeCode: SmccdCourse["college_code"];
  units: number;
  catalogUrl: string;
}

export interface SmccdRequirementProgress {
  requirement: SmccdProgramRequirement;
  status: SmccdRequirementState;
  completedStatus: SmccdRequirementState;
  selectedCourseCodes: string[];
  completedCourseCodes: string[];
  optionCourseCodes: string[];
  earnedUnits: number;
  completedUnits: number;
  requiredUnits: number | null;
  remainingUnits: number | null;
  remainingCount: number | null;
  missingSummary: string;
  manualReviewReason: string | null;
  selectedCourses: SmccdProgressCourse[];
  remainingOptions: SmccdRequirementOption[];
}

export interface SmccdGeEvidence {
  area: string;
  label: string;
  completedCourseCodes: string[];
  projectedCourseCodes: string[];
}

export interface SmccdProgramProgress {
  completedCollegeUnits: number;
  projectedCollegeUnits: number;
  completedDegreeApplicableUnits: number;
  projectedDegreeApplicableUnits: number;
  totalDegreeUnits: number;
  completedMajorUnits: number;
  projectedMajorUnits: number;
  requiredMajorUnits: number;
  completedRequirements: number;
  satisfiedRequirements: number;
  totalRequirements: number;
  manualReviewRequirements: number;
  majorPercent: number;
  geEvidence: SmccdGeEvidence[];
  requirements: SmccdRequirementProgress[];
}

export interface SmccdProgramProgressContext {
  requirementsByProgram: Map<string, SmccdProgramRequirement[]>;
  optionsByRequirement: Map<string, SmccdRequirementCourse[]>;
  courseById: Map<string, SmccdCourse>;
  coursesByCode: Map<string, SmccdCourse[]>;
  smccdRows: PlanCourse[];
  rowsByCode: Map<string, PlanCourse[]>;
  completedRowsByCode: Map<string, PlanCourse[]>;
}

export function createSmccdProgramProgressContext(
  requirements: readonly SmccdProgramRequirement[],
  options: readonly SmccdRequirementCourse[],
  planCourses: readonly PlanCourse[],
  courses: readonly SmccdCourse[]
): SmccdProgramProgressContext {
  const requirementsByProgram = new Map<string, SmccdProgramRequirement[]>();
  for (const requirement of requirements) {
    requirementsByProgram.set(requirement.program_id, [...(requirementsByProgram.get(requirement.program_id) ?? []), requirement]);
  }
  for (const rows of requirementsByProgram.values()) rows.sort((a, b) => a.sort_order - b.sort_order);

  const optionsByRequirement = new Map<string, SmccdRequirementCourse[]>();
  for (const option of options) {
    optionsByRequirement.set(option.requirement_id, [...(optionsByRequirement.get(option.requirement_id) ?? []), option]);
  }

  const courseById = new Map(courses.map((course) => [course.id, course]));
  const coursesByCode = new Map<string, SmccdCourse[]>();
  for (const course of courses) {
    const code = normalizeSmccdCourseCode(course.course_code);
    coursesByCode.set(code, [...(coursesByCode.get(code) ?? []), course]);
  }
  const smccdRows = planCourses.filter((row) => row.smccd_course_id && courseById.has(row.smccd_course_id));
  const rowsByCode = groupRowsByCode(smccdRows, courseById);
  const completedRowsByCode = groupRowsByCode(smccdRows.filter((row) => row.status === "completed"), courseById);

  return {
    requirementsByProgram,
    optionsByRequirement,
    courseById,
    coursesByCode,
    smccdRows,
    rowsByCode,
    completedRowsByCode
  };
}

export function calculateSmccdProgramProgressWithContext(
  program: SmccdProgram,
  context: SmccdProgramProgressContext
): SmccdProgramProgress {
  const requirementProgress = (context.requirementsByProgram.get(program.id) ?? []).map((requirement) => {
    const requirementOptions = context.optionsByRequirement.get(requirement.id) ?? [];
    const optionCodes = [...new Set(requirementOptions.map((option) => normalizeSmccdCourseCode(option.course_code)))];
    const projected = evaluateRequirement(requirement, optionCodes, context.rowsByCode);
    const completed = evaluateRequirement(requirement, optionCodes, context.completedRowsByCode);
    const selectedCourses = projected.selectedCodes
      .map((code) => progressCourse(code, context.rowsByCode, context.courseById))
      .filter((course): course is SmccdProgressCourse => Boolean(course));
    const manualReviewReason = [
      supplementalRuleReview(requirement),
      selectedCourses.some((course) => course.collegeCode !== program.college_code)
        ? `A same-code course from another SMCCD college is included as evidence. Confirm that ${SMCCD_COLLEGE_NAMES[program.college_code]} accepts it for this local program.`
        : null
    ].filter((reason): reason is string => Boolean(reason)).join(" ") || null;
    const remainingOptions = optionCodes
      .filter((code) => !projected.selectedCodes.includes(code))
      .map((code) => catalogOption(code, program, context.coursesByCode))
      .filter((course): course is SmccdRequirementOption => Boolean(course));

    return {
      requirement,
      status: projected.status,
      completedStatus: completed.status,
      selectedCourseCodes: projected.selectedCodes,
      completedCourseCodes: completed.selectedCodes,
      optionCourseCodes: optionCodes,
      earnedUnits: projected.earnedUnits,
      completedUnits: completed.earnedUnits,
      requiredUnits: projected.requiredUnits,
      remainingUnits: projected.remainingUnits,
      remainingCount: projected.remainingCount,
      missingSummary: requirementNeedLabel(requirement, projected.remainingUnits, projected.remainingCount, manualReviewReason),
      manualReviewReason,
      selectedCourses,
      remainingOptions
    } satisfies SmccdRequirementProgress;
  });

  const majorCourseCodes = new Set(requirementProgress.flatMap((progress) => progress.optionCourseCodes));
  const completedMajorUnits = sumRows(context.smccdRows.filter((row) => row.status === "completed"), context.courseById, majorCourseCodes);
  const projectedMajorUnits = sumRows(context.smccdRows, context.courseById, majorCourseCodes);
  const completedCollegeUnits = sumAllRows(context.smccdRows.filter((row) => row.status === "completed"));
  const projectedCollegeUnits = sumAllRows(context.smccdRows);
  const completedDegreeApplicableUnits = sumDegreeApplicableRows(
    context.smccdRows.filter((row) => row.status === "completed"),
    context.courseById
  );
  const projectedDegreeApplicableUnits = sumDegreeApplicableRows(context.smccdRows, context.courseById);
  const fromCatalog = Number(program.total_major_units_text.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const requiredMajorUnits = fromCatalog || round(requirementProgress.reduce((sum, progress) => sum + Number(progress.requiredUnits ?? 0), 0));
  const geEvidence = collectGeEvidence(context.smccdRows, context.courseById);

  return {
    completedCollegeUnits,
    projectedCollegeUnits,
    completedDegreeApplicableUnits,
    projectedDegreeApplicableUnits,
    totalDegreeUnits: Number(program.total_degree_units || 60),
    completedMajorUnits,
    projectedMajorUnits,
    requiredMajorUnits,
    completedRequirements: requirementProgress.filter((progress) => progress.completedStatus === "satisfied").length,
    satisfiedRequirements: requirementProgress.filter((progress) => progress.status === "satisfied").length,
    totalRequirements: requirementProgress.length,
    manualReviewRequirements: requirementProgress.filter((progress) => progress.status === "manual_review" || Boolean(progress.manualReviewReason)).length,
    majorPercent: requiredMajorUnits > 0 ? Math.min(100, Math.round((projectedMajorUnits / requiredMajorUnits) * 100)) : 0,
    geEvidence,
    requirements: requirementProgress
  };
}

export function calculateSmccdProgramProgress(
  program: SmccdProgram,
  requirements: SmccdProgramRequirement[],
  options: SmccdRequirementCourse[],
  planCourses: PlanCourse[],
  courses: SmccdCourse[]
): SmccdProgramProgress {
  return calculateSmccdProgramProgressWithContext(
    program,
    createSmccdProgramProgressContext(requirements, options, planCourses, courses)
  );
}

function groupRowsByCode(rows: readonly PlanCourse[], courseById: Map<string, SmccdCourse>) {
  const grouped = new Map<string, PlanCourse[]>();
  for (const row of rows) {
    const code = row.smccd_course_id ? courseById.get(row.smccd_course_id)?.course_code : null;
    if (!code) continue;
    const normalized = normalizeSmccdCourseCode(code);
    grouped.set(normalized, [...(grouped.get(normalized) ?? []), row]);
  }
  return grouped;
}

function evaluateRequirement(
  requirement: SmccdProgramRequirement,
  optionCodes: string[],
  rowsByCode: Map<string, PlanCourse[]>
) {
  const selectedCodes = optionCodes.filter((code) => rowsByCode.has(code));
  const earnedUnits = round(selectedCodes.reduce((total, code) => total + Number(bestPlanRow(rowsByCode.get(code) ?? [])?.college_units ?? 0), 0));
  const minUnits = requirement.min_units === null ? null : Number(requirement.min_units);
  const minCount = requirement.min_count ?? (requirement.kind === "or_group" ? 1 : null);
  let status: SmccdRequirementState;
  if (requirement.kind === "text_rule") status = "manual_review";
  else if (requirement.kind === "all") {
    status = optionCodes.length > 0 && selectedCodes.length === optionCodes.length ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
  } else if (requirement.kind === "choose_count" || requirement.kind === "or_group") {
    status = selectedCodes.length >= (minCount ?? 1) ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
  } else {
    status = earnedUnits >= (minUnits ?? Number.POSITIVE_INFINITY) ? "satisfied" : earnedUnits > 0 ? "partial" : "missing";
  }
  return {
    status,
    selectedCodes,
    earnedUnits,
    requiredUnits: minUnits,
    remainingUnits: minUnits === null ? null : round(Math.max(0, minUnits - earnedUnits)),
    remainingCount: requirement.kind === "all"
      ? Math.max(0, optionCodes.length - selectedCodes.length)
      : requirement.kind === "choose_count" || requirement.kind === "or_group"
        ? Math.max(0, (minCount ?? 1) - selectedCodes.length)
        : null
  };
}

function requirementNeedLabel(requirement: SmccdProgramRequirement, remainingUnits: number | null, remainingCount: number | null, manualReviewReason: string | null) {
  if (requirement.kind === "text_rule") return "Counselor or catalog review required";
  if (manualReviewReason && (remainingUnits === 0 || remainingCount === 0)) return "Course minimum covered; verify the text rule";
  if (remainingUnits !== null) return remainingUnits > 0 ? `${remainingUnits} more units` : "Requirement covered";
  if (remainingCount !== null) return remainingCount > 0 ? `${remainingCount} more ${remainingCount === 1 ? "course" : "courses"}` : "Requirement covered";
  return "Review the official requirement";
}

function supplementalRuleReview(requirement: SmccdProgramRequirement) {
  if (requirement.kind === "text_rule") return requirement.raw_text ?? "This requirement needs manual review.";
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`;
  if (/different\s+(?:academic\s+)?disciplines?/i.test(text)) {
    return "The course or unit minimum is measured, but the required number of different disciplines is not yet verified.";
  }
  if (/(?:minimum|overall|major)\s+gpa|grade\s+of\s+[A-C][+-]?\s+or\s+better|residen(?:cy|t)/i.test(text)) {
    return "The course or unit minimum is measured, but the grade, GPA, or residency condition still needs official review.";
  }
  return null;
}

function catalogOption(code: string, program: SmccdProgram, coursesByCode: Map<string, SmccdCourse[]>): SmccdRequirementOption | null {
  const matches = coursesByCode.get(code) ?? [];
  const course = matches.find((candidate) => candidate.college_code === program.college_code) ?? matches[0];
  if (!course) return null;
  return {
    courseCode: course.course_code,
    title: course.title,
    collegeCode: course.college_code,
    units: Number(course.units_max ?? course.units_min),
    catalogUrl: course.catalog_url
  };
}

function progressCourse(code: string, rowsByCode: Map<string, PlanCourse[]>, courseById: Map<string, SmccdCourse>): SmccdProgressCourse | null {
  const row = bestPlanRow(rowsByCode.get(code) ?? []);
  const course = row?.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
  if (!row || !course) return null;
  return {
    courseCode: course.course_code,
    title: course.title,
    collegeCode: course.college_code,
    units: Number(row.college_units ?? course.units_max ?? course.units_min),
    status: row.status,
    gradeLevel: row.grade_level,
    term: row.term,
    letterGrade: row.letter_grade,
    catalogUrl: course.catalog_url
  };
}

function collectGeEvidence(rows: readonly PlanCourse[], courseById: Map<string, SmccdCourse>) {
  const areas = new Map<string, { completed: Set<string>; projected: Set<string> }>();
  for (const row of rows) {
    const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
    if (!course) continue;
    for (const attribute of course.attributes ?? []) {
      const match = attribute.match(/AA\/AS Degree Requirements:\s*Area\s+(.+)$/i);
      if (!match) continue;
      const area = match[1].trim();
      const evidence = areas.get(area) ?? { completed: new Set<string>(), projected: new Set<string>() };
      evidence.projected.add(course.course_code);
      if (row.status === "completed") evidence.completed.add(course.course_code);
      areas.set(area, evidence);
    }
  }
  return [...areas.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([area, evidence]) => ({
      area,
      label: `Area ${area}`,
      completedCourseCodes: [...evidence.completed],
      projectedCourseCodes: [...evidence.projected]
    }));
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
    const normalized = code ? normalizeSmccdCourseCode(code) : null;
    if (!normalized || !allowedCodes.has(normalized) || usedCodes.has(normalized)) continue;
    usedCodes.add(normalized);
    units += Number(row.college_units ?? 0);
  }
  return round(units);
}

function sumAllRows(rows: readonly PlanCourse[]) {
  return round(rows.reduce((sum, row) => sum + Number(row.college_units ?? 0), 0));
}

function sumDegreeApplicableRows(rows: readonly PlanCourse[], courseById: Map<string, SmccdCourse>) {
  const usedCodes = new Set<string>();
  let units = 0;
  for (const row of [...rows].sort((a, b) => planRowRank(b) - planRowRank(a))) {
    const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
    if (!course?.degree_applicable) continue;
    const code = normalizeSmccdCourseCode(course.course_code);
    if (usedCodes.has(code)) continue;
    usedCodes.add(code);
    units += Number(row.college_units ?? course.units_max ?? course.units_min);
  }
  return round(units);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
