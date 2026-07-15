import type {
  Course,
  CourseRequirementMapping,
  EnrollmentPolicy,
  GpaSummary,
  GraduationRequirement,
  GradeLevel,
  PlanCourse,
  RequirementProgress,
  SmccdHighSchoolEquivalency,
  StudentSettings
} from "@/lib/models";
import { courseEquivalenceKeys } from "@/lib/course-names";
import { resolvePlanCourseHighSchoolCredits } from "@/lib/college-credits";

const GRADE_POINTS: Record<string, number> = {
  "A+": 4,
  A: 4,
  "A-": 4,
  "B+": 3,
  B: 3,
  "B-": 3,
  "C+": 2,
  C: 2,
  "C-": 2,
  "D+": 1,
  D: 1,
  "D-": 1,
  F: 0
};

export const REQUIREMENT_LABELS = {
  english: "English",
  social_science: "Social Science",
  math: "Mathematics",
  lab_science: "Laboratory Science",
  world_language: "World Language",
  design_lab: "Design Lab",
  visual_performing_arts: "Visual and Performing Arts",
  personal_development: "Personal Development",
  physical_education: "Physical Education",
  career_technical_education: "Career Technical Education",
  electives: "Electives",
  ethnic_studies: "Ethnic Studies",
  other: "Other diploma requirement"
} as const;

const DTECH_SCHOOL_ID = "d7ec0000-0000-4000-8000-000000000001";

export const GRADE_LEVELS: GradeLevel[] = [9, 10, 11, 12];
export const LETTER_GRADES = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "IP"];

export function dtechGradePoint(grade: string | null | undefined) {
  const points = GRADE_POINTS[grade?.trim().toUpperCase() ?? ""];
  return points === undefined ? null : points;
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function schoolYearForGrade(graduationYear: number, grade: GradeLevel) {
  const endYear = graduationYear - (12 - grade);
  return `${endYear - 1}-${endYear}`;
}

type AcademicTerm = "fall" | "spring" | "summer";

export interface AcademicPeriod {
  term: AcademicTerm;
  schoolYear: string;
  label: string;
}

export function academicPeriodForDate(date = new Date()): AcademicPeriod {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const term: AcademicTerm = month <= 5 ? "spring" : month <= 7 ? "summer" : "fall";
  const startYear = term === "fall" ? year : year - 1;
  return {
    term,
    schoolYear: `${startYear}-${startYear + 1}`,
    label: `${term[0].toUpperCase()}${term.slice(1)} ${year}`
  };
}

export function nextAcademicPeriod(period: AcademicPeriod): AcademicPeriod {
  const [startYearValue] = period.schoolYear.split("-");
  const startYear = Number(startYearValue);
  if (period.term === "fall") {
    return { term: "spring", schoolYear: period.schoolYear, label: `Spring ${startYear + 1}` };
  }
  if (period.term === "spring") {
    return { term: "summer", schoolYear: period.schoolYear, label: `Summer ${startYear + 1}` };
  }
  return { term: "fall", schoolYear: `${startYear + 1}-${startYear + 2}`, label: `Fall ${startYear + 1}` };
}

export function courseOccursInAcademicPeriod(row: PlanCourse, period: AcademicPeriod) {
  const rowStartYear = Number(row.school_year.match(/\d{4}/)?.[0] ?? 0);
  const periodStartYear = Number(period.schoolYear.slice(0, 4));
  if (!rowStartYear || rowStartYear !== periodStartYear) return false;
  if (row.term === period.term) return true;
  return row.term === "full_year" && (period.term === "fall" || period.term === "spring");
}

export function planCourseMovePatch(
  settings: StudentSettings,
  row: PlanCourse,
  status: PlanCourse["status"],
  sortOrder: number
): Partial<PlanCourse> | null {
  if (row.source_review_item_id) return null;
  const currentGrade = Math.max(9, Math.min(12, Number(settings.grade_level ?? row.grade_level))) as GradeLevel;
  const grade = (status === "planned" ? Math.min(12, currentGrade + 1) : currentGrade) as GradeLevel;
  return {
    status,
    grade_level: grade,
    school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, grade),
    letter_grade: status === "completed" ? row.letter_grade : null,
    sort_order: sortOrder
  };
}

