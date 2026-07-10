import type {
  Course,
  CourseRequirementMapping,
  GradeLevel,
  PlanCourse,
  SmccdHighSchoolEquivalency,
  StudentProfile
} from "@/lib/models";
import { courseNameAliases, normalizeCourseName } from "@/lib/course-names";
import { schoolYearForGrade } from "@/lib/planning";

export function findTranscriptCatalogMatch(name: string, courses: Course[]) {
  const normalized = normalizeCourseName(name);
  if (!normalized) return null;
  const exact = courses.filter((course) => courseNameAliases(course.name).includes(normalized));
  return exact.length === 1 ? exact[0] : null;
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
}

export function transcriptPlanCourseDraft(
  payload: TranscriptCoursePayload,
  profile: StudentProfile,
  courses: Course[],
  mappings: CourseRequirementMapping[],
  reviewItemId: string,
  equivalencies: SmccdHighSchoolEquivalency[] = []
): Omit<PlanCourse, "id" | "plan_version_id" | "user_id"> {
  const matched = payload.matched_course_id
    ? courses.find((course) => course.id === payload.matched_course_id) ?? null
    : findTranscriptCatalogMatch(payload.course_name, courses);
  const fallbackGrade = Math.max(9, Math.min(12, (profile.grade_level ?? 9) - 1)) as GradeLevel;
  const grade = Math.max(9, Math.min(12, Number(payload.grade_level ?? fallbackGrade))) as GradeLevel;
  const equivalency = findHighSchoolEquivalency(payload, equivalencies);
  const credits = equivalency?.high_school_credits ?? payload.credits ?? matched?.credits ?? null;
  const isSmccdCourse = Boolean(
    payload.matched_smccd_course_id ||
    /College of San Mateo|Skyline College|Cañada College|Canada College/i.test(payload.institution_name ?? "")
  );
  const isIntersessionPass = !matched && payload.letter_grade?.toUpperCase() === "P" && payload.subject === "Personal Development";
  const verifiedMapping = Boolean(equivalency) || isIntersessionPass || Boolean(
    matched && mappings.some((mapping) => mapping.course_id === matched.id && mapping.confidence === "verified")
  );

  return {
    course_id: matched?.id ?? null,
    custom_course_name: matched ? payload.course_name : payload.matched_smccd_course_name ?? payload.course_name,
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
    notes: [
      payload.institution_name
        ? `Imported from a reviewed transcript (${payload.institution_name}).`
        : "Imported from a reviewed transcript.",
      equivalency
        ? `The official d.tech equivalency chart (updated 2021) applies ${equivalency.high_school_credits} high-school credits to ${equivalency.high_school_equivalent}. Confirm current approval with a counselor.`
        : null
    ].filter(Boolean).join(" "),
    sort_order: 0,
    source_review_item_id: reviewItemId,
    smccd_course_id: payload.matched_smccd_course_id ?? null,
    requirement_area_override: equivalency?.requirement_area ?? (isIntersessionPass ? "personal_development" : null)
  };
}
