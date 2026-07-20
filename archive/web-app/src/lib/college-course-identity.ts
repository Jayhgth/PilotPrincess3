import type { PlanCourse, SmccdCourse } from "@/lib/models";

export function normalizeCollegeCourseCode(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^(?:CSM|SKY|CAN):/, "")
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

/**
 * Resolves the district-wide identity of a planned SMCCD course. The catalog
 * row is authoritative when available, while the saved ID and printed course
 * name keep imported/manual rows usable when only part of the catalog is
 * loaded. College is provenance; the normalized course code is the shared
 * prerequisite identity across Cañada, CSM, and Skyline.
 */
export function resolvePlanCollegeCourseCode(
  row: PlanCourse,
  smccdById: ReadonlyMap<string, Pick<SmccdCourse, "course_code">> = new Map()
) {
  const catalogCode = row.smccd_course_id
    ? smccdById.get(row.smccd_course_id)?.course_code
    : null;
  return normalizeCollegeCourseCode(catalogCode)
    ?? normalizeCollegeCourseCode(row.smccd_course_id?.split(":").at(-1))
    ?? normalizeCollegeCourseCode(row.custom_course_name);
}
