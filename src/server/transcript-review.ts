import type { CatalogReviewItem, Confidence, Course, SmccdCourse } from "@/lib/models";
import { normalizeCourseName } from "@/lib/course-names";
import {
  findTranscriptCatalogMatch,
  isDtechIntersessionCourse,
  normalizeCollegeCourseCode,
  resolveTranscriptWeighting,
  stripTranscriptQuarterPrefix,
  type TranscriptCourseClassification
} from "@/lib/transcript";
import { institutionKeyFromName } from "@/lib/institutions";
import { findSmccdCourseMatch } from "@/lib/smccd";
import type { ParsedTranscriptResult } from "@/server/ai-schemas";

export interface ProposedTranscriptReviewRow {
  user_id: string;
  source_id: string;
  entity_type: "transcript_course" | "transcript_note";
  proposed_payload: Record<string, unknown>;
  confidence: Confidence;
  status: "pending" | "approved";
  uncertainty_notes: string[];
}

function previousSchoolYear(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{4})$/);
  return match ? `${Number(match[1]) - 1}-${Number(match[2]) - 1}` : value;
}

function plannerPlacementForTranscriptCourse(course: ParsedTranscriptResult["courses"][number]) {
  if (course.term !== "summer" || course.grade_level === null || course.grade_level <= 9) return course;
  return {
    ...course,
    grade_level: course.grade_level - 1,
    school_year: previousSchoolYear(course.school_year)
  };
}

export function transcriptReviewRows(
  userId: string,
  sourceId: string,
  result: ParsedTranscriptResult,
  courses: Course[],
  smccdCourses: SmccdCourse[]
): ProposedTranscriptReviewRow[] {
  const courseRows: ProposedTranscriptReviewRow[] = result.courses.map((course) => {
    const plannerCourse = plannerPlacementForTranscriptCourse(course);
    const isIntersession = isDtechIntersessionCourse(plannerCourse);
    const normalizedCourse = isIntersession
      ? { ...plannerCourse, course_name: stripTranscriptQuarterPrefix(plannerCourse.course_name), subject: "Personal Development", weighted: false }
      : plannerCourse;
    const institutionKey = institutionKeyFromName(normalizedCourse.institution_name);
    const districtInstitution = institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN" || institutionKey === "smccd";
    const isCollegeCourse = Boolean(normalizedCourse.course_code && (districtInstitution || Number(normalizedCourse.college_units ?? 0) > 0));
    const smccdMatch = isCollegeCourse
      ? findSmccdCourseMatch({
          courseCode: normalizedCourse.course_code,
          courseName: normalizedCourse.course_name,
          institutionName: normalizedCourse.institution_name
        }, smccdCourses)
      : null;
    const match = isCollegeCourse || isIntersession ? null : findTranscriptCatalogMatch(normalizedCourse.course_name, courses);
    const transcriptClassification: TranscriptCourseClassification = isCollegeCourse
      ? smccdMatch ? "smccd_catalog" : "smccd_unmatched"
      : isIntersession ? "dtech_intersession" : match ? "dtech_catalog" : "custom";
    const institutionConflict = transcriptClassification === "dtech_catalog" && districtInstitution;
    const reconciledCourse = institutionConflict
      ? { ...normalizedCourse, institution_name: "Design Tech High School" }
      : normalizedCourse;
    const weighting = resolveTranscriptWeighting({
      ...reconciledCourse,
      matched_course_id: match?.id ?? null,
      matched_smccd_course_id: smccdMatch?.id ?? null,
      transcript_classification: transcriptClassification
    }, courses);
    const uncertaintyNotes = [
      ...(transcriptClassification === "custom" ? ["No exact d.tech catalog match was found. This course will remain custom until reviewed."] : []),
      ...(isCollegeCourse && !smccdMatch ? ["No exact SMCCD catalog match was found for this college course code."] : []),
      ...(normalizedCourse.grade_level === null ? ["Grade level was not explicit in the transcript."] : []),
      ...(normalizedCourse.credits === null && match?.credits === null ? ["Credits need manual confirmation."] : [])
    ];
    return {
      user_id: userId,
      source_id: sourceId,
      entity_type: "transcript_course",
      proposed_payload: {
        ...reconciledCourse,
        reported_institution_name: institutionConflict ? normalizedCourse.institution_name : null,
        institution_resolution: institutionConflict ? "dtech_catalog_identity" : "reported",
        matched_course_id: match?.id ?? null,
        matched_course_name: match?.name ?? null,
        matched_smccd_course_id: smccdMatch?.id ?? null,
        matched_smccd_course_name: smccdMatch ? `${smccdMatch.course_code} ${smccdMatch.title}` : null,
        college_units: smccdMatch ? Number(smccdMatch.units_max ?? smccdMatch.units_min) : normalizedCourse.college_units,
        transcript_classification: transcriptClassification,
        grading_basis: isIntersession ? "pass_fail" : "letter",
        weighted: weighting.weighted,
        weighting_basis: weighting.basis,
        weighting_source_id: weighting.sourceId,
        import_status: "completed"
      },
      confidence: uncertaintyNotes.length > 0 ? "uncertain" : normalizedCourse.confidence,
      status: "pending",
      uncertainty_notes: uncertaintyNotes
    };
  });
  const noteRow: ProposedTranscriptReviewRow = {
    user_id: userId,
    source_id: sourceId,
    entity_type: "transcript_note",
    proposed_payload: {
      summary: result.summary,
      student_name: result.student_name,
      school_name: result.school_name,
      academic_years: result.academic_years,
      conflicts: result.conflicts,
      counselor_questions: result.counselor_questions
    },
    confidence: result.conflicts.length > 0 ? "uncertain" : "likely",
    status: "approved",
    uncertainty_notes: result.conflicts
  };
  return [...courseRows, noteRow];
}

