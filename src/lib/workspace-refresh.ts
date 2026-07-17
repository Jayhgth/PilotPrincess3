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

export async function loadPlanWorkspaceSlice(
  supabase: SupabaseClient,
  userId: string,
  activeVersionId: string
) {
  const [planResult, gpaResult] = await Promise.all([
    supabase.from("plan_courses").select("*").eq("plan_version_id", activeVersionId).eq("user_id", userId).order("grade_level").order("sort_order"),
    supabase.from("student_gpa_scenario_choices").select("plan_course_id,included,expected_grade").eq("user_id", userId)
  ]);
  if (planResult.error) throw planResult.error;
  if (gpaResult.error) throw gpaResult.error;
  const planCourses = (planResult.data ?? []) as unknown as PlanCourse[];
  const collegeIds = [...new Set(planCourses.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
  const collegeResult = collegeIds.length
    ? await supabase.from("smccd_courses").select("*").in("id", collegeIds)
    : { data: [], error: null };
  if (collegeResult.error) throw collegeResult.error;
  return {
    planCourses,
    plannedCollegeCourses: (collegeResult.data ?? []) as unknown as SmccdCourse[],
    gpaChoices: (gpaResult.data ?? []).map((choice) => ({
      planCourseId: String(choice.plan_course_id),
      included: choice.included !== false,
      expectedGrade: choice.expected_grade ? String(choice.expected_grade) : null
    }))
  };
}

export async function loadSettingsWorkspaceSlice(supabase: SupabaseClient, userId: string) {
  const result = await supabase.from("student_settings").select("*").eq("id", userId).single();
  if (result.error) throw result.error;
  return result.data as unknown as StudentSettings;
}

export async function loadDegreeWorkspaceSlice(supabase: SupabaseClient, userId: string) {
  const [goalsResult, completionsResult] = await Promise.all([
    supabase.from("student_smccd_goals").select("*").eq("user_id", userId).order("is_primary", { ascending: false }).order("created_at"),
    supabase.from("student_smccd_ge_completions").select("user_id,college_code,area,completion_source").eq("user_id", userId)
  ]);
  if (goalsResult.error) throw goalsResult.error;
  if (completionsResult.error) throw completionsResult.error;
  const goals = (goalsResult.data ?? []) as unknown as StudentSmccdGoal[];
  const programIds = goals.map((goal) => goal.program_id);
  const programsResult = programIds.length
    ? await supabase.from("smccd_programs").select("*").in("id", programIds)
    : { data: [], error: null };
  if (programsResult.error) throw programsResult.error;
  const programs = (programsResult.data ?? []) as unknown as SmccdProgram[];
  const requirementsResult = programIds.length
    ? await supabase.from("smccd_program_requirements").select("*").in("program_id", programIds).order("sort_order")
    : { data: [], error: null };
  if (requirementsResult.error) throw requirementsResult.error;
  const requirements = (requirementsResult.data ?? []) as unknown as SmccdProgramRequirement[];
  const requirementIds = requirements.map((requirement) => requirement.id);
  const optionsResult = requirementIds.length
    ? await supabase.from("smccd_requirement_courses").select("*").in("requirement_id", requirementIds)
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
