import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentSmccdGoal } from "@/lib/models";

const goalCache = new Map<string, StudentSmccdGoal[]>();
const goalRequests = new Map<string, Promise<StudentSmccdGoal[]>>();

function cacheKey(userId: string, planId: string) {
  return `${userId}:${planId}`;
}

export function cachedStudentSmccdGoals(userId: string, planId: string) {
  return goalCache.get(cacheKey(userId, planId)) ?? null;
}

export function cacheStudentSmccdGoals(userId: string, planId: string, goals: StudentSmccdGoal[]) {
  goalCache.set(cacheKey(userId, planId), goals);
}

export function loadStudentSmccdGoals(supabase: SupabaseClient, userId: string, planId: string) {
  const key = cacheKey(userId, planId);
  const cached = goalCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = goalRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from("student_smccd_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_id", planId);
      if (error) throw error;
      const goals = (data ?? []) as unknown as StudentSmccdGoal[];
      goalCache.set(key, goals);
      return goals;
  })().finally(() => goalRequests.delete(key));
  goalRequests.set(key, request);
  return request;
}
