import { z } from "zod";
import type { AiModel } from "@/lib/ai-preferences";
import { assistantToolLabel, type AssistantToolName } from "@/server/ai-tools";
import { runCodexStructured } from "@/server/codex";

export const autoReviewResultSchema = z.object({
  decision: z.enum(["approve", "manual", "deny"]),
  risk: z.enum(["low", "medium", "high"]),
  summary: z.string().trim().min(1).max(240)
});

export type AutoReviewResult = z.infer<typeof autoReviewResultSchema>;

const autoReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "risk", "summary"],
  properties: {
    decision: { type: "string", enum: ["approve", "manual", "deny"] },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" }
  }
} as const;

const DESTRUCTIVE_TOOLS = new Set<AssistantToolName>([
  "remove_plan_course",
  "remove_experience",
  "remove_next_step",
  "clear_college_goal"
]);

export function autoReviewManualReason(name: AssistantToolName, argumentsValue: Record<string, unknown>) {
  if (DESTRUCTIVE_TOOLS.has(name)) return "This removes saved student data, so it needs your confirmation.";
  if (name === "move_plan_course" && argumentsValue.status === "completed") return "Marking a course Done changes academic status, so it needs your confirmation.";
  if (name === "update_plan_course" && argumentsValue.letter_grade !== undefined) return "Changing a recorded grade needs your confirmation.";
  if (name === "update_student_profile" && argumentsValue.preferred_name !== undefined) return "Changing student identity information needs your confirmation.";
  return null;
}

export function buildAutoReviewPrompt(input: {
  userMessage: string;
  toolName: AssistantToolName;
  arguments: Record<string, unknown>;
  explanation: string;
}) {
  return [
    "You are a separate approval reviewer for Pilot Princess, not the assistant that proposed the change.",
    "Review one proposed student-data mutation using a conservative risk framework.",
    "Approve only when the student's message explicitly requests this exact change, the arguments match that request, the action is low-risk and reversible, and no missing fact needs interpretation.",
    "Choose manual when the request is ambiguous, consequential, identity-sensitive, destructive, or depends on counselor or institutional judgment.",
    "Deny when the proposal is unrelated to the request, contradicts it, attempts to certify an outcome, or bypasses product evidence rules.",
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
  const manualReason = autoReviewManualReason(input.toolName, input.arguments);
  if (manualReason) return { decision: "manual", risk: "high", summary: manualReason };

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

  if (result.value.decision === "approve" && result.value.risk !== "low") {
    return { ...result.value, decision: "manual", summary: "Auto-review found enough risk that this change still needs your confirmation." };
  }
  return result.value;
}
