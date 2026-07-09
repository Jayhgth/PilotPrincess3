import type {
  Course,
  CourseRequirementMapping,
  GradeLevel,
  PlanCourse,
  StudentProfile
} from "@/lib/models";
import { schoolYearForGrade } from "@/lib/planning";

function normalizeCourseName(value: string) {
  const designLabTranscriptLabel = /^\s*d\s*\.?\s*lab\s*:\s*/i.test(value);
  const normalized = value
    .toLowerCase()
    .replace(/^\s*d\s*\.?\s*lab\s*:\s*/i, "")
    .replace(/\bhonors?\b/g, designLabTranscriptLabel ? "" : "honors")
    .replace(/\badvanced placement\b/g, "ap")
    .replace(/\bintro\b/g, "introduction")
    .replace(/\bcodesigners\b/g, "co designers")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return normalized === "foundation design thinking"
    ? "foundation in design thinking"
    : normalized;
}

function courseAliases(course: Course) {
  return course.name
    .split("/")
    .map(normalizeCourseName)
    .filter(Boolean);
}

export function findTranscriptCatalogMatch(name: string, courses: Course[]) {
  const normalized = normalizeCourseName(name);
  if (!normalized) return null;
  const exact = courses.filter((course) => courseAliases(course).includes(normalized));
  return exact.length === 1 ? exact[0] : null;
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
}

export function transcriptPlanCourseDraft(
  payload: TranscriptCoursePayload,
  profile: StudentProfile,
  courses: Course[],
  mappings: CourseRequirementMapping[],
  reviewItemId: string
): Omit<PlanCourse, "id" | "plan_version_id" | "user_id"> {
  const matched = payload.matched_course_id
    ? courses.find((course) => course.id === payload.matched_course_id) ?? null
    : findTranscriptCatalogMatch(payload.course_name, courses);
  const fallbackGrade = Math.max(9, Math.min(12, (profile.grade_level ?? 9) - 1)) as GradeLevel;
  const grade = Math.max(9, Math.min(12, Number(payload.grade_level ?? fallbackGrade))) as GradeLevel;
  const credits = payload.credits ?? matched?.credits ?? null;
  const isSmccdCourse = Boolean(
    payload.matched_smccd_course_id ||
    /College of San Mateo|Skyline College|Cañada College|Canada College/i.test(payload.institution_name ?? "")
  );
  const isIntersessionPass = !matched && payload.letter_grade?.toUpperCase() === "P" && payload.subject === "Personal Development";
  const verifiedMapping = isIntersessionPass || Boolean(
    matched && mappings.some((mapping) => mapping.course_id === matched.id && mapping.confidence === "verified")
  );

  return {
    course_id: matched?.id ?? null,
    custom_course_name: matched ? null : payload.matched_smccd_course_name ?? payload.course_name,
    grade_level: grade,
    school_year: payload.school_year ?? schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, grade),
    term: payload.term ?? (matched?.term_type === "semester" ? "fall" : "full_year"),
    status: "completed",
    credits,
    college_units: payload.college_units ?? matched?.college_units ?? null,
    letter_grade: payload.letter_grade?.trim().toUpperCase() || null,
    is_weighted: isSmccdCourse ? true : payload.weighted ?? matched?.is_weighted ?? false,
    mapping_verified: verifiedMapping,
    user_edited: true,
    notes: payload.institution_name
      ? `Imported from a reviewed transcript (${payload.institution_name}).`
      : "Imported from a reviewed transcript.",
    sort_order: 0,
    source_review_item_id: reviewItemId,
    smccd_course_id: payload.matched_smccd_course_id ?? null,
    requirement_area_override: isIntersessionPass ? "personal_development" : null
  };
}
