import type { CatalogReviewItem, Course, OfficialSource, PlanCourse, SmccdCourse } from "@/lib/models";
import { courseNameAliases } from "@/lib/course-names";
import { courseDisplayName } from "@/lib/planning";
import {
  normalizeCollegeCourseCode,
  resolveTranscriptCourse,
  resolveTranscriptWeighting,
  visibleTranscriptUncertaintyNotes,
  type TranscriptCoursePayload
} from "@/lib/transcript";

const MAX_SOURCE_TEXT = 20_000;
const MAX_TOTAL_SOURCE_TEXT = 40_000;

function effectivePayload(item: CatalogReviewItem) {
  return (item.corrected_payload ?? item.proposed_payload) as unknown as TranscriptCoursePayload;
}

function sameNumber(left: unknown, right: unknown) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "";
  if (right === null || right === undefined || right === "") return false;
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function titlesMatch(left: string | null | undefined, right: string | null | undefined) {
  if (!left?.trim() || !right?.trim()) return false;
  const rightAliases = new Set(courseNameAliases(right));
  return courseNameAliases(left).some((alias) => rightAliases.has(alias));
}

function withoutCollegeCode(value: string) {
  return value.replace(/^\s*[A-Z]{2,5}\.?\s+[A-Z]?\d{2,4}(?:\.\d)?[A-Z]?\s+/i, "").trim();
}

function transcriptReportedMetrics(rawText: string | null) {
  if (!rawText) return { unweighted_gpa: null, weighted_gpa: null, credits_earned: null };
  const value = (pattern: RegExp) => {
    const match = rawText.match(pattern);
    return match ? Number(match[1]) : null;
  };
  return {
    unweighted_gpa: value(/\bunweighted(?:\s+9\s*-\s*12)?\s+gpa\s*:\s*([0-5](?:\.\d+)?)/i),
    weighted_gpa: value(/(?:^|[^a-z])weighted(?:\s+9\s*-\s*12)?\s+gpa\s*:\s*([0-5](?:\.\d+)?)/i),
    credits_earned: value(/credits\s+earned\s*:\s*(\d+(?:\.\d+)?)/i)
  };
}

function metricsForRows(rows: Array<{ payload: TranscriptCoursePayload; imported: PlanCourse | null }>, courses: Course[]) {
  let earnedCredits = 0;
  let gradedCredits = 0;
  let unweightedPoints = 0;
  let weightedPoints = 0;
  for (const { payload, imported } of rows) {
    const grade = String(imported?.letter_grade ?? payload.letter_grade ?? "").trim().toUpperCase();
    const credits = Number(imported?.credits ?? payload.credits ?? 0);
    if (credits <= 0) continue;
    earnedCredits += credits;
    const band = grade.charAt(0);
    const points = band === "A" ? 4 : band === "B" ? 3 : band === "C" ? 2 : band === "D" ? 1 : band === "F" ? 0 : null;
    if (points === null) continue;
    const weighted = resolveTranscriptWeighting(payload, courses).weighted;
    gradedCredits += credits;
    unweightedPoints += points * credits;
    weightedPoints += Math.min(5, points + (weighted ? 1 : 0)) * credits;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    unweighted_gpa: gradedCredits ? round(unweightedPoints / gradedCredits) : null,
    weighted_gpa: gradedCredits ? round(weightedPoints / gradedCredits) : null,
    credits_earned: round(earnedCredits),
    graded_credits: round(gradedCredits)
  };
}

function importedMismatch(
  payload: TranscriptCoursePayload,
  row: PlanCourse,
  courses: Course[],
  smccdCourses: SmccdCourse[]
) {
  const expectedName = row.smccd_course_id
    ? payload.matched_smccd_course_name ?? withoutCollegeCode(payload.course_name)
    : payload.course_name;
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const importedName = row.smccd_course_id
    ? smccdCourses.find((course) => course.id === row.smccd_course_id)?.title ?? row.custom_course_name
    : courseDisplayName(row, courseMap);
  const mismatches: string[] = [];
  const sameCatalogIdentity = Boolean(
    (payload.matched_course_id && payload.matched_course_id === row.course_id)
    || (payload.matched_smccd_course_id && payload.matched_smccd_course_id === row.smccd_course_id)
  );
  if (!sameCatalogIdentity && !titlesMatch(expectedName, importedName)) mismatches.push("course title or catalog identity");
  if (payload.grade_level != null && Number(payload.grade_level) !== row.grade_level) mismatches.push("grade level");
  if (payload.letter_grade && payload.letter_grade.trim().toUpperCase() !== row.letter_grade?.trim().toUpperCase()) mismatches.push("final grade");
  if (payload.credits != null && !sameNumber(payload.credits, row.credits)) mismatches.push("credits");
  if (payload.college_units != null && !sameNumber(payload.college_units, row.college_units)) mismatches.push("college units");
  if (payload.matched_course_id && payload.matched_course_id !== row.course_id) mismatches.push("high-school catalog link");
  if (payload.matched_smccd_course_id && payload.matched_smccd_course_id !== row.smccd_course_id) mismatches.push("SMCCD catalog link");
  if (resolveTranscriptWeighting(payload, courses).weighted !== row.is_weighted) mismatches.push("GPA weighting");
  return mismatches;
}

