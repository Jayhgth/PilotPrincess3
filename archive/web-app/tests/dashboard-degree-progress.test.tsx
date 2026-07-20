import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DashboardDegreeProgress from "@/components/DashboardDegreeProgress";
import type { SmccdProgram, StudentSmccdGeCompletion, StudentSmccdGoal } from "@/lib/models";
import { calculateSmccdLocalDegreeProgress, smccdDegreeOverallPercent } from "@/lib/smccd";

vi.mock("@/lib/smccd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smccd")>();
  return {
    ...actual,
    createSmccdProgramProgressContext: vi.fn(() => ({ context: true })),
    calculateSmccdProgramProgressWithContext: vi.fn(() => ({ majorPercent: 48 })),
    calculateSmccdLocalDegreeProgress: vi.fn(() => ({ geAreas: [], graduationRequirements: [] })),
    smccdDegreeOverallPercent: vi.fn(() => 73)
  };
});

describe("DashboardDegreeProgress", () => {
  it("uses the same overall degree percentage as the Degrees tab", () => {
    const program: SmccdProgram = {
      id: "CSM:test-as",
      college_code: "CSM",
      program_code: "TEST-AS",
      title: "Test Degree",
      award_type: "AS",
      total_degree_units: 60,
      total_major_units_text: "30 units",
      catalog_url: "https://catalog.collegeofsanmateo.edu/",
      source_year: "2026-2027"
    };
    const goal: StudentSmccdGoal = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), plan_id: crypto.randomUUID(), program_id: program.id, is_primary: true, notes: "" };
    const completion: StudentSmccdGeCompletion = { user_id: goal.user_id, college_code: "CSM", area: "7A", completion_source: "manual" };
    const html = renderToStaticMarkup(<DashboardDegreeProgress
      planCourses={[]}
      plannedSmccdCourses={[]}
      goals={[goal]}
      programs={[program]}
      requirements={[]}
      requirementCourses={[]}
      manualCompletions={[completion]}
      onOpen={vi.fn()}
    />);

    expect(html).toContain("Test Degree: 73% complete");
    expect(html).toContain(">73%</b>");
    expect(html).not.toContain(">48%</b>");
    expect(calculateSmccdLocalDegreeProgress).toHaveBeenCalledWith(expect.anything(), "CSM", new Set(["7A"]));
    expect(smccdDegreeOverallPercent).toHaveBeenCalledOnce();
  });
});