export function selectedPlanGrades(settings: StudentSettings) {
  const start = (settings.plan_start_grade ?? settings.grade_level ?? 9) as GradeLevel;
  const end = (settings.plan_end_grade ?? 12) as GradeLevel;
  return GRADE_LEVELS.filter((grade) => grade >= start && grade <= end);
}

export function requirementsForSettings(requirements: GraduationRequirement[], settings: StudentSettings) {
  if (settings.tracker_mode !== "selected") return requirements;
  const selected = new Set(settings.tracked_requirement_areas);
  return requirements.filter((requirement) => selected.has(requirement.area));
}

export function appliedCreditBreakdown({
  required,
  completed,
  current,
  planned,
  unverified = 0
}: {
  required: number;
  completed: number;
  current: number;
  planned: number;
  unverified?: number;
}) {
  const appliedCompleted = Math.min(required, completed);
  const appliedCurrent = Math.min(Math.max(0, required - appliedCompleted), current);
  const appliedPlanned = Math.min(Math.max(0, required - appliedCompleted - appliedCurrent), planned);
  const appliedTotal = appliedCompleted + appliedCurrent + appliedPlanned;
  return {
    completed: round(appliedCompleted, 1),
    current: round(appliedCurrent, 1),
    planned: round(appliedPlanned, 1),
    remaining: round(Math.max(0, required - appliedTotal), 1),
    total: round(appliedTotal, 1),
    unverified: round(unverified, 1)
  };
}

export function courseDisplayName(planCourse: PlanCourse, courseMap: Map<string, Course>) {
  if (planCourse.source_review_item_id && planCourse.custom_course_name) return planCourse.custom_course_name;
  return planCourse.course_id ? courseMap.get(planCourse.course_id)?.name ?? "Unavailable course" : planCourse.custom_course_name ?? "Custom course";
}

