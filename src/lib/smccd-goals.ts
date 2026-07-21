import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentSmccdGoal } from "@/lib/models";

const goalCache = new Map<string, StudentSmccdGoal[]>();
const goalRequests = new Map<string, Promise<StudentSmccdGoal[]>>();
let planScopedGoalSchemaAvailable: boolean | null = null;

function cacheKey(userId: string, planId: string) {
  return `${userId}:${planId}`;
}

export function cachedStudentSmccdGoals(userId: string, planId: string) {
  return goalCache.get(cacheKey(userId, planId)) ?? null;
}

export function cacheStudentSmccdGoals(userId: string, planId: string, goals: StudentSmccdGoal[]) {
  goalCache.set(cacheKey(userId, planId), goals);
}

function missingPlanScopeColumn(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (error?.code === "42703" || error?.code === "PGRST204")
    && message.includes("plan_id");
}

function withPlanScope(goal: Record<string, unknown>, planId: string) {
  return {
    ...goal,
    plan_id: typeof goal.plan_id === "string" ? goal.plan_id : planId,
    notes: typeof goal.notes === "string" ? goal.notes : ""
  } as unknown as StudentSmccdGoal;
}

function normalizeGoalNotes(notes: string | null | undefined) {
  return notes?.trim() ?? "";
}

async function selectStudentSmccdGoals(supabase: SupabaseClient, userId: string, planId: string) {
  if (planScopedGoalSchemaAvailable !== false) {
    const scoped = await supabase
      .from("student_smccd_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_id", planId);
    if (!scoped.error) {
      planScopedGoalSchemaAvailable = true;
      return (scoped.data ?? []) as unknown as StudentSmccdGoal[];
    }
    if (!missingPlanScopeColumn(scoped.error)) throw new Error(scoped.error.message);
    planScopedGoalSchemaAvailable = false;
  }

  const legacy = await supabase
    .from("student_smccd_goals")
    .select("*")
    .eq("user_id", userId);
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((goal) => withPlanScope(goal, planId));
}

export function loadStudentSmccdGoals(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  options: { force?: boolean } = {}
) {
  const key = cacheKey(userId, planId);
  const cached = goalCache.get(key);
  if (cached && !options.force) return Promise.resolve(cached);
  const pending = goalRequests.get(key);
  if (pending && !options.force) return pending;

  const request = (async () => {
    const goals = await selectStudentSmccdGoals(supabase, userId, planId);
    goalCache.set(key, goals);
    return goals;
  })().finally(() => goalRequests.delete(key));
  goalRequests.set(key, request);
  return request;
}

export async function insertStudentSmccdGoals(
  supabase: SupabaseClient,
  input: {
    userId: string;
    planId: string;
    goals: Array<{ programId: string; isPrimary?: boolean; notes?: string | null }>;
  }
) {
  const baseRows = input.goals.map((goal) => ({
    user_id: input.userId,
    program_id: goal.programId,
    is_primary: goal.isPrimary ?? false,
    notes: normalizeGoalNotes(goal.notes)
  }));

  if (planScopedGoalSchemaAvailable !== false) {
    const scoped = await supabase.from("student_smccd_goals")
      .insert(baseRows.map((row) => ({ ...row, plan_id: input.planId })))
      .select("*");
    if (!scoped.error) {
      planScopedGoalSchemaAvailable = true;
      return (scoped.data ?? []) as unknown as StudentSmccdGoal[];
    }
    if (!missingPlanScopeColumn(scoped.error)) throw new Error(scoped.error.message);
    planScopedGoalSchemaAvailable = false;
  }

  const legacy = await supabase.from("student_smccd_goals").insert(baseRows).select("*");
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map((goal) => withPlanScope(goal, input.planId));
}

export async function saveStudentSmccdGoal(
  supabase: SupabaseClient,
  input: {
    userId: string;
    planId: string;
    programId: string;
    isPrimary?: boolean;
    notes?: string | null;
    existing?: StudentSmccdGoal | null;
  }
) {
  if (input.existing) {
    const updated = await supabase.from("student_smccd_goals").update({
      is_primary: input.isPrimary ?? false,
      notes: normalizeGoalNotes(input.notes)
    }).eq("id", input.existing.id).eq("user_id", input.userId).select("*").single();
    if (updated.error) throw new Error(updated.error.message);
    return withPlanScope(updated.data, input.planId);
  }
  const inserted = await insertStudentSmccdGoals(supabase, {
    userId: input.userId,
    planId: input.planId,
    goals: [{ programId: input.programId, isPrimary: input.isPrimary, notes: input.notes }]
  });
  if (!inserted[0]) throw new Error("The degree bookmark was not saved.");
  return inserted[0];
}
