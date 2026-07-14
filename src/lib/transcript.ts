import type {
  Course,
  CourseRequirementMapping,
  GradeLevel,
  PlanCourse,
  SmccdHighSchoolEquivalency,
  StudentSettings
} from "@/lib/models";
import { courseEquivalenceKeys, courseNameAliases, normalizeCourseName } from "@/lib/course-names";
import { normalizeCollegeCourseCode } from "@/lib/college-course-identity";
import { resolveCollegeHighSchoolCredits } from "@/lib/college-credits";
import { institutionKeyFromName } from "@/lib/institutions";
import { schoolYearForGrade } from "@/lib/planning";

export { normalizeCollegeCourseCode } from "@/lib/college-course-identity";

const DTECH_INSTITUTION_PATTERN = /Design Tech High School|\bd\.?tech\b/i;
const DTECH_CATALOG_MISS = "No exact d.tech catalog match was found.";
const SMCCD_CATALOG_MISS = "No exact SMCCD catalog match was found";

export type TranscriptCourseClassification =
  | "dtech_catalog"
  | "dtech_intersession"
  | "smccd_catalog"
  | "smccd_unmatched"
  | "custom";

export function findTranscriptCatalogMatch(name: string, courses: Course[]) {
  const normalized = normalizeCourseName(name);
  if (!normalized) return null;
  const exact = courses.filter((course) => courseNameAliases(course.name).includes(normalized));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const transcriptKeys = courseEquivalenceKeys(name);
  const equivalent = courses.filter((course) => {
    for (const key of courseEquivalenceKeys(course.name)) {
      if (transcriptKeys.has(key)) return true;
    }
    return false;
  });
  return equivalent.length === 1 ? equivalent[0] : null;
}

export function stripTranscriptQuarterPrefix(name: string) {
  return name.replace(/^\s*Q[1-4]\s+/i, "").replace(/\s+/g, " ").trim();
}

export function isDtechIntersessionCourse(payload: TranscriptCoursePayload) {
  const grade = payload.letter_grade?.trim().toUpperCase() ?? "";
  if (grade !== "P" && grade !== "F") return false;
  const institutionIsDtech = DTECH_INSTITUTION_PATTERN.test(payload.institution_name ?? "");
  const quarterPrefix = /^\s*Q[1-4]\b/i.test(payload.course_name);
  const personalDevelopment = payload.subject?.trim().toLowerCase() === "personal development";
  if (grade === "P" && institutionIsDtech) return true;
  return (institutionIsDtech && (quarterPrefix || personalDevelopment))
    || (payload.transcript_classification === "dtech_intersession" && personalDevelopment);
}

export function findHighSchoolEquivalency(
  payload: Pick<TranscriptCoursePayload, "course_code" | "course_name" | "matched_smccd_course_id">,
  equivalencies: SmccdHighSchoolEquivalency[]
) {
  const smccdCode = payload.matched_smccd_course_id?.split(":").at(-1) ?? null;
  const normalized = normalizeCollegeCourseCode(payload.course_code ?? smccdCode ?? payload.course_name);
  return normalized
    ? equivalencies.find((equivalency) => equivalency.normalized_course_code === normalized) ?? null
    : null;
}

export interface TranscriptCoursePayload {
  course_name: string;
  course_code?: string | null;
  subject?: string | null;
  grade_level?: number | null;
  school_year?: string | null;
  term?: "fall" | "spring" | "summer" | "full_year";
  letter_grade?: string | null;
  credits?: number | null;
  weighted?: boolean | null;
  institution_name?: string | null;
  reported_institution_name?: string | null;
  institution_resolution?: "reported" | "dtech_catalog_identity" | "dtech_quarter_identity";
  college_units?: number | null;
  matched_course_id?: string | null;
  matched_course_name?: string | null;
  matched_smccd_course_id?: string | null;
  matched_smccd_course_name?: string | null;
  transcript_classification?: TranscriptCourseClassification;
  grading_basis?: "letter" | "pass_fail";
  weighting_basis?: "college_course" | "dtech_printed_honors" | "dtech_printed_standard" | "reported" | "catalog_default" | "student_correction";
  weighting_source_id?: string | null;
}