export function calculateRequirementProgress(
  requirements: GraduationRequirement[],
  planCourses: PlanCourse[],
  mappings: CourseRequirementMapping[],
  courses: Course[] = [],
  equivalencies: SmccdHighSchoolEquivalency[] = []
): RequirementProgress[] {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const equivalencyMap = new Map(equivalencies.map((equivalency) => [equivalency.normalized_course_code, equivalency]));
  const mappingsByCourse = new Map<string, CourseRequirementMapping[]>();
  for (const mapping of mappings) {
    const existing = mappingsByCourse.get(mapping.course_id) ?? [];
    existing.push(mapping);
    mappingsByCourse.set(mapping.course_id, existing);
  }

  return requirements.map((requirement) => {
    let completedCredits = 0;
    let currentCredits = 0;
    let plannedCredits = 0;
    let unverifiedCredits = 0;
    const verifiedRows: Array<{
      id: string;
      status: PlanCourse["status"];
      credits: number;
      name: string;
      equivalent: string | null;
      gradeLevel: PlanCourse["grade_level"];
      institution: "dtech" | "smccd" | "CSM" | "SKY" | "CAN";
    }> = [];
    const unverifiedRows: typeof verifiedRows = [];

    for (const planCourse of planCourses) {
      const overrideMatches = planCourse.requirement_area_override === requirement.area;
      const mapping = planCourse.course_id
        ? (mappingsByCourse.get(planCourse.course_id) ?? []).find(
            (candidate) => candidate.requirement_id === requirement.id
          )
        : null;
      if (!overrideMatches && !mapping) continue;

      const credits = resolvePlanCourseHighSchoolCredits(planCourse, equivalencies).credits;
      if ((!overrideMatches && mapping?.confidence === "uncertain") || !planCourse.mapping_verified) {
        unverifiedCredits += credits;
        unverifiedRows.push({
          id: planCourse.id,
          status: planCourse.status,
          credits,
          name: courseDisplayName(planCourse, courseMap),
          equivalent: null,
          gradeLevel: planCourse.grade_level,
          institution: institutionForPlanCourse(planCourse)
        });
        continue;
      }
      if (planCourse.status === "completed") completedCredits += credits;
      if (planCourse.status === "current") currentCredits += credits;
      if (planCourse.status === "planned") plannedCredits += credits;
      verifiedRows.push({
        id: planCourse.id,
        status: planCourse.status,
        credits,
        name: courseDisplayName(planCourse, courseMap),
        gradeLevel: planCourse.grade_level,
        institution: institutionForPlanCourse(planCourse),
        equivalent: planCourse.smccd_course_id
          ? equivalencyMap.get(planCourse.smccd_course_id.split(":").at(-1)?.toUpperCase() ?? "")?.high_school_equivalent ?? null
          : null
      });
    }

    const ruleWarnings: string[] = [];
    const appliedById = new Map<string, number>();
    const contributionNotes = new Map<string, string>();
    const unusedNotes = new Map<string, string>();
    let usesRuleAllocation = false;
    if (requirement.area === "world_language") {
      const proficiencyRows = verifiedRows.filter((row) => {
        const evidence = row.equivalent ?? row.name;
        return /\b(?:3|iii)\b/i.test(evidence) || /meets the requirement for the 2nd year/i.test(evidence);
      });
      const qualifyingStatus = (["completed", "current", "planned"] as PlanCourse["status"][])
        .find((status) => proficiencyRows.some((row) => row.status === status));
      if (qualifyingStatus) {
        usesRuleAllocation = true;
        const requiredCredits = Number(requirement.credits_required);
        const qualifyingRow = proficiencyRows.find((row) => row.status === qualifyingStatus)!;
        completedCredits = Math.min(completedCredits, requiredCredits);
        if (qualifyingStatus === "completed") {
          completedCredits = requiredCredits;
          currentCredits = 0;
          plannedCredits = 0;
          appliedById.set(qualifyingRow.id, requiredCredits);
        } else {
          allocateEvidenceByStatus(verifiedRows, "completed", completedCredits, appliedById);
          currentCredits = Math.min(currentCredits, Math.max(0, requiredCredits - completedCredits));
          if (qualifyingStatus === "current") {
            currentCredits = Math.max(0, requiredCredits - completedCredits);
            plannedCredits = 0;
            appliedById.set(qualifyingRow.id, currentCredits);
          } else {
            allocateEvidenceByStatus(verifiedRows, "current", currentCredits, appliedById);
            plannedCredits = Math.max(0, requiredCredits - completedCredits - currentCredits);
            appliedById.set(qualifyingRow.id, plannedCredits);
          }
        }
        contributionNotes.set(qualifyingRow.id, "Verified Level 3 proficiency satisfies the full sequence.");
      } else if (verifiedRows.length > 0 && completedCredits + currentCredits + plannedCredits < requirement.credits_required) {
        ruleWarnings.push(
          `A verified Level 3 language course satisfies the full sequence; otherwise ${requirement.credits_required} credits are needed.`
        );
      }
    }
    if (requirement.area === "social_science" && (!requirement.school_id || requirement.school_id === DTECH_SCHOOL_ID)) {
      usesRuleAllocation = true;
      const allocation = { completed: 0, current: 0, planned: 0 };
      const statusOrder: PlanCourse["status"][] = ["completed", "current", "planned"];
      const classify = (row: typeof verifiedRows[number]) => {
        const evidence = `${row.equivalent ?? ""} ${row.name}`.toLowerCase();
        const government = /\bgovernment\b|\bamerican politics\b/.test(evidence);
        const economics = /\beconom(?:ics|y)\b/.test(evidence);
        if (government && economics) return "government_economics";
        if (government) return "government";
        if (economics) return "economics";
        if (/\bu\.?s\.? history\b|\bunited states history\b/.test(evidence)) return "us_history";
        if (/\bworld history\b|\bwestern civilization\b/.test(evidence)) return "world_history";
        return "other";
      };
      const socialRows = verifiedRows.map((row) => ({ ...row, lane: classify(row), remaining: row.credits }));
      for (const row of socialRows.filter((candidate) => candidate.lane === "other")) {
        unusedNotes.set(row.id, "Does not replace World History, US History, or Government & Economics.");
      }
      const allocate = (candidates: typeof socialRows, limit: number) => {
        let remaining = limit;
        for (const status of statusOrder) {
          for (const row of candidates.filter((candidate) => candidate.status === status)) {
            const applied = Math.min(row.remaining, remaining);
            allocation[status] += applied;
            appliedById.set(row.id, (appliedById.get(row.id) ?? 0) + applied);
            row.remaining -= applied;
            remaining -= applied;
            if (remaining <= 0) return limit;
          }
        }
        return limit - remaining;
      };
      const worldHistoryApplied = allocate(socialRows.filter((row) => row.lane === "world_history"), 10);
      const usHistoryApplied = allocate(socialRows.filter((row) => row.lane === "us_history"), 10);
      let governmentEconomicsApplied = allocate(socialRows.filter((row) => row.lane === "government_economics"), 10);
      if (governmentEconomicsApplied < 10) {
        const governmentApplied = allocate(socialRows.filter((row) => row.lane === "government"), Math.min(5, 10 - governmentEconomicsApplied));
        governmentEconomicsApplied += governmentApplied;
        governmentEconomicsApplied += allocate(
          socialRows.filter((row) => row.lane === "economics"),
          Math.min(5, 10 - governmentEconomicsApplied)
        );
      }
      completedCredits = allocation.completed;
      currentCredits = allocation.current;
      plannedCredits = allocation.planned;
      if (worldHistoryApplied < 10) ruleWarnings.push(`${10 - worldHistoryApplied} World History credits still need coverage.`);
      if (usHistoryApplied < 10) ruleWarnings.push(`${10 - usHistoryApplied} US History credits still need coverage.`);
      if (governmentEconomicsApplied < 10) ruleWarnings.push(`${10 - governmentEconomicsApplied} Government & Economics credits still need coverage.`);
    }
    if (requirement.area === "lab_science") {
      usesRuleAllocation = true;
      const allocation = { completed: 0, current: 0, planned: 0 };
      const statusOrder: PlanCourse["status"][] = ["completed", "current", "planned"];
      const classify = (name: string) => /\bbiol(?:ogy)?\b|biological/i.test(name)
        ? "biology"
        : /\bchem(?:istry)?\b/i.test(name)
          ? "chemistry"
          : "other";
      const scienceRows = verifiedRows.map((row) => ({ ...row, lane: classify(row.name), remaining: row.credits }));
      const allocate = (candidates: typeof scienceRows, limit: number) => {
        let remaining = limit;
        for (const status of statusOrder) {
          for (const row of candidates.filter((candidate) => candidate.status === status)) {
            const applied = Math.min(row.remaining, remaining);
            allocation[status] += applied;
            appliedById.set(row.id, (appliedById.get(row.id) ?? 0) + applied);
            row.remaining -= applied;
            remaining -= applied;
            if (remaining <= 0) return limit;
          }
        }
        return limit - remaining;
      };
      const biologyApplied = allocate(scienceRows.filter((row) => row.lane === "biology"), 10);
      const chemistryApplied = allocate(scienceRows.filter((row) => row.lane === "chemistry"), 10);
      allocate(scienceRows.filter((row) => row.remaining > 0), 10);
      completedCredits = allocation.completed;
      currentCredits = allocation.current;
      plannedCredits = allocation.planned;
      if (biologyApplied < 10) ruleWarnings.push(`${10 - biologyApplied} Biology credits still need coverage.`);
      if (chemistryApplied < 10) ruleWarnings.push(`${10 - chemistryApplied} Chemistry credits still need coverage.`);
    }

    if (!usesRuleAllocation) {
      const applied = appliedCreditBreakdown({
        required: Number(requirement.credits_required),
        completed: completedCredits,
        current: currentCredits,
        planned: plannedCredits
      });
      allocateEvidenceByStatus(verifiedRows, "completed", applied.completed, appliedById);
      allocateEvidenceByStatus(verifiedRows, "current", applied.current, appliedById);
      allocateEvidenceByStatus(verifiedRows, "planned", applied.planned, appliedById);
    }

    const verifiedProjectedCredits = completedCredits + currentCredits + plannedCredits;
    const percent = clamp(Math.round((verifiedProjectedCredits / requirement.credits_required) * 100), 0, 100);
    const status =
      completedCredits >= requirement.credits_required
        ? "complete"
        : verifiedProjectedCredits >= requirement.credits_required
          ? "on_track"
          : "missing";

    return {
      requirement,
      completedCredits: round(completedCredits, 1),
      currentCredits: round(currentCredits, 1),
      plannedCredits: round(plannedCredits, 1),
      verifiedProjectedCredits: round(verifiedProjectedCredits, 1),
      unverifiedCredits: round(unverifiedCredits, 1),
      percent,
      status,
      ruleWarnings,
      contributions: verifiedRows
        .filter((row) => (appliedById.get(row.id) ?? 0) > 0)
        .map((row) => requirementEvidence(row, appliedById.get(row.id) ?? 0, contributionNotes.get(row.id) ?? null)),
      unusedCourses: verifiedRows
        .filter((row) => row.credits - Math.min(row.credits, appliedById.get(row.id) ?? 0) > 0)
        .map((row) => requirementEvidence(
          row,
          Math.min(row.credits, appliedById.get(row.id) ?? 0),
          unusedNotes.get(row.id) ?? "Verified credit is not applied because this requirement is already covered."
        )),
      unverifiedCourses: unverifiedRows.map((row) => requirementEvidence(
        row,
        0,
        "Excluded because the requirement mapping is not verified."
      ))
    };
  });
}

