import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OverviewPath, { type OverviewPathData } from "@/components/OverviewPath";

const data: OverviewPathData = {
  earnedPercent: 80,
  completedCredits: 180,
  scheduledCredits: 20,
  remainingCredits: 25,
  currentWeightedGpa: "4.20",
  currentUnweightedGpa: "3.86",
  currentGradedCredits: 200,
  currentWeightedCredits: 120,
  requirements: [
    { id: "english", name: "English", remaining: 0 },
    { id: "design", name: "Design Lab", remaining: 0 }
  ],
  requirementsVerified: true,
  currentPeriodLabel: "Fall 2026",
  nextPeriodLabel: "Spring 2027",
  currentCourses: [{ id: "current", name: "English 4", source: "d.tech", institution: "dtech" }],
  plannedCourses: [{ id: "planned", name: "CIS 127", source: "CSM", institution: "CSM" }]
};

describe("OverviewPath", () => {
  it("renders the selected temporal Overview with institution-scoped course sources", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(<OverviewPath
      data={data}
      degreeProgress={<div>Degree chart</div>}
      onOpenGraduation={noop}
      onOpenCourses={noop}
      onOpenGpa={noop}
      onOpenDegrees={noop}
    />);

    expect(html).toContain("High school diploma");
    expect(html).toContain("Current GPA");
    expect(html).toContain("Associate degrees");
    expect(html).toContain("Degree chart");
    expect(html).toContain("Fall 2026");
    expect(html).toContain("Spring 2027");
    expect(html).toContain("180 credits earned, 20 scheduled, and 25 remaining");
    expect(html).toContain("institution-dtech");
    expect(html).toContain("institution-csm");
    expect(html).not.toContain("Plan evidence");
    expect(html).not.toContain("Includes only saved courses");
  });
});
