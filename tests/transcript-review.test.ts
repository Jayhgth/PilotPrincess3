import { describe, expect, it } from "vitest";
import type { Course, SmccdCourse } from "@/lib/models";
import type { ParsedTranscriptResult } from "@/server/ai-schemas";
import { transcriptReviewRows } from "@/server/transcript-review";

function catalogCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    school_id: "school-1",
    catalog_version_id: "catalog-1",
    source_id: "source-1",
    course_code: null,
    name: "Advanced Physics Honors",
    subject: "Laboratory Science",
    course_type: "high_school",
    grade_levels: [11],
    credits: 10,
    college_units: null,
    term_type: "year",
    uc_ag_area: "D",
    prerequisites: [],
    description: null,
    is_honors: true,
    is_weighted: true,
    confidence: "verified",
    review_status: "approved",
    ...overrides
  };
}

function parsedResult(courses: ParsedTranscriptResult["courses"]): ParsedTranscriptResult {
  return {
    summary: "Transcript parsed.",
    student_name: null,
    school_name: "Design Tech High School",
    academic_years: ["2025-2026"],
    courses,
    conflicts: [],
    counselor_questions: []
  };
}

const baseCourse: ParsedTranscriptResult["courses"][number] = {
  course_name: "Documentary Film",
  course_code: null,
  subject: "Personal Development",
  grade_level: 11,
  school_year: "2025-2026",
  term: "spring",
  letter_grade: "P",
  credits: 2.5,
  weighted: false,
  institution_name: "Design Tech High School",
  college_units: null,
  confidence: "verified",
  evidence: "Q3 Documentary Film, P, 2.5 credits."
};

describe("transcript review reconciliation", () => {
  it("treats a recognized intersession course as resolved without requiring a catalog row", () => {
    const [row] = transcriptReviewRows("user-1", "source-1", parsedResult([baseCourse]), [], []);

    expect(row).toMatchObject({ confidence: "verified", uncertainty_notes: [] });
    expect(row.proposed_payload).toMatchObject({
      course_name: "Documentary Film",
      subject: "Personal Development",
      transcript_classification: "dtech_intersession",
      grading_basis: "pass_fail",
      matched_course_id: null
    });
  });

  it("reconciles a unique academic alias to the current d.tech catalog", () => {
    const academic = { ...baseCourse, course_name: "Advanced Physics", subject: null, letter_grade: "A", credits: 10, weighted: false };
    const [row] = transcriptReviewRows("user-1", "source-1", parsedResult([academic]), [catalogCourse()], []);

    expect(row.uncertainty_notes).toEqual([]);
    expect(row.proposed_payload).toMatchObject({
      matched_course_id: "course-1",
      matched_course_name: "Advanced Physics Honors",
      transcript_classification: "dtech_catalog",
      grading_basis: "letter"
    });
  });

  it("keeps a truly unmatched academic course in review", () => {
    const custom = { ...baseCourse, course_name: "Independent Robotics Study", subject: null, letter_grade: "A", credits: 5 };
    const [row] = transcriptReviewRows("user-1", "source-1", parsedResult([custom]), [], []);

    expect(row.confidence).toBe("uncertain");
    expect(row.proposed_payload).toMatchObject({ transcript_classification: "custom" });
    expect(row.uncertainty_notes[0]).toContain("No exact d.tech catalog match");
  });

  it("matches district course codes when the transcript uses the district name instead of a campus name", () => {
    const history = {
      ...baseCourse,
      course_name: "History 101 - History of Western Civilization II",
      course_code: "HIST 101",
      institution_name: "San Mateo County Community College District",
      college_units: 3,
      credits: null,
      letter_grade: "A",
      subject: "History"
    };
    const catalogHistory = {
      id: "CSM:HIST 101",
      college_code: "CSM",
      course_code: "HIST 101",
      title: "History of Western Civilization II",
      units_min: 3,
      units_max: 3
    } as SmccdCourse;

    const [row] = transcriptReviewRows("user-1", "source-1", parsedResult([history]), [], [catalogHistory]);

    expect(row.uncertainty_notes).toEqual([]);
    expect(row.proposed_payload).toMatchObject({
      matched_smccd_course_id: "CSM:HIST 101",
      transcript_classification: "smccd_catalog",
      college_units: 3
    });
  });
});
