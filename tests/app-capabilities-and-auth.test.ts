import { describe, expect, it } from "vitest";
import { affectedWorkspaceDomains, mutationReviewMode, pilotToolNamesForMessage } from "@/lib/app-capabilities";
import { safeAuthRedirect } from "@/lib/auth";

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
    expect(mutationReviewMode("remove_plan_courses")).toBe("model");
    expect(pilotToolNamesForMessage("Change the app to dark mode")).toContain("update_student_settings");
    expect(affectedWorkspaceDomains("update_student_settings")).toEqual(["identity", "settings", "plan", "graduation", "pilot"]);
    }

    {
    expect(safeAuthRedirect("/app?view=courses")).toBe("/app?view=courses");
    expect(safeAuthRedirect("https://example.com/steal")).toBe("/app");
    expect(safeAuthRedirect("//example.com/steal")).toBe("/app");
    }
  });
});