function institutionForPlanCourse(planCourse: PlanCourse): "dtech" | "smccd" | "CSM" | "SKY" | "CAN" {
  const college = planCourse.smccd_course_id?.split(":", 1)[0];
  return college === "CSM" || college === "SKY" || college === "CAN" ? college : planCourse.smccd_course_id ? "smccd" : "dtech";
}

function allocateEvidenceByStatus(
  rows: Array<{ id: string; status: PlanCourse["status"]; credits: number }>,
  status: PlanCourse["status"],
  target: number,
  appliedById: Map<string, number>
) {
  let remaining = target;
  for (const row of rows.filter((candidate) => candidate.status === status)) {
    const alreadyApplied = appliedById.get(row.id) ?? 0;
    const available = Math.max(0, row.credits - Math.min(row.credits, alreadyApplied));
    const applied = Math.min(available, remaining);
    if (applied > 0) appliedById.set(row.id, alreadyApplied + applied);
    remaining -= applied;
    if (remaining <= 0) break;
  }
}

function requirementEvidence(
  row: {
    id: string;
    status: PlanCourse["status"];
    credits: number;
    name: string;
    gradeLevel: PlanCourse["grade_level"];
    institution: "dtech" | "smccd" | "CSM" | "SKY" | "CAN";
  },
  creditsApplied: number,
  note: string | null
) {
  return {
    planCourseId: row.id,
    courseName: row.name,
    status: row.status,
    creditsApplied: round(creditsApplied, 1),
    creditsAvailable: round(row.credits, 1),
    gradeLevel: row.gradeLevel,
    institution: row.institution,
    note
  };
}

