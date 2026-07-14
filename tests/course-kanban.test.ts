import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CourseKanban from "@/components/CourseKanban";
import {
  compareCourseBoardRows,
  courseAppearsInBoardTerm,
  courseBoardTermsForGrade,
  orderedCourseIdsForAutomaticBoardSort,
  orderedCourseIdsForBoardMove
} from "@/lib/course-board";
import type { PlanCourse, StudentSettings } from "@/lib/models";

function row(id: string, name: string, gradeLevel: PlanCourse["grade_level"], status: PlanCourse["status"], term: PlanCourse["term"], overrides: Partial<PlanCourse> = {}): PlanCourse {
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
    requirement_area_override: null,
    ...overrides
  };
}

function renderBoard(rows: PlanCourse[], gradeLevel: PlanCourse["grade_level"] = 11) {
  return renderToStaticMarkup(createElement(CourseKanban, {
    rows,
    courses: [],
    smccdCourses: [],
    settings: { grade_level: gradeLevel, graduation_year: 2027 } as StudentSettings,
    busy: false,
    onMove: () => undefined,
    onRemove: () => undefined,
    onSort: () => undefined,
    onGeneratePlan: () => undefined
  }));
}

describe("four-year course board", () => {
  it("opens the current grade and keeps every school year one click away", () => {
    const html = renderBoard([
      row("completed", "Completed Algebra", 11, "completed", "full_year"),
      row("current", "Current English", 11, "current", "spring"),
      row("future", "Future Physics", 12, "planned", "fall")
    ]);

    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('id="course-grade-11"');
    expect(html).toContain("2025-2026 · 2 courses");
    expect(html.match(/class="course-year /g)).toHaveLength(1);
    expect(html.match(/class="course-term-lane /g)).toHaveLength(3);
    expect(html).not.toContain("course-year-header");
    expect(html).toContain("Completed courses cannot move");
    expect(html).toContain("Move Current English. Drag this card to another school year or term.");
    expect(html).not.toContain("Future Physics");
    expect(html).toContain("Full year");
    expect(html.match(/Completed Algebra/g)).toHaveLength(4);
    expect(html).toContain("Completed Algebra, full-year course continuing in spring.");
    expect(html).toContain("Remove Current English");
    expect(html).toContain("Drag editable courses by the dotted handle to another grade or term. Completed and transcript-backed courses stay locked.");
    expect(html).toContain("Sort courses");
    expect(html).not.toContain("course-edit-button");
    expect(html).not.toContain("kanban-course-editor");
  });

  it("omits senior summer and shows one full-year record in both semester lanes", () => {
    const html = renderBoard([
      row("full-year", "Senior English", 12, "current", "full_year"),
      row("spring", "Government", 12, "current", "spring")
    ], 12);

    expect(courseBoardTermsForGrade(12)).toEqual(["fall", "spring"]);
    expect(html.match(/class="course-term-lane /g)).toHaveLength(2);
    expect(html).not.toContain("grade-12-summer");
    expect(courseAppearsInBoardTerm(row("year", "Year", 12, "current", "full_year"), "fall")).toBe(true);
    expect(courseAppearsInBoardTerm(row("year", "Year", 12, "current", "full_year"), "spring")).toBe(true);
  });

  it("orders college first, high school second, and pass/fail last", () => {
    const college = row("college", "College Course", 11, "current", "fall", { college_provider_code: "SMCCD", college_units: 3 });
    const highSchool = row("high-school", "High School Course", 11, "current", "fall");
    const passFail = row("pass-fail", "Pass Fail Course", 11, "completed", "fall", {
      letter_grade: "P",
      requirement_area_override: "personal_development"
    });

    expect([passFail, highSchool, college].sort(compareCourseBoardRows).map((course) => course.id)).toEqual([
      "college",
      "high-school",
      "pass-fail"
    ]);
  });

  it("restores college-first order without overriding manual order until requested", () => {
    const skyline = row("skyline", "Skyline Calculus", 11, "current", "fall", {
      college_provider_code: "SMCCD",
      college_units: 5,
      sort_order: 9
    });
    const highSchool = row("high-school", "High School English", 11, "current", "fall", { sort_order: 0 });
    const otherYear = row("other-year", "Senior Government", 12, "planned", "fall", { sort_order: 0 });

    expect([skyline, highSchool].sort(compareCourseBoardRows).map((course) => course.id)).toEqual(["high-school", "skyline"]);
    expect(orderedCourseIdsForAutomaticBoardSort([highSchool, otherYear, skyline], 11)).toEqual(["skyline", "high-school"]);
  });

  it("projects stable order when a course moves within or across school years", () => {
    const algebra = row("algebra", "Algebra", 11, "current", "fall", { sort_order: 0 });
    const english = row("english", "English", 11, "current", "fall", { sort_order: 1 });
    const physics = row("physics", "Physics", 12, "planned", "fall", { sort_order: 0 });
    const rows = [algebra, english, physics];

    expect(orderedCourseIdsForBoardMove(rows, english.id, 11, "fall", algebra.id)).toEqual([
      english.id,
      algebra.id
    ]);
    expect(orderedCourseIdsForBoardMove(rows, physics.id, 11, "fall", algebra.id, true)).toEqual([
      algebra.id,
      physics.id,
      english.id
    ]);
    expect(orderedCourseIdsForBoardMove(rows, algebra.id, 12, "fall", null)).toEqual([
      physics.id,
      algebra.id
    ]);
  });
});
