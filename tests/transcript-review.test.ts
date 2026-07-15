import { describe, expect, it } from "vitest";
import type { CatalogReviewItem, Course, SmccdCourse } from "@/lib/models";
import type { ParsedTranscriptResult } from "@/server/ai-schemas";
import {
  reconcileTranscriptReviewRows,
  transcriptReviewRows,
  type ProposedTranscriptReviewRow
} from "@/server/transcript-review";

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

function parsedResult(courses: ParsedTranscriptResult["courses"], schoolName = "Design Tech High School"): ParsedTranscriptResult {
  return {
    summary: "Transcript parsed.",
    student_name: null,
    school_name: schoolName,
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
  it("places an upcoming-grade S0 course in the preceding high-school summer", () => {
    const [row] = transcriptReviewRows(
      "user-1",
      "source-1",
      parsedResult([{
        ...baseCourse,
        course_name: "Summer Seminar",
        grade_level: 10,
        school_year: "2024-2025",
        term: "summer"
      }]),
      [],
      []
    );

    expect(row.proposed_payload).toMatchObject({
      grade_level: 9,
      school_year: "2023-2024",
      term: "summer"
    });
  });

  it("replaces inferred d.tech weighting with exact title and official catalog evidence", () => {
    const environmentalScience = catalogCourse({
      id: "environmental-science",
      source_id: "official-dtech-catalog",
      name: "Environmental Science",
      subject: "Laboratory Science",
      is_honors: false,
      is_weighted: false
    });
    const [row] = transcriptReviewRows(
      "user-1",
      "source-1",
      parsedResult([{
        ...baseCourse,
        course_name: "Environmental Science",
        subject: "Laboratory Science",
        institution_name: "College of San Mateo",
        letter_grade: "A",
        weighted: true
      }]),
      [environmentalScience],
      []
    );

    expect(row.proposed_payload).toMatchObject({
      matched_course_id: environmentalScience.id,
      institution_name: "Design Tech High School",
      reported_institution_name: "College of San Mateo",
      institution_resolution: "dtech_catalog_identity",
      weighted: false,
      weighting_basis: "dtech_printed_standard",
      weighting_source_id: "official-dtech-catalog"
    });
  });

  it("preserves review identities when a replacement transcript corrects the term", () => {
    const existing = {
      id: "review-1",
      user_id: "user-1",
      source_id: "source-1",
      entity_type: "transcript_course",
      proposed_payload: { ...baseCourse, term: "full_year" },
      corrected_payload: null,
      status: "approved",
      confidence: "verified",
      uncertainty_notes: [],
      created_at: "2026-07-12T00:00:00.000Z"
    } satisfies CatalogReviewItem;
    const replacementRows = transcriptReviewRows(
      "user-1",
      "source-1",
      parsedResult([{ ...baseCourse, term: "spring" }]),
      [],
      []
    ) as ProposedTranscriptReviewRow[];

    const reconciliation = reconcileTranscriptReviewRows([existing], replacementRows);

    expect(reconciliation.matched).toHaveLength(1);
    expect(reconciliation.matched[0].existing.id).toBe("review-1");
    expect(reconciliation.matched[0].proposed.proposed_payload.term).toBe("spring");
    expect(reconciliation.inserts).toEqual([]);
    expect(reconciliation.stale).toEqual([]);
  });

  it("preserves review identities when reparsing corrects a leaked institution heading", () => {
    const existing = {
      id: "review-1",
      user_id: "user-1",
      source_id: "source-1",
      entity_type: "transcript_course",
      proposed_payload: {
        ...baseCourse,
        institution_name: "College of San Mateo",
        subject: null,
        transcript_classification: "custom"
      },
      corrected_payload: null,
      status: "approved",
      confidence: "verified",
      uncertainty_notes: [],
      created_at: "2026-07-12T00:00:00.000Z"
    } satisfies CatalogReviewItem;
    const replacementRows = transcriptReviewRows("user-1", "source-1", parsedResult([baseCourse]), [], []);

    const reconciliation = reconcileTranscriptReviewRows([existing], replacementRows);

    expect(reconciliation.matched[0]?.existing.id).toBe("review-1");
    expect(reconciliation.inserts).toEqual([]);
    expect(reconciliation.stale).toEqual([]);
  });

  it("preserves review identities when a replacement expands a truncated title", () => {
    const existing = {
      id: "review-1",
      user_id: "user-1",
      source_id: "source-1",
      entity_type: "transcript_course",
      proposed_payload: { ...baseCourse, course_name: "Physical Therapy & Wellness" },
      corrected_payload: null,
      status: "approved",
      confidence: "verified",
      uncertainty_notes: [],
      created_at: "2026-07-12T00:00:00.000Z"
    } satisfies CatalogReviewItem;
    const replacementRows = transcriptReviewRows(
      "user-1",
      "source-1",
      parsedResult([{ ...baseCourse, course_name: "Physical Therapy & Wellness Essential" }]),
      [],
      []
    );

    const reconciliation = reconcileTranscriptReviewRows([existing], replacementRows);

    expect(reconciliation.matched[0]?.existing.id).toBe("review-1");
    expect(reconciliation.inserts).toEqual([]);
    expect(reconciliation.stale).toEqual([]);
  });

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

  it("uses only the selected non-d.tech school catalog and its weighting evidence", () => {
    const carlmontCourse = catalogCourse({
      id: "carlmont-ap-biology",
      school_id: "carlmont-school",
      name: "AP Biology",
      subject: "Biology / Life Sciences",
      is_honors: true,
      is_weighted: true
    });
    const academic = {
      ...baseCourse,
      course_name: "AP Biology",
      subject: "Biology / Life Sciences",
      institution_name: "Carlmont High",
      letter_grade: "A",
      credits: 10,
      weighted: null
    };
    const [row] = transcriptReviewRows(
      "user-1",
      "source-1",
      parsedResult([academic], "Carlmont High"),
      [carlmontCourse],
      [],
      { id: "carlmont-school", name: "Carlmont High", slug: "carlmont-high" }
    );

    expect(row.uncertainty_notes).toEqual([]);
    expect(row.proposed_payload).toMatchObject({
      institution_name: "Carlmont High",
      matched_course_id: "carlmont-ap-biology",
      transcript_classification: "high_school_catalog",
      weighted: true,
      weighting_basis: "catalog_default"
    });
  });

  it("keeps a truly unmatched academic course in review", () => {
    const custom = { ...baseCourse, course_name: "Independent Robotics Study", subject: null, letter_grade: "A", credits: 5 };
    const [row] = transcriptReviewRows("user-1", "source-1", parsedResult([custom]), [], []);

    expect(row.confidence).toBe("uncertain");
    expect(row.proposed_payload).toMatchObject({ transcript_classification: "custom" });
    expect(row.uncertainty_notes[0]).toContain("No exact selected-school catalog match");
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