function gpaForRows(rows: PlanCourse[], includePlanned: boolean, equivalencies: readonly SmccdHighSchoolEquivalency[]) {
  let unweightedPoints = 0;
  let weightedPoints = 0;
  let credits = 0;
  let weightedCredits = 0;
  let passCredits = 0;

  for (const row of rows) {
    if (!includePlanned && row.status === "planned") continue;
    const grade = row.letter_grade?.toUpperCase() ?? "";
    const rowCredits = resolvePlanCourseHighSchoolCredits(row, equivalencies).credits;
    if (grade === "P" && rowCredits > 0) {
      passCredits += rowCredits;
      continue;
    }
    const points = dtechGradePoint(grade);
    if (points === null) continue;
    if (rowCredits <= 0) continue;
    const isWeighted = row.is_weighted || Boolean(row.smccd_course_id) || Number(row.college_units ?? 0) > 0;
    credits += rowCredits;
    if (isWeighted) weightedCredits += rowCredits;
    unweightedPoints += points * rowCredits;
    weightedPoints += Math.min(5, points + (isWeighted ? 1 : 0)) * rowCredits;
  }

  return {
    credits,
    weightedCredits,
    passCredits,
    unweighted: credits > 0 ? round(unweightedPoints / credits) : null,
    weighted: credits > 0 ? round(weightedPoints / credits) : null
  };
}

