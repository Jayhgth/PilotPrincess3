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
  StudentSettings,
  TimelineTask
} from "@/lib/models";
import { courseEquivalenceKeys } from "@/lib/course-names";

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
  personal_development: "Personal Development"
} as const;

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

      const credits = Number(planCourse.credits ?? 0);
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
          "Verified credit is not applied because this requirement is already covered."
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

function gpaForRows(rows: PlanCourse[], includePlanned: boolean) {
  let unweightedPoints = 0;
  let weightedPoints = 0;
  let credits = 0;
  let weightedCredits = 0;
  let passCredits = 0;

  for (const row of rows) {
    if (!includePlanned && row.status === "planned") continue;
    const grade = row.letter_grade?.toUpperCase() ?? "";
    const rowCredits = Number(row.credits ?? 0);
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

export function calculateGpa(rows: PlanCourse[]): GpaSummary {
  const current = gpaForRows(rows, false);
  const projected = gpaForRows(rows, true);
  return {
    currentUnweighted: current.unweighted,
    currentWeighted: current.weighted,
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
  12: ["English 4", "Government", "Economics", "Precalculus"]
};

export interface GeneratedPlanCourse {
  course_id: string;
  grade_level: GradeLevel;
  school_year: string;
  status: "current" | "planned";
  credits: number | null;
  college_units: number | null;
  college_provider_code: string | null;
  is_weighted: boolean;
  mapping_verified: boolean;
  user_edited: false;
}

export function generateSuggestedPlan(
  settings: StudentSettings,
  courses: Course[],
  existing: PlanCourse[],
  enrollmentPolicy?: EnrollmentPolicy | null
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

  for (const grade of selectedPlanGrades(settings)) {
    if (grade < currentGrade) continue;
    for (const courseName of FLOW_BY_GRADE[grade]) {
      const candidates = courses.filter((candidate) => candidate.name.toLowerCase().startsWith(courseName.toLowerCase()));
      const course = candidates[0];
      if (!course || existingIds.has(course.id)) continue;
      const equivalenceKeys = courseEquivalenceKeys(course.name);
      if ([...equivalenceKeys].some((key) => existingNameKeys.has(key))) continue;
      const schoolYear = schoolYearForGrade(graduationYear, grade);
      const collegeUnits = Number(course.college_units ?? 0);
      if (enrollmentPolicy && collegeUnits > 0) {
        const wouldExceed = ["fall", "spring"].some((term) =>
          (collegeUnitsByTerm.get(`${schoolYear}:${term}`) ?? 0) + collegeUnits > Number(enrollmentPolicy.recommended_max_units)
        );
        if (wouldExceed) continue;
      }
      generated.push({
        course_id: course.id,
        grade_level: grade,
        school_year: schoolYear,
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
        for (const term of ["fall", "spring"]) {
          const key = `${schoolYear}:${term}`;
          collegeUnitsByTerm.set(key, (collegeUnitsByTerm.get(key) ?? 0) + collegeUnits);
        }
      }
    }
  }

  return generated;
}

export interface GeneratedTimelineTask {
  title: string;
  category: "academics" | "activities" | "college" | "summer" | "admin";
  due_label: string;
  explanation: string;
}

export function generateTimeline(settings: StudentSettings, progress: RequirementProgress[]): GeneratedTimelineTask[] {
  const grade = (settings.grade_level ?? 9) as GradeLevel;
  const tasks: GeneratedTimelineTask[] = [];
  const missing = progress.filter((item) => item.status === "missing").slice(0, 3);

  for (const item of missing) {
    tasks.push({
      title: `Choose a course for ${item.requirement.name}`,
      category: "academics",
      due_label: "Before next course registration",
      explanation: `${item.requirement.name} is projected at ${item.verifiedProjectedCredits} of ${item.requirement.credits_required} verified credits.`
    });
  }

  if (grade === 11) {
    tasks.push({
      title: "Review senior-year rigor with a counselor",
      category: "college",
      due_label: "Before senior registration",
      explanation: "Confirm prerequisites, graduation coverage, and whether concurrent enrollment fits the district unit threshold."
    });
  }
  if (grade === 12) {
    tasks.push({
      title: "Verify final graduation requirement status",
      category: "admin",
      due_label: "Before graduation clearance",
      explanation: "Use the app as a planning aid, then confirm official transcript and requirement status with d.tech."
    });
  }

  tasks.push({
    title: "Plan one restorative summer goal",
    category: "summer",
    due_label: "Before summer",
    explanation: "Balance academic plans with rest, responsibilities, and activities."
  });
  return tasks;
}

export interface GeneratedTimelineTaskUpdate {
  id: string;
  patch: Pick<TimelineTask, "category" | "due_label" | "explanation">;
}

export function reconcileGeneratedTimelineTasks(
  savedTasks: TimelineTask[],
  desiredGeneratedTasks: GeneratedTimelineTask[]
) {
  const desiredByTitle = new Map(desiredGeneratedTasks.map((task) => [task.title, task]));
  const manualTitles = new Set(savedTasks.filter((task) => !task.is_generated).map((task) => task.title));
  const retainedGeneratedTitles = new Set<string>();
  const obsoleteIds: string[] = [];
  const updateTasks: GeneratedTimelineTaskUpdate[] = [];

  for (const task of savedTasks) {
    if (!task.is_generated) continue;
    const desired = desiredByTitle.get(task.title);
    if (!desired || manualTitles.has(task.title) || retainedGeneratedTitles.has(task.title)) {
      obsoleteIds.push(task.id);
      continue;
    }
    retainedGeneratedTitles.add(task.title);
    if (
      task.category !== desired.category
      || task.due_label !== desired.due_label
      || task.explanation !== desired.explanation
    ) {
      updateTasks.push({
        id: task.id,
        patch: {
          category: desired.category,
          due_label: desired.due_label,
          explanation: desired.explanation
        }
      });
    }
  }

  const obsolete = new Set(obsoleteIds);
  const visibleTasks = savedTasks.filter((task) => !obsolete.has(task.id));
  const existingTitles = new Set(visibleTasks.map((task) => task.title));
  const insertTasks = desiredGeneratedTasks.filter((task) => !existingTitles.has(task.title));

  return { visibleTasks, obsoleteIds, updateTasks, insertTasks };
}

export function overallGraduationPercent(progress: RequirementProgress[]) {
  const required = progress.reduce((total, item) => total + item.requirement.credits_required, 0);
  const projected = progress.reduce((total, item) => total + Math.min(item.verifiedProjectedCredits, item.requirement.credits_required), 0);
  return required > 0 ? clamp(Math.round((projected / required) * 100), 0, 100) : 0;
}

export function overallCompletedPercent(progress: RequirementProgress[]) {
  const required = progress.reduce((total, item) => total + item.requirement.credits_required, 0);
  const completed = progress.reduce((total, item) => total + Math.min(item.completedCredits, item.requirement.credits_required), 0);
  return required > 0 ? clamp(Math.round((completed / required) * 100), 0, 100) : 0;
}
