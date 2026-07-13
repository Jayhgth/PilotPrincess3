import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentSmccdGoal } from "@/lib/models";

const goalCache = new Map<string, StudentSmccdGoal[]>();
const goalRequests = new Map<string, Promise<StudentSmccdGoal[]>>();

export function cachedStudentSmccdGoals(userId: string) {
  return goalCache.get(userId) ?? null;
}

export function cacheStudentSmccdGoals(userId: string, goals: StudentSmccdGoal[]) {
  goalCache.set(userId, goals);
}

export function loadStudentSmccdGoals(supabase: SupabaseClient, userId: string) {
  const cached = goalCache.get(userId);
  if (cached) return Promise.resolve(cached);
  const pending = goalRequests.get(userId);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from("student_smccd_goals")
      .select("*")
      .eq("user_id", userId);
      if (error) throw error;
      const goals = (data ?? []) as unknown as StudentSmccdGoal[];
      goalCache.set(userId, goals);
      return goals;
  })().finally(() => goalRequests.delete(userId));
  goalRequests.set(userId, request);
  return request;
}
