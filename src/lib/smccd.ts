import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse
} from "@/lib/models";

const DOTTED_SUBJECTS = new Set(["BUS", "EMC", "LIT", "MUS", "P.E", "RE", "BCM", "ECE", "HTM"]);
const PASSING_MAJOR_GRADES = new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "P"]);
const PASSING_DEGREE_GRADES = new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "P"]);

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
  remainingDisciplines: number;
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
  const completedAttempts = bestAttemptsByCode(context.smccdRows, context.courseById, false);
  const projectedAttempts = bestAttemptsByCode(context.smccdRows, context.courseById, true);
  const completedMajorCodes = new Set<string>();
  const projectedMajorCodes = new Set<string>();
  const requirementProgress = (context.requirementsByProgram.get(program.id) ?? []).map((requirement) => {
    const requirementOptions = context.optionsByRequirement.get(requirement.id) ?? [];
    const optionCodes = [...new Set(requirementOptions.map((option) => normalizeSmccdCourseCode(option.course_code)))];
    const projected = evaluateRequirement(requirement, requirementOptions, optionCodes, projectedAttempts, context.courseById, projectedMajorCodes);
    const completed = evaluateRequirement(requirement, requirementOptions, optionCodes, completedAttempts, context.courseById, completedMajorCodes);
    for (const code of projected.selectedCodes) projectedMajorCodes.add(code);
    for (const code of completed.selectedCodes) completedMajorCodes.add(code);
    const selectedCourses = projected.selectedCodes
      .map((code) => progressCourse(code, projectedAttempts, context.courseById))
      .filter((course): course is SmccdProgressCourse => Boolean(course));
    const manualReviewReason = [
      supplementalRuleReview(requirement),
      selectedCourses.some((course) => course.collegeCode !== program.college_code)
        ? `A same-code course from another SMCCD college is included as evidence. Confirm that ${SMCCD_COLLEGE_NAMES[program.college_code]} accepts it for this local program.`
        : null
    ].filter((reason): reason is string => Boolean(reason)).join(" ") || null;
    const remainingOptions = projected.status === "satisfied"
      ? []
      : optionCodes
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
      remainingDisciplines: projected.remainingDisciplines,
      missingSummary: requirementNeedLabel(requirement, projected, manualReviewReason),
      manualReviewReason,
      selectedCourses,
      remainingOptions
    } satisfies SmccdRequirementProgress;
  });

  const completedMajorUnits = round(requirementProgress.reduce((sum, progress) => sum + progress.completedUnits, 0));
  const projectedMajorUnits = round(requirementProgress.reduce((sum, progress) => sum + progress.earnedUnits, 0));
  const completedCollegeUnits = sumAttemptUnits(completedAttempts, context.courseById, false);
  const projectedCollegeUnits = sumAttemptUnits(projectedAttempts, context.courseById, false);
  const completedDegreeApplicableUnits = sumAttemptUnits(completedAttempts, context.courseById, true);
  const projectedDegreeApplicableUnits = sumAttemptUnits(projectedAttempts, context.courseById, true);
  const fromCatalog = Number(program.total_major_units_text.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const requiredMajorUnits = fromCatalog || round(requirementProgress.reduce((sum, progress) => sum + Number(progress.requiredUnits ?? 0), 0));
  const geEvidence = collectGeEvidence(projectedAttempts, context.courseById);

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

export function calculateSmccdGeEvidence(context: SmccdProgramProgressContext): SmccdGeEvidence[] {
  return collectGeEvidence(bestAttemptsByCode(context.smccdRows, context.courseById, true), context.courseById);
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
  options: SmccdRequirementCourse[],
  optionCodes: string[],
  attemptsByCode: Map<string, PlanCourse>,
  courseById: Map<string, SmccdCourse>,
  alreadyUsed: Set<string>
) {
  const minUnits = requirementMinUnits(requirement);
  const minCount = requirement.min_count ?? (requirement.kind === "or_group" ? 1 : null);
  const minDisciplines = minimumDisciplineCount(requirement);
  const unitSelection = requirement.kind === "all" && isUnitSelectionGroup(requirement, options, courseById);

  if (requirement.kind === "text_rule") {
    return {
      status: "manual_review" as const,
      selectedCodes: [] as string[],
      earnedUnits: 0,
      requiredUnits: minUnits,
      remainingUnits: minUnits,
      remainingCount: null,
      remainingDisciplines: minDisciplines
    };
  }

  const eligible = optionCodes.filter((code) => {
    const attempt = attemptsByCode.get(code);
    return !alreadyUsed.has(code) && Boolean(attempt) && satisfiesMajorAttempt(attempt!);
  });
  let selectedCodes: string[];

  if (requirement.kind === "all" && !unitSelection) {
    selectedCodes = optionCodes.filter((code) => eligible.includes(code));
  } else if (requirement.kind === "or_group" || requirement.kind === "choose_count") {
    selectedCodes = eligible.slice(0, minCount ?? 1);
  } else {
    const sorted = [...eligible].sort((left, right) => catalogCourseUnitsForCode(right, courseById) - catalogCourseUnitsForCode(left, courseById));
    selectedCodes = [];
    let selectedUnits = 0;
    for (const code of sorted) {
      selectedCodes.push(code);
      selectedUnits += attemptUnits(attemptsByCode.get(code)!, courseById);
      if (requirement.kind === "choose_units" && selectedUnits >= (minUnits ?? Number.POSITIVE_INFINITY) && disciplineCount(selectedCodes) >= minDisciplines) break;
    }
  }

  const earnedUnits = round(selectedCodes.reduce((total, code) => total + attemptUnits(attemptsByCode.get(code)!, courseById), 0));
  let status: SmccdRequirementState;
  if (requirement.kind === "all" && !unitSelection) {
    status = selectedCodes.length === optionCodes.length ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
  } else if (requirement.kind === "choose_count" || requirement.kind === "or_group") {
    status = selectedCodes.length >= (minCount ?? 1) ? "satisfied" : selectedCodes.length > 0 ? "partial" : "missing";
  } else {
    status = earnedUnits >= (minUnits ?? Number.POSITIVE_INFINITY) && disciplineCount(selectedCodes) >= minDisciplines
      ? "satisfied"
      : earnedUnits > 0
        ? "partial"
        : "missing";
  }

  return {
    status,
    selectedCodes,
    earnedUnits,
    requiredUnits: minUnits,
    remainingUnits: minUnits === null ? null : round(Math.max(0, minUnits - earnedUnits)),
    remainingCount: requirement.kind === "all" && !unitSelection
      ? Math.max(0, optionCodes.length - selectedCodes.length)
      : requirement.kind === "choose_count" || requirement.kind === "or_group"
        ? Math.max(0, (minCount ?? 1) - selectedCodes.length)
        : null,
    remainingDisciplines: Math.max(0, minDisciplines - disciplineCount(selectedCodes))
  };
}

type RequirementEvaluation = ReturnType<typeof evaluateRequirement>;

function requirementNeedLabel(requirement: SmccdProgramRequirement, evaluation: RequirementEvaluation, manualReviewReason: string | null) {
  if (requirement.kind === "text_rule") return "Counselor or catalog review required";
  if (evaluation.status === "satisfied") return manualReviewReason ? "Course minimum covered; verify the text rule" : "Requirement covered";
  if (evaluation.remainingCount !== null) {
    if (requirement.kind === "or_group" || requirement.kind === "choose_count") {
      return `Choose ${evaluation.remainingCount} more ${evaluation.remainingCount === 1 ? "course" : "courses"} from the options`;
    }
    return `${evaluation.remainingCount} required ${evaluation.remainingCount === 1 ? "course" : "courses"} remaining`;
  }
  if (evaluation.remainingUnits !== null && evaluation.remainingDisciplines > 0) {
    return `${formatNumber(evaluation.remainingUnits)} more ${evaluation.remainingUnits === 1 ? "unit" : "units"} and ${evaluation.remainingDisciplines} more ${evaluation.remainingDisciplines === 1 ? "discipline" : "disciplines"} needed from the options`;
  }
  if (evaluation.remainingUnits !== null) {
    return `${formatNumber(evaluation.remainingUnits)} more ${evaluation.remainingUnits === 1 ? "unit" : "units"} needed from the options`;
  }
  return "Review the official requirement";
}

function supplementalRuleReview(requirement: SmccdProgramRequirement) {
  if (requirement.kind === "text_rule") return requirement.raw_text ?? "This requirement needs manual review.";
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`;
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

function progressCourse(code: string, attemptsByCode: Map<string, PlanCourse>, courseById: Map<string, SmccdCourse>): SmccdProgressCourse | null {
  const row = attemptsByCode.get(code);
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

function collectGeEvidence(attemptsByCode: Map<string, PlanCourse>, courseById: Map<string, SmccdCourse>) {
  const areas = new Map<string, { completed: Set<string>; projected: Set<string> }>();
  for (const row of attemptsByCode.values()) {
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

function planRowRank(row: PlanCourse) {
  if (row.status === "completed" && PASSING_MAJOR_GRADES.has(normalizeGrade(row.letter_grade))) return 4;
  if (row.status === "completed") return 3;
  return row.status === "current" ? 2 : 1;
}

function bestAttemptsByCode(rows: readonly PlanCourse[], courseById: Map<string, SmccdCourse>, includeProjection: boolean) {
  const attempts = new Map<string, PlanCourse>();
  for (const row of rows) {
    const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
    if (!course) continue;
    const eligible = row.status === "completed"
      ? PASSING_DEGREE_GRADES.has(normalizeGrade(row.letter_grade))
      : includeProjection && (row.status === "current" || row.status === "planned");
    if (!eligible) continue;
    const code = normalizeSmccdCourseCode(course.course_code);
    const existing = attempts.get(code);
    if (!existing || planRowRank(row) > planRowRank(existing)) attempts.set(code, row);
  }
  return attempts;
}

function normalizeGrade(grade: string | null | undefined) {
  return grade?.trim().toUpperCase() ?? "";
}

function satisfiesMajorAttempt(row: PlanCourse) {
  return row.status === "current" || row.status === "planned" || PASSING_MAJOR_GRADES.has(normalizeGrade(row.letter_grade));
}

function attemptUnits(row: PlanCourse, courseById: Map<string, SmccdCourse>) {
  const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
  return Number(row.college_units ?? course?.units_max ?? course?.units_min ?? 0);
}

function catalogCourseUnitsForCode(code: string, courseById: Map<string, SmccdCourse>) {
  let units = 0;
  for (const course of courseById.values()) {
    if (normalizeSmccdCourseCode(course.course_code) === code) units = Math.max(units, Number(course.units_max ?? course.units_min ?? 0));
  }
  return units;
}

function sumAttemptUnits(attemptsByCode: Map<string, PlanCourse>, courseById: Map<string, SmccdCourse>, degreeApplicableOnly: boolean) {
  let units = 0;
  for (const row of attemptsByCode.values()) {
    const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
    if (!course || (degreeApplicableOnly && !course.degree_applicable)) continue;
    units += attemptUnits(row, courseById);
  }
  return round(units);
}

function requirementMinUnits(requirement: SmccdProgramRequirement) {
  if (requirement.min_units !== null) return Number(requirement.min_units);
  const match = `${requirement.label} ${requirement.raw_text ?? ""}`.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|or)\s*(?:more\s*)?(?:\d+(?:\.\d+)?)?)?\s*units?\b/i);
  return match ? Number(match[1]) : null;
}

function isUnitSelectionGroup(
  requirement: SmccdProgramRequirement,
  options: readonly SmccdRequirementCourse[],
  courseById: Map<string, SmccdCourse>
) {
  const minUnits = requirementMinUnits(requirement);
  if (!minUnits) return false;
  if (/select|selected|minimum|at least|from the following|or more units/i.test(`${requirement.label} ${requirement.raw_text ?? ""}`)) return true;
  const courseUnitsByCode = new Map<string, number>();
  for (const course of courseById.values()) {
    const code = normalizeSmccdCourseCode(course.course_code);
    courseUnitsByCode.set(code, Math.max(courseUnitsByCode.get(code) ?? 0, Number(course.units_max ?? course.units_min ?? 0)));
  }
  const totalOptionUnits = options.reduce((sum, option) => sum + optionUnits(option, courseUnitsByCode), 0);
  return totalOptionUnits > minUnits;
}

function optionUnits(option: SmccdRequirementCourse, courseUnitsByCode: Map<string, number>) {
  const values = [...(option.units_text ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return values.length > 0 ? Math.max(...values) : courseUnitsByCode.get(normalizeSmccdCourseCode(option.course_code)) ?? 0;
}

function minimumDisciplineCount(requirement: SmccdProgramRequirement) {
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`.toLowerCase();
  const match = text.match(/at least\s+(\d+|one|two|three|four|five)\s+different\s+(?:academic\s+)?discipline/);
  if (!match) return 0;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  return ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[match[1]] ?? 0;
}

function disciplineCount(courseCodes: readonly string[]) {
  return new Set(courseCodes.map((code) => code.split(" ")[0])).size;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
