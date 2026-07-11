import { describe, expect, it } from "vitest";
import { buildTransparentReviewPrompt, CODEX_FEATURES, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus } from "@/server/codex";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { activityProjection } from "@/components/CodexReviewPanel";

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
    expect(featureMap.connection_diagnostic).toBe(true);
    expect(featureMap.transparent_plan_reviews).toBe(true);
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

  it("shows failed tool items as failed even after item completion", () => {
    const projected = activityProjection({
      source: "sdk",
      type: "item.completed",
      sequence: 4,
      occurredAt: "2026-07-11T00:00:00.000Z",
      item: {
        id: "tool-1",
        type: "command_execution",
        command: "false",
        status: "failed",
        exitCode: 1
      }
    });

    expect(projected.kind).toBe("tool");
    expect(projected.state).toBe("failed");
  });
});