export function calculateGpa(rows: PlanCourse[], equivalencies: readonly SmccdHighSchoolEquivalency[] = []): GpaSummary {
  const current = gpaForRows(rows, false, equivalencies);
  const projected = gpaForRows(rows, true, equivalencies);
  return {
    currentUnweighted: current.unweighted,
    currentWeighted: current.weighted,
    currentGradedCredits: current.credits,
    currentWeightedCredits: current.weightedCredits,
    projectedUnweighted: projected.unweighted,
    projectedWeighted: projected.weighted,
    gradedCredits: projected.credits,
    weightedCredits: projected.weightedCredits,
    passCredits: projected.passCredits,
    isEstimate: true
  };
}

const FLOW_BY_GRADE: Record<GradeLevel, string[]> = {
  9: ["English 1", "Ethnic Studies", "Algebra 1", "Environmental Science", "Foundation in Design Thinking", "Spanish 1", "Introduction to Prototyping and Fabrication"],
  10: ["English 2", "World History", "Geometry", "Chemistry", "Co-designers", "Spanish 2", "Introduction to Visual Art"],
  11: ["English 3", "US History", "Algebra 2", "Biology", "Spanish 3"],
  12: ["English 4", "Government & Economics", "Precalculus"]
};

export interface GeneratedPlanCourse {
  course_id: string;
  grade_level: GradeLevel;
  school_year: string;
  term: PlanCourse["term"];
  status: "current" | "planned";
  credits: number | null;
  college_units: number | null;
  college_provider_code: string | null;
  is_weighted: boolean;
  mapping_verified: boolean;
  user_edited: false;
}

export interface SuggestedPlanContext {
  schoolSlug: string;
  requirements?: readonly GraduationRequirement[];
  mappings?: readonly CourseRequirementMapping[];
  startGrade?: GradeLevel;
  rigor?: "balanced" | "advanced" | "lighter";
  maxCoursesPerTerm?: number | null;
  startingMathCourse?: string | null;
  includeCollegeCourses?: boolean;
  interests?: readonly string[];
}

function normalizedPlannerText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function plannerCourseMatches(candidate: Course, requested: string) {
  const course = normalizedPlannerText(`${candidate.course_code ?? ""} ${candidate.name}`);
  const query = normalizedPlannerText(requested);
  return Boolean(query && (course.includes(query) || query.includes(normalizedPlannerText(candidate.name))));
}

