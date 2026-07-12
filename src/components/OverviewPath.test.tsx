import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OverviewPath, { type OverviewPathData } from "./OverviewPath";

const data: OverviewPathData = {
  earnedPercent: 80,
  completedCredits: 180,
  scheduledCredits: 20,
  remainingCredits: 25,
  projectedWeightedGpa: "4.20",
  currentUnweightedGpa: "3.86",
  gradedCredits: 200,
  weightedCredits: 120,
  transcriptBackedCourseCount: 16,
  completedCollegeUnits: 9,
  requirements: [
    { id: "english", name: "English", remaining: 0 },
    { id: "design", name: "Design Lab", remaining: 0 }
  ],
  currentCourses: [{ id: "current", name: "English 4", source: "d.tech", institution: "dtech" }],
  plannedCourses: [{ id: "planned", name: "CIS 127", source: "CSM", institution: "CSM" }],
  courseCounts: { completed: 18, current: 1, planned: 1 }
};

describe("OverviewPath", () => {
  it("renders the selected temporal Overview with institution-scoped course sources", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(<OverviewPath
      data={data}
      onOpenGraduation={noop}
      onOpenCourses={noop}
      onOpenGpa={noop}
    />);

    expect(html).toContain("Credit composition");
    expect(html).toContain("Saved schedule projection");
    expect(html).toContain("Plan evidence");
    expect(html).toContain("Now");
    expect(html).toContain("Planned");
    expect(html).toContain("180 credits earned, 20 scheduled, and 25 remaining");
    expect(html).toContain("institution-dtech");
    expect(html).toContain("institution-csm");
    expect(html).not.toContain("Action queue");
  });
});
