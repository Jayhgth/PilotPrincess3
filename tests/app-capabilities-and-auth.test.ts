import { describe, expect, it } from "vitest";
import { affectedWorkspaceDomains, mutationReviewMode, pilotToolNamesForMessage } from "@/lib/app-capabilities";
import { safeAuthRedirect } from "@/lib/auth";
import { assistantTurnDuration, formatAssistantDuration } from "@/lib/assistant-display";

describe("application capability and authentication boundaries", () => {
  it("enforces capability, review, and redirect boundaries", () => {
    {
    const tools = pilotToolNamesForMessage("Build a four-year schedule that completes graduation and my associate degree");
    expect(tools).toContain("get_course_schedule_options");
    expect(tools).toContain("get_degree_progress");
    expect(tools).toContain("get_enrollment_constraints");
    expect(tools).toContain("add_course_schedule");
    expect(tools).toContain("set_college_goals");
    expect(tools).not.toContain("update_student_settings");
    expect(mutationReviewMode("update_gpa_scenario")).toBe("deterministic");
    expect(mutationReviewMode("add_course_schedule", { replace_existing: false })).toBe("deterministic");
    expect(mutationReviewMode("add_course_schedule", { replace_existing: true })).toBe("model");
    expect(mutationReviewMode("remove_plan_courses")).toBe("deterministic");
    expect(pilotToolNamesForMessage("Change the app to dark mode")).toContain("update_student_settings");
    expect(pilotToolNamesForMessage("Edit my schedule, I start math at alg 2 in 9th")).toContain("update_plan_courses");
    expect(affectedWorkspaceDomains("update_student_settings")).toEqual(["identity", "settings", "plan", "graduation", "pilot"]);
    expect(formatAssistantDuration(420)).toBe("<1s");
    expect(assistantTurnDuration([
      { type: "turn.started", occurredAt: "2026-07-16T10:00:00.000Z" },
      { type: "turn.completed", occurredAt: "2026-07-16T10:00:02.000Z", latencyMs: 0 },
      { type: "safety_review.completed", occurredAt: "2026-07-16T10:00:05.000Z" },
      { type: "tool.completed", occurredAt: "2026-07-16T10:00:07.000Z" }
    ], [{ completed_at: "2026-07-16T10:00:08.000Z" }])).toBe("8s");
    }

    {
    expect(safeAuthRedirect("/app?view=courses")).toBe("/app?view=courses");
    expect(safeAuthRedirect("https://example.com/steal")).toBe("/app");
    expect(safeAuthRedirect("//example.com/steal")).toBe("/app");
    }
  });
});
