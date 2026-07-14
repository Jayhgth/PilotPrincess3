import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse
} from "@/lib/models";
import { institutionKeyFromName } from "@/lib/institutions";
import localGeCatalog from "../../supabase/catalog/smccd-local-ge-2025-2026.json";

const DOTTED_SUBJECTS = new Set(["BUS", "EMC", "LIT", "MUS", "P.E", "RE", "BCM", "ECE", "HTM"]);
const PASSING_MAJOR_GRADES = new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "P"]);
const PASSING_C_MINUS_GRADES = new Set([...PASSING_MAJOR_GRADES, "C-"]);
const PASSING_DEGREE_GRADES = new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "P"]);

const OFFICIAL_LOCAL_GE_COURSES = Object.fromEntries(
  Object.entries(localGeCatalog.colleges).map(([collegeCode, college]) => [
    collegeCode,
    Object.fromEntries(Object.entries(college.areas).map(([area, definition]) => [area, new Set(definition.courseCodes.map(normalizeSmccdCourseCode))]))
  ])
) as Record<SmccdCourse["college_code"], Record<string, Set<string>>>;
const CAN_AREA_5_LAB_COURSES = new Set(localGeCatalog.colleges.CAN.areas["5"].labCourseCodes.map(normalizeSmccdCourseCode));

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

function extractSmccdCourseCode(input: string | null | undefined) {
  if (!input) return null;
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/^CHINESE\b/, "CHIN")
    .replace(/^SPANISH\b/, "SPAN")
    .replace(/^BIOLOGY\b/, "BIOL")
    .replace(/^CHEMISTRY\b/, "CHEM")
    .replace(/^PHYSICS\b/, "PHYS")
    .replace(/^ECONOMICS\b/, "ECON")
    .replace(/^HISTORY\b/, "HIST")
    .replace(/^POLITICAL SCIENCE\b/, "PLSC")
    .replace(/\s+/g, " ");
  const match = cleaned.match(/^([A-Z]{2,5}|P\.?E\.?|R\.?E\.?)\s*\.?\s*([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)(?:\b|\s|$)/);
  return match ? normalizeSmccdCourseCode(`${match[1]} ${match[2]}`) : null;
}

export function findSmccdCourseMatch(
  input: {
    courseCode?: string | null;
    courseName?: string | null;
    institutionName?: string | null;
    providerCode?: string | null;
  },
  courses: readonly SmccdCourse[]
) {
  const code = extractSmccdCourseCode(input.courseCode) ?? extractSmccdCourseCode(input.courseName);
  if (!code) return null;
  const matches = courses.filter((course) => normalizeSmccdCourseCode(course.course_code) === code);
  if (!matches.length) return null;
  const institutionKey = institutionKeyFromName(input.institutionName);
  const providerCode = input.providerCode?.trim().toUpperCase();
  const preferredCollege = institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN"
    ? institutionKey
    : providerCode === "CSM" || providerCode === "SKY" || providerCode === "CAN"
      ? providerCode
      : null;
  return (preferredCollege ? matches.find((course) => course.college_code === preferredCollege) : null)
    ?? [...matches].sort((left, right) => ["CSM", "SKY", "CAN"].indexOf(left.college_code) - ["CSM", "SKY", "CAN"].indexOf(right.college_code))[0];
}

type SmccdRequirementState = "satisfied" | "partial" | "missing" | "manual_review";