function transcriptCourseIdentity(payload: Record<string, unknown>) {
  const courseName = String(payload.course_name ?? "");
  const courseCode = normalizeCollegeCourseCode(String(payload.course_code ?? ""))
    ?? normalizeCollegeCourseCode(courseName);
  const institutionName = String(payload.institution_name ?? "");
  const institution = institutionKeyFromName(institutionName)
    ?? normalizeCourseName(institutionName);
  return [
    courseCode ?? normalizeCourseName(courseName),
    institution,
    String(payload.grade_level ?? ""),
    String(payload.school_year ?? "")
  ].join("|");
}

function transcriptCourseMatchScore(existing: CatalogReviewItem, proposed: ProposedTranscriptReviewRow) {
  const left = existing.proposed_payload;
  const right = proposed.proposed_payload;
  if (String(left.grade_level ?? "") !== String(right.grade_level ?? "")) return -1;
  if (String(left.school_year ?? "") !== String(right.school_year ?? "")) return -1;

  const leftCode = normalizeCollegeCourseCode(String(left.course_code ?? ""));
  const rightCode = normalizeCollegeCourseCode(String(right.course_code ?? ""));
  if ((leftCode || rightCode) && leftCode !== rightCode) return -1;

  const leftName = normalizeCourseName(String(left.course_name ?? ""));
  const rightName = normalizeCourseName(String(right.course_name ?? ""));
  const shorter = leftName.length <= rightName.length ? leftName : rightName;
  const longer = shorter === leftName ? rightName : leftName;
  const sameName = leftName === rightName;
  const compatibleTruncation = shorter.length >= 12 && longer.startsWith(shorter);
  if (!sameName && !compatibleTruncation) return -1;

  return (transcriptCourseIdentity(left) === transcriptCourseIdentity(right) ? 100 : 0)
    + (leftCode && leftCode === rightCode ? 80 : sameName ? 60 : 40)
    + (String(left.term ?? "") === String(right.term ?? "") ? 8 : 0)
    + (String(left.letter_grade ?? "") === String(right.letter_grade ?? "") ? 4 : 0)
    + (String(left.credits ?? "") === String(right.credits ?? "") ? 2 : 0);
}

export function reconcileTranscriptReviewRows(
  existingRows: CatalogReviewItem[],
  proposedRows: ProposedTranscriptReviewRow[]
) {
  const available = existingRows.filter((item) => item.entity_type === "transcript_course");
  const claimed = new Set<string>();
  const matched: Array<{ existing: CatalogReviewItem; proposed: ProposedTranscriptReviewRow }> = [];
  const inserts: ProposedTranscriptReviewRow[] = [];
  for (const row of proposedRows.filter((item) => item.entity_type === "transcript_course")) {
    const candidates = available
      .filter((existing) => !claimed.has(existing.id))
      .map((existing) => ({ existing, score: transcriptCourseMatchScore(existing, row) }))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score || left.existing.id.localeCompare(right.existing.id));
    const existing = candidates[0]?.existing;
    if (existing) claimed.add(existing.id);
    if (existing) matched.push({ existing, proposed: row });
    else inserts.push(row);
  }

  return {
    matched,
    inserts,
    stale: available.filter((row) => !claimed.has(row.id)),
    existingNote: existingRows.find((item) => item.entity_type === "transcript_note") ?? null,
    proposedNote: proposedRows.find((item) => item.entity_type === "transcript_note") ?? null
  };
}
