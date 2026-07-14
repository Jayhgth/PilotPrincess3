import type { GradeLevel, PlanCourse } from "@/lib/models";

export type CourseBoardTerm = "fall" | "spring" | "summer";

export const COURSE_BOARD_TERMS: readonly CourseBoardTerm[] = ["fall", "spring", "summer"];

export function courseBoardTermsForGrade(grade: GradeLevel): readonly CourseBoardTerm[] {
  return grade === 12 ? COURSE_BOARD_TERMS.slice(0, 2) : COURSE_BOARD_TERMS;
}

export function courseAppearsInBoardTerm(row: PlanCourse, term: CourseBoardTerm) {
  return row.term === term || (row.term === "full_year" && (term === "fall" || term === "spring"));
}

export function isCollegePlanCourse(row: PlanCourse) {
  return Boolean(row.smccd_course_id || row.college_provider_code || Number(row.college_units ?? 0) > 0);
}

export function isPassFailPlanCourse(row: PlanCourse) {
  const grade = row.letter_grade?.trim().toUpperCase();
  return grade === "P" || Boolean(
    grade === "F"
    && (
      row.requirement_area_override === "personal_development"
      || /pass[ /-]?fail/i.test(row.notes ?? "")
    )
  );
}

function boardSortGroup(row: PlanCourse) {
  if (isPassFailPlanCourse(row)) return 2;
  return isCollegePlanCourse(row) ? 0 : 1;
}

export function compareCourseBoardRows(left: PlanCourse, right: PlanCourse) {
  return left.sort_order - right.sort_order
    || boardSortGroup(left) - boardSortGroup(right)
    || (left.custom_course_name ?? "").localeCompare(right.custom_course_name ?? "")
    || left.id.localeCompare(right.id);
}

export function compareCourseBoardRowsForAutomaticSort(left: PlanCourse, right: PlanCourse) {
  return boardSortGroup(left) - boardSortGroup(right)
    || left.sort_order - right.sort_order
    || (left.custom_course_name ?? "").localeCompare(right.custom_course_name ?? "")
    || left.id.localeCompare(right.id);
}

export function orderedCourseIdsForAutomaticBoardSort(rows: readonly PlanCourse[], gradeLevel: GradeLevel) {
  return rows
    .filter((row) => row.grade_level === gradeLevel)
    .sort(compareCourseBoardRowsForAutomaticSort)
    .map((row) => row.id);
}

export function orderedCourseIdsForBoardMove(
  rows: readonly PlanCourse[],
  activeId: string,
  gradeLevel: GradeLevel,
  term: CourseBoardTerm,
  overId: string | null,
  insertAfter = false
) {
  const destinationIds = rows
    .filter((row) => row.id !== activeId && row.grade_level === gradeLevel && courseAppearsInBoardTerm(row, term))
    .sort(compareCourseBoardRows)
    .map((row) => row.id);
  const overIndex = overId ? destinationIds.indexOf(overId) : -1;
  const insertionIndex = overIndex < 0
    ? destinationIds.length
    : Math.min(destinationIds.length, overIndex + (insertAfter ? 1 : 0));
  destinationIds.splice(insertionIndex, 0, activeId);
  return destinationIds;
}
