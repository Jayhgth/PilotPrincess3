import { buildDtechPrerequisiteEquivalencies } from "./smccd";
import { resolvePlanCollegeCourseCode } from "@/lib/college-course-identity";
import { evaluateParsedPrerequisites } from "./evaluator";
import { parsePrerequisites } from "./parser";
import { parseSmccdCoursePrerequisites } from "./smccd";
import type {
  CatalogCourse,
  PlannedCourseInput,
  PrerequisiteEvaluationResult,
  PrerequisiteEquivalencyInput
} from "./types";
import type { Course, GradeLevel, PlanCourse, SmccdCourse, SmccdHighSchoolEquivalency } from "@/lib/models";
import type { SmccdPrerequisiteCourseInput } from "./smccd";

export const DTECH_PREREQUISITE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Algebra 1": ["Algebra I"],
  "English 2 / English 2 Honors": ["English 2"],
  "English 3 / English 3 Honors": ["English 3"],
  "English 4 / English 4 Honors": ["English 4"],
  "Geometry / Geometry Honors": ["Geometry"],
  "Algebra 2 / Algebra 2-Trigonometry Honors": ["Algebra 2", "Algebra II", "Algebra 2 / Trigonometry Honors"],
  "Precalculus": ["Pre-Calculus"],
  "Precalculus Honors": ["Precalculus", "Pre-Calculus", "Pre-Calculus Honors"],
  "Calculus / Calculus Honors": ["Calculus"]
};

export type PlannerTerm = PlanCourse["term"];

export interface PlannerPrerequisiteTarget {
  gradeLevel: GradeLevel;
  term: PlannerTerm;
  instanceId?: string;
}

export interface PlannerPrerequisiteEvaluation {
  result: PrerequisiteEvaluationResult;
  originalTexts: string[];
}

export function plannerTargetTermIndex(gradeLevel: GradeLevel, term: PlannerTerm): number {
  const offset = term === "spring" ? 1 : term === "summer" ? 2 : 0;
  return (gradeLevel - 9) * 3 + offset;
}

function plannedTermIndex(course: PlanCourse): number | undefined {
  if (course.term === "full_year") {
    return course.status === "completed"
      ? undefined
      : plannerTargetTermIndex(course.grade_level, "fall");
  }
  return plannerTargetTermIndex(course.grade_level, course.term);
}

export function dtechPrerequisiteCatalog(courses: readonly Course[]): CatalogCourse[] {
  return courses.map((course) => ({
    id: course.id,
    code: course.course_code,
    name: course.name,
    ...(DTECH_PREREQUISITE_ALIASES[course.name]
      ? { aliases: DTECH_PREREQUISITE_ALIASES[course.name] }
      : {}),
    gradeLevels: course.grade_levels.filter((grade): grade is GradeLevel => grade >= 9 && grade <= 12),
    prerequisites: course.prerequisites,
    ...(course.source_id ? { sourceId: course.source_id } : {}),
    sourceLabel: "Official d.tech course catalog",
    confidence: course.confidence
  }));
}

export function smccdPrerequisiteCourse(course: SmccdCourse): SmccdPrerequisiteCourseInput {
  return {
    id: course.id,
    collegeCode: course.college_code,
    courseCode: course.course_code,
    title: course.title,
    prerequisites: course.prerequisites ?? [],
    corequisites: course.corequisites ?? [],
    recommendedPreparation: course.recommended_preparation ?? [],
    catalogUrl: course.catalog_url,
    sourceYear: course.source_year,
    detailStatus: course.detail_status ?? "unavailable"
  };
}

export function plannerCourseInputs(
  planCourses: readonly PlanCourse[],
  dtechCourses: readonly Course[],
  smccdCourses: readonly SmccdCourse[]
): PlannedCourseInput[] {
  const dtechById = new Map(dtechCourses.map((course) => [course.id, course]));
  const smccdById = new Map(smccdCourses.map((course) => [course.id, course]));
  return planCourses.map((row) => {
    const dtech = row.course_id ? dtechById.get(row.course_id) : undefined;
    const smccd = row.smccd_course_id ? smccdById.get(row.smccd_course_id) : undefined;
    const name = dtech?.name ?? (smccd ? `${smccd.course_code} ${smccd.title}` : row.custom_course_name ?? "Unidentified course");
    const code = dtech?.course_code ?? resolvePlanCollegeCourseCode(row, smccdById);
    return {
      instanceId: row.id,
      ...(dtech ? { courseId: dtech.id } : row.smccd_course_id ? { courseId: row.smccd_course_id } : {}),
      code,
      name,
      ...(dtech && DTECH_PREREQUISITE_ALIASES[dtech.name]
        ? { aliases: DTECH_PREREQUISITE_ALIASES[dtech.name] }
        : {}),
      status: row.status,
      ...(plannedTermIndex(row) !== undefined ? { termIndex: plannedTermIndex(row) } : {}),
      gradeLevel: row.grade_level,
      grade: row.letter_grade,
      source: row.source_review_item_id ? "transcript" : dtech || smccd ? "catalog" : "manual"
    };
  });
}