export function generateSuggestedPlan(
  settings: StudentSettings,
  courses: Course[],
  existing: PlanCourse[],
  enrollmentPolicy?: EnrollmentPolicy | null,
  respectRecommendedLimit = true,
  context: SuggestedPlanContext = { schoolSlug: "design-tech-high-school" }
): GeneratedPlanCourse[] {
  const graduationYear = settings.graduation_year ?? new Date().getFullYear() + 3;
  const currentGrade = (settings.grade_level ?? 9) as GradeLevel;
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const existingIds = new Set(existing.map((row) => row.course_id).filter(Boolean));
  const existingNameKeys = new Set<string>();
  for (const row of existing) {
    const catalogName = row.course_id ? courseMap.get(row.course_id)?.name : null;
    for (const name of [catalogName, row.custom_course_name]) {
      if (!name) continue;
      for (const key of courseEquivalenceKeys(name)) existingNameKeys.add(key);
    }
  }
  const generated: GeneratedPlanCourse[] = [];
  const collegeUnitsByTerm = new Map<string, number>();
  const semesterCourseCountByGrade = new Map<GradeLevel, number>();
  for (const row of existing) {
    if (row.status === "completed" || Number(row.college_units ?? 0) <= 0) continue;
    const provider = row.college_provider_code ?? (row.smccd_course_id ? "SMCCD" : null);
    if (enrollmentPolicy && provider !== enrollmentPolicy.provider_code) continue;
    const terms = row.term === "full_year" ? ["fall", "spring"] : [row.term];
    for (const term of terms) {
      const key = `${row.school_year}:${term}`;
      collegeUnitsByTerm.set(key, (collegeUnitsByTerm.get(key) ?? 0) + Number(row.college_units));
    }
  }

  const planningStartGrade = (context.startGrade ?? Math.max(currentGrade, settings.plan_start_grade ?? currentGrade)) as GradeLevel;
  const planningGrades = selectedPlanGrades(settings).filter((grade) => grade >= planningStartGrade);
  const isDtech = context.schoolSlug === "design-tech-high-school";
  const includeCollegeCourses = context.includeCollegeCourses !== false;
  const maximumPerTerm = context.maxCoursesPerTerm ?? null;
  const termLoad = (grade: GradeLevel, term: "fall" | "spring" | "summer") => existing.filter((row) => row.grade_level === grade && (row.term === term || (term !== "summer" && row.term === "full_year"))).length
    + generated.filter((row) => row.grade_level === grade && (row.term === term || (term !== "summer" && row.term === "full_year"))).length;

  function addCourse(course: Course, grade: GradeLevel, preferredTerm?: PlanCourse["term"]) {
    if (generated.length >= 40) return false;
    if (existingIds.has(course.id)) return false;
    if (!includeCollegeCourses && Number(course.college_units ?? 0) > 0) return false;
    if (!isDtech && course.grade_levels.length === 0) return false;
    if (course.grade_levels.length > 0 && !course.grade_levels.includes(grade)) return false;
    const equivalenceKeys = courseEquivalenceKeys(course.name);
    if ([...equivalenceKeys].some((key) => existingNameKeys.has(key))) return false;
    const schoolYear = schoolYearForGrade(graduationYear, grade);
    const term: PlanCourse["term"] = preferredTerm ?? (course.term_type === "year"
      ? "full_year"
      : termLoad(grade, "fall") <= termLoad(grade, "spring") ? "fall" : "spring");
    const plannedTerms = term === "full_year" ? ["fall", "spring"] as const : [term] as const;
    if (maximumPerTerm && plannedTerms.some((plannedTerm) => termLoad(grade, plannedTerm) >= maximumPerTerm)) return false;
    const collegeUnits = Number(course.college_units ?? 0);
    if (enrollmentPolicy && collegeUnits > 0) {
      const scheduleLimit = respectRecommendedLimit
        ? Number(enrollmentPolicy.recommended_max_units)
        : Number(enrollmentPolicy.absolute_max_units);
      if (plannedTerms.some((plannedTerm) => (collegeUnitsByTerm.get(`${schoolYear}:${plannedTerm}`) ?? 0) + collegeUnits > scheduleLimit)) return false;
    }
    generated.push({
      course_id: course.id,
      grade_level: grade,
      school_year: schoolYear,
      term,
      status: grade === currentGrade ? "current" : "planned",
      credits: course.credits,
      college_units: course.college_units,
      college_provider_code: collegeUnits > 0 ? enrollmentPolicy?.provider_code ?? "SMCCD" : null,
      is_weighted: course.is_weighted,
      mapping_verified: course.confidence === "verified",
      user_edited: false
    });
    existingIds.add(course.id);
    for (const key of equivalenceKeys) existingNameKeys.add(key);
    if (collegeUnits > 0) {
      for (const plannedTerm of plannedTerms) {
        const key = `${schoolYear}:${plannedTerm}`;
        collegeUnitsByTerm.set(key, (collegeUnitsByTerm.get(key) ?? 0) + collegeUnits);
      }
    }
    return true;
  }

  if (context.startingMathCourse) {
    const requested = context.startingMathCourse;
    const explicitMath = courses
      .filter((course) => normalizedPlannerText(course.subject).includes("math") && plannerCourseMatches(course, requested))
      .sort((left, right) => Number(right.is_weighted) - Number(left.is_weighted) || left.name.localeCompare(right.name))[0];
    if (explicitMath) addCourse(explicitMath, planningStartGrade);
  }

  if (isDtech) for (const grade of planningGrades) {
    for (const courseName of FLOW_BY_GRADE[grade]) {
      const candidates = courses.filter((candidate) => candidate.name.toLowerCase().startsWith(courseName.toLowerCase()));
      const course = candidates[0];
      if (!course) continue;
      const semesterIndex = semesterCourseCountByGrade.get(grade) ?? 0;
      const term: PlanCourse["term"] = course.term_type === "semester"
        ? semesterIndex % 2 === 0 ? "fall" : "spring"
        : "full_year";
      if (addCourse(course, grade, term) && course.term_type === "semester") semesterCourseCountByGrade.set(grade, semesterIndex + 1);
    }
  }

  if (!isDtech && context.requirements?.length && context.mappings?.length) {
    const verifiedRequirements = context.requirements.filter((requirement) => requirement.confidence === "verified" && requirement.review_status === "approved");
    const verifiedMappings = context.mappings.filter((mapping) => mapping.confidence === "verified");
    const interestText = normalizedPlannerText((context.interests ?? []).join(" "));
    const courseById = new Map(courses.map((course) => [course.id, course]));
    const initialProgress = calculateRequirementProgress(verifiedRequirements, existing, verifiedMappings, courses);
    const neededCredits = new Map(initialProgress.map((item) => [item.requirement.id, Math.max(0, item.requirement.credits_required - item.verifiedProjectedCredits)]));
    for (const row of generated) {
      for (const mapping of verifiedMappings.filter((candidate) => candidate.course_id === row.course_id)) {
        neededCredits.set(mapping.requirement_id, Math.max(0, (neededCredits.get(mapping.requirement_id) ?? 0) - Number(row.credits ?? 0)));
      }
    }
    for (const requirement of verifiedRequirements) {
      let remaining = neededCredits.get(requirement.id) ?? 0;
      if (remaining <= 0 || requirement.constraint_only) continue;
      const mapped = verifiedMappings
        .filter((mapping) => mapping.requirement_id === requirement.id)
        .map((mapping) => courseById.get(mapping.course_id))
        .filter((course): course is Course => Boolean(course))
        .filter((course) => course.grade_levels.length > 0)
        .filter((course) => includeCollegeCourses || Number(course.college_units ?? 0) === 0)
        .sort((left, right) => {
          const leftInterest = interestText && normalizedPlannerText(`${left.name} ${left.subject} ${left.description ?? ""}`).split(" ").some((token) => token.length > 3 && interestText.includes(token)) ? 1 : 0;
          const rightInterest = interestText && normalizedPlannerText(`${right.name} ${right.subject} ${right.description ?? ""}`).split(" ").some((token) => token.length > 3 && interestText.includes(token)) ? 1 : 0;
          const rigorDelta = context.rigor === "advanced" ? Number(right.is_weighted) - Number(left.is_weighted) : context.rigor === "lighter" ? Number(left.is_weighted) - Number(right.is_weighted) : 0;
          return rightInterest - leftInterest || rigorDelta || left.name.localeCompare(right.name);
        });
      while (remaining > 0) {
        let added = false;
        const placements = mapped.flatMap((course) => planningGrades
          .filter((grade) => !existingIds.has(course.id) && (course.grade_levels.length === 0 || course.grade_levels.includes(grade)))
          .map((grade) => ({
            course,
            grade,
            load: termLoad(grade, "fall") + termLoad(grade, "spring")
          })))
          .sort((left, right) => left.load - right.load || left.grade - right.grade || left.course.name.localeCompare(right.course.name));
        for (const { course: candidate, grade } of placements) {
          if (!addCourse(candidate, grade)) continue;
          remaining -= Math.max(0, Number(candidate.credits ?? 0));
          added = true;
          break;
        }
        if (!added) break;
      }
    }
  }

  return generated;
}

