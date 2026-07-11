import { describe, expect, it } from "vitest";
import type { CatalogReviewItem, Course, OfficialSource, PlanCourse } from "@/lib/models";
import { buildTranscriptAudit } from "@/server/assistant-audits";

const source: OfficialSource = {
  id: "source-1",
  school_id: "school-1",
  user_id: "user-1",
  title: "DTech June transcript.pdf",
  kind: "upload",
  source_url: null,
  storage_path: "user-1/transcript.pdf",
  raw_text: "Pre-Calculus Honors 10 A 10.0\nDocumentary Film 9 P 2.5",
  mime_type: "application/pdf",
  source_year: "2025-2026",
  is_official: false,
  parse_status: "needs_review",
  confidence: "uncertain",
  error_message: null,
  document_type: "transcript",
  created_at: "2026-07-11T00:00:00.000Z"
};

const catalogCourse: Course = {
  id: "course-precalc",
  school_id: "school-1",
  catalog_version_id: "catalog-1",
  source_id: null,
  course_code: null,
  name: "Pre-Calculus Honors",
  subject: "Mathematics",
  course_type: "academic",
  grade_levels: [10, 11, 12],
  credits: 10,
  college_units: null,
  term_type: "year",
  uc_ag_area: "c",
  prerequisites: [],
  description: null,
  is_honors: true,
  is_weighted: true,
  confidence: "verified",
  review_status: "approved"
};

function reviewItem(overrides: Partial<CatalogReviewItem> = {}): CatalogReviewItem {
  return {
    id: "review-precalc",
    user_id: "user-1",
    source_id: source.id,
    entity_type: "transcript_course",
    proposed_payload: {
      course_name: "Pre-Calculus Honors",
      grade_level: 10,
      school_year: "2023-2024",
      term: "full_year",
      letter_grade: "A",
      credits: 10,
      weighted: true,
      institution_name: "Design Tech High School",
      matched_course_id: catalogCourse.id,
      matched_course_name: catalogCourse.name,
      transcript_classification: "dtech_catalog"
    },
    corrected_payload: null,
    status: "approved",
    confidence: "verified",
    uncertainty_notes: [],
    created_at: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

function planCourse(overrides: Partial<PlanCourse> = {}): PlanCourse {
  return {
    id: "plan-precalc",
    plan_version_id: "version-1",
    user_id: "user-1",
    course_id: catalogCourse.id,
    custom_course_name: "Pre-Calculus Honors",
    grade_level: 10,
    school_year: "2023-2024",
    term: "full_year",
    status: "completed",
    credits: 10,
    college_units: null,
    letter_grade: "A",
    is_weighted: true,
    mapping_verified: true,
    user_edited: true,
    notes: null,
    sort_order: 0,
    source_review_item_id: "review-precalc",
    smccd_course_id: null,
    requirement_area_override: null,
    ...overrides
  };
}

describe("assistant transcript evidence audit", () => {
  it("does not convert downstream graduation gaps into transcript parsing errors", () => {
    const audit = buildTranscriptAudit({
      sources: [source],
      reviewItems: [reviewItem()],
      planCourses: [planCourse()],
      courses: [catalogCourse],
      smccdCourses: [],
      includeSourceText: true
    });

    expect(audit.important_boundary).toContain("graduation requirement gap");
    expect(audit.summary.parser_or_reconciliation_issue_count).toBe(0);
    expect(audit.rows[0]?.parser_or_reconciliation_issues).toEqual([]);
    expect(audit.sources[0]?.source_text_excerpt).toContain("Pre-Calculus Honors");
  });

  it("separates confirmed import mismatches from unresolved review items", () => {
    const unresolved = reviewItem({
      id: "review-film",
      status: "pending",
      confidence: "uncertain",
      proposed_payload: {
        course_name: "Documentary Film",
        grade_level: 9,
        letter_grade: "P",
        credits: 2.5,
        institution_name: "Design Tech High School",
        transcript_classification: "custom"
      },
      uncertainty_notes: ["No exact d.tech catalog match was found. This course will remain custom until reviewed."]
    });
    const audit = buildTranscriptAudit({
      sources: [source],
      reviewItems: [reviewItem(), unresolved],
      planCourses: [planCourse({ credits: 5 })],
      courses: [catalogCourse],
      smccdCourses: [],
      includeSourceText: false
    });

    expect(audit.rows[0]?.parser_or_reconciliation_issues).toContain("imported row differs on credits");
    expect(audit.rows[1]?.verification_items).toContain("row is awaiting student review");
    expect(audit.rows[1]?.parser_or_reconciliation_issues).toEqual([]);
    expect(audit.sources[0]?.source_text_excerpt).toBeNull();
  });
});
