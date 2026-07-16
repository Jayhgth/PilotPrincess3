import { describe, expect, it } from "vitest";
import type { EnrollmentPolicy, PlanCourse, StudentEnrollmentPreference } from "@/lib/models";
import { evaluateEnrollmentSchedule, policyForPreference, selectedEnrollmentLimit } from "@/lib/enrollment-policy";

const policy: EnrollmentPolicy = {
  id: "smccd-concurrent-2026",
  provider_code: "SMCCD",
  provider_name: "San Mateo County Community College District",
  program_type: "concurrent",
  term: "any",
  unit_system: "semester",
  recommended_max_units: 11,
  fee_free_max_units: 11.5,
  absolute_max_units: 19,
  approval_required: true,
  source_url: "https://smccd.edu/k-12/faqs.php",
  source_label: "SMCCD K-12 FAQ",
  source_year: "2026",
  notes: null,
  confidence: "verified"
};

const preference: StudentEnrollmentPreference = {
  user_id: "user-1",
  provider_code: "SMCCD",
  program_type: "concurrent",
  limit_mode: "recommended",
  custom_unit_limit: null,
  respect_recommended_limit: true,
  updated_at: "2026-07-11T00:00:00.000Z"
};

function row(id: string, units: number, term: PlanCourse["term"], overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id,
    plan_version_id: "version-1",
    user_id: "user-1",
    course_id: null,
    custom_course_name: id,
    grade_level: 12,
    school_year: "2026-2027",
    term,
    status: "planned",
    credits: 5,
    college_units: units,
    letter_grade: null,
    is_weighted: true,
    mapping_verified: false,
    user_edited: true,
    notes: null,
    sort_order: 0,
    source_review_item_id: null,
    smccd_course_id: `CSM:${id}`,
    college_provider_code: "SMCCD",
    requirement_area_override: null,
    ...overrides
  };
}

describe("enrollment policy evaluation", () => {
  it("selects and aggregates enrollment policy limits", () => {
    {
    expect(policyForPreference([policy], preference)?.id).toBe(policy.id);
    expect(selectedEnrollmentLimit(policy)).toBe(11);
    }

    {
    const [term] = evaluateEnrollmentSchedule([
      row("CIS 117", 4, "fall"),
      row("MATH 200", 5, "fall", { smccd_course_id: "SKY:MATH 200" }),
      row("ENGL 100", 3, "fall", { smccd_course_id: "CAN:ENGL 100" })
    ], policy);
    expect(term).toMatchObject({ units: 12, selectedLimit: 11, state: "over_policy" });
    expect(term?.courseIds).toHaveLength(3);
    }
  });

  it("classifies term loads and ignores unrelated rows", () => {
    {
    const terms = evaluateEnrollmentSchedule([row("CIS 117", 4, "full_year")], policy);
    expect(terms.map((term) => [term.term, term.units])).toEqual([["fall", 4], ["spring", 4]]);
    }

    {
    expect(evaluateEnrollmentSchedule([row("A", 11.5, "fall")], policy)[0]?.state).toBe("over_policy");
    expect(evaluateEnrollmentSchedule([row("A", 12, "fall")], policy)[0]?.state).toBe("over_policy");
    expect(evaluateEnrollmentSchedule([row("A", 19, "fall")], policy)[0]?.state).toBe("over_policy");
    expect(evaluateEnrollmentSchedule([row("A", 20, "fall")], policy)[0]?.state).toBe("blocked");
    }

    {
    const terms = evaluateEnrollmentSchedule([
      row("completed", 12, "fall", { status: "completed" }),
      row("other", 12, "fall", { smccd_course_id: null, college_provider_code: "CCSF" })
    ], policy);
    expect(terms).toEqual([]);
    }
  });
});