export function dtechEquivalenciesForPrerequisites(
  rows: readonly SmccdHighSchoolEquivalency[],
  catalog: readonly CatalogCourse[]
): PrerequisiteEquivalencyInput[] {
  return buildDtechPrerequisiteEquivalencies(
    rows.map((row) => ({
      normalizedCourseCode: row.normalized_course_code,
      highSchoolEquivalent: row.high_school_equivalent,
      confidence: row.confidence,
      sourceId: row.source_id
    })),
    catalog
  );
}

export function evaluateDtechPlannerPrerequisites(
  course: Course,
  target: PlannerPrerequisiteTarget,
  dtechCourses: readonly Course[],
  planCourses: readonly PlanCourse[],
  smccdCourses: readonly SmccdCourse[] = [],
  equivalencies: readonly SmccdHighSchoolEquivalency[] = []
): PlannerPrerequisiteEvaluation {
  const catalog = dtechPrerequisiteCatalog(dtechCourses);
  const parsed = parsePrerequisites(course.prerequisites, {
    catalog,
    ...(course.source_id ? { sourceId: course.source_id } : {}),
    sourceLabel: "Official d.tech course catalog",
    confidence: course.confidence
  });
  return {
    result: evaluateParsedPrerequisites(parsed, {
      target: {
        ...(target.instanceId ? { instanceId: target.instanceId } : {}),
        courseId: course.id,
        code: course.course_code,
        name: course.name,
        termIndex: plannerTargetTermIndex(target.gradeLevel, target.term),
        gradeLevel: target.gradeLevel
      },
      courses: plannerCourseInputs(planCourses, dtechCourses, smccdCourses),
      equivalencies: dtechEquivalenciesForPrerequisites(equivalencies, catalog)
    }),
    originalTexts: parsed.originalTexts
  };
}

export function evaluateSmccdPlannerPrerequisites(
  course: SmccdCourse,
  target: PlannerPrerequisiteTarget,
  smccdCourses: readonly SmccdCourse[],
  planCourses: readonly PlanCourse[],
  dtechCourses: readonly Course[],
  equivalencies: readonly PrerequisiteEquivalencyInput[] = []
): PlannerPrerequisiteEvaluation {
  const prerequisiteCourses = smccdCourses.map(smccdPrerequisiteCourse);
  const parsed = parseSmccdCoursePrerequisites(smccdPrerequisiteCourse(course), prerequisiteCourses);
  return {
    result: evaluateParsedPrerequisites(parsed, {
      target: {
        ...(target.instanceId ? { instanceId: target.instanceId } : {}),
        courseId: course.id,
        code: course.course_code,
        name: `${course.course_code} ${course.title}`,
        termIndex: plannerTargetTermIndex(target.gradeLevel, target.term),
        gradeLevel: target.gradeLevel
      },
      courses: plannerCourseInputs(planCourses, dtechCourses, smccdCourses),
      equivalencies
    }),
    originalTexts: parsed.originalTexts
  };
}

/**
 * Builds the catalog and student evidence once for a browsing session. The
 * returned function only parses each course the first time it is inspected,
 * which keeps catalog search from rebuilding the full SMCCD graph per row.
 */
export function createSmccdPlannerPrerequisiteEvaluator(
  smccdCourses: readonly SmccdCourse[],
  planCourses: readonly PlanCourse[],
  dtechCourses: readonly Course[],
  equivalencies: readonly PrerequisiteEquivalencyInput[] = []
) {
  const prerequisiteCourses = smccdCourses.map(smccdPrerequisiteCourse);
  const plannedInputs = plannerCourseInputs(planCourses, dtechCourses, smccdCourses);
  const parsedByCourseId = new Map<string, ReturnType<typeof parseSmccdCoursePrerequisites>>();

  return (course: SmccdCourse, target: PlannerPrerequisiteTarget): PlannerPrerequisiteEvaluation => {
    let parsed = parsedByCourseId.get(course.id);
    if (!parsed) {
      parsed = parseSmccdCoursePrerequisites(smccdPrerequisiteCourse(course), prerequisiteCourses);
      parsedByCourseId.set(course.id, parsed);
    }
    return {
      result: evaluateParsedPrerequisites(parsed, {
        target: {
          ...(target.instanceId ? { instanceId: target.instanceId } : {}),
          courseId: course.id,
          code: course.course_code,
          name: `${course.course_code} ${course.title}`,
          termIndex: plannerTargetTermIndex(target.gradeLevel, target.term),
          gradeLevel: target.gradeLevel
        },
        courses: plannedInputs,
        equivalencies
      }),
      originalTexts: parsed.originalTexts
    };
  };
}
