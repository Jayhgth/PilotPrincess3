/**
 * Stable read boundary for district-backed academic data.
 *
 * SMCCD is the first installed provider adapter. Keep its existing tables as
 * the deploy-safe runtime source until the provider-neutral compatibility
 * views have been rolled out everywhere; app and Pilot code depend on this
 * contract rather than on either naming scheme. That prevents application
 * deploys from outrunning database migrations while keeping a single adapter
 * seam for future districts.
 */
export const COLLEGE_DATA = {
  courses: "smccd_courses",
  programs: "smccd_programs",
  programRequirements: "smccd_program_requirements",
  requirementCourses: "smccd_requirement_courses",
  providerCodeColumn: "college_code"
} as const;

export const COLLEGE_COURSE_SELECT = "*";
export const COLLEGE_PROGRAM_SELECT = "*";
export const COLLEGE_PROGRAM_SEARCH_SELECT = "id,district_code,college_code,program_code,title,award_type,total_degree_units,total_major_units_text,catalog_url,source_year";