export function resolveTranscriptCourse(payload: TranscriptCoursePayload, courses: Course[]) {
  const isIntersession = isDtechIntersessionCourse(payload);
  const matchedCourse = isIntersession
    ? null
    : payload.matched_course_id
      ? courses.find((course) => course.id === payload.matched_course_id) ?? findTranscriptCatalogMatch(payload.course_name, courses)
      : findTranscriptCatalogMatch(payload.course_name, courses);
  const institutionKey = institutionKeyFromName(payload.institution_name);
  const isSmccd = Boolean(payload.matched_smccd_course_id)
    || (!matchedCourse && (institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN" || institutionKey === "smccd"));
  const classification: TranscriptCourseClassification = isIntersession
    ? "dtech_intersession"
    : matchedCourse
      ? "dtech_catalog"
      : isSmccd ? payload.matched_smccd_course_id ? "smccd_catalog" : "smccd_unmatched" : "custom";

  return {
    classification,
    gradingBasis: isIntersession ? "pass_fail" as const : "letter" as const,
    matchedCourse,
    identityResolved: classification === "dtech_intersession" || classification === "dtech_catalog" || classification === "smccd_catalog"
  };
}

export function resolveTranscriptWeighting(payload: TranscriptCoursePayload, courses: Course[]) {
  if (payload.weighting_basis === "student_correction" && payload.weighted !== null && payload.weighted !== undefined) {
    return { weighted: payload.weighted, basis: "student_correction" as const, sourceId: payload.weighting_source_id ?? null };
  }
  const resolution = resolveTranscriptCourse(payload, courses);
  const institutionKey = institutionKeyFromName(payload.institution_name);
  const isDtechCourse = DTECH_INSTITUTION_PATTERN.test(payload.institution_name ?? "")
    || resolution.classification === "dtech_catalog"
    || resolution.classification === "dtech_intersession";
  if (isDtechCourse) {
    const explicitHonors = resolution.classification !== "dtech_intersession" && /\bhonors?\b/i.test(payload.course_name);
    return {
      weighted: explicitHonors,
      basis: explicitHonors ? "dtech_printed_honors" as const : "dtech_printed_standard" as const,
      sourceId: resolution.matchedCourse?.source_id ?? null
    };
  }

  const isCollegeCourse = Boolean(payload.matched_smccd_course_id)
    || institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN" || institutionKey === "smccd";
  if (isCollegeCourse) {
    return { weighted: true, basis: "college_course" as const, sourceId: null };
  }

  if (payload.weighted !== null && payload.weighted !== undefined) {
    return { weighted: payload.weighted, basis: "reported" as const, sourceId: null };
  }
  return {
    weighted: resolution.matchedCourse?.is_weighted ?? false,
    basis: "catalog_default" as const,
    sourceId: resolution.matchedCourse?.source_id ?? null
  };
}

export function visibleTranscriptUncertaintyNotes(
  payload: TranscriptCoursePayload,
  notes: string[],
  courses: Course[]
) {
  const resolution = resolveTranscriptCourse(payload, courses);
  return notes.filter((note) => {
    if (note.startsWith(DTECH_CATALOG_MISS) && (resolution.classification === "dtech_intersession" || resolution.classification === "dtech_catalog")) return false;
    if (note.startsWith(SMCCD_CATALOG_MISS) && resolution.classification === "smccd_catalog") return false;
    return true;
  });
}

export function transcriptPlanCourseDraft(
  payload: TranscriptCoursePayload,
  settings: StudentSettings,
  courses: Course[],
  mappings: CourseRequirementMapping[],
  reviewItemId: string,
  equivalencies: SmccdHighSchoolEquivalency[] = []
): Omit<PlanCourse, "id" | "plan_version_id" | "user_id"> {
  const resolution = resolveTranscriptCourse(payload, courses);
  const matched = resolution.matchedCourse;
  const fallbackGrade = Math.max(9, Math.min(12, (settings.grade_level ?? 9) - 1)) as GradeLevel;
  const grade = Math.max(9, Math.min(12, Number(payload.grade_level ?? fallbackGrade))) as GradeLevel;
  const equivalency = findHighSchoolEquivalency(payload, equivalencies);
  const isSmccdCourse = resolution.classification === "smccd_catalog" || resolution.classification === "smccd_unmatched";
  const collegeUnits = payload.college_units ?? matched?.college_units ?? null;
  const creditResolution = isSmccdCourse
    ? resolveCollegeHighSchoolCredits({
        collegeUnits,
        storedHighSchoolCredits: payload.credits ?? matched?.credits,
        equivalencyHighSchoolCredits: equivalency?.high_school_credits,
        normalizedCourseCode: equivalency?.normalized_course_code ?? normalizeCollegeCourseCode(payload.course_code ?? payload.course_name)
      })
    : null;
  const reportedCredits = creditResolution?.credits ?? payload.credits ?? matched?.credits ?? null;
  const isIntersession = resolution.classification === "dtech_intersession";
  const passedIntersession = isIntersession && payload.letter_grade?.trim().toUpperCase() === "P";
  const credits = isIntersession && !passedIntersession ? 0 : reportedCredits;
  const weighting = resolveTranscriptWeighting(payload, courses);
  const verifiedMapping = Boolean(equivalency) || passedIntersession || Boolean(
    matched && mappings.some((mapping) => mapping.course_id === matched.id && mapping.confidence === "verified")
  );

  return {
    course_id: matched?.id ?? null,
    custom_course_name: matched ? payload.course_name : payload.matched_smccd_course_name ?? payload.course_name,
    grade_level: grade,
    school_year: payload.school_year ?? schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, grade),
    term: payload.term ?? (matched?.term_type === "semester" ? "fall" : "full_year"),
    status: "completed",
    credits,
    college_units: collegeUnits,
    letter_grade: payload.letter_grade?.trim().toUpperCase() || null,
    is_weighted: weighting.weighted,
    mapping_verified: verifiedMapping,
    user_edited: true,
    notes: [
      payload.institution_name
        ? `Imported from a reviewed transcript (${payload.institution_name}).`
        : "Imported from a reviewed transcript.",
      matched && weighting.sourceId
        ? `Matched to the official d.tech catalog record "${matched.name}". GPA weighting follows the exact printed transcript title; only an explicit Honors label is weighted.`
        : null,
      equivalency
        ? `The official d.tech equivalency chart (updated 2021) applies ${equivalency.high_school_credits} high-school credits to ${equivalency.high_school_equivalent}. Confirm current approval with a counselor.`
        : null,
      creditResolution?.basis === "district_unit_conversion"
        ? `${creditResolution.collegeUnits} college units are represented as ${creditResolution.credits} high-school credits for GPA calculations; confirm transcript credit with d.tech.`
        : null,
      isIntersession
        ? `Recognized from the transcript as a d.tech intersession pass/fail course${passedIntersession ? " with Personal Development credit" : "; no Personal Development credit is earned for an F"}.`
        : null
    ].filter(Boolean).join(" "),
    sort_order: 0,
    source_review_item_id: reviewItemId,
    smccd_course_id: payload.matched_smccd_course_id ?? null,
    college_provider_code: isSmccdCourse ? "SMCCD" : null,
    requirement_area_override: equivalency?.requirement_area ?? (isIntersession ? "personal_development" : null)
  };
}

type TranscriptPlanCourseDraft = Omit<PlanCourse, "id" | "plan_version_id" | "user_id">;

export function findExistingTranscriptPlanCourse(
  draft: TranscriptPlanCourseDraft,
  rows: PlanCourse[],
  claimedIds: ReadonlySet<string> = new Set()
) {
  const draftName = normalizeCourseName(draft.custom_course_name ?? "");
  const ranked = rows.flatMap((row) => {
    if (row.status !== "completed" || claimedIds.has(row.id)) return [];

    const sameCatalogCourse = Boolean(draft.course_id && row.course_id === draft.course_id);
    const sameCollegeCourse = Boolean(draft.smccd_course_id && row.smccd_course_id === draft.smccd_course_id);
    const sameName = Boolean(draftName && normalizeCourseName(row.custom_course_name ?? "") === draftName);
    if (!sameCatalogCourse && !sameCollegeCourse && !sameName) return [];
    if (sameName && !sameCatalogCourse && !sameCollegeCourse
      && row.grade_level !== draft.grade_level && row.school_year !== draft.school_year) return [];

    const identityScore = sameCatalogCourse || sameCollegeCourse ? 100 : 50;
    const score = identityScore
      + (row.grade_level === draft.grade_level ? 12 : 0)
      + (row.school_year === draft.school_year ? 8 : 0)
      + (row.term === draft.term ? 4 : 0);
    return [{ row, score }];
  });

  ranked.sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id));
  return ranked[0]?.row ?? null;
}
