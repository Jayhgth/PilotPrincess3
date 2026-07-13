import { describe, expect, it } from "vitest";
import { academicPeriodForDate, courseOccursInAcademicPeriod, nextAcademicPeriod } from "@/lib/planning";
import type { PlanCourse } from "@/lib/models";

const row = (term: PlanCourse["term"], schoolYear = "2025-2026") => ({ term, school_year: schoolYear } as PlanCourse);

describe("academic period placement", () => {
  it("uses the actual calendar term instead of the broad course status", () => {
    const spring = academicPeriodForDate(new Date(2026, 2, 10));
    expect(spring).toEqual({ term: "spring", schoolYear: "2025-2026", label: "Spring 2026" });
    expect(courseOccursInAcademicPeriod(row("spring"), spring)).toBe(true);
    expect(courseOccursInAcademicPeriod(row("fall"), spring)).toBe(false);
    expect(courseOccursInAcademicPeriod(row("full_year"), spring)).toBe(true);
  });

  it("moves from summer into the next school year's fall term", () => {
    const summer = academicPeriodForDate(new Date(2026, 6, 13));
    expect(summer).toEqual({ term: "summer", schoolYear: "2025-2026", label: "Summer 2026" });
    expect(nextAcademicPeriod(summer)).toEqual({ term: "fall", schoolYear: "2026-2027", label: "Fall 2026" });
    expect(courseOccursInAcademicPeriod(row("full_year"), summer)).toBe(false);
  });
});
