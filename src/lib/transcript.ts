import type {
  Course,
  CourseRequirementMapping,
  GradeLevel,
  PlanCourse,
  SmccdHighSchoolEquivalency,
  StudentSettings
} from "@/lib/models";
import { courseEquivalenceKeys, courseNameAliases, normalizeCourseName } from "@/lib/course-names";
import { institutionKeyFromName } from "@/lib/institutions";
import { schoolYearForGrade } from "@/lib/planning";

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

export function normalizeCollegeCourseCode(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^CHINESE\b/, "CHIN")
    .replace(/^SPANISH\b/, "SPAN")
    .replace(/^BIOLOGY\b/, "BIOL")
    .replace(/^CHEM\.\s*/, "CHEM ")
    .replace(/^PHYSICS\b/, "PHYS")
    .replace(/^ECONOMICS\b/, "ECON")
    .replace(/^HISTORY\b/, "HIST")
    .replace(/^POLITICAL SCIENCE\b/, "PLSC")
    .replace(/^MUS\.\s*/, "MUS ")
    .replace(/\s+/g, " ");
  const match = normalized.match(/^([A-Z]{2,5})\.?\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)/);
  return match ? `${match[1]} ${match[2]}` : null;
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
  college_units?: number | null;
  matched_course_id?: string | null;
  matched_course_name?: string | null;
  matched_smccd_course_id?: string | null;
  matched_smccd_course_name?: string | null;
  transcript_classification?: TranscriptCourseClassification;
  grading_basis?: "letter" | "pass_fail";
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
    || institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN" || institutionKey === "smccd";
  const classification: TranscriptCourseClassification = isIntersession
    ? "dtech_intersession"
    : isSmccd
      ? payload.matched_smccd_course_id ? "smccd_catalog" : "smccd_unmatched"
      : matchedCourse ? "dtech_catalog" : "custom";

  return {
    classification,
    gradingBasis: isIntersession ? "pass_fail" as const : "letter" as const,
    matchedCourse,
    identityResolved: classification === "dtech_intersession" || classification === "dtech_catalog" || classification === "smccd_catalog"
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
  const reportedCredits = equivalency?.high_school_credits ?? payload.credits ?? matched?.credits ?? null;
  const isIntersession = resolution.classification === "dtech_intersession";
  const passedIntersession = isIntersession && payload.letter_grade?.trim().toUpperCase() === "P";
  const credits = isIntersession && !passedIntersession ? 0 : reportedCredits;
  const institutionKey = institutionKeyFromName(payload.institution_name);
  const isSmccdCourse = Boolean(payload.matched_smccd_course_id)
    || institutionKey === "CSM" || institutionKey === "SKY" || institutionKey === "CAN" || institutionKey === "smccd";
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
    college_units: payload.college_units ?? matched?.college_units ?? null,
    letter_grade: payload.letter_grade?.trim().toUpperCase() || null,
    is_weighted: isSmccdCourse ? true : payload.weighted ?? matched?.is_weighted ?? false,
    mapping_verified: verifiedMapping,
    user_edited: true,
    notes: [
      payload.institution_name
        ? `Imported from a reviewed transcript (${payload.institution_name}).`
        : "Imported from a reviewed transcript.",
      equivalency
        ? `The official d.tech equivalency chart (updated 2021) applies ${equivalency.high_school_credits} high-school credits to ${equivalency.high_school_equivalent}. Confirm current approval with a counselor.`
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
