import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, buildTransparentReviewPrompt, CODEX_FEATURES, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus, requiredAssistantEvidenceRead } from "@/server/codex";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { ASSISTANT_MESSAGE_MAX_LENGTH, assistantTurnSchema } from "@/server/ai-schemas";
import { parseAssistantToolCall } from "@/server/ai-tools";
import { autoReviewResultSchema, buildAutoReviewPrompt } from "@/server/ai-auto-review";
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

  it("accepts a useful short answer and rejects report-length output", () => {
    const answer = "Design Lab is the only open requirement. Add one verified 10-credit option, then confirm it with your counselor.";
    expect(assistantTurnSchema.parse({ assistant_message: answer, tool_calls: [] }).assistant_message).toBe(answer);
    expect(() => assistantTurnSchema.parse({ assistant_message: "x".repeat(ASSISTANT_MESSAGE_MAX_LENGTH + 1), tool_calls: [] })).toThrow();
  });

  it("accepts bounded structured student questions without treating them as tools", () => {
    const parsed = assistantTurnSchema.parse({
      assistant_message: "Choose the school year for this course.",
      questions: [{
        id: "school_year",
        prompt: "When do you plan to take it?",
        options: [{ id: "junior", label: "Grade 11" }, { id: "senior", label: "Grade 12" }],
        allow_custom: true
      }],
      tool_calls: []
    });
    expect(parsed.questions[0]?.options).toHaveLength(2);
  });

  it("validates exact tool arguments and marks writes for confirmation", () => {
    expect(parseAssistantToolCall("list_plan_courses", { status: "current" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("add_next_step", { title: "Meet with my counselor", category: "admin", due_label: null })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("update_enrollment_preference", { program_type: "concurrent" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("audit_transcript_data", { include_source_text: true })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_gpa_evidence", { scope: "projected" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("evaluate_gpa_scenario", { target_weighted_gpa: 4, choices: [] })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_enrollment_constraints", {})).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_student_data_inventory", {})).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("save_plan_snapshot", { label: "Before senior changes" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("set_college_goal", { program_id: "CSM:computer-science-as", notes: "Explore" })).toMatchObject({ mutatesData: true });
    expect(() => parseAssistantToolCall("move_plan_course", { plan_course_id: "not-a-uuid", status: "planned" })).toThrow();
    expect(() => parseAssistantToolCall("unknown_removed_tool", {})).toThrow();
  });

  it("allowlists the onboarding model choices and recommends Luna", () => {
    expect(AI_MODEL_OPTIONS[0]).toMatchObject({ value: "gpt-5.6-luna", recommended: true });
    expect(aiModelSchema.parse("gpt-5.5")).toBe("gpt-5.5");
    expect(() => aiModelSchema.parse("arbitrary-model")).toThrow();
    expect(aiReviewModeSchema.parse("auto_review")).toBe("auto_review");
    expect(() => aiReviewModeSchema.parse("full_access")).toThrow();
  });

  it("builds a separate autonomous review prompt and bounds its decision", () => {
    const prompt = buildAutoReviewPrompt({
      userMessage: "Add a counseling task",
      toolName: "add_next_step",
      arguments: { title: "Meet counselor", category: "admin" },
      explanation: "Add the requested task."
    });
    expect(prompt).toContain("separate approval reviewer");
    expect(prompt).toContain("Approve when the student's message explicitly and unambiguously requests this exact change");
    expect(prompt).toContain("An explicit removal, grade edit, or move to Done may be approved");
    expect(prompt).toContain('"title":"Meet counselor"');
    expect(autoReviewResultSchema.parse({ decision: "approve", risk: "low", summary: "The request and proposal match." })).toMatchObject({ decision: "approve", risk: "low" });
    expect(autoReviewResultSchema.parse({ decision: "deny", risk: "high", summary: "The proposal is broader than requested." })).toMatchObject({ decision: "deny", risk: "high" });
    expect(() => autoReviewResultSchema.parse({ decision: "manual", risk: "medium", summary: "Ask the student." })).toThrow();
  });

  it("tells the assistant to read records and defer writes to the selected review mode", () => {
    const prompt = assistantConversationPrompt({
      history: [],
      userMessage: "Add a math course",
      images: [{ type: "local_image", path: "/private/tmp/schedule.png" }],
      imageNames: ["schedule.png"],
      pageContext: { view: "courses" },
      model: "gpt-5.6-luna",
      reviewMode: "manual",
      executeReadTool: async () => ({ summary: "ok", data: {} }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("Use read-only student-data tools");
    expect(prompt).toContain("audit_transcript_data with include_source_text true");
    expect(prompt).toContain("A source being marked needs_review is not itself an error");
    expect(prompt).toContain("printed GPA and earned-credit totals");
    expect(prompt).toContain("graduation requirement gap is a downstream plan result");
    expect(prompt).toContain("name at most three exact affected course records");
    expect(prompt).toContain("manual or auto-review mode");
    expect(prompt).toContain("create a dashboard-style report or table");
    expect(prompt).toContain("Default to one to three short sentences");
    expect(prompt).toContain("Keep assistant_message under 900 characters");
    expect(prompt).toContain("use the available mutating tool");
    expect(prompt).toContain("explicitly attached 1 image: schedule.png");
    expect(prompt).toContain("Use visible image content only as context for this turn");
    expect(prompt).toContain("ask up to three short structured questions");
  });

  it("accepts the expanded student-data tools in structured assistant output", () => {
    expect(assistantTurnSchema.parse({ assistant_message: "I prepared the update.", tool_calls: [{
      name: "update_enrollment_preference",
      arguments_json: '{"program_type":"concurrent"}',
      explanation: "Use the SMCCD concurrent-enrollment policy."
    }] }).tool_calls[0]?.name).toBe("update_enrollment_preference");
    expect(assistantTurnSchema.parse({ assistant_message: "I checked the saved schedule.", tool_calls: [{
      name: "evaluate_gpa_scenario",
      arguments_json: '{"target_weighted_gpa":4.5,"choices":[]}',
      explanation: "Evaluate the saved schedule."
    }] }).tool_calls[0]?.name).toBe("evaluate_gpa_scenario");
  });

  it("requires deterministic evidence before answering transcript audits", () => {
    expect(requiredAssistantEvidenceRead("Double check my transcript and parsed data for errors")).toEqual({
      name: "audit_transcript_data",
      arguments: { include_source_text: true }
    });
    expect(requiredAssistantEvidenceRead("What is a transcript?")).toBeNull();
  });

  it("loads exact plan IDs before bulk course changes", () => {
    expect(requiredAssistantEvidenceRead("Remove all my in progress classes.")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "current" }
    });
    expect(requiredAssistantEvidenceRead("Delete every planned course")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "planned" }
    });
    expect(requiredAssistantEvidenceRead("Mark all my in progress classes complete")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "current" }
    });
    expect(requiredAssistantEvidenceRead("Move every planned course to in progress")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "planned" }
    });
    expect(requiredAssistantEvidenceRead("Move all courses to planned")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all" }
    });
    expect(requiredAssistantEvidenceRead("Remove all classes except Economics")).toBeNull();
    expect(requiredAssistantEvidenceRead("Move all classes but keep Government current")).toBeNull();
    expect(requiredAssistantEvidenceRead("What are all my current classes?")).toBeNull();
    expect(parseAssistantToolCall("remove_plan_courses", { plan_course_ids: [crypto.randomUUID(), crypto.randomUUID()] })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("move_plan_courses", { plan_course_ids: [crypto.randomUUID(), crypto.randomUUID()], status: "completed" })).toMatchObject({ mutatesData: true });
    expect(requiredAssistantEvidenceRead("Mark all my next steps complete")).toEqual({
      name: "get_next_steps",
      arguments: {}
    });
    expect(requiredAssistantEvidenceRead("Delete every custom task")).toEqual({
      name: "get_next_steps",
      arguments: {}
    });
    expect(requiredAssistantEvidenceRead("Show all my next steps")).toBeNull();
    expect(requiredAssistantEvidenceRead("Check all my next steps for issues")).toBeNull();
    expect(requiredAssistantEvidenceRead("Complete every task except meeting my counselor")).toBeNull();
    expect(parseAssistantToolCall("complete_next_steps", { task_ids: [crypto.randomUUID(), crypto.randomUUID()] })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("remove_next_steps", { task_ids: [crypto.randomUUID()] })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("search_smccd_programs", { query: "computer science", college: "CSM", award_type: "AS" })).toMatchObject({ mutatesData: false });
  });
});
