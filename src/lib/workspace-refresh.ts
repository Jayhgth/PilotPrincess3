import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentEnrollmentPreference,
  StudentSmccdGeCompletion,
  StudentSettings,
  StudentSmccdGoal
} from "@/lib/models";
import { COLLEGE_COURSE_SELECT, COLLEGE_DATA, COLLEGE_PROGRAM_SELECT } from "@/lib/college-provider-contract";

export interface PlanWorkspaceSlice {
  planCourses: PlanCourse[];
  plannedCollegeCourses: SmccdCourse[];
  collegeCatalogError: string | null;
  gpaChoices: Array<{ planCourseId: string; included: boolean; expectedGrade: string | null }>;
}

const planSliceCache = new Map<string, PlanWorkspaceSlice>();

export function cachedPlanWorkspaceSlice(versionId: string) {
  return planSliceCache.get(versionId) ?? null;
}

export function invalidatePlanWorkspaceSlice(versionId: string) {
  planSliceCache.delete(versionId);
}

export async function loadPlanWorkspaceSlice(
  supabase: SupabaseClient,
  userId: string,
  activeVersionId: string
): Promise<PlanWorkspaceSlice> {
  const compact = await supabase.rpc("get_plan_workspace_slice_v1", { p_version_id: activeVersionId });
  if (!compact.error && compact.data && typeof compact.data === "object" && !Array.isArray(compact.data)) {
    const payload = compact.data as Record<string, unknown>;
    const planCourses = (Array.isArray(payload.plan_courses) ? payload.plan_courses : []) as unknown as PlanCourse[];
    const choices = Array.isArray(payload.gpa_scenario_choices) ? payload.gpa_scenario_choices as Array<Record<string, unknown>> : [];
    const slice: PlanWorkspaceSlice = {
      planCourses,
      plannedCollegeCourses: (Array.isArray(payload.planned_college_courses) ? payload.planned_college_courses : []) as unknown as SmccdCourse[],
      collegeCatalogError: null,
      gpaChoices: choices.map((choice) => ({
        planCourseId: String(choice.plan_course_id),
        included: choice.included !== false,
        expectedGrade: choice.expected_grade ? String(choice.expected_grade) : null
      }))
    };
    planSliceCache.set(activeVersionId, slice);
    return slice;
  }

  const planResult = await supabase.from("plan_courses").select("*").eq("plan_version_id", activeVersionId).eq("user_id", userId).order("grade_level").order("sort_order");
  if (planResult.error) throw planResult.error;
  const planCourses = (planResult.data ?? []) as unknown as PlanCourse[];
  const planCourseIds = planCourses.map((row) => row.id);
  const gpaResult = planCourseIds.length
    ? await supabase.from("student_gpa_scenario_choices").select("plan_course_id,included,expected_grade").eq("user_id", userId).in("plan_course_id", planCourseIds)
    : { data: [], error: null };
  if (gpaResult.error) throw gpaResult.error;
  const collegeIds = [...new Set(planCourses.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
  const collegeResult = collegeIds.length
    ? await supabase.from(COLLEGE_DATA.courses).select(COLLEGE_COURSE_SELECT).in("id", collegeIds)
    : { data: [], error: null };
  const slice: PlanWorkspaceSlice = {
    planCourses,
    plannedCollegeCourses: (collegeResult.data ?? []) as unknown as SmccdCourse[],
    collegeCatalogError: collegeResult.error?.message ?? null,
    gpaChoices: (gpaResult.data ?? []).map((choice) => ({
      planCourseId: String(choice.plan_course_id),
      included: choice.included !== false,
      expectedGrade: choice.expected_grade ? String(choice.expected_grade) : null
    }))
  };
  planSliceCache.set(activeVersionId, slice);
  return slice;
}

export async function loadSettingsWorkspaceSlice(supabase: SupabaseClient, userId: string) {
  const result = await supabase.from("student_settings").select("*").eq("id", userId).single();
  if (result.error) throw result.error;
  return result.data as unknown as StudentSettings;
}

export async function loadDegreeWorkspaceSlice(supabase: SupabaseClient, userId: string, activePlanId: string) {
  const [goalsResult, completionsResult] = await Promise.all([
    supabase.from("student_smccd_goals").select("*").eq("user_id", userId).eq("plan_id", activePlanId).order("is_primary", { ascending: false }).order("created_at"),
    supabase.from("student_smccd_ge_completions").select("user_id,college_code,area,completion_source").eq("user_id", userId)
  ]);
  if (goalsResult.error) throw goalsResult.error;
  if (completionsResult.error) throw completionsResult.error;
  const goals = (goalsResult.data ?? []) as unknown as StudentSmccdGoal[];
  const programIds = goals.map((goal) => goal.program_id);
  const programsResult = programIds.length
    ? await supabase.from(COLLEGE_DATA.programs).select(COLLEGE_PROGRAM_SELECT).in("id", programIds)
    : { data: [], error: null };
  if (programsResult.error) throw programsResult.error;
  const programs = (programsResult.data ?? []) as unknown as SmccdProgram[];
  const requirementsResult = programIds.length
    ? await supabase.from(COLLEGE_DATA.programRequirements).select("*").in("program_id", programIds).order("sort_order")
    : { data: [], error: null };
  if (requirementsResult.error) throw requirementsResult.error;
  const requirements = (requirementsResult.data ?? []) as unknown as SmccdProgramRequirement[];
  const requirementIds = requirements.map((requirement) => requirement.id);
  const optionsResult = requirementIds.length
    ? await supabase.from(COLLEGE_DATA.requirementCourses).select("*").in("requirement_id", requirementIds)
    : { data: [], error: null };
  if (optionsResult.error) throw optionsResult.error;
  return {
    goals,
    programs,
    requirements,
    requirementCourses: (optionsResult.data ?? []) as unknown as SmccdRequirementCourse[],
    manualCompletions: (completionsResult.data ?? []) as unknown as StudentSmccdGeCompletion[]
  };
}

export async function loadEnrollmentWorkspaceSlice(
  supabase: SupabaseClient,
  userId: string,
  providerCode: string
) {
  const result = await supabase.from("student_enrollment_preferences").select("*").eq("user_id", userId).eq("provider_code", providerCode).maybeSingle();
  if (result.error) throw result.error;
  return result.data as unknown as StudentEnrollmentPreference | null;
}
