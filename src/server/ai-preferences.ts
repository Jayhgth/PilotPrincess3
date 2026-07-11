import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_REASONING_EFFORT, aiModelSchema, DEFAULT_AI_MODEL, type AiModel } from "@/lib/ai-preferences";

export interface UserAiPreferences {
  enabled: boolean;
  model: AiModel;
  reasoningEffort: typeof AI_REASONING_EFFORT;
  approvedAt: string | null;
  testedAt: string | null;
}

export async function loadUserAiPreferences(supabase: SupabaseClient, userId: string): Promise<UserAiPreferences> {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("ai_enabled, ai_model, ai_reasoning_effort, ai_connection_approved_at, ai_setup_tested_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    enabled: data.ai_enabled === true,
    model: aiModelSchema.catch(DEFAULT_AI_MODEL).parse(data.ai_model),
    reasoningEffort: AI_REASONING_EFFORT,
    approvedAt: data.ai_connection_approved_at ?? null,
    testedAt: data.ai_setup_tested_at ?? null
  };
}
