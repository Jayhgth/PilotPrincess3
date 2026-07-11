import { z } from "zod";

export const DEFAULT_AI_MODEL = "gpt-5.6-luna" as const;
export const AI_REASONING_EFFORT = "low" as const;
export const aiReviewModeSchema = z.enum(["manual", "auto_review"]);
export type AiReviewMode = z.infer<typeof aiReviewModeSchema>;

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

export function formatAiReasoning(value: string) {
  return value === "low" ? "Light" : value.charAt(0).toUpperCase() + value.slice(1);
}