export function overallGraduationPercent(progress: RequirementProgress[]) {
  const substantive = progress.filter((item) => !item.requirement.constraint_only);
  const required = substantive.reduce((total, item) => total + item.requirement.credits_required, 0);
  const projected = substantive.reduce((total, item) => total + Math.min(item.verifiedProjectedCredits, item.requirement.credits_required), 0);
  const base = required > 0 ? clamp(Math.round((projected / required) * 100), 0, 100) : 0;
  const hasOpenConstraint = progress.some((item) => item.requirement.constraint_only && item.verifiedProjectedCredits < item.requirement.credits_required);
  return hasOpenConstraint && base === 100 ? 99 : base;
}

export function overallCompletedPercent(progress: RequirementProgress[]) {
  const substantive = progress.filter((item) => !item.requirement.constraint_only);
  const required = substantive.reduce((total, item) => total + item.requirement.credits_required, 0);
  const completed = substantive.reduce((total, item) => total + Math.min(item.completedCredits, item.requirement.credits_required), 0);
  const base = required > 0 ? clamp(Math.round((completed / required) * 100), 0, 100) : 0;
  const hasOpenConstraint = progress.some((item) => item.requirement.constraint_only && item.completedCredits < item.requirement.credits_required);
  return hasOpenConstraint && base === 100 ? 99 : base;
}