export function buildTranscriptAudit(input: {
  sources: OfficialSource[];
  reviewItems: CatalogReviewItem[];
  planCourses: PlanCourse[];
  courses: Course[];
  smccdCourses: SmccdCourse[];
  includeSourceText: boolean;
}) {
  const sourceMap = new Map(input.sources.map((source) => [source.id, source]));
  const importedByReview = new Map(
    input.planCourses.filter((row) => row.source_review_item_id).map((row) => [row.source_review_item_id!, row])
  );
  const courseRows = input.reviewItems.filter((item) => item.entity_type === "transcript_course" && sourceMap.has(item.source_id));
  let textBudget = MAX_TOTAL_SOURCE_TEXT;

  const sources = input.sources.map((source) => {
    const rows = courseRows.filter((item) => item.source_id === source.id);
    const metricRows = rows.map((item) => ({ payload: effectivePayload(item), imported: importedByReview.get(item.id) ?? null }));
    const reportedMetrics = transcriptReportedMetrics(source.raw_text);
    const calculatedMetrics = metricsForRows(metricRows, input.courses);
    const comparable = rows.length > 0 && rows.every((item) => item.status === "approved" && importedByReview.has(item.id));
    const metricMismatches = comparable ? [
      reportedMetrics.unweighted_gpa !== null && !sameNumber(reportedMetrics.unweighted_gpa, calculatedMetrics.unweighted_gpa) ? "unweighted GPA" : null,
      reportedMetrics.weighted_gpa !== null && !sameNumber(reportedMetrics.weighted_gpa, calculatedMetrics.weighted_gpa) ? "weighted GPA" : null,
      reportedMetrics.credits_earned !== null && !sameNumber(reportedMetrics.credits_earned, calculatedMetrics.credits_earned) ? "earned credits" : null
    ].filter((value): value is string => Boolean(value)) : [];
    const excerpt = input.includeSourceText && source.raw_text && textBudget > 0
      ? source.raw_text.slice(0, Math.min(MAX_SOURCE_TEXT, textBudget))
      : null;
    if (excerpt) textBudget -= excerpt.length;
    return {
      source_id: source.id,
      label: source.title,
      parse_status: source.parse_status,
      confidence: source.confidence,
      error: source.error_message,
      parsed_course_rows: rows.length,
      approved_rows: rows.filter((item) => item.status === "approved").length,
      pending_rows: rows.filter((item) => item.status === "pending").length,
      rejected_rows: rows.filter((item) => item.status === "rejected").length,
      imported_rows: rows.filter((item) => importedByReview.has(item.id)).length,
      printed_totals: reportedMetrics,
      calculated_from_parsed_rows: calculatedMetrics,
      totals_comparable: comparable,
      total_mismatches: metricMismatches,
      source_text_excerpt: excerpt,
      source_text_truncated: Boolean(source.raw_text && excerpt && excerpt.length < source.raw_text.length)
    };
  });

  const rows = courseRows.map((item) => {
    const payload = effectivePayload(item);
    const imported = importedByReview.get(item.id) ?? null;
    const resolution = resolveTranscriptCourse(payload, input.courses);
    const weighting = resolveTranscriptWeighting(payload, input.courses);
    const visibleNotes = visibleTranscriptUncertaintyNotes(payload, item.uncertainty_notes, input.courses);
    const parserIssues: string[] = [];
    const reviewItems: string[] = [];
    if (!payload.course_name?.trim()) parserIssues.push("missing course title");
    if (payload.letter_grade == null || !String(payload.letter_grade).trim()) parserIssues.push("missing final grade");
    if (payload.credits == null) parserIssues.push("missing credits");
    if (payload.grade_level == null) parserIssues.push("missing grade level");
    if (resolution.classification === "custom" || resolution.classification === "smccd_unmatched") {
      reviewItems.push("catalog identity is unresolved");
    }
    if (payload.matched_course_id && resolution.matchedCourse && !titlesMatch(payload.course_name, resolution.matchedCourse.name)) {
      parserIssues.push(`high-school catalog link (${resolution.matchedCourse.name}) does not match printed title (${payload.course_name})`);
    }
    const printedCollegeCode = normalizeCollegeCourseCode(payload.course_code ?? payload.course_name);
    const matchedCollegeCode = normalizeCollegeCourseCode(payload.matched_smccd_course_id?.split(":").at(-1));
    const stableCollegeCodeMatch = Boolean(printedCollegeCode && matchedCollegeCode && printedCollegeCode === matchedCollegeCode);
    if (payload.matched_smccd_course_name && !stableCollegeCodeMatch && !titlesMatch(withoutCollegeCode(payload.course_name), payload.matched_smccd_course_name)) {
      parserIssues.push(`SMCCD catalog link (${payload.matched_smccd_course_name}) does not match printed title (${payload.course_name})`);
    }
    if (item.status === "pending") reviewItems.push("row is awaiting student review");
    if (item.status === "approved" && !imported) parserIssues.push("approved row is not in the active plan");
    if (imported && item.status !== "approved") reviewItems.push(`imported row is ${item.status}, not approved`);
    if (imported) {
      const mismatches = importedMismatch(payload, imported, input.courses, input.smccdCourses);
      if (mismatches.length) parserIssues.push(`imported row differs on ${mismatches.join(", ")}`);
      if (!imported.mapping_verified) reviewItems.push("graduation mapping is not verified");
    }
    reviewItems.push(...visibleNotes);

    return {
      review_item_id: item.id,
      source_id: item.source_id,
      review_status: item.status,
      confidence: item.confidence,
      parsed: {
        course_name: payload.course_name,
        course_code: payload.course_code ?? null,
        institution: payload.institution_name ?? null,
        grade_level: payload.grade_level ?? null,
        school_year: payload.school_year ?? null,
        term: payload.term ?? null,
        final_grade: payload.letter_grade ?? null,
        credits: payload.credits ?? null,
        college_units: payload.college_units ?? null,
        weighted: weighting.weighted,
        weighting_basis: weighting.basis,
        weighting_source_id: weighting.sourceId,
        classification: resolution.classification,
        matched_high_school_course: resolution.matchedCourse?.name ?? payload.matched_course_name ?? null,
        matched_smccd_course: payload.matched_smccd_course_name ?? null
      },
      imported: imported ? {
        plan_course_id: imported.id,
        status: imported.status,
        course_name: imported.smccd_course_id
          ? input.smccdCourses.find((course) => course.id === imported.smccd_course_id)?.title ?? imported.custom_course_name
          : courseDisplayName(imported, new Map(input.courses.map((course) => [course.id, course]))),
        grade_level: imported.grade_level,
        final_grade: imported.letter_grade,
        credits: imported.credits,
        college_units: imported.college_units,
        weighted: imported.is_weighted,
        mapping_verified: imported.mapping_verified
      } : null,
      parser_or_reconciliation_issues: [...new Set(parserIssues)],
      verification_items: [...new Set(reviewItems)]
    };
  });

  const issueRows = rows.filter((row) => row.parser_or_reconciliation_issues.length > 0);
  const verificationRows = rows.filter((row) => row.verification_items.length > 0);
  const sourceTotalIssues = sources.flatMap((source) => source.total_mismatches.map((metric) => ({
    source_id: source.source_id,
    source_label: source.label,
    metric,
    printed: source.printed_totals[metric === "unweighted GPA" ? "unweighted_gpa" : metric === "weighted GPA" ? "weighted_gpa" : "credits_earned"],
    calculated: source.calculated_from_parsed_rows[metric === "unweighted GPA" ? "unweighted_gpa" : metric === "weighted GPA" ? "weighted_gpa" : "credits_earned"]
  })));
  return {
    scope: "Transcript extraction, row review, catalog reconciliation, and active-plan import only.",
    important_boundary: "A graduation requirement gap is a downstream plan result, not evidence of a transcript parsing error.",
    summary: {
      source_count: sources.length,
      parsed_course_count: rows.length,
      parser_or_reconciliation_issue_count: issueRows.length,
      transcript_total_mismatch_count: sourceTotalIssues.length,
      verification_item_count: verificationRows.length,
      rows_without_issues: rows.length - issueRows.length,
      verdict: issueRows.length || sourceTotalIssues.length
        ? `${issueRows.length + sourceTotalIssues.length} confirmed source, parser, or import mismatches found.`
        : verificationRows.length
          ? `No confirmed mismatch found; ${verificationRows.length} rows still need verification.`
          : "No confirmed transcript mismatch found."
    },
    confirmed_total_mismatches: sourceTotalIssues,
    sources,
    rows
  };
}
