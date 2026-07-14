import type { CourseStatus, GradeLevel, PlanCourse } from "@/lib/models";

export type CourseBoardTerm = "fall" | "spring" | "summer";

const COURSE_BOARD_TERMS: readonly CourseBoardTerm[] = ["fall", "spring", "summer"];

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

export function courseStatusForBoardMove(currentGrade: GradeLevel, destinationGrade: GradeLevel, currentStatus: CourseStatus) {
  if (destinationGrade > currentGrade) return "planned";
  if (destinationGrade === currentGrade) return "current";
  return currentStatus;
}

export function boardTermForYearDrop(term: PlanCourse["term"], destinationGrade: GradeLevel): CourseBoardTerm {
  if (term === "full_year") return "fall";
  if (term === "summer" && destinationGrade === 12) return "fall";
  return term;
}

function boardSortGroup(row: PlanCourse) {
  if (isPassFailPlanCourse(row)) return 2;
  return isCollegePlanCourse(row) ? 0 : 1;
}

export function compareCourseBoardRows(left: PlanCourse, right: PlanCourse) {
  return left.sort_order - right.sort_order
    || left.id.localeCompare(right.id);
}

export function compareCourseBoardRowsForTerm(term: CourseBoardTerm) {
  return (left: PlanCourse, right: PlanCourse) => {
    const leftContinuation = term === "spring" && left.term === "full_year" ? 1 : 0;
    const rightContinuation = term === "spring" && right.term === "full_year" ? 1 : 0;
    return leftContinuation - rightContinuation || compareCourseBoardRows(left, right);
  };
}

export function compareCourseBoardRowsForAutomaticSort(left: PlanCourse, right: PlanCourse) {
  return boardSortGroup(left) - boardSortGroup(right)
    || left.sort_order - right.sort_order
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
  const originalDestinationIds = rows
    .filter((row) => row.grade_level === gradeLevel)
    .sort(compareCourseBoardRows)
    .map((row) => row.id);
  const active = rows.find((row) => row.id === activeId);
  if (overId === activeId && active?.grade_level === gradeLevel && courseAppearsInBoardTerm(active, term)) {
    return originalDestinationIds;
  }

  const destinationRows = rows
    .filter((row) => row.id !== activeId && row.grade_level === gradeLevel)
    .sort(compareCourseBoardRows);
  const destinationIds = destinationRows.map((row) => row.id);
  const overIndex = overId ? destinationIds.indexOf(overId) : -1;
  let insertionIndex = overIndex >= 0
    ? Math.min(destinationIds.length, overIndex + (insertAfter ? 1 : 0))
    : destinationRows.reduce(
        (lastIndex, row, index) => courseAppearsInBoardTerm(row, term) ? index + 1 : lastIndex,
        destinationIds.length
      );
  if (overIndex < 0 && !destinationRows.some((row) => courseAppearsInBoardTerm(row, term))) {
    insertionIndex = destinationIds.length;
  }
  destinationIds.splice(insertionIndex, 0, activeId);
  return destinationIds;
}
