import { z } from "zod";
import type { AiModel } from "@/lib/ai-preferences";
import { assistantToolLabel, type AssistantToolName } from "@/server/ai-tools";
import { parseAssistantScheduleIntent, runCodexStructured } from "@/server/codex";

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
    "You are the separate safety reviewer for Pilot Princess, not the assistant that proposed the change.",
    "Review one proposed student-data mutation and make the final autonomous apply-or-decline decision.",
    "Approve when the student's message explicitly and unambiguously requests this exact change, the target and arguments match, and no missing fact needs interpretation.",
    "An explicit removal, grade edit, or move to Done may be approved. Use the risk label to describe impact, not to force a student confirmation.",
    "For undo_change, approve when the student explicitly asks to undo, revert, restore, or bring back the referenced recent change and the proposal targets the exact conversation action supplied by the server. The stored inverse and undo window are revalidated at execution.",
    "For add_course_schedule, an explicit request to generate, suggest, or build a schedule may approve only the exact selected-school batch returned by the deterministic planner. The selected school must have verified diploma evidence, every explicit starting-course, grade, workload, rigor, and college inclusion/exclusion constraint must match, and every requirement gap must be closed. Existing courses must be retained unless the student explicitly requested a clear-and-rebuild and replace_existing is true; transcript-backed rows are always retained. Never approve a partial plan, cross-school fallback, or mismatched replacement. Normal schedule revalidation still runs before insertion.",
    "For submit_shared_data_correction, approve only the submission of the exact evidence-backed pending proposal the student requested. This does not approve or publish the institutional correction; an administrator must review it separately.",
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
  verifiedBatchResolution?: boolean;
  signal?: AbortSignal;
}): Promise<AutoReviewResult> {
  if (input.toolName === "undo_change" && /\b(?:undo|revert|restore|reverse|rollback|roll back|bring\b.+\bback)\b/i.test(input.userMessage)) {
    return { decision: "approve", risk: "low", summary: "The request targets the exact reversible change recorded in this conversation." };
  }
  if (input.toolName === "add_course_schedule") {
    const intent = parseAssistantScheduleIntent(input.userMessage);
    const proposedReplacement = input.arguments.replace_existing === true;
    const proposedMath = String(input.arguments.starting_math_course ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const requestedMath = String(intent.startingMathCourse ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const proposedLanguage = String(input.arguments.starting_language_course ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const requestedLanguage = String(intent.startingLanguageCourse ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const proposedReplacementGrades = Array.isArray(input.arguments.replace_grade_levels)
      ? input.arguments.replace_grade_levels.map(Number).sort((left, right) => left - right)
      : [];
    const requestedReplacementGrades = [...intent.replaceGradeLevels].sort((left, right) => left - right);
    const mismatch = proposedReplacement !== intent.replaceExisting
      || JSON.stringify(proposedReplacementGrades) !== JSON.stringify(requestedReplacementGrades)
      || (requestedMath && !proposedMath.includes(requestedMath) && !requestedMath.includes(proposedMath))
      || (requestedLanguage && !proposedLanguage.includes(requestedLanguage) && !requestedLanguage.includes(proposedLanguage))
      || (intent.startGrade && Number(input.arguments.start_grade) !== intent.startGrade)
      || (intent.includeCollegeCourses === false && input.arguments.include_college_courses !== false)
      || (intent.maxCoursesPerTerm !== null && Number(input.arguments.max_courses_per_term) !== intent.maxCoursesPerTerm);
    if (mismatch) return { decision: "deny", risk: "high", summary: "The proposed schedule does not match every constraint in your request, so it was not applied." };
    if (/\b(generate|build|create|make|draft|suggest|plan|recommend|find|design|redesign|replace|rebuild|regenerate|redo|rework)\b/i.test(input.userMessage)) {
      return {
        decision: "approve",
        risk: proposedReplacement ? "medium" : "low",
        summary: proposedReplacement
          ? "The verified rebuild matches your explicit clear-and-replace request and will remain fully undoable."
          : "The verified schedule batch matches your explicit planning request."
      };
    }
  }
  if (input.toolName === "add_academic_courses" && input.verifiedBatchResolution) {
    return {
      decision: "approve",
      risk: "medium",
      summary: "The exact mixed course batch matches the server-validated catalog, graduation, placement, prerequisite, and enrollment resolution for this request."
    };
  }
  const result = await runCodexStructured({
    feature: "assistant_safety_review",
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
