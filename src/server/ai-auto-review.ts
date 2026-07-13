import { z } from "zod";
import type { AiModel } from "@/lib/ai-preferences";
import { assistantToolLabel, type AssistantToolName } from "@/server/ai-tools";
import { runCodexStructured } from "@/server/codex";

export const autoReviewResultSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  risk: z.enum(["low", "medium", "high"]),
  summary: z.string().trim().min(1).max(240)
});

export type AutoReviewResult = z.infer<typeof autoReviewResultSchema>;

const autoReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "risk", "summary"],
  properties: {
    decision: { type: "string", enum: ["approve", "deny"] },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" }
  }
} as const;

export function buildAutoReviewPrompt(input: {
  userMessage: string;
  toolName: AssistantToolName;
  arguments: Record<string, unknown>;
  explanation: string;
}) {
  return [
    "You are a separate approval reviewer for Pilot Princess, not the assistant that proposed the change.",
    "Review one proposed student-data mutation and make the final autonomous apply-or-decline decision.",
    "Approve when the student's message explicitly and unambiguously requests this exact change, the target and arguments match, and no missing fact needs interpretation.",
    "An explicit removal, grade edit, or move to Done may be approved. Use the risk label to describe impact, not to force a student confirmation.",
    "For add_course_schedule, an explicit request to generate, suggest, or build a schedule may approve the exact deterministic batch when respect_recommended_limit is true. A structured Yes answer to Pilot's explicit add-schedule question may also approve the shown batch; a structured Yes or No answer to Pilot's unit-limit question may approve the batch when the arguments match that answer. A No answer to an add-schedule question must never approve a write. Normal schedule revalidation still runs before insertion.",
    "Deny when the request is ambiguous, the proposal is unrelated or broader than requested, it contradicts the request, depends on counselor or institutional judgment, attempts to certify an outcome, or bypasses product evidence rules.",
    "Normal RLS, transcript locks, eligibility, prerequisite, and record validation will run again after approval. Do not assume approval guarantees execution.",
    "Return a short student-readable summary. Do not expose hidden reasoning or mention this schema.",
    `Student message: ${input.userMessage}`,
    `Proposed action: ${assistantToolLabel(input.toolName)}`,
    `Exact arguments: ${JSON.stringify(input.arguments)}`,
    `Assistant explanation: ${input.explanation}`
  ].join("\n\n");
}

export async function reviewAssistantProposal(input: {
  userMessage: string;
  toolName: AssistantToolName;
  arguments: Record<string, unknown>;
  explanation: string;
  model: AiModel;
  signal?: AbortSignal;
}): Promise<AutoReviewResult> {
  const result = await runCodexStructured({
    feature: "assistant_auto_review",
    prompt: buildAutoReviewPrompt(input),
    schema: autoReviewResultSchema,
    outputSchema: autoReviewJsonSchema,
    model: input.model,
    reasoningEffort: "low",
    timeoutMs: 60_000,
    signal: input.signal
  });

  return result.value;
}
