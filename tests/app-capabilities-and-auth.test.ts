import { describe, expect, it } from "vitest";
import { affectedWorkspaceDomains, mutationReviewMode, pilotToolNamesForMessage } from "@/lib/app-capabilities";
import { safeAuthRedirect } from "@/lib/auth";
import { assistantTurnDuration, formatAssistantDuration } from "@/lib/assistant-display";
import { COLLEGE_DATA } from "@/lib/college-provider-contract";
import { planVersionDisplayLabel } from "@/lib/plan-versions";
import { safeParseAssistantToolCall } from "@/server/ai-tools";
import { acquireAssistantTurn } from "@/server/assistant-request-protection";

describe("application capability and authentication boundaries", () => {
  it("enforces capability, review, and redirect boundaries", async () => {
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
    expect(mutationReviewMode("add_course_schedule", { replace_existing: true })).toBe("deterministic");
    expect(mutationReviewMode("remove_plan_courses")).toBe("deterministic");
    expect(pilotToolNamesForMessage("Change the app to dark mode")).toContain("update_student_settings");
    expect(pilotToolNamesForMessage("Edit my schedule, I start math at alg 2 in 9th")).toContain("update_plan_courses");
    const planVersionTools = pilotToolNamesForMessage("Create another plan, compare it with my current plan, then switch back");
    expect(planVersionTools).toContain("get_plan_versions");
    expect(planVersionTools).toContain("compare_plan_versions");
    expect(planVersionTools).toContain("create_plan_version");
    expect(planVersionTools).toContain("merge_plan_versions");
    expect(planVersionTools).toContain("activate_plan_version");
    expect(affectedWorkspaceDomains("activate_plan_version")).toEqual(["history", "active_plan", "plan", "graduation", "gpa", "college", "degree", "enrollment"]);
    expect(affectedWorkspaceDomains("update_student_settings")).toEqual(["identity", "settings", "plan", "graduation", "pilot"]);
    expect(affectedWorkspaceDomains("add_course_schedule")).toEqual(["history", "plan", "graduation", "gpa", "college", "enrollment"]);
    // Runtime reads stay compatible with databases deployed before the
    // provider-neutral compatibility views. The contract remains the sole
    // place future provider adapters need to change.
    expect(COLLEGE_DATA.courses).toBe("smccd_courses");
    expect(COLLEGE_DATA.programs).toBe("smccd_programs");
    expect(planVersionDisplayLabel({ kind: "active", label: "Current plan" })).toBe("New plan");
    expect(planVersionDisplayLabel({ kind: "active", label: "College plan" })).toBe("College plan");
    const mergeCall = safeParseAssistantToolCall("merge_plan_versions", {
      source_version_id: "11111111-1111-4111-8111-111111111111",
      target_version_id: "22222222-2222-4222-8222-222222222222",
      source_course_ids: ["33333333-3333-4333-8333-333333333333"]
    });
    expect(mergeCall.success).toBe(true);
    expect(safeParseAssistantToolCall("merge_plan_versions", {
      source_version_id: "11111111-1111-4111-8111-111111111111",
      target_version_id: "11111111-1111-4111-8111-111111111111",
      source_course_ids: ["33333333-3333-4333-8333-333333333333"]
    }).success).toBe(false);
    expect(formatAssistantDuration(420)).toBe("<1s");
    expect(assistantTurnDuration([
      { type: "turn.started", occurredAt: "2026-07-16T10:00:00.000Z" },
      { type: "turn.completed", occurredAt: "2026-07-16T10:00:02.000Z", latencyMs: 0 },
      { type: "safety_review.completed", occurredAt: "2026-07-16T10:00:05.000Z" },
      { type: "tool.completed", occurredAt: "2026-07-16T10:00:07.000Z" }
    ], [{ completed_at: "2026-07-16T10:00:08.000Z" }])).toBe("8s");
    let limiterCalls = 0;
    const transientLimiter = await acquireAssistantTurn(async () => {
      limiterCalls += 1;
      return limiterCalls === 1
        ? { data: null, error: { code: "PGRST000", message: "Transient connection error" } }
        : { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
    }, async () => undefined);
    expect(transientLimiter).toEqual({ status: "allowed", retryAfterSeconds: 0 });
    expect(limiterCalls).toBe(2);
    const unavailableLimiter = await acquireAssistantTurn(async () => ({
      data: null,
      error: { code: "PGRST202", message: "Function unavailable" }
    }), async () => undefined);
    expect(unavailableLimiter.status).toBe("unavailable");
    }

    {
    expect(safeAuthRedirect("/app?view=courses")).toBe("/app?view=courses");
    expect(safeAuthRedirect("https://example.com/steal")).toBe("/app");
    expect(safeAuthRedirect("//example.com/steal")).toBe("/app");
    }
  });
});
