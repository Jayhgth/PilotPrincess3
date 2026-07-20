import type { PlanCourse, SmccdHighSchoolEquivalency } from "@/lib/models";
import { resolvePlanCollegeCourseCode } from "@/lib/college-course-identity";

type HighSchoolCreditBasis =
  | "official_high_school_credits"
  | "stored_high_school_credits"
  | "verified_equivalency"
  | "provisional_unit_conversion"
  | "unresolved";

export interface HighSchoolCreditResolution {
  credits: number;
  basis: HighSchoolCreditBasis;
  collegeUnits: number;
  normalizedCourseCode: string | null;
}

export const COLLEGE_HIGH_SCHOOL_CREDIT_POLICY = "Keep college units separate from high-school credits. Use an official transcript credit award first, then an exact selected-school equivalency. When neither exists, represent 3 to fewer than 5 college units as 5 provisional high-school credits and 5 or more units as 10 provisional high-school credits for GPA and planning only; a graduation area still requires verified selected-school evidence.";

function positiveNumber(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Local California policy controls the final award. This fallback mirrors the
 * published SMUHSD Middle College 3-unit/5-credit and 5-unit/10-credit rule,
 * while leaving short courses unresolved. Exact school/course evidence always
 * wins and graduation-area assignment remains a separate verified decision.
 */
export function provisionalHighSchoolCreditsForCollegeUnits(collegeUnits: number | null | undefined) {
  const units = positiveNumber(collegeUnits);
  if (units >= 5) return 10;
  if (units >= 3) return 5;
  return 0;
}

export function resolveCollegeHighSchoolCredits({
  collegeUnits,
  storedHighSchoolCredits,
  equivalencyHighSchoolCredits,
  storedHighSchoolCreditsAreOfficial = false,
  normalizedCourseCode = null
}: {
  collegeUnits: number | null | undefined;
  storedHighSchoolCredits: number | null | undefined;
  equivalencyHighSchoolCredits?: number | null;
  storedHighSchoolCreditsAreOfficial?: boolean;
  normalizedCourseCode?: string | null;
}): HighSchoolCreditResolution {
  const units = positiveNumber(collegeUnits);
  const stored = positiveNumber(storedHighSchoolCredits);
  const equivalency = positiveNumber(equivalencyHighSchoolCredits);
  if (storedHighSchoolCreditsAreOfficial && stored > 0) {
    return { credits: stored, basis: "official_high_school_credits", collegeUnits: units, normalizedCourseCode };
  }
  if (equivalency > 0) return { credits: equivalency, basis: "verified_equivalency", collegeUnits: units, normalizedCourseCode };

  const provisional = provisionalHighSchoolCreditsForCollegeUnits(units);
  // Older plan writers sometimes copied college units into the high-school
  // credit column. Do not let 3 or 5 raw units masquerade as transcript credit.
  const storedLooksLikeRawCollegeUnits = stored > 0 && units > 0 && Math.abs(stored - units) < 0.001;
  if (provisional > 0 && (stored === 0 || storedLooksLikeRawCollegeUnits)) {
    return { credits: provisional, basis: "provisional_unit_conversion", collegeUnits: units, normalizedCourseCode };
  }
  if (stored > 0) return { credits: stored, basis: "stored_high_school_credits", collegeUnits: units, normalizedCourseCode };
  if (provisional > 0) {
    return { credits: provisional, basis: "provisional_unit_conversion", collegeUnits: units, normalizedCourseCode };
  }
  return { credits: 0, basis: "unresolved", collegeUnits: units, normalizedCourseCode };
}

export function resolvePlanCourseHighSchoolCredits(
  row: PlanCourse,
  equivalencies: readonly SmccdHighSchoolEquivalency[] = []
): HighSchoolCreditResolution {
  const isCollegeCourse = Boolean(row.smccd_course_id || row.college_provider_code || positiveNumber(row.college_units) > 0);
  if (!isCollegeCourse) {
    return {
      credits: positiveNumber(row.credits),
      basis: positiveNumber(row.credits) > 0 ? "stored_high_school_credits" : "unresolved",
      collegeUnits: 0,
      normalizedCourseCode: null
    };
  }

  const normalizedCourseCode = resolvePlanCollegeCourseCode(row);
  const equivalency = normalizedCourseCode
    ? equivalencies.find((candidate) => candidate.normalized_course_code === normalizedCourseCode)
    : null;
  return resolveCollegeHighSchoolCredits({
    collegeUnits: row.college_units,
    // Preserve an explicit transcript/plan credit value for GPA weighting. The
    // graduation audit separately requires a verified mapping or equivalency
    // before applying these credits to a diploma area.
    storedHighSchoolCredits: row.credits,
    equivalencyHighSchoolCredits: equivalency?.high_school_credits,
    normalizedCourseCode
  });
}
