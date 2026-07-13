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
  return boardSortGroup(left) - boardSortGroup(right)
    || left.sort_order - right.sort_order
    || (left.custom_course_name ?? "").localeCompare(right.custom_course_name ?? "")
    || left.id.localeCompare(right.id);
}
