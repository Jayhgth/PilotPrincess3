import type {
  Course,
  CourseRequirementMapping,
  GraduationRequirement,
  PlanCourse,
  PlanVersion,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGeCompletion,
  StudentSmccdGoal
} from "@/lib/models";
import { calculateGpa, calculateRequirementProgress, overallGraduationPercent } from "@/lib/planning";
import {
  calculateSmccdLocalDegreeProgress,
  calculateSmccdProgramProgressWithContext,
  createSmccdProgramProgressContext,
  smccdDegreeOverallPercent
} from "@/lib/smccd";

export interface PlanVersionSummary extends PlanVersion {
  course_count: number;
  updated_at: string;
  archived_at: string | null;
}

export interface PlanVersionMetrics {
  courseCount: number;
  diplomaPercent: number;
  projectedWeightedGpa: number | null;
  majorFitPercent: number | null;
  peakCollegeUnits: number;
  degreeProgress: Array<{ programId: string; label: string; percent: number }>;
}

export type PlanStrategy = "balanced" | "highest_gpa" | "degree_overlap" | "minimum_courses";

export const PLAN_STRATEGY_LABELS: Record<PlanStrategy, string> = {
  balanced: "Balanced",
  highest_gpa: "Highest GPA",
  degree_overlap: "Degree overlap",
  minimum_courses: "Minimum courses"
};

export interface PlanVersionDifference {
  sourceCourseId: string;
  label: string;
  placement: string;
  kind: "added" | "removed" | "moved";
  previousPlacement?: string;
}

export function planVersionRole(version: Pick<PlanVersion, "generation_config">) {
  return version.generation_config?.role === "backup" ? "backup" : "plan";
}

export function planVersionStrategy(version: Pick<PlanVersion, "generation_config">): PlanStrategy {
  const value = version.generation_config?.strategy;
  return value === "highest_gpa" || value === "degree_overlap" || value === "minimum_courses" ? value : "balanced";
}

function rowIdentity(row: PlanCourse) {
  if (row.smccd_course_id) return `college:${row.smccd_course_id}`;
  if (row.course_id) return `school:${row.course_id}`;
  const title = row.custom_course_name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
  return `custom:${title || row.id}`;
}

function rowLabel(row: PlanCourse, courses: Map<string, Course>, collegeCourses: Map<string, SmccdCourse>) {
  if (row.smccd_course_id) {
    const college = collegeCourses.get(row.smccd_course_id);
    if (college) return `${college.course_code} ${college.title}`;
  }
  if (row.course_id) return courses.get(row.course_id)?.name ?? row.custom_course_name ?? "Course";
  return row.custom_course_name ?? "Course";
}

function placement(row: PlanCourse) {
  const term = row.term === "full_year" ? "full year" : row.term;
  return `Grade ${row.grade_level}, ${term}`;
}

export function planVersionDifferences(input: {
  baseRows: PlanCourse[];
  targetRows: PlanCourse[];
  courses: Course[];
  collegeCourses: SmccdCourse[];
}): PlanVersionDifference[] {
  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const college = new Map(input.collegeCourses.map((course) => [course.id, course]));
  const base = new Map(input.baseRows.map((row) => [rowIdentity(row), row]));
  const target = new Map(input.targetRows.map((row) => [rowIdentity(row), row]));
  const differences: PlanVersionDifference[] = [];
  for (const [identity, row] of target) {
    const previous = base.get(identity);
    if (!previous) {
      differences.push({ sourceCourseId: row.id, label: rowLabel(row, courses, college), placement: placement(row), kind: "added" });
    } else if (previous.grade_level !== row.grade_level || previous.term !== row.term || previous.status !== row.status) {
      differences.push({ sourceCourseId: row.id, label: rowLabel(row, courses, college), placement: placement(row), previousPlacement: placement(previous), kind: "moved" });
    }
  }
  for (const [identity, row] of base) {
    if (!target.has(identity)) differences.push({ sourceCourseId: row.id, label: rowLabel(row, courses, college), placement: placement(row), kind: "removed" });
  }
  return differences;
}

export function planVersionDisplayLabel(version: Pick<PlanVersion, "kind" | "label">) {
  return version.kind === "active" && ["", "active plan", "current plan"].includes(version.label.trim().toLowerCase())
    ? "New plan"
    : version.label;
}

export function planVersionMetrics(input: {
  rows: PlanCourse[];
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  collegeCourses: SmccdCourse[];
  goals: StudentSmccdGoal[];
  programs: SmccdProgram[];
  degreeRequirements: SmccdProgramRequirement[];
  degreeRequirementCourses: SmccdRequirementCourse[];
  manualCompletions: Array<Pick<StudentSmccdGeCompletion, "college_code" | "area">>;
}): PlanVersionMetrics {
  const progress = calculateRequirementProgress(
    input.requirements,
    input.rows,
    input.mappings,
    input.courses,
    input.equivalencies
  );
  const gpa = calculateGpa(input.rows, input.equivalencies);
  const programById = new Map(input.programs.map((program) => [program.id, program]));
  const degreeContext = createSmccdProgramProgressContext(
    input.degreeRequirements,
    input.degreeRequirementCourses,
    input.rows,
    input.collegeCourses
  );
  const degreeProgress = input.goals.flatMap((goal) => {
    const program = programById.get(goal.program_id);
    if (!program) return [];
    const majorProgress = calculateSmccdProgramProgressWithContext(program, degreeContext);
    const localProgress = calculateSmccdLocalDegreeProgress(
      degreeContext,
      program.college_code,
      new Set(input.manualCompletions
        .filter((completion) => completion.college_code === program.college_code || completion.area === "information_literacy")
        .map((completion) => completion.area))
    );
    return [{ programId: program.id, label: `${program.title} (${program.college_code})`, percent: smccdDegreeOverallPercent(majorProgress, localProgress) }];
  });
  const collegeUnitsByTerm = new Map<string, number>();
  for (const row of input.rows) {
    const units = Number(row.college_units ?? 0);
    if (units <= 0) continue;
    const occupiedTerms = row.term === "full_year" ? ["fall", "spring"] : [row.term];
    for (const term of occupiedTerms) {
      const key = `${row.school_year}:${term}`;
      collegeUnitsByTerm.set(key, (collegeUnitsByTerm.get(key) ?? 0) + units);
    }
  }
  return {
    courseCount: input.rows.length,
    diplomaPercent: overallGraduationPercent(progress),
    projectedWeightedGpa: gpa.projectedWeighted,
    majorFitPercent: degreeProgress.length
      ? Math.round(degreeProgress.reduce((sum, progress) => sum + progress.percent, 0) / degreeProgress.length)
      : null,
    peakCollegeUnits: Math.max(0, ...collegeUnitsByTerm.values()),
    degreeProgress
  };
}
