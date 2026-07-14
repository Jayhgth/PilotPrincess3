import type { PlanCourse, SmccdHighSchoolEquivalency } from "@/lib/models";
import { resolvePlanCollegeCourseCode } from "@/lib/college-course-identity";

type HighSchoolCreditBasis =
  | "stored_high_school_credits"
  | "verified_equivalency"
  | "district_unit_conversion"
  | "unresolved";

export interface HighSchoolCreditResolution {
  credits: number;
  basis: HighSchoolCreditBasis;
  collegeUnits: number;
  normalizedCourseCode: string | null;
}

export const COLLEGE_HIGH_SCHOOL_CREDIT_POLICY = "Use exact d.tech equivalencies first; otherwise 3 to under 5 college units count as 5 high-school credits and 5 or more units count as 10.";

function positiveNumber(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function districtHighSchoolCreditsForCollegeUnits(collegeUnits: number | null | undefined) {
  const units = positiveNumber(collegeUnits);
  if (units >= 5) return 10;
  if (units >= 3) return 5;
  return 0;
}

export function resolveCollegeHighSchoolCredits({
  collegeUnits,
  storedHighSchoolCredits,
  equivalencyHighSchoolCredits,
  normalizedCourseCode = null
}: {
  collegeUnits: number | null | undefined;
  storedHighSchoolCredits: number | null | undefined;
  equivalencyHighSchoolCredits?: number | null;
  normalizedCourseCode?: string | null;
}): HighSchoolCreditResolution {
  const units = positiveNumber(collegeUnits);
  const stored = positiveNumber(storedHighSchoolCredits);
  const equivalency = positiveNumber(equivalencyHighSchoolCredits);
  if (equivalency > 0) return { credits: equivalency, basis: "verified_equivalency", collegeUnits: units, normalizedCourseCode };

  const converted = districtHighSchoolCreditsForCollegeUnits(units);
  const storedLooksLikeRawCollegeUnits = stored > 0 && units > 0 && Math.abs(stored - units) < 0.001;
  if (converted > 0 && (stored === 0 || storedLooksLikeRawCollegeUnits)) {
    return { credits: converted, basis: "district_unit_conversion", collegeUnits: units, normalizedCourseCode };
  }
  if (stored > 0) return { credits: stored, basis: "stored_high_school_credits", collegeUnits: units, normalizedCourseCode };
  if (converted > 0) return { credits: converted, basis: "district_unit_conversion", collegeUnits: units, normalizedCourseCode };
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
    storedHighSchoolCredits: row.credits,
    equivalencyHighSchoolCredits: equivalency?.high_school_credits,
    normalizedCourseCode
  });
}
