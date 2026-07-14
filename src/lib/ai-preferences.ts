import { z } from "zod";

export const DEFAULT_AI_MODEL = "gpt-5.6-luna" as const;
export const DEFAULT_AI_REASONING_EFFORT = "low" as const;
export const aiReviewModeSchema = z.enum(["manual", "auto_review"]);
export type AiReviewMode = z.infer<typeof aiReviewModeSchema>;

export const AI_REASONING_OPTIONS = [
  { value: "low", label: "Light", description: "Fast, concise answers for routine planning." },
  { value: "medium", label: "Standard", description: "More analysis for comparisons and schedule questions." },
  { value: "high", label: "Deep", description: "Most thorough for complex, multi-part planning." }
] as const;

export const aiReasoningEffortSchema = z.enum(AI_REASONING_OPTIONS.map((option) => option.value) as [
  (typeof AI_REASONING_OPTIONS)[number]["value"],
  ...(typeof AI_REASONING_OPTIONS)[number]["value"][]
]);

export type AiReasoningEffort = z.infer<typeof aiReasoningEffortSchema>;

export const AI_MODEL_OPTIONS = [
  {
    value: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Best fit for planning questions and multi-step student-data work.",
    recommended: true
  },
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    description: "A compatible general-purpose option for shorter planning conversations.",
    recommended: false
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Faster for simple lookups, with less depth on multi-step requests.",
    recommended: false
  }
] as const;

export const aiModelSchema = z.enum(AI_MODEL_OPTIONS.map((option) => option.value) as [
  (typeof AI_MODEL_OPTIONS)[number]["value"],
  ...(typeof AI_MODEL_OPTIONS)[number]["value"][]
]);

export type AiModel = z.infer<typeof aiModelSchema>;

export function aiModelLabel(model: string) {
  return AI_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model;
}
