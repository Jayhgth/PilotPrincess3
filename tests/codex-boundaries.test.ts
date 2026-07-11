import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, buildTransparentReviewPrompt, CODEX_FEATURES, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus } from "@/server/codex";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { assistantTurnSchema } from "@/server/ai-schemas";
import { parseAssistantToolCall } from "@/server/ai-tools";
import { assistantKnowledgePrompt } from "@/server/assistant-knowledge";
import { autoReviewManualReason, autoReviewResultSchema, buildAutoReviewPrompt } from "@/server/ai-auto-review";
import { AI_MODEL_OPTIONS, aiModelSchema, aiReviewModeSchema } from "@/lib/ai-preferences";

describe("Codex feature boundaries", () => {
  it("keeps transcript text parsing and planning math deterministic", () => {
    const featureMap = Object.fromEntries(CODEX_FEATURES.map((feature) => [feature.id, feature.usesCodex]));
    const configuredModel = process.env.CODEX_MODEL;
    delete process.env.CODEX_MODEL;
    const status = codexRuntimeStatus();
    if (configuredModel === undefined) delete process.env.CODEX_MODEL;
    else process.env.CODEX_MODEL = configuredModel;

    expect(featureMap.structured_transcripts).toBe(false);
    expect(featureMap.planning_math).toBe(false);
    expect(featureMap.image_transcript_ocr).toBe(true);
    expect(featureMap.global_assistant).toBe(true);
    expect(featureMap.assistant_plan_changes).toBe(true);
    expect(status.features).toEqual(CODEX_FEATURES);
    expect(status.maxConcurrentTurns).toBe(2);
    expect(status.maxWaitingTurns).toBe(4);
    expect(status.model).toBe("gpt-5.6-luna");
    expect(status.reasoningEffort).toBe("low");
    expect(status.accessPolicy).toContain("sent to OpenAI Codex");
    expect(status.retentionPolicy).toContain("No local Codex CLI session history");
    expect(status.capabilities).toEqual(CODEX_RUNTIME_CAPABILITIES);
  });

  it("builds one inspectable review prompt with the access and mutation boundary", () => {
    const prompt = buildTransparentReviewPrompt("gpa_review", "SNAPSHOT: {\"weighted\":4.2}");

    expect(prompt).toContain("Feature: gpa_review");
    expect(prompt).toContain("Do not execute commands, inspect files, use tools, or access the network.");
    expect(prompt).toContain("Never imply that you changed the student's plan.");
    expect(prompt).toContain("no more than three observations");
    expect(prompt).toContain("SNAPSHOT: {\"weighted\":4.2}");
  });

  it("turns nested Codex runtime errors into a useful message", () => {
    const error = new Error(JSON.stringify({
      type: "error",
      status: 400,
      error: {
        type: "invalid_request_error",
        message: "The 'gpt-5.6-luna' model requires a newer version of Codex."
      }
    }));

    expect(codexErrorMessage(error, "Codex failed.")).toBe(
      "This server is still running an older Codex CLI. Restart the app to load the upgraded runtime."
    );
  });

  it("bounds and redacts sensitive SDK event payload values", () => {
    expect(sanitizeCodexText("Authorization: Bearer secret-token-value")).toBe("Authorization: Bearer [redacted]");
    expect(sanitizeCodexText("key=sk-proj-abcdefghijklmnop")).toBe("key=[redacted]");
    expect(sanitizeCodexValue({ clientSecret: "visible", nested: { refresh_token: "also-visible", safe: "keep" } })).toEqual({
      clientSecret: "[redacted]",
      nested: { refresh_token: "[redacted]", safe: "keep" }
    });
  });

  it("accepts a conversational answer without the former review-card length ceiling", () => {
    const answer = "This response is intentionally longer than the old 240 character next-action field. ".repeat(5);
    expect(assistantTurnSchema.parse({ assistant_message: answer, tool_calls: [] }).assistant_message).toBe(answer);
  });

  it("validates exact tool arguments and marks writes for confirmation", () => {
    expect(parseAssistantToolCall("list_plan_courses", { status: "current" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("add_next_step", { title: "Meet with my counselor", category: "admin", due_label: null })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("update_student_profile", { stress_level: 4, weekly_commitment_limit: 18 })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("add_experience", { name: "Robotics", kind: "club", weekly_hours: 4 })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("run_load_check", { college_units: 3, activity_hours_change: -2 })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("set_college_goal", { program_id: "CSM:computer-science-as", notes: "Explore" })).toMatchObject({ mutatesData: true });
    expect(() => parseAssistantToolCall("move_plan_course", { plan_course_id: "not-a-uuid", status: "planned" })).toThrow();
    expect(() => parseAssistantToolCall("update_experience", { experience_id: crypto.randomUUID() })).toThrow();
  });

  it("allowlists the onboarding model choices and recommends Luna", () => {
    expect(AI_MODEL_OPTIONS[0]).toMatchObject({ value: "gpt-5.6-luna", recommended: true });
    expect(aiModelSchema.parse("gpt-5.5")).toBe("gpt-5.5");
    expect(() => aiModelSchema.parse("arbitrary-model")).toThrow();
    expect(aiReviewModeSchema.parse("auto_review")).toBe("auto_review");
    expect(() => aiReviewModeSchema.parse("full_access")).toThrow();
  });

  it("keeps destructive and academic-evidence changes in manual review", () => {
    expect(autoReviewManualReason("remove_plan_course", { plan_course_id: crypto.randomUUID() })).toContain("removes saved student data");
    expect(autoReviewManualReason("move_plan_course", { status: "completed" })).toContain("academic status");
    expect(autoReviewManualReason("update_plan_course", { letter_grade: "A" })).toContain("recorded grade");
    expect(autoReviewManualReason("update_student_profile", { preferred_name: "Jay" })).toContain("identity");
    expect(autoReviewManualReason("add_next_step", { title: "Meet counselor" })).toBeNull();
  });

  it("builds a separate risk-review prompt and bounds its decision", () => {
    const prompt = buildAutoReviewPrompt({
      userMessage: "Add a counseling task",
      toolName: "add_next_step",
      arguments: { title: "Meet counselor", category: "admin" },
      explanation: "Add the requested task."
    });
    expect(prompt).toContain("separate approval reviewer");
    expect(prompt).toContain("Approve only when the student's message explicitly requests this exact change");
    expect(prompt).toContain('"title":"Meet counselor"');
    expect(autoReviewResultSchema.parse({ decision: "approve", risk: "low", summary: "The request and proposal match." })).toMatchObject({ decision: "approve", risk: "low" });
  });

  it("formats retrieved product guidance with source ownership", () => {
    const prompt = assistantKnowledgePrompt([{ id: "role", title: "Pilot role", content: "Use deterministic evidence.", sourcePath: "docs/AI_TRANSPARENCY.md", tags: ["assistant"], score: 1 }]);
    expect(prompt).toContain("[Pilot role]");
    expect(prompt).toContain("Use deterministic evidence.");
    expect(prompt).toContain("docs/AI_TRANSPARENCY.md");
  });

  it("tells the assistant to read records and defer writes to the selected review mode", () => {
    const prompt = assistantConversationPrompt({
      history: [],
      userMessage: "Add a math course",
      pageContext: { view: "courses" },
      knowledge: "Course changes require confirmation.",
      model: "gpt-5.6-luna",
      reviewMode: "manual",
      executeReadTool: async () => ({ summary: "ok", data: {} }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("Use read-only student-data tools");
    expect(prompt).toContain("manual or auto-review mode");
    expect(prompt).toContain("Do not create a dashboard-style report or use tables");
    expect(prompt).toContain("Course changes require confirmation.");
  });

  it("accepts the expanded student-data tools in structured assistant output", () => {
    expect(assistantTurnSchema.parse({ assistant_message: "I prepared the update.", tool_calls: [{
      name: "update_student_profile",
      arguments_json: '{"stress_level":3}',
      explanation: "Update the requested stress level."
    }] }).tool_calls[0]?.name).toBe("update_student_profile");
  });
});
