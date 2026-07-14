import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GpaPlanningLab from "@/components/GpaPlanningLab";
import type { PlanCourse } from "@/lib/models";

function row(id: string, college = false): PlanCourse {
  return {
    id,
    plan_version_id: "version-1",
    user_id: "user-1",
    course_id: null,
    custom_course_name: college ? "College Algebra" : "English 4",
    grade_level: 12,
    school_year: "2026-2027",
    term: "full_year",
    status: "planned",
    credits: college ? 0 : 10,
    college_units: college ? 3 : null,
    letter_grade: null,
    is_weighted: college,
    mapping_verified: true,
    user_edited: true,
    notes: null,
    sort_order: 0,
    source_review_item_id: null,
    smccd_course_id: college ? "CSM:MATH 120" : null,
    college_provider_code: college ? "SMCCD" : null,
    requirement_area_override: null
  };
}

describe("GPA planning lab", () => {
  it("uses animated school lists and a bulk-grade action without target framing", () => {
    const html = renderToStaticMarkup(createElement(GpaPlanningLab, {
      rows: [row("high-school"), row("college", true)],
      courses: [],
      smccdCourses: [],
      equivalencies: [],
      choices: [],
      onOpenCourses: () => undefined,
      onChoicesChange: () => undefined,
      onScenarioChange: () => undefined
    }));

    expect(html).toContain("Grade for all");
    expect(html).toContain("Set all");
    expect(html).toContain("High school");
    expect(html).toContain("College");
    expect(html.match(/data-react-bits="animated-list"/g)).toHaveLength(2);
    expect(html).toContain("Expected grade for English 4");
    expect(html).toContain("3 units");
    expect(html).not.toContain("GPA cr");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain(">Include<");
    expect(html).not.toContain("Choose grade");
    expect(html).not.toContain("Target weighted GPA");
    expect(html).not.toContain("Pilot can compare this calculator");
    expect(html).not.toContain("completed transcript already meets");
  });

  it("renders parent-owned scenario choices", () => {
    const html = renderToStaticMarkup(createElement(GpaPlanningLab, {
      rows: [row("high-school")],
      courses: [],
      smccdCourses: [],
      equivalencies: [],
      choices: [{ planCourseId: "high-school", included: false, expectedGrade: "B" }],
      onOpenCourses: () => undefined,
      onChoicesChange: () => undefined,
      onScenarioChange: () => undefined
    }));

    expect(html).toContain('data-excluded="true"');
    expect(html).toContain('<option value="B" selected="">B</option>');
  });
});
