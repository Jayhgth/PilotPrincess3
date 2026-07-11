import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, buildTransparentReviewPrompt, CODEX_FEATURES, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus } from "@/server/codex";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { assistantTurnSchema } from "@/server/ai-schemas";
import { parseAssistantToolCall } from "@/server/ai-tools";

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
    expect(() => parseAssistantToolCall("move_plan_course", { plan_course_id: "not-a-uuid", status: "planned" })).toThrow();
  });

  it("tells the assistant to read records and defer writes to confirmation", () => {
    const prompt = assistantConversationPrompt({
      history: [],
      userMessage: "Add a math course",
      pageContext: { view: "courses" },
      executeReadTool: async () => ({ summary: "ok", data: {} }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("Use read-only student-data tools");
    expect(prompt).toContain("require the student to confirm");
    expect(prompt).toContain("Do not create a dashboard-style report or use tables");
  });
});
