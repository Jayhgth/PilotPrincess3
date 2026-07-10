import type { Course, SmccdCourse } from "@/lib/models";
import {
  findTranscriptCatalogMatch,
  isDtechIntersessionCourse,
  stripTranscriptQuarterPrefix,
  type TranscriptCourseClassification
} from "@/lib/transcript";
import { normalizeSmccdCourseCode, SMCCD_COLLEGE_NAMES } from "@/lib/smccd";
import type { ParsedTranscriptResult } from "@/server/ai-schemas";

export function transcriptReviewRows(
  userId: string,
  sourceId: string,
  result: ParsedTranscriptResult,
  courses: Course[],
  smccdCourses: SmccdCourse[]
) {
  const courseRows = result.courses.map((course) => {
    const isIntersession = isDtechIntersessionCourse(course);
    const normalizedCourse = isIntersession
      ? { ...course, course_name: stripTranscriptQuarterPrefix(course.course_name), subject: "Personal Development", weighted: false }
      : course;
    const institutionCode = Object.entries(SMCCD_COLLEGE_NAMES).find(([, name]) => name === normalizedCourse.institution_name)?.[0];
    const isCollegeCourse = Boolean(normalizedCourse.course_code && institutionCode);
    const normalizedCollegeCode = normalizedCourse.course_code ? normalizeSmccdCourseCode(normalizedCourse.course_code) : null;
    const collegeMatches = normalizedCollegeCode
      ? smccdCourses.filter((candidate) => candidate.course_code === normalizedCollegeCode)
      : [];
    const smccdMatch = collegeMatches.find((candidate) => candidate.college_code === institutionCode)
      ?? (collegeMatches.length === 1 ? collegeMatches[0] : null);
    const match = isCollegeCourse || isIntersession ? null : findTranscriptCatalogMatch(normalizedCourse.course_name, courses);
    const transcriptClassification: TranscriptCourseClassification = isCollegeCourse
      ? smccdMatch ? "smccd_catalog" : "smccd_unmatched"
      : isIntersession ? "dtech_intersession" : match ? "dtech_catalog" : "custom";
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
        ...normalizedCourse,
        matched_course_id: match?.id ?? null,
        matched_course_name: match?.name ?? null,
        matched_smccd_course_id: smccdMatch?.id ?? null,
        matched_smccd_course_name: smccdMatch ? `${smccdMatch.course_code} ${smccdMatch.title}` : null,
        college_units: smccdMatch ? Number(smccdMatch.units_max ?? smccdMatch.units_min) : normalizedCourse.college_units,
        transcript_classification: transcriptClassification,
        grading_basis: isIntersession ? "pass_fail" : "letter",
        import_status: "completed"
      },
      confidence: uncertaintyNotes.length > 0 ? "uncertain" : normalizedCourse.confidence,
      status: "pending",
      uncertainty_notes: uncertaintyNotes
    };
  });
  const noteRow = {
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
