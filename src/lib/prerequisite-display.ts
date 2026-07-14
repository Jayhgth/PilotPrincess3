import type { PlannerPrerequisiteEvaluation } from "@/lib/prerequisites";

export function prerequisiteDisplay(evaluation: PlannerPrerequisiteEvaluation) {
  if (evaluation.originalTexts.length === 0) {
    return { label: "No prereq", tone: "none" as const };
  }
  if (evaluation.result.status === "satisfied") {
    return { label: "Met", tone: "ready" as const };
  }
  if (evaluation.result.status === "blocked") {
    return { label: "Not met", tone: "blocked" as const };
  }
  return { label: "Review", tone: "review" as const };
}
