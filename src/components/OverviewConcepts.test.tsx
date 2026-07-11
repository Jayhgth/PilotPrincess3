import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OverviewConcepts, { type OverviewConceptData } from "./OverviewConcepts";

const data: OverviewConceptData = {
  trackerLabel: "Graduation credits earned",
  earnedPercent: 80,
  completedCredits: 180,
  scheduledCredits: 20,
  requiredCredits: 225,
  projectedWeightedGpa: "4.20",
  gradedCredits: 180,
  workloadLabel: "Balanced",
  knownWeeklyHours: 12,
  workloadWarning: null,
  requirements: [
    { id: "english", name: "English", required: 40, completed: 40, scheduled: 0, remaining: 0, status: "complete" },
    { id: "design", name: "Design Lab", required: 40, completed: 30, scheduled: 10, remaining: 0, status: "on_track" }
  ],
  currentCourses: [{ id: "current", name: "English 4", source: "d.tech" }],
  plannedCourses: [{ id: "planned", name: "CIS 127", source: "CSM" }],
  courseCounts: { completed: 18, current: 1, planned: 1 },
  smccdCounts: { completed: 0, current: 0, planned: 1 },
  tasks: [{ id: "task", title: "Confirm registration", detail: "This month" }],
  summary: "The plan is covered after scheduled coursework."
};

describe("OverviewConcepts", () => {
  it("exposes five review concepts and renders the recommended priority brief from shared data", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(<OverviewConcepts
      data={data}
      onOpenGraduation={noop}
      onOpenCourses={noop}
      onOpenSmccd={noop}
      onOpenTimeline={noop}
      onOpenProfile={noop}
      onGenerateTimeline={noop}
      onCompleteTask={noop}
    />);

    for (const label of ["Priority", "Scorecard", "Path", "Advisor", "Two systems"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("data-demo-only=\"overview-concept-review\"");
    expect(html).toContain("Option A: Priority brief");
    expect(html).toContain("45 earned credits remain.");
    expect(html).toContain("The plan is covered after scheduled coursework.");
  });
});
