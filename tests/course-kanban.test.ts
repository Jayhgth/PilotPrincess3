import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CourseKanban from "@/components/CourseKanban";
import type { PlanCourse, StudentSettings } from "@/lib/models";

function row(id: string, name: string, gradeLevel: PlanCourse["grade_level"], status: PlanCourse["status"], term: PlanCourse["term"]): PlanCourse {
  return {
    id,
    plan_version_id: "version-1",
    user_id: "user-1",
    course_id: null,
    custom_course_name: name,
    grade_level: gradeLevel,
    school_year: `${2022 + gradeLevel - 9}-${2023 + gradeLevel - 9}`,
    term,
    status,
    credits: 10,
    college_units: null,
    letter_grade: status === "completed" ? "A" : null,
    is_weighted: false,
    mapping_verified: false,
    user_edited: true,
    notes: null,
    sort_order: 0,
    source_review_item_id: status === "completed" ? `review-${id}` : null,
    smccd_course_id: null,
    college_provider_code: null,
    requirement_area_override: null
  };
}

describe("four-year course board", () => {
  it("opens the current grade and keeps every school year one click away", () => {
    const html = renderToStaticMarkup(createElement(CourseKanban, {
      rows: [
        row("completed", "Completed Algebra", 11, "completed", "full_year"),
        row("current", "Current English", 11, "current", "spring"),
        row("future", "Future Physics", 12, "planned", "fall")
      ],
      courses: [],
      smccdCourses: [],
      settings: { grade_level: 11, graduation_year: 2027 } as StudentSettings,
      editingCourseId: null,
      busy: false,
      onEditingChange: () => undefined,
      onMove: () => undefined,
      onUpdate: () => undefined,
      onRemove: () => undefined,
      onGeneratePlan: () => undefined
    }));

    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('id="course-grade-11"');
    expect(html.match(/class="course-year /g)).toHaveLength(1);
    expect(html.match(/class="course-term-lane /g)).toHaveLength(3);
    expect(html).toContain("Completed courses cannot move");
    expect(html).toContain("Move Current English. Drag this card to another school year or term.");
    expect(html).not.toContain("Future Physics");
    expect(html).toContain("Full year");
  });
});
