import { describe, expect, it } from "vitest";
import { prerequisiteDisplay } from "@/components/PrerequisiteReadout";
import type { PlannerPrerequisiteEvaluation } from "@/lib/prerequisites";

function evaluation(
  status: PlannerPrerequisiteEvaluation["result"]["status"],
  originalTexts: string[] = ["Algebra 1"]
): PlannerPrerequisiteEvaluation {
  return {
    originalTexts,
    result: {
      status,
      missingCourses: [],
      orderingViolations: [],
      evidence: [],
      suggestedCounselorQuestions: []
    }
  };
}

describe("prerequisite presentation", () => {
  it("uses the four student-facing prerequisite outcomes", () => {
    expect(prerequisiteDisplay(evaluation("satisfied"))).toEqual({ label: "Met", tone: "ready" });
    expect(prerequisiteDisplay(evaluation("blocked"))).toEqual({ label: "Not met", tone: "blocked" });
    expect(prerequisiteDisplay(evaluation("needs_review"))).toEqual({ label: "Review", tone: "review" });
    expect(prerequisiteDisplay(evaluation("satisfied", []))).toEqual({ label: "No prereq", tone: "none" });
  });
});
