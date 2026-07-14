import { courseEquivalenceKeys } from "@/lib/course-names";
import { normalizeCollegeCourseCode, resolvePlanCollegeCourseCode } from "@/lib/college-course-identity";
import { normalizeCourseKey } from "@/lib/prerequisites/normalize";
import type { Course, GradeLevel, PlanCourse, SmccdCourse } from "@/lib/models";

type CatalogExclusionReason = "already_in_plan" | "outside_grade" | "below_math_level";

export interface CatalogEligibility {
  eligible: boolean;
  reason?: CatalogExclusionReason;
}

const DTECH_MATH_SEQUENCE: ReadonlyArray<{ rank: number; names: readonly string[] }> = [
  { rank: 1, names: ["Algebra 1", "Algebra I"] },
  { rank: 2, names: ["Geometry", "Geometry / Geometry Honors"] },
  {
    rank: 3,
    names: [
      "Algebra 2",
      "Algebra II",
      "Algebra 2 / Algebra 2-Trigonometry Honors",
      "Algebra 2 / Trigonometry Honors"
    ]
  },
  { rank: 4, names: ["Algebra 2 + Pre-Calculus Honors", "Precalculus", "Precalculus Honors"] },
  { rank: 5, names: ["Calculus", "Calculus / Calculus Honors"] }
];

const DTECH_MATH_RANKS = new Map(
  DTECH_MATH_SEQUENCE.flatMap(({ rank, names }) => names.flatMap((name) =>
    [...courseEquivalenceKeys(name)].map((key) => [key, rank] as const)
  ))
);

function dtechCourseKeys(course: Course): Set<string> {
  return courseEquivalenceKeys(course.name);
}

function planDtechKeys(row: PlanCourse, courseById: ReadonlyMap<string, Course>): Set<string> {
  const catalogName = row.course_id ? courseById.get(row.course_id)?.name : null;
  return courseEquivalenceKeys(catalogName ?? row.custom_course_name ?? "");
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].some((value) => right.has(value));
}

export function dtechMathRank(name: string): number | null {
  const ranks = [...courseEquivalenceKeys(name)]
    .map((key) => DTECH_MATH_RANKS.get(key))
    .filter((rank): rank is number => rank !== undefined);
  return ranks.length ? Math.max(...ranks) : null;
}

export function highestDemonstratedDtechMathRank(
  planCourses: readonly PlanCourse[],
  dtechCourses: readonly Course[]
): number {
  const courseById = new Map(dtechCourses.map((course) => [course.id, course]));
  return planCourses
    .filter((row) => row.status === "completed" || row.status === "current")
    .map((row) => {
      const course = row.course_id ? courseById.get(row.course_id) : null;
      return dtechMathRank(course?.name ?? row.custom_course_name ?? "") ?? 0;
    })
    .reduce((highest, rank) => Math.max(highest, rank), 0);
}

export function dtechCatalogEligibility(
  course: Course,
  targetGrade: GradeLevel,
  planCourses: readonly PlanCourse[],
  dtechCourses: readonly Course[]
): CatalogEligibility {
  const courseById = new Map(dtechCourses.map((candidate) => [candidate.id, candidate]));
  const candidateKeys = dtechCourseKeys(course);
  const alreadyInPlan = planCourses.some((row) =>
    row.course_id === course.id || intersects(candidateKeys, planDtechKeys(row, courseById))
  );
  if (alreadyInPlan) return { eligible: false, reason: "already_in_plan" };
  if (course.grade_levels.length > 0 && !course.grade_levels.includes(targetGrade)) return { eligible: false, reason: "outside_grade" };

  const candidateMathRank = course.subject === "Mathematics" ? dtechMathRank(course.name) : null;
  const demonstratedMathRank = highestDemonstratedDtechMathRank(planCourses, dtechCourses);
  if (candidateMathRank !== null && candidateMathRank <= demonstratedMathRank) {
    return { eligible: false, reason: "below_math_level" };
  }
  return { eligible: true };
}

export interface SmccdPlanCourseIndex {
  courseIds: ReadonlySet<string>;
  normalizedCourseCodes: ReadonlySet<string>;
}

export function createSmccdPlanCourseIndex(
  planCourses: readonly PlanCourse[],
  smccdCourses: readonly SmccdCourse[]
): SmccdPlanCourseIndex {
  const smccdById = new Map(smccdCourses.map((course) => [course.id, course]));
  const courseIds = new Set<string>();
  const normalizedCourseCodes = new Set<string>();

  for (const row of planCourses) {
    if (row.smccd_course_id) courseIds.add(row.smccd_course_id);
    const code = resolvePlanCollegeCourseCode(row, smccdById);
    if (code) normalizedCourseCodes.add(code);
  }

  return { courseIds, normalizedCourseCodes };
}

export function smccdCourseAlreadyInPlanIndex(
  course: SmccdCourse,
  index: SmccdPlanCourseIndex
): boolean {
  if (index.courseIds.has(course.id)) return true;
  const candidateCode = normalizeCollegeCourseCode(course.course_code) ?? normalizeCourseKey(course.course_code);
  return Boolean(candidateCode && index.normalizedCourseCodes.has(candidateCode));
}

export function smccdCourseAlreadyInPlan(
  course: SmccdCourse,
  planCourses: readonly PlanCourse[],
  smccdCourses: readonly SmccdCourse[]
): boolean {
  return smccdCourseAlreadyInPlanIndex(course, createSmccdPlanCourseIndex(planCourses, smccdCourses));
}
