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

export function prerequisiteWarningDetail(evaluation: PlannerPrerequisiteEvaluation) {
  if (evaluation.result.status !== "blocked") return null;
  return evaluation.result.missingCourses[0]?.message
    ?? evaluation.result.orderingViolations[0]?.message
    ?? evaluation.result.evidence.find((item) => item.satisfied === false)?.message
    ?? "A listed prerequisite is not present in an earlier term of this plan.";
}
