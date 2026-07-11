import { describe, expect, it } from "vitest";
import { assistantTurnDuration, assistantTurnStartedAt, formatAssistantDuration } from "@/lib/assistant-display";

describe("assistant turn display", () => {
  it("formats compact t3code-style elapsed times", () => {
    expect(formatAssistantDuration(999)).toBe("0s");
    expect(formatAssistantDuration(42_800)).toBe("42s");
    expect(formatAssistantDuration(72_000)).toBe("1m 12s");
    expect(formatAssistantDuration(7_260_000)).toBe("2h 1m");
  });

  it("prefers the measured assistant latency", () => {
    expect(assistantTurnDuration([
      { type: "turn.started", occurredAt: "2026-07-11T12:00:00.000Z" },
      { type: "turn.completed", occurredAt: "2026-07-11T12:00:30.000Z", latencyMs: 12_450 }
    ])).toBe("12s");
  });

  it("falls back to lifecycle timestamps for failed turns", () => {
    const events = [
      { type: "turn.started", occurredAt: "2026-07-11T12:00:00.000Z" },
      { type: "turn.failed", occurredAt: "2026-07-11T12:01:05.000Z" }
    ];
    expect(assistantTurnStartedAt(events)).toBe("2026-07-11T12:00:00.000Z");
    expect(assistantTurnDuration(events)).toBe("1m 5s");
  });

  it("keeps timing for a student-cancelled turn", () => {
    expect(assistantTurnDuration([
      { type: "turn.started", occurredAt: "2026-07-11T12:00:00.000Z" },
      { type: "turn.cancelled", occurredAt: "2026-07-11T12:00:08.500Z" }
    ])).toBe("8s");
  });

  it("uses lifecycle timestamps when a completed event has no measured latency", () => {
    expect(assistantTurnDuration([
      { type: "turn.started", occurredAt: "2026-07-11T12:00:00.000Z" },
      { type: "turn.completed", occurredAt: "2026-07-11T12:00:09.500Z", latencyMs: null }
    ])).toBe("9s");
  });

  it("does not invent timing when lifecycle evidence is incomplete", () => {
    expect(assistantTurnStartedAt([{ type: "turn.started", occurredAt: "not-a-date" }])).toBeNull();
    expect(assistantTurnDuration([{ type: "reasoning", occurredAt: "2026-07-11T12:00:00.000Z" }])).toBeNull();
  });
});