interface SmccdProgressCourse {
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

interface SmccdRequirementOption {
  courseCode: string;
  title: string;
  collegeCode: SmccdCourse["college_code"];
  units: number;
  catalogUrl: string;
}

interface SmccdRequirementProgress {
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
  completionRatio: number;
  completedCompletionRatio: number;
  completionWeight: number;
  selectedCourses: SmccdProgressCourse[];
  remainingOptions: SmccdRequirementOption[];
}

export interface SmccdGeEvidence {
  area: string;
  label: string;
  completedCourseCodes: string[];
  projectedCourseCodes: string[];
}

type SmccdGeState = "completed" | "planned" | "partial" | "missing";

export interface SmccdGeProgress extends SmccdGeEvidence {
  description: string;
  status: SmccdGeState;
  completedUnits: number;
  projectedUnits: number;
  requiredUnits: number;
  missingSummary: string;
  eligibleCourseCodes: string[];
  manuallyCompleted: boolean;
}

const CSM_LOCAL_GE_WORKSHEET_URL = "https://collegeofsanmateo.edu/forms/docs/counseling/AAAS_DegreeWorksheet_25-26.pdf";
export const SMCCD_LOCAL_GE_SOURCE_URLS: Record<SmccdCourse["college_code"], string> = {
  CSM: CSM_LOCAL_GE_WORKSHEET_URL,
  CAN: "https://catalog.canadacollege.edu/current/ge-worksheets/_docs/aa-as-req.pdf",
  SKY: "https://catalog.skylinecollege.edu/current/generaldegreerequirements/associatestable.php"
};

type GeGradeMinimum = "c" | "c_minus" | "degree";

interface LocalGeAreaDefinition {
  area: string;
  label: string;
  description: string;
  requiredUnits: number;
  minimumGrade: GeGradeMinimum;
  allowReuse?: boolean;
  requiresLab?: boolean;
}

function localGeAreas(collegeCode: SmccdCourse["college_code"]): LocalGeAreaDefinition[] {
  const minimumGrade: GeGradeMinimum = collegeCode === "SKY" ? "c_minus" : "c";
  return [
    { area: "1A", label: "Area 1A", description: "English Composition", requiredUnits: 3, minimumGrade },
    { area: "1B", label: "Area 1B", description: "Oral Communication & Critical Thinking", requiredUnits: 3, minimumGrade },
    { area: "2", label: "Area 2", description: "Mathematics & Quantitative Reasoning", requiredUnits: 3, minimumGrade },
    { area: "3", label: "Area 3", description: "Arts & Humanities", requiredUnits: 3, minimumGrade: "degree" },
    { area: "4", label: "Area 4", description: "Social & Behavioral Sciences", requiredUnits: 3, minimumGrade: "degree" },
    { area: "5", label: "Area 5", description: collegeCode === "CAN" ? "Natural Science with Lab" : "Natural Sciences", requiredUnits: collegeCode === "CAN" ? 4 : 3, minimumGrade: "degree", requiresLab: collegeCode === "CAN" },
    { area: "6", label: "Area 6", description: "Ethnic Studies", requiredUnits: 3, minimumGrade: "degree" },
    { area: "7A", label: "Area 7A", description: collegeCode === "CAN" ? "Physical Education Activity" : "Wellness & Kinesiology Activity", requiredUnits: 1, minimumGrade: "degree" },
    { area: "7B", label: "Area 7B", description: "Additional Area 7 units", requiredUnits: 2, minimumGrade: "degree" },
    ...(collegeCode === "CSM" ? [{ area: "8", label: "Area 8", description: "American History & Institutions and California Government", requiredUnits: 3, minimumGrade: "degree" as const }] : []),
    ...(collegeCode === "SKY" ? [{ area: "8", label: "Graduation requirement", description: "American History & Institutions", requiredUnits: 3, minimumGrade: "degree" as const, allowReuse: true }] : [])
  ];
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
  courseUnitsByCode: Map<string, number>;
  smccdRows: PlanCourse[];
  rowsByCode: Map<string, PlanCourse[]>;
  completedRowsByCode: Map<string, PlanCourse[]>;
  completedAttemptsByCode: Map<string, PlanCourse>;
  projectedAttemptsByCode: Map<string, PlanCourse>;
  completedCollegeUnits: number;
  projectedCollegeUnits: number;
  completedDegreeApplicableUnits: number;
  projectedDegreeApplicableUnits: number;
  geEvidence: SmccdGeEvidence[];
  eligibleGeCourseCodesByCollege: Map<SmccdCourse["college_code"], Map<string, string[]>>;
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
  const courseUnitsByCode = new Map<string, number>();
  for (const course of courses) {
    const code = normalizeSmccdCourseCode(course.course_code);
    coursesByCode.set(code, [...(coursesByCode.get(code) ?? []), course]);
    courseUnitsByCode.set(code, Math.max(courseUnitsByCode.get(code) ?? 0, Number(course.units_max ?? course.units_min ?? 0)));
  }
  const smccdRows = planCourses.flatMap((row) => {
    if (row.smccd_course_id && courseById.has(row.smccd_course_id)) return [row];
    const provider = row.college_provider_code?.trim().toUpperCase();
    const hasCollegeEvidence = provider === "SMCCD" || provider === "CSM" || provider === "SKY" || provider === "CAN" || Number(row.college_units ?? 0) > 0;
    if (!hasCollegeEvidence) return [];
    const matchedCourse = findSmccdCourseMatch({
      courseName: row.custom_course_name,
      institutionName: row.notes,
      providerCode: provider
    }, courses);
    if (!matchedCourse) return [];
    return [{
      ...row,
      smccd_course_id: matchedCourse.id,
      college_units: row.college_units ?? matchedCourse.units_max ?? matchedCourse.units_min
    }];
  });
  const rowsByCode = groupRowsByCode(smccdRows, courseById);
  const completedRowsByCode = groupRowsByCode(smccdRows.filter((row) => row.status === "completed"), courseById);
  const completedAttemptsByCode = bestAttemptsByCode(smccdRows, courseById, false);
  const projectedAttemptsByCode = bestAttemptsByCode(smccdRows, courseById, true);

  return {
    requirementsByProgram,
    optionsByRequirement,
    courseById,
    coursesByCode,
    courseUnitsByCode,
    smccdRows,
    rowsByCode,
    completedRowsByCode,
    completedAttemptsByCode,
    projectedAttemptsByCode,
    completedCollegeUnits: sumAttemptUnits(completedAttemptsByCode, courseById, false),
    projectedCollegeUnits: sumAttemptUnits(projectedAttemptsByCode, courseById, false),
    completedDegreeApplicableUnits: sumAttemptUnits(completedAttemptsByCode, courseById, true),
    projectedDegreeApplicableUnits: sumAttemptUnits(projectedAttemptsByCode, courseById, true),
    geEvidence: collectGeEvidence(projectedAttemptsByCode, courseById),
    eligibleGeCourseCodesByCollege: buildEligibleGeCourseCodes(courseById)
  };
}

export function calculateSmccdProgramProgressWithContext(
  program: SmccdProgram,
  context: SmccdProgramProgressContext
): SmccdProgramProgress {
  const completedAttempts = context.completedAttemptsByCode;
  const projectedAttempts = context.projectedAttemptsByCode;
  const completedMajorCodes = new Set<string>();
  const projectedMajorCodes = new Set<string>();
  const requirementProgress = (context.requirementsByProgram.get(program.id) ?? []).map((requirement) => {
    const requirementOptions = context.optionsByRequirement.get(requirement.id) ?? [];
    const optionCodes = [...new Set(requirementOptions.map((option) => normalizeSmccdCourseCode(option.course_code)))];
    const projected = evaluateRequirement(requirement, requirementOptions, optionCodes, projectedAttempts, context.courseById, context.courseUnitsByCode, projectedMajorCodes);
    const completed = evaluateRequirement(requirement, requirementOptions, optionCodes, completedAttempts, context.courseById, context.courseUnitsByCode, completedMajorCodes);
    if (!requirement.constraint_only) {
      for (const code of projected.selectedCodes) projectedMajorCodes.add(code);
      for (const code of completed.selectedCodes) completedMajorCodes.add(code);
    }
    const selectedCourses = projected.selectedCodes
      .map((code) => progressCourse(code, projectedAttempts, context.courseById))
      .filter((course): course is SmccdProgressCourse => Boolean(course));
    const manualReviewReason = [
      supplementalRuleReview(requirement)
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
      completionRatio: projected.completionRatio,
      completedCompletionRatio: completed.completionRatio,
      completionWeight: projected.completionWeight,
      selectedCourses,
      remainingOptions
    } satisfies SmccdRequirementProgress;
  });

  const completedMajorUnits = round(requirementProgress.reduce((sum, progress) => sum + (progress.requirement.constraint_only ? 0 : progress.completedUnits), 0));
  const projectedMajorUnits = round(requirementProgress.reduce((sum, progress) => sum + (progress.requirement.constraint_only ? 0 : progress.earnedUnits), 0));
  const fromCatalog = Number(program.total_major_units_text.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const requiredMajorUnits = fromCatalog || round(requirementProgress.reduce((sum, progress) => sum + (progress.requirement.constraint_only ? 0 : Number(progress.requiredUnits ?? 0)), 0));
  const unitPercent = requiredMajorUnits > 0 ? Math.min(100, (projectedMajorUnits / requiredMajorUnits) * 100) : 0;
  const substantiveRequirements = requirementProgress.filter((progress) => !progress.requirement.constraint_only);
  const substantiveWeight = substantiveRequirements.reduce((sum, progress) => sum + requirementProgressWeight(progress), 0);
  const substantivePercent = substantiveWeight > 0
    ? substantiveRequirements.reduce((sum, progress) => sum + progress.completionRatio * requirementProgressWeight(progress), 0) / substantiveWeight * 100
    : unitPercent;
  const constraints = requirementProgress.filter((progress) => progress.requirement.constraint_only);
  const constraintPercent = constraints.length > 0
    ? constraints.reduce((sum, progress) => sum + progress.completionRatio, 0) / constraints.length * 100
    : 100;

  const manualReviewRequirements = requirementProgress.filter((progress) => progress.status === "manual_review" || Boolean(progress.manualReviewReason)).length;
  return {
    completedCollegeUnits: context.completedCollegeUnits,
    projectedCollegeUnits: context.projectedCollegeUnits,
    completedDegreeApplicableUnits: context.completedDegreeApplicableUnits,
    projectedDegreeApplicableUnits: context.projectedDegreeApplicableUnits,
    totalDegreeUnits: Number(program.total_degree_units || 60),
    completedMajorUnits,
    projectedMajorUnits,
    requiredMajorUnits,
    completedRequirements: requirementProgress.filter((progress) => progress.completedStatus === "satisfied").length,
    satisfiedRequirements: requirementProgress.filter((progress) => progress.status === "satisfied").length,
    totalRequirements: requirementProgress.length,
    manualReviewRequirements,
    majorPercent: Math.round(Math.min(unitPercent, substantivePercent, constraintPercent, manualReviewRequirements > 0 ? 95 : 100)),
    geEvidence: context.geEvidence,
    requirements: requirementProgress
  };
}

export function calculateSmccdGeEvidence(context: SmccdProgramProgressContext): SmccdGeEvidence[] {
  return context.geEvidence;
}

export function calculateSmccdGeProgress(
  context: SmccdProgramProgressContext,
  collegeCode: SmccdCourse["college_code"] = "CSM",
  completedAreaOverrides: ReadonlySet<string> = new Set()
): SmccdGeProgress[] {
  const definitions = localGeAreas(collegeCode);
  const completed = auditLocalGe(context.completedAttemptsByCode, context.courseById, definitions, collegeCode, completedAreaOverrides);
  const projected = auditLocalGe(context.projectedAttemptsByCode, context.courseById, definitions, collegeCode, completedAreaOverrides);

  return definitions.map((definition) => {
    const completedArea = completed.get(definition.area) ?? emptyGeArea(definition.requiredUnits);
    const projectedArea = projected.get(definition.area) ?? emptyGeArea(definition.requiredUnits);
    const requiredUnits = projectedArea.requiredUnits;
    const completedCovered = completedArea.units >= completedArea.requiredUnits && completedArea.conditionMet;
    const projectedCovered = projectedArea.units >= requiredUnits && projectedArea.conditionMet;
    const status: SmccdGeState = completedCovered
      ? "completed"
      : projectedCovered
        ? "planned"
        : projectedArea.units > 0
          ? "partial"
          : "missing";
    const remainingUnits = round(Math.max(0, requiredUnits - projectedArea.units));
    const missingSummary = !projectedArea.conditionMet && definition.requiresLab
      ? "A laboratory science course is still needed"
      : definition.area === "7B" && requiredUnits === 0
      ? "Area 7 is covered by Area 7A coursework"
      : status === "completed"
        ? "Completed"
        : status === "planned"
          ? "Covered by the active plan"
          : `${formatNumber(remainingUnits)} more ${remainingUnits === 1 ? "unit" : "units"} needed`;

    return {
      area: definition.area,
      label: definition.label,
      description: definition.description,
      status,
      completedUnits: completedArea.units,
      projectedUnits: projectedArea.units,
      requiredUnits,
      completedCourseCodes: completedArea.codes,
      projectedCourseCodes: projectedArea.codes,
      missingSummary,
      eligibleCourseCodes: context.eligibleGeCourseCodesByCollege.get(collegeCode)?.get(definition.area) ?? [],
      manuallyCompleted: completedArea.manuallyCompleted
    };
  });
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
  courseUnitsByCode: Map<string, number>,
  alreadyUsed: Set<string>
) {
  const minUnits = requirementMinUnits(requirement);
  const minCount = requirement.min_count ?? (requirement.kind === "or_group" ? 1 : null);
  const minDisciplines = minimumDisciplineCount(requirement);
  const unitSelection = requirement.kind === "all" && isUnitSelectionGroup(requirement, options, courseUnitsByCode);

  if (requirement.kind === "text_rule") {
    const breadthRule = supportedSubjectBreadthRule(requirement);
    if (breadthRule) {
      const eligible = [...attemptsByCode.keys()].filter((code) => {
        const parsed = courseSubjectAndNumber(code);
        const attempt = attemptsByCode.get(code);
        return parsed
          && breadthRule.subjects.has(parsed.subject)
          && !breadthRule.excludedCodes.has(normalizeSmccdCourseCode(code))
          && !alreadyUsed.has(code)
          && Boolean(attempt)
          && satisfiesMajorAttempt(attempt!);
      });
      const selectedCodes = eligible.sort((left, right) => (courseUnitsByCode.get(right) ?? 0) - (courseUnitsByCode.get(left) ?? 0));
      const earnedUnits = round(selectedCodes.reduce((total, code) => total + attemptUnits(attemptsByCode.get(code)!, courseById), 0));
      const disciplines = disciplineCount(selectedCodes);
      const largestDiscipline = Math.max(0, ...[...breadthRule.subjects].map((subject) => selectedCodes.filter((code) => courseSubjectAndNumber(code)?.subject === subject).length));
      const unitRatio = Math.min(1, earnedUnits / breadthRule.minUnits);
      const disciplineRatio = Math.min(1, disciplines / breadthRule.minDisciplines);
      const concentrationRatio = Math.min(1, largestDiscipline / breadthRule.minCoursesInOneDiscipline);
      const satisfied = unitRatio === 1 && disciplineRatio === 1 && concentrationRatio === 1;
      return {
        status: satisfied ? "satisfied" as const : selectedCodes.length > 0 ? "partial" as const : "missing" as const,
        selectedCodes,
        earnedUnits,
        requiredUnits: breadthRule.minUnits,
        remainingUnits: round(Math.max(0, breadthRule.minUnits - earnedUnits)),
        remainingCount: null,
        remainingDisciplines: Math.max(0, breadthRule.minDisciplines - disciplines),
        completionRatio: Math.min(unitRatio, disciplineRatio, concentrationRatio),
        completionWeight: breadthRule.minUnits
      };
    }
    const subjectRule = supportedSubjectSelectionRule(requirement);
    if (subjectRule) {
      const eligible = [...attemptsByCode.keys()].filter((code) => {
        const parsed = courseSubjectAndNumber(code);
        const attempt = attemptsByCode.get(code);
        return parsed?.subject === subjectRule.subject
          && parsed.number >= subjectRule.minimumNumber
          && !alreadyUsed.has(code)
          && Boolean(attempt)
          && satisfiesMajorAttempt(attempt!);
      }).sort((left, right) => (courseUnitsByCode.get(right) ?? 0) - (courseUnitsByCode.get(left) ?? 0));
      const selectedCodes: string[] = [];
      let earnedUnits = 0;
      for (const code of eligible) {
        selectedCodes.push(code);
        earnedUnits += attemptUnits(attemptsByCode.get(code)!, courseById);
        if (earnedUnits >= subjectRule.minUnits) break;
      }
      earnedUnits = round(earnedUnits);
      return {
        status: earnedUnits >= subjectRule.minUnits ? "satisfied" as const : earnedUnits > 0 ? "partial" as const : "missing" as const,
        selectedCodes,
        earnedUnits,
        requiredUnits: subjectRule.minUnits,
        remainingUnits: round(Math.max(0, subjectRule.minUnits - earnedUnits)),
        remainingCount: null,
        remainingDisciplines: 0,
        completionRatio: Math.min(1, earnedUnits / subjectRule.minUnits),
        completionWeight: subjectRule.minUnits
      };
    }
    if (optionCodes.length > 0 && minUnits !== null && minUnits > 0) {
      const selectedCodes: string[] = [];
      let earnedUnits = 0;
      for (const code of optionCodes.filter((candidate) => {
        const attempt = attemptsByCode.get(candidate);
        return !alreadyUsed.has(candidate) && Boolean(attempt) && satisfiesMajorAttempt(attempt!);
      }).sort((left, right) => (courseUnitsByCode.get(right) ?? 0) - (courseUnitsByCode.get(left) ?? 0))) {
        selectedCodes.push(code);
        earnedUnits += attemptUnits(attemptsByCode.get(code)!, courseById);
        if (earnedUnits >= minUnits && disciplineCount(selectedCodes) >= minDisciplines) break;
      }
      earnedUnits = round(earnedUnits);
      return {
        status: "manual_review" as const,
        selectedCodes,
        earnedUnits,
        requiredUnits: minUnits,
        remainingUnits: round(Math.max(0, minUnits - earnedUnits)),
        remainingCount: null,
        remainingDisciplines: Math.max(0, minDisciplines - disciplineCount(selectedCodes)),
        completionRatio: Math.min(.95, minUnits > 0 ? earnedUnits / minUnits : 0),
        completionWeight: minUnits
      };
    }
    return {
      status: "manual_review" as const,
      selectedCodes: [] as string[],
      earnedUnits: 0,
      requiredUnits: minUnits,
      remainingUnits: minUnits,
      remainingCount: null,
      remainingDisciplines: minDisciplines,
      completionRatio: 0,
      completionWeight: minUnits ?? 1
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
    const sorted = [...eligible].sort((left, right) => (courseUnitsByCode.get(right) ?? 0) - (courseUnitsByCode.get(left) ?? 0));
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
    remainingDisciplines: Math.max(0, minDisciplines - disciplineCount(selectedCodes)),
    completionRatio: requirementCompletionRatio(requirement, optionCodes, selectedCodes, earnedUnits, minUnits, minCount, minDisciplines, unitSelection),
    completionWeight: requirementWeight(requirement, optionCodes, minUnits, minCount, courseUnitsByCode)
  };
}

type RequirementEvaluation = ReturnType<typeof evaluateRequirement>;

function requirementNeedLabel(requirement: SmccdProgramRequirement, evaluation: RequirementEvaluation, manualReviewReason: string | null) {
  if (requirement.kind === "text_rule" && !supportedSubjectSelectionRule(requirement)) return "Counselor or catalog review required";
  if (evaluation.status === "satisfied") return manualReviewReason ? "Requirement covered; review the noted condition" : "Requirement covered";
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
  if (requirement.kind === "text_rule") return supportedSubjectSelectionRule(requirement) || supportedSubjectBreadthRule(requirement) ? null : requirement.raw_text ?? "This requirement needs manual review.";
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`;
  if (/(?:minimum|overall|major)\s+gpa|grade\s+of\s+[A-C][+-]?\s+or\s+better|residen(?:cy|t)/i.test(text)) {
    return "The course or unit minimum is measured, but the grade, GPA, or residency condition still needs official review.";
  }
  if (/(?:laboratory experience|maximum|may choose up to|not already (?:used|chosen))/i.test(text)) {
    return "The measurable course and unit minimum is shown, but the catalog's laboratory, maximum-use, or reuse condition still needs review.";
  }
  return null;
}

function supportedSubjectBreadthRule(requirement: SmccdProgramRequirement) {
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`;
  if (!/subject areas listed below/i.test(text) || !/one of the subject areas.*at least two courses/i.test(text)) return null;
  return {
    minUnits: requirementMinUnits(requirement) ?? 18,
    minDisciplines: 3,
    minCoursesInOneDiscipline: 2,
    subjects: new Set(["ANTH", "ECON", "ETHN", "GEOG", "HIST", "POLS", "PLSC", "PSYC", "SOSC", "SOCI"]),
    excludedCodes: new Set(["ETHN 288", "ETHN 585", "GEOG 100", "PSYC 121"])
  };
}

function supportedSubjectSelectionRule(requirement: SmccdProgramRequirement) {
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`;
  const match = text.match(/(\d+(?:\.\d+)?)\s+or more units from\s+([A-Z.]+)\s+courses numbered\s+(\d+)\s+or higher/i);
  if (!match) return null;
  return { minUnits: Number(match[1]), subject: match[2].replace(/\.$/, "").toUpperCase(), minimumNumber: Number(match[3]) };
}

function courseSubjectAndNumber(code: string) {
  const match = normalizeSmccdCourseCode(code).match(/^([A-Z.]+)\s+[A-Z]?(\d+)/);
  return match ? { subject: match[1].replace(/\.$/, ""), number: Number(match[2]) } : null;
}

function requirementCompletionRatio(
  requirement: SmccdProgramRequirement,
  optionCodes: string[],
  selectedCodes: string[],
  earnedUnits: number,
  minUnits: number | null,
  minCount: number | null,
  minDisciplines: number,
  unitSelection: boolean
) {
  if (requirement.kind === "all" && !unitSelection) return optionCodes.length > 0 ? selectedCodes.length / optionCodes.length : 0;
  if (requirement.kind === "or_group" || requirement.kind === "choose_count") return Math.min(1, selectedCodes.length / (minCount ?? 1));
  const unitRatio = minUnits && minUnits > 0 ? Math.min(1, earnedUnits / minUnits) : 0;
  const disciplineRatio = minDisciplines > 0 ? Math.min(1, disciplineCount(selectedCodes) / minDisciplines) : 1;
  return Math.min(unitRatio, disciplineRatio);
}

function requirementProgressWeight(progress: SmccdRequirementProgress) {
  return progress.completionWeight;
}

function requirementWeight(requirement: SmccdProgramRequirement, optionCodes: string[], minUnits: number | null, minCount: number | null, courseUnitsByCode: Map<string, number>) {
  if (minUnits && minUnits > 0) return minUnits;
  const optionUnits = optionCodes.map((code) => courseUnitsByCode.get(code) ?? 0).filter((units) => units > 0);
  if (requirement.kind === "or_group") return optionUnits.length > 0 ? Math.min(...optionUnits) : 1;
  if (requirement.kind === "choose_count") return (optionUnits.length > 0 ? Math.min(...optionUnits) : 1) * (minCount ?? 1);
  if (requirement.kind === "all") return optionUnits.reduce((sum, units) => sum + units, 0) || Math.max(1, optionCodes.length);
  return 1;
}

export function smccdDegreeOverallPercent(progress: SmccdProgramProgress, geProgress: SmccdGeProgress[]) {
  const degreeUnitsPercent = progress.totalDegreeUnits > 0 ? Math.min(100, (progress.projectedDegreeApplicableUnits / progress.totalDegreeUnits) * 100) : 0;
  const coveredGeAreas = geProgress.filter((area) => area.status === "completed" || area.status === "planned").length;
  const gePercent = geProgress.length > 0 ? (coveredGeAreas / geProgress.length) * 100 : 0;
  return Math.round((progress.majorPercent + degreeUnitsPercent + gePercent) / 3);
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
    for (const area of courseGeAreas(course, course.college_code)) {
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

interface GeAuditArea {
  codes: string[];
  units: number;
  requiredUnits: number;
  manuallyCompleted: boolean;
  conditionMet: boolean;
}

function emptyGeArea(requiredUnits: number): GeAuditArea {
  return { codes: [], units: 0, requiredUnits, manuallyCompleted: false, conditionMet: true };
}

function auditLocalGe(
  attemptsByCode: Map<string, PlanCourse>,
  courseById: Map<string, SmccdCourse>,
  definitions: LocalGeAreaDefinition[],
  awardingCollegeCode: SmccdCourse["college_code"],
  completedAreaOverrides: ReadonlySet<string>
) {
  const assigned = new Set<string>();
  const result = new Map<string, GeAuditArea>();
  const constrainedOrder = ["1A", "1B", "2", "6", "8", "4", "5", "3"];

  for (const area of constrainedOrder) {
    const definition = definitions.find((candidate) => candidate.area === area);
    if (!definition) continue;
    const areaAssigned = definition.allowReuse ? new Set<string>() : assigned;
    const candidates = geCandidates(area, attemptsByCode, courseById, areaAssigned, definition.minimumGrade, awardingCollegeCode)
      .sort((left, right) => {
        if (definition.requiresLab) {
          const labDifference = Number(satisfiesCanadaLabOrReciprocity(right.code, attemptsByCode, courseById)) - Number(satisfiesCanadaLabOrReciprocity(left.code, attemptsByCode, courseById));
          if (labDifference) return labDifference;
        }
        return right.units - left.units || left.code.localeCompare(right.code);
      });
    const assignedArea = assignGeCandidates(candidates, definition.requiredUnits, areaAssigned);
    assignedArea.conditionMet = !definition.requiresLab || assignedArea.codes.some((code) => satisfiesCanadaLabOrReciprocity(code, attemptsByCode, courseById));
    if (definition.requiresLab && assignedArea.conditionMet && assignedArea.codes.some((code) => courseForAttempt(code, attemptsByCode, courseById)?.college_code !== "CAN")) {
      assignedArea.units = Math.max(assignedArea.units, definition.requiredUnits);
    }
    result.set(area, assignedArea);
  }

  const area7ACandidates = geCandidates("7A", attemptsByCode, courseById, assigned, "degree", awardingCollegeCode)
    .sort((left, right) => left.units - right.units || left.code.localeCompare(right.code));
  const area7A = area7ACandidates.length > 0
    ? assignGeCandidates(area7ACandidates, 1, assigned)
    : completedAreaOverrides.has("7A")
      ? { codes: [], units: 1, requiredUnits: 1, manuallyCompleted: true, conditionMet: true }
      : emptyGeArea(1);
  result.set("7A", area7A);

  const area7BRequired = round(Math.max(0, 3 - area7A.units));
  const area7Candidates = [
    ...geCandidates("7B", attemptsByCode, courseById, assigned, "degree", awardingCollegeCode),
    ...geCandidates("7A", attemptsByCode, courseById, assigned, "degree", awardingCollegeCode)
  ].filter((candidate, index, rows) => rows.findIndex((row) => row.code === candidate.code) === index)
    .sort((left, right) => right.units - left.units || left.code.localeCompare(right.code));
  result.set("7B", assignGeCandidates(area7Candidates, area7BRequired, assigned));

  return result;
}

function geCandidates(
  area: string,
  attemptsByCode: Map<string, PlanCourse>,
  courseById: Map<string, SmccdCourse>,
  assigned: Set<string>,
  minimumGrade: GeGradeMinimum,
  awardingCollegeCode: SmccdCourse["college_code"]
) {
  const candidates: Array<{ code: string; units: number }> = [];
  for (const [code, row] of attemptsByCode) {
    if (assigned.has(code) || !qualifiesForLocalGe(row, minimumGrade)) continue;
    const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
    if (!course || !courseGeAreas(course, awardingCollegeCode).some((candidate) => geAreaMatches(area, candidate))) continue;
    candidates.push({ code: course.course_code, units: attemptUnits(row, courseById) });
  }
  return candidates;
}

function courseForAttempt(code: string, attemptsByCode: Map<string, PlanCourse>, courseById: Map<string, SmccdCourse>) {
  const attempt = attemptsByCode.get(normalizeSmccdCourseCode(code));
  return attempt?.smccd_course_id ? courseById.get(attempt.smccd_course_id) : null;
}

function satisfiesCanadaLabOrReciprocity(code: string, attemptsByCode: Map<string, PlanCourse>, courseById: Map<string, SmccdCourse>) {
  const course = courseForAttempt(code, attemptsByCode, courseById);
  return Boolean(course) && (course?.college_code !== "CAN" || CAN_AREA_5_LAB_COURSES.has(normalizeSmccdCourseCode(code)));
}

function assignGeCandidates(candidates: Array<{ code: string; units: number }>, requiredUnits: number, assigned: Set<string>): GeAuditArea {
  const codes: string[] = [];
  let units = 0;
  for (const candidate of candidates) {
    if (units >= requiredUnits) break;
    const normalized = normalizeSmccdCourseCode(candidate.code);
    if (assigned.has(normalized)) continue;
    assigned.add(normalized);
    codes.push(candidate.code);
    units += candidate.units;
  }
  return { codes, units: round(units), requiredUnits, manuallyCompleted: false, conditionMet: true };
}

function courseGeAreas(course: SmccdCourse, _awardingCollegeCode: SmccdCourse["college_code"]) {
  const normalizedCode = normalizeSmccdCourseCode(course.course_code);
  const officialAreas = Object.entries(OFFICIAL_LOCAL_GE_COURSES[course.college_code] ?? {})
    .filter(([, courseCodes]) => courseCodes.has(normalizedCode))
    .map(([area]) => area);
  if (officialAreas.length > 0 || OFFICIAL_LOCAL_GE_COURSES[course.college_code]) return officialAreas;
  return (course.attributes ?? []).flatMap((attribute) => {
    const match = attribute.match(/AA\/AS Degree Requirements:\s*Area\s+(.+)$/i);
    return match ? [match[1].trim().toUpperCase()] : [];
  });
}

function geAreaMatches(requiredArea: string, catalogArea: string) {
  if (["1A", "1B", "7A", "7B"].includes(requiredArea)) return catalogArea === requiredArea;
  return catalogArea === requiredArea || catalogArea.startsWith(requiredArea);
}

function buildEligibleGeCourseCodes(courseById: Map<string, SmccdCourse>) {
  return new Map<SmccdCourse["college_code"], Map<string, string[]>>(
    (["CSM", "SKY", "CAN"] as const).map((collegeCode) => {
      const definitions = localGeAreas(collegeCode);
      const codesByArea = new Map(definitions.map((definition) => [definition.area, new Set<string>()]));
      for (const course of courseById.values()) {
        const catalogAreas = courseGeAreas(course, collegeCode);
        if (!catalogAreas.length) continue;
        const normalizedCode = normalizeSmccdCourseCode(course.course_code);
        for (const definition of definitions) {
          if (catalogAreas.some((candidate) => geAreaMatches(definition.area, candidate))) {
            codesByArea.get(definition.area)?.add(normalizedCode);
          }
        }
      }
      return [collegeCode, new Map([...codesByArea].map(([area, codes]) => [
        area,
        [...codes].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      ]))];
    })
  );
}

function qualifiesForLocalGe(row: PlanCourse, minimumGrade: GeGradeMinimum) {
  if (row.status === "current" || row.status === "planned") return true;
  const grade = normalizeGrade(row.letter_grade);
  if (minimumGrade === "c") return PASSING_MAJOR_GRADES.has(grade);
  if (minimumGrade === "c_minus") return PASSING_C_MINUS_GRADES.has(grade);
  return PASSING_DEGREE_GRADES.has(grade);
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
  courseUnitsByCode: Map<string, number>
) {
  const minUnits = requirementMinUnits(requirement);
  if (!minUnits) return false;
  if (/select|selected|minimum|at least|from the following|or more units/i.test(`${requirement.label} ${requirement.raw_text ?? ""}`)) return true;
  const totalOptionUnits = options.reduce((sum, option) => sum + optionUnits(option, courseUnitsByCode), 0);
  return totalOptionUnits > minUnits;
}

function optionUnits(option: SmccdRequirementCourse, courseUnitsByCode: Map<string, number>) {
  const values = [...(option.units_text ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return values.length > 0 ? Math.max(...values) : courseUnitsByCode.get(normalizeSmccdCourseCode(option.course_code)) ?? 0;
}

function minimumDisciplineCount(requirement: SmccdProgramRequirement) {
  const text = `${requirement.label} ${requirement.raw_text ?? ""}`.toLowerCase();
  const match = text.match(/(?:at least\s+|each of\s+)(\d+|one|two|three|four|five)\s+different\s+(?:(?:academic\s+)?disciplines?|areas?)/);
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
