import type { EnrollmentPolicy, PlanCourse, StudentEnrollmentPreference } from "@/lib/models";

type EnrollmentLimitState = "within" | "review" | "over_policy" | "blocked";

export interface EnrollmentTermEvaluation {
  key: string;
  schoolYear: string;
  term: "fall" | "spring" | "summer";
  units: number;
  selectedLimit: number;
  recommendedLimit: number;
  feeFreeLimit: number;
  absoluteLimit: number;
  state: EnrollmentLimitState;
  message: string;
  courseIds: string[];
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function policyForPreference(
  policies: readonly EnrollmentPolicy[],
  preference: Pick<StudentEnrollmentPreference, "provider_code" | "program_type">
) {
  return policies.find((policy) =>
    policy.provider_code === preference.provider_code
    && policy.program_type === preference.program_type
    && policy.term === "any"
  ) ?? policies.find((policy) =>
    policy.provider_code === preference.provider_code
    && policy.program_type === preference.program_type
  ) ?? null;
}

export function selectedEnrollmentLimit(policy: EnrollmentPolicy) {
  return Number(policy.recommended_max_units);
}

function planTerms(row: PlanCourse): Array<"fall" | "spring" | "summer"> {
  if (row.term === "full_year") return ["fall", "spring"];
  return [row.term];
}

export function evaluateEnrollmentSchedule(
  rows: readonly PlanCourse[],
  policy: EnrollmentPolicy
): EnrollmentTermEvaluation[] {
  const selectedLimit = selectedEnrollmentLimit(policy);
  const groups = new Map<string, { schoolYear: string; term: "fall" | "spring" | "summer"; units: number; courseIds: string[] }>();

  for (const row of rows) {
    if (row.status === "completed") continue;
    const provider = row.college_provider_code ?? (row.smccd_course_id ? "SMCCD" : null);
    if (provider !== policy.provider_code) continue;
    const units = Number(row.college_units ?? 0);
    if (units <= 0) continue;
    for (const term of planTerms(row)) {
      if (policy.term !== "any" && policy.term !== term) continue;
      const key = `${row.school_year}:${term}`;
      const group = groups.get(key) ?? { schoolYear: row.school_year, term, units: 0, courseIds: [] };
      group.units += units;
      group.courseIds.push(row.id);
      groups.set(key, group);
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    const units = round(group.units);
    const absolute = Number(policy.absolute_max_units);
    const recommended = Number(policy.recommended_max_units);
    const feeFree = Number(policy.fee_free_max_units);
    let state: EnrollmentLimitState = "within";
    let message = `${units} units stay within the district's ${selectedLimit}-unit ${policy.program_type}-enrollment threshold.`;
    if (units > absolute) {
      state = "blocked";
      message = `${units} units exceed the source-backed ${absolute}-unit K-12 maximum.`;
    } else if (units > recommended) {
      state = "over_policy";
      message = units > feeFree
        ? `${units} units exceed both the ${recommended}-unit ${policy.program_type}-enrollment planning threshold and the district's ${feeFree}-unit fee-free figure. Fees and additional approval may apply.`
        : `${units} units exceed the ${recommended}-unit ${policy.program_type}-enrollment planning threshold. Verify fees and approval.`;
    } else if (units > feeFree) {
      state = "review";
      message = `${units} units exceed the district's ${feeFree}-unit fee-free figure. Fees and additional approval may apply.`;
    }
    return {
      key,
      schoolYear: group.schoolYear,
      term: group.term,
      units,
      selectedLimit: round(selectedLimit),
      recommendedLimit: round(recommended),
      feeFreeLimit: round(feeFree),
      absoluteLimit: round(absolute),
      state,
      message,
      courseIds: group.courseIds
    };
  }).sort((left, right) => left.schoolYear.localeCompare(right.schoolYear) || left.term.localeCompare(right.term));
}

export function defaultEnrollmentPreference(userId: string, providerCode = "SMCCD"): StudentEnrollmentPreference {
  return {
    user_id: userId,
    provider_code: providerCode,
    program_type: "concurrent",
    limit_mode: "recommended",
    custom_unit_limit: null,
    respect_recommended_limit: true,
    updated_at: new Date(0).toISOString()
  };
}
