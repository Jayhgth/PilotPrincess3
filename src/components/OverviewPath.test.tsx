import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OverviewPath, { type OverviewPathData } from "./OverviewPath";

const data: OverviewPathData = {
  earnedPercent: 80,
  completedCredits: 180,
  scheduledCredits: 20,
  projectedWeightedGpa: "4.20",
  knownWeeklyHours: 12,
  workloadWarning: null,
  requirements: [
    { id: "english", name: "English", remaining: 0 },
    { id: "design", name: "Design Lab", remaining: 0 }
  ],
  currentCourses: [{ id: "current", name: "English 4", source: "d.tech", institution: "dtech" }],
  plannedCourses: [{ id: "planned", name: "CIS 127", source: "CSM", institution: "CSM" }],
  courseCounts: { completed: 18, current: 1, planned: 1 },
  tasks: [{ id: "task", title: "Confirm registration", detail: "This month", generated: false }],
  summary: "The plan is covered after scheduled coursework."
};

describe("OverviewPath", () => {
  it("renders the selected temporal Overview with institution-scoped course sources", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(<OverviewPath
      data={data}
      onOpenGraduation={noop}
      onOpenCourses={noop}
      onOpenProfile={noop}
      onGenerateTimeline={noop}
      onCompleteTask={noop}
      onAddTask={noop}
      onDeleteTask={noop}
    />);

    expect(html).toContain("Your path to graduation");
    expect(html).toContain("Finished");
    expect(html).toContain("In progress");
    expect(html).toContain("Next");
    expect(html).toContain("institution-dtech");
    expect(html).toContain("institution-csm");
    expect(html).toContain("The plan is covered after scheduled coursework.");
    expect(html).not.toContain("overview-concept-review");
  });
});
