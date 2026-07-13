import type { SupabaseClient } from "@supabase/supabase-js";
import { aiModelSchema, aiReasoningEffortSchema, aiReviewModeSchema, DEFAULT_AI_MODEL, DEFAULT_AI_REASONING_EFFORT, type AiModel, type AiReasoningEffort, type AiReviewMode } from "@/lib/ai-preferences";

export interface UserAiPreferences {
  enabled: boolean;
  model: AiModel;
  reasoningEffort: AiReasoningEffort;
  reviewMode: AiReviewMode;
  approvedAt: string | null;
  testedAt: string | null;
}

export async function loadUserAiPreferences(supabase: SupabaseClient, userId: string): Promise<UserAiPreferences> {
  const { data, error } = await supabase
    .from("student_settings")
    .select("ai_enabled, ai_model, ai_reasoning_effort, ai_review_mode, ai_connection_approved_at, ai_setup_tested_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return {
    enabled: data.ai_enabled === true,
    model: aiModelSchema.catch(DEFAULT_AI_MODEL).parse(data.ai_model),
    reasoningEffort: aiReasoningEffortSchema.catch(DEFAULT_AI_REASONING_EFFORT).parse(data.ai_reasoning_effort),
    reviewMode: aiReviewModeSchema.catch("manual").parse(data.ai_review_mode),
    approvedAt: data.ai_connection_approved_at ?? null,
    testedAt: data.ai_setup_tested_at ?? null
  };
}
