import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pilotToolNamesForMessage } from "@/lib/app-capabilities";
import { createSmccdPlanCourseIndex, selectedSchoolCatalogEligibility, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
import { COLLEGE_HIGH_SCHOOL_CREDIT_POLICY, resolveCollegeHighSchoolCredits, resolvePlanCourseHighSchoolCredits } from "@/lib/college-credits";
import type {
  CatalogReviewItem,
  CollegeDistrict,
  Course,
  CourseDesignation,
  CourseRequirementMapping,
  EducationProvider,
  EnrollmentPolicy,
  FourYearPlan,
  GradeLevel,
  GraduationRequirement,
  NearbyCollegeDistrict,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SchoolPlanningProfile,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdPrerequisiteClearance,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGoal,
  StudentCollegeDistrictPreference,
  StudentEnrollmentPreference,
  StudentSettings
} from "@/lib/models";
import {
  calculateGpa,
  calculateRequirementProgress,
  courseNeedsExplicitPlanningIntent,
  courseDisplayName,
  dtechGradePoint,
  generateSuggestedPlan,
  mathSequenceRankFromText,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  requirementsForSettings,
  scheduleTermLoad,
  schoolYearForGrade
} from "@/lib/planning";
import { calculateSmccdLocalDegreeProgress, calculateSmccdProgramProgressWithContext, createSmccdProgramProgressContext } from "@/lib/smccd";
import { evaluateSelectedSchoolPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
import { normalizeCollegeCourseCode, transcriptPlanCourseDraft } from "@/lib/transcript";
import type { TranscriptCoursePayload } from "@/lib/transcript";
import { buildTranscriptAudit } from "@/server/assistant-audits";
import { defaultEnrollmentPreference, evaluateEnrollmentSchedule, policyForPreference } from "@/lib/enrollment-policy";
import { evaluateGpaScenario } from "@/lib/gpa-planner";
import { orderedCourseIdsForAutomaticBoardSort } from "@/lib/course-board";
import { normalizeAssistantWorkspaceBootstrap } from "@/lib/workspace-bootstrap";
import { undoAssistantToolCall } from "@/server/assistant-undo";

const courseStatusSchema = z.enum(["current", "planned"]);
const termSchema = z.enum(["fall", "spring", "summer", "full_year"]);
const gradeSchema = z.union([z.literal(9), z.literal(10), z.literal(11), z.literal(12)]);
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable();

const SHARED_CORRECTION_FIELDS: Record<string, ReadonlySet<string>> = {
  schools: new Set(["name", "short_name", "website_url", "district_name", "county_name", "governance_type", "charter_number", "status", "school_type", "street_address", "city", "postal_code", "uc_ag_institution_id", "directory_source_url"]),
  courses: new Set(["course_code", "name", "subject", "course_type", "grade_levels", "credits", "college_units", "term_type", "uc_ag_area", "prerequisites", "description", "is_honors", "is_weighted", "confidence", "review_status"]),
  education_providers: new Set(["district_name", "name", "website_url", "street_address", "city", "postal_code", "status", "source_url"]),
  school_provider_links: new Set(["relationship_type", "distance_miles", "source_url", "confidence", "review_status"])
};

function assertPlanningTermExists(gradeLevel: GradeLevel, term: PlanCourse["term"]) {
  if (gradeLevel === 12 && term === "summer") {
    throw new Error("Senior year does not include a summer term. Choose fall or spring.");
  }
}

const toolArgumentSchemas = {
  get_student_overview: z.object({}),
  get_academic_context: z.object({
    include_transcript_review: z.boolean().default(false),
    planning_start_grade: gradeSchema.optional(),
    planning_objectives: z.array(z.enum(["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"])).max(4).default([])
  }),
  list_plan_courses: z.object({
    status: z.enum(["completed", "current", "planned", "all"]).default("all"),
    grade_level: gradeSchema.optional(),
    term: termSchema.optional(),
    include_full_year: z.boolean().default(false),
    school_year: z.string().trim().regex(/^\d{4}-\d{4}$/).optional()
  }),
  search_california_high_schools: z.object({ query: z.string().trim().min(2).max(100) }),
  search_course_catalog: z.object({
    query: z.string().trim().min(1).max(80),
    source: z.enum(["high_school", "dtech", "smccd", "all"]).default("all"),
    grade_level: gradeSchema.optional()
  }),
  resolve_academic_course_batch: z.object({
    requests: z.array(z.object({
      query: z.string().trim().min(1).max(100),
      source: z.enum(["selected_school", "smccd"]),
      grade_level: gradeSchema.optional(),
      term: termSchema.nullable().default(null),
      status: courseStatusSchema.default("planned")
    })).max(30).default([]),
    fill_remaining_graduation_requirements: z.boolean().default(false),
    graduation_grade_level: gradeSchema.optional(),
    graduation_status: courseStatusSchema.default("planned"),
    respect_recommended_limit: z.boolean().default(true)
  }).refine((value) => value.requests.length > 0 || value.fill_remaining_graduation_requirements, "At least one course request or graduation-gap fill is required."),
  get_graduation_progress: z.object({}),
  get_nearby_education_providers: z.object({}),
  get_transcript_sources: z.object({}),
  get_student_data_inventory: z.object({}),
  audit_transcript_data: z.object({ include_source_text: z.boolean().default(false) }),
  get_gpa_evidence: z.object({ scope: z.enum(["current", "projected"]).default("projected") }),
  evaluate_gpa_scenario: z.object({
    target_weighted_gpa: z.number().min(0).max(5).default(4),
    choices: z.array(z.object({
      plan_course_id: z.uuid(),
      included: z.boolean().default(true),
      expected_grade: z.enum(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]).nullable()
    })).max(40)
  }),
  get_gpa_scenario: z.object({}),
  get_enrollment_constraints: z.object({}),
  get_course_schedule_options: z.object({
    respect_recommended_limit: z.boolean().default(true),
    interests: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
    rigor: z.enum(["balanced", "advanced", "lighter"]).default("balanced"),
    max_courses_per_term: z.number().int().min(1).max(12).nullable().default(null),
    start_grade: gradeSchema.optional(),
    starting_math_course: z.string().trim().min(1).max(100).nullable().default(null),
    starting_language_course: z.string().trim().min(1).max(100).nullable().default(null),
    include_college_courses: z.boolean().default(true),
    exclude_college_courses_explicitly: z.boolean().default(false),
    replace_existing: z.boolean().default(false),
    replace_grade_levels: z.array(gradeSchema).max(4).default([]),
    objectives: z.array(z.enum(["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"])).min(1).max(4).default(["complete_diploma"])
  }),
  get_prerequisite_evidence: z.object({ course_id: z.string().trim().min(1).max(180) }),
  get_degree_progress: z.object({ program_id: z.string().trim().min(1).max(180).optional() }),
  get_college_goal: z.object({}),
  search_smccd_programs: z.object({
    query: z.string().trim().min(1).max(100),
    college: z.enum(["CSM", "SKY", "CAN", "all"]).default("all"),
    award_type: z.enum(["AA", "AS", "all"]).default("all")
  }),
  set_current_school: z.object({ school_id: z.uuid() }),
  set_college_district_preference: z.object({ district_code: z.string().trim().min(3).max(180) }),
  undo_change: z.object({ tool_call_id: z.uuid() }),
  add_course_schedule: z.object({
    course_ids: z.array(z.uuid()).max(64)
      .refine((ids) => new Set(ids).size === ids.length, "Course IDs must be unique."),
    respect_recommended_limit: z.boolean().default(true),
    interests: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
    rigor: z.enum(["balanced", "advanced", "lighter"]).default("balanced"),
    max_courses_per_term: z.number().int().min(1).max(12).nullable().default(null),
    start_grade: gradeSchema.optional(),
    starting_math_course: z.string().trim().min(1).max(100).nullable().default(null),
    starting_language_course: z.string().trim().min(1).max(100).nullable().default(null),
    include_college_courses: z.boolean().default(true),
    exclude_college_courses_explicitly: z.boolean().default(false),
    replace_existing: z.boolean().default(false),
    replace_grade_levels: z.array(gradeSchema).max(4).default([]),
    objectives: z.array(z.enum(["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"])).min(1).max(4).default(["complete_diploma"])
  }),
  add_dtech_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema,
    prerequisite_override_reason: z.string().trim().min(3).max(600).optional()
  }),
  add_high_school_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema,
    prerequisite_override_reason: z.string().trim().min(3).max(600).optional()
  }),
  add_smccd_course: z.object({
    course_id: z.string().trim().min(1).max(180),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema,
    prerequisite_override_reason: z.string().trim().min(3).max(600).optional()
  }),
  add_custom_course: z.object({
    name: z.string().trim().min(1).max(180),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema,
    credits: z.number().min(0).max(100),
    college_units: z.number().min(0).max(30).nullable().default(null),
    is_weighted: z.boolean(),
    requirement_area: z.enum(["english", "social_science", "math", "lab_science", "world_language", "design_lab", "visual_performing_arts", "personal_development", "physical_education", "career_technical_education", "electives", "ethnic_studies", "other"]).nullable().default(null),
    notes: optionalText(1200).default(null)
  }).refine((value) => value.college_units === null || value.is_weighted, "Custom college courses are weighted in the app GPA."),
  add_academic_courses: z.object({
    entries: z.array(z.object({
      source: z.enum(["selected_school", "smccd"]),
      course_id: z.string().trim().min(1).max(180),
      status: courseStatusSchema,
      grade_level: gradeSchema,
      term: termSchema,
      prerequisite_override_reason: z.string().trim().min(3).max(600).optional()
    })).min(1).max(80).refine((entries) => new Set(entries.map((entry) => `${entry.source}:${entry.course_id}`)).size === entries.length, "Course entries must be unique."),
    respect_recommended_limit: z.boolean().default(true)
  }),
  move_plan_course: z.object({
    plan_course_id: z.uuid(),
    status: z.enum(["completed", "current", "planned"])
  }),
  move_plan_courses: z.object({
    plan_course_ids: z.array(z.uuid()).min(1).max(160)
      .refine((ids) => new Set(ids).size === ids.length, "Course IDs must be unique."),
    status: z.enum(["completed", "current", "planned"])
  }),
  remove_plan_course: z.object({ plan_course_id: z.uuid() }),
  remove_plan_courses: z.object({
    plan_course_ids: z.array(z.uuid()).min(1).max(160)
      .refine((ids) => new Set(ids).size === ids.length, "Course IDs must be unique.")
  }),
  update_plan_course: z.object({
    plan_course_id: z.uuid(),
    grade_level: gradeSchema.optional(),
    term: termSchema.optional(),
    letter_grade: optionalText(12).optional(),
    notes: optionalText(1200).optional(),
    credits: z.number().min(0).max(100).optional(),
    college_units: z.number().min(0).max(30).nullable().optional(),
    is_weighted: z.boolean().optional()
  }).refine((value) => Object.keys(value).some((key) => key !== "plan_course_id"), "Provide at least one course field to update."),
  update_plan_courses: z.object({
    patches: z.array(z.object({
      plan_course_id: z.uuid(),
      remove: z.boolean().default(false),
      course_id: z.uuid().optional(),
      grade_level: gradeSchema.optional(),
      term: termSchema.optional(),
      letter_grade: optionalText(12).optional(),
      notes: optionalText(1200).optional(),
      credits: z.number().min(0).max(100).optional(),
      college_units: z.number().min(0).max(30).nullable().optional(),
      is_weighted: z.boolean().optional(),
      prerequisite_override_reason: z.string().trim().min(3).max(600).optional()
    }).refine((value) => value.remove || Object.keys(value).some((key) => !["plan_course_id", "remove"].includes(key)), "Provide at least one course field to update.")).min(1).max(40)
      .refine((patches) => new Set(patches.map((patch) => patch.plan_course_id)).size === patches.length, "Plan course IDs must be unique.")
  }),
  sort_plan_courses: z.object({}),
  update_gpa_scenario: z.object({
    choices: z.array(z.object({
      plan_course_id: z.uuid(),
      included: z.boolean(),
      expected_grade: z.enum(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]).nullable()
    })).min(1).max(160).refine((choices) => new Set(choices.map((choice) => choice.plan_course_id)).size === choices.length, "Course IDs must be unique.")
  }),
  update_enrollment_preference: z.object({
    program_type: z.enum(["concurrent", "dual"]),
    respect_recommended_limit: z.boolean().optional()
  }),
  update_student_settings: z.object({
    preferred_name: z.string().trim().min(1).max(100).optional(),
    age: z.number().int().min(10).max(25).nullable().optional(),
    grade_level: gradeSchema.nullable().optional(),
    graduation_year: z.number().int().min(2020).max(2100).nullable().optional(),
    plan_start_grade: gradeSchema.nullable().optional(),
    plan_end_grade: gradeSchema.nullable().optional(),
    tracker_mode: z.enum(["full", "selected"]).optional(),
    tracked_requirement_areas: z.array(z.enum(["english", "social_science", "math", "lab_science", "world_language", "design_lab", "visual_performing_arts", "personal_development", "physical_education", "career_technical_education", "electives", "ethnic_studies", "other"])).max(13).optional(),
    ai_model: z.enum(["gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini"]).optional(),
    ai_reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
    ui_theme: z.enum(["light", "dark"]).optional()
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one setting to update."),
  submit_shared_data_correction: z.object({
    entity_type: z.enum(["school", "course", "provider", "provider_link", "policy", "source"]),
    target_table: z.enum(["schools", "courses", "education_providers", "school_provider_links"]),
    target_id: z.uuid(),
    proposed_payload: z.record(z.string(), z.unknown()).refine((payload) => Object.keys(payload).length > 0 && Object.keys(payload).length <= 20, "Provide one to twenty corrected fields."),
    evidence_url: z.url().max(1000).nullable().default(null),
    evidence_summary: z.string().trim().min(10).max(1200)
  }),
  correct_transcript_course: z.object({
    review_item_id: z.uuid(),
    letter_grade: z.enum(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "IP"]).nullable().optional(),
    credits: z.number().min(0).max(100).optional(),
    weighted: z.boolean().optional(),
    grade_level: gradeSchema.optional(),
    term: termSchema.optional(),
    reason: z.string().trim().min(3).max(600)
  }).refine((value) => ["letter_grade", "credits", "weighted", "grade_level", "term"].some((key) => key in value), "Provide at least one transcript correction."),
  save_prerequisite_evidence: z.object({
    target_course_id: z.string().trim().min(1).max(180),
    clearance_type: z.enum(["placement", "approved_equivalency", "prerequisite_challenge", "instructor_approval", "program_admission", "audition_or_portfolio"]),
    authority: z.string().trim().min(2).max(180),
    evidence_summary: z.string().trim().min(3).max(1200),
    source_url: z.url().max(1000).nullable().default(null)
  }),
  create_plan_snapshot: z.object({ label: z.string().trim().min(1).max(100) }),
  set_smccd_ge_completion: z.object({ college_code: z.enum(["CSM", "SKY", "CAN"]), requirement: z.enum(["7A", "information_literacy"]).default("7A"), completed: z.boolean() }),
  set_college_goal: z.object({ program_id: z.string().trim().min(1).max(180), notes: z.string().trim().max(1200).default("") }),
  set_college_goals: z.object({
    program_ids: z.array(z.string().trim().min(1).max(180)).min(1).max(12)
      .refine((ids) => new Set(ids).size === ids.length, "Degree bookmarks must be unique."),
    notes: z.string().trim().max(1200).default("")
  }),
  clear_college_goal: z.object({ program_id: z.string().trim().min(1).max(180) }),
  clear_academic_plan: z.object({
    courses: z.boolean().default(true),
    degree_bookmarks: z.boolean().default(false),
    gpa_scenario: z.boolean().default(false)
  }).refine((value) => value.courses || value.degree_bookmarks || value.gpa_scenario, "Select at least one academic-plan area to clear.")
} as const;

export type AssistantToolName = keyof typeof toolArgumentSchemas;

const ASSISTANT_TOOL_CATALOG: ReadonlyArray<{
  name: AssistantToolName;
  mutatesData: boolean;
  description: string;
  arguments: string;
}> = [
  { name: "get_student_overview", mutatesData: false, description: "Read the current graduation, GPA, and course-count summary.", arguments: "{}" },
  { name: "get_academic_context", mutatesData: false, description: "Read the complete current student-owned academic workspace in one bounded result: editable settings, school, active plan rows, degree bookmarks, GPA assumptions, enrollment preference, manual degree evidence, and optional transcript review rows. For a cross-feature planning request, preserve the requested starting grade and objectives in the evidence result.", arguments: '{"include_transcript_review":boolean,"planning_start_grade":9|10|11|12,"planning_objectives":["complete_diploma|maximize_weighted_gpa|maximize_degree_overlap|align_major"]}' },
  { name: "list_plan_courses", mutatesData: false, description: "List courses already in the active plan, with stable IDs, placement, school year, and Done/In progress/Planned state. Use filters for exact schedule periods; include_full_year includes year-round courses that occupy fall or spring.", arguments: '{"status":"completed|current|planned|all","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","include_full_year":boolean,"school_year":"YYYY-YYYY"}' },
  { name: "search_california_high_schools", mutatesData: false, description: "Search active California public and charter high schools by school, district, city, ZIP, or CDS code. Returns exact school IDs for changing the selected school.", arguments: '{"query":"string"}' },
  { name: "search_course_catalog", mutatesData: false, description: "Search the selected high school's approved catalog and/or the currently supported SMCCD catalog. Returns stable course IDs and never mixes high-school catalogs.", arguments: '{"query":"string","source":"high_school|smccd|all","grade_level":9|10|11|12}' },
  { name: "resolve_academic_course_batch", mutatesData: false, description: "Resolve a complete mixed batch of explicit selected-school and SMCCD course names in one call, optionally filling every remaining verified graduation gap. Use this instead of repeated single-course searches for multi-course add requests. Preserve only explicitly stated placements; leave term null when the student did not state one so prerequisite-aware placement can choose a valid term. Returns exact IDs and an execution-ready add_academic_courses batch or exact unresolved items.", arguments: '{"requests":[{"query":"string","source":"selected_school|smccd","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year|null","status":"current|planned"}],"fill_remaining_graduation_requirements":boolean,"graduation_grade_level":9|10|11|12,"graduation_status":"current|planned","respect_recommended_limit":boolean}' },
  { name: "get_graduation_progress", mutatesData: false, description: "Read requirement-by-requirement completed, scheduled, and remaining credit evidence.", arguments: "{}" },
  { name: "get_nearby_education_providers", mutatesData: false, description: "Read community colleges discovered from the selected school's official address and approximate distance. This does not use precise student location or prove enrollment eligibility.", arguments: "{}" },
  { name: "get_transcript_sources", mutatesData: false, description: "Read transcript source labels and review state. Corrections require the separate exact correction tool and preserve the original evidence.", arguments: "{}" },
  { name: "get_student_data_inventory", mutatesData: false, description: "Read a compact inventory of the current student's available records so the assistant can choose the correct evidence tool.", arguments: "{}" },
  { name: "audit_transcript_data", mutatesData: false, description: "Compare transcript source text, parsed rows, review decisions, catalog identities, and imported plan rows. Use source text for an actual extraction audit; never treat a graduation gap as a parsing error.", arguments: '{"include_source_text":boolean}' },
  { name: "get_gpa_evidence", mutatesData: false, description: "Read course-level GPA inclusion, weighting, points, and exclusion evidence for the current or projected calculation.", arguments: '{"scope":"current|projected"}' },
  { name: "evaluate_gpa_scenario", mutatesData: false, description: "Evaluate grade assumptions for courses already in the current four-year plan, including its all-A ceiling. This cannot predict grades or invent a new schedule.", arguments: '{"target_weighted_gpa":number,"choices":[{"plan_course_id":"uuid","included":boolean,"expected_grade":"A|B|C|D|F|null"}]}' },
  { name: "get_gpa_scenario", mutatesData: false, description: "Read the saved GPA-planner inclusion and expected-grade choices for every current or planned course.", arguments: "{}" },
  { name: "get_enrollment_constraints", mutatesData: false, description: "Read source-backed concurrent or dual-enrollment limits and evaluate the saved college schedule by term.", arguments: "{}" },
  { name: "get_course_schedule_options", mutatesData: false, description: "Generate one integrated schedule from the selected school's verified load/subject rules and every bookmarked degree's major, awarding-college GE, separate graduation, and total-unit requirements. It searches for multi-requirement overlap, verified college-to-high-school credit, prerequisite-ordered subject sequences, GPA weighting, balanced workload, and the saved concurrent-enrollment limit before filling lower-value electives. Set include_college_courses=true whenever degree bookmarks exist unless the student explicitly forbids college coursework. It prevents duplicate or regressive core sequences and never borrows another school's policy. When every degree cannot fit, it returns the valid maximum-progress plan with exact remaining requirements rather than invalidating the whole schedule. Set replace_existing only when explicitly requested.", arguments: '{"respect_recommended_limit":boolean,"interests":["string"],"rigor":"balanced|advanced|lighter","max_courses_per_term":number|null,"start_grade":9|10|11|12,"starting_math_course":"string|null","starting_language_course":"string|null","include_college_courses":boolean,"replace_existing":boolean,"replace_grade_levels":[9|10|11|12],"objectives":["complete_diploma|maximize_weighted_gpa|maximize_degree_overlap|align_major"]}' },
  { name: "get_prerequisite_evidence", mutatesData: false, description: "Read official prerequisite evaluation and any student-submitted clearance evidence for one selected-school or SMCCD course.", arguments: '{"course_id":"string"}' },
  { name: "get_degree_progress", mutatesData: false, description: "Read deterministic requirement-level evidence for one bookmarked SMCCD associate degree. Omit program_id only when one bookmark is sufficient context.", arguments: '{"program_id":"string|optional"}' },
  { name: "get_college_goal", mutatesData: false, description: "Read all bookmarked SMCCD associate degrees.", arguments: "{}" },
  { name: "search_smccd_programs", mutatesData: false, description: "Search official SMCCD AA and AS programs by name or program code. Returns exact program IDs needed to bookmark a degree.", arguments: '{"query":"string","college":"CSM|SKY|CAN|all","award_type":"AA|AS|all"}' },
  { name: "set_current_school", mutatesData: true, description: "Propose changing the student's selected California public or charter high school after search_california_high_schools returns its exact ID. Existing plan rows are retained; school-specific catalog and graduation evidence refresh to the new school.", arguments: '{"school_id":"uuid"}' },
  { name: "set_college_district_preference", mutatesData: true, description: "Propose changing the student's California community-college district. Use an exact district_code returned by get_nearby_education_providers. This changes district-aware suggestions and sourced policy context; it never claims enrollment eligibility.", arguments: '{"district_code":"string"}' },
  { name: "undo_change", mutatesData: true, description: "Undo one exact applied change from this conversation using its private stored inverse. Use only a tool_call_id supplied by the recent conversation change ledger; never reconstruct deleted data from the current plan.", arguments: '{"tool_call_id":"uuid"}' },
  { name: "add_course_schedule", mutatesData: true, description: "Apply the exact integrated high-school and bookmarked-degree schedule returned by get_course_schedule_options. course_ids contains the returned selected-school course IDs; the server deterministically revalidates and atomically includes the returned college-degree portion, so it cannot be silently omitted. Pass every schedule constraint unchanged. Transcript evidence remains locked and replacement is limited to the explicit scope.", arguments: '{"course_ids":["uuid"],"respect_recommended_limit":boolean,"interests":["string"],"rigor":"balanced|advanced|lighter","max_courses_per_term":number|null,"start_grade":9|10|11|12,"starting_math_course":"string|null","starting_language_course":"string|null","include_college_courses":boolean,"replace_existing":boolean,"replace_grade_levels":[9|10|11|12],"objectives":["complete_diploma|maximize_weighted_gpa|maximize_degree_overlap|align_major"]}' },
  { name: "add_dtech_course", mutatesData: true, description: "Legacy-compatible alias for proposing one verified selected-school catalog course in In progress or Planned. Normal validation and reversible execution still apply.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","prerequisite_override_reason?":"string"}' },
  { name: "add_high_school_course", mutatesData: true, description: "Propose adding one approved course from the student's selected high-school catalog to In progress or Planned. A prerequisite override is allowed only when the student explicitly corrects or overrides the app evidence, and remains labeled unverified.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","prerequisite_override_reason?":"string"}' },
  { name: "add_smccd_course", mutatesData: true, description: "Propose adding one college catalog course to In progress or Planned. A prerequisite override is allowed only when the student explicitly corrects or overrides the app evidence, and remains labeled unverified.", arguments: '{"course_id":"string","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","prerequisite_override_reason?":"string"}' },
  { name: "add_custom_course", mutatesData: true, description: "Add an explicitly requested course that is absent from the verified catalogs as student-provided custom data. Use only after the student supplies its name, placement, high-school credits, college units when applicable, weighting, and intended requirement area. It remains clearly unverified and reversible.", arguments: '{"name":"string","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","credits":number,"college_units":number|null,"is_weighted":boolean,"requirement_area":"english|social_science|math|lab_science|world_language|design_lab|visual_performing_arts|personal_development|physical_education|career_technical_education|electives|ethnic_studies|other|null","notes":"string|null"}' },
  { name: "add_academic_courses", mutatesData: true, description: "Add one validated mixed batch of selected-school and SMCCD courses across grades 9–12. Use this for complete multi-year plans after catalog, graduation, degree, prerequisite, GPA, and enrollment evidence has selected exact IDs. The whole batch is reversible; every SMCCD row is weighted in the app GPA and high-school credits resolve separately from college units.", arguments: '{"entries":[{"source":"selected_school|smccd","course_id":"string","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}],"respect_recommended_limit":boolean}' },
  { name: "move_plan_course", mutatesData: true, description: "Propose moving an editable plan course between Done, In progress, and Planned. Transcript-backed courses cannot move.", arguments: '{"plan_course_id":"uuid","status":"completed|current|planned"}' },
  { name: "move_plan_courses", mutatesData: true, description: "Propose moving an exact set of editable plan courses to Done, In progress, or Planned in one request. Use this for all/every bulk state changes after listing the matching courses.", arguments: '{"plan_course_ids":["uuid"],"status":"completed|current|planned"}' },
  { name: "remove_plan_course", mutatesData: true, description: "Propose removing an editable course from the active plan. Transcript-backed courses cannot be removed.", arguments: '{"plan_course_id":"uuid"}' },
  { name: "remove_plan_courses", mutatesData: true, description: "Propose removing an exact set of editable courses from the active plan in one atomic request. Use this for all/every bulk removal requests after listing the matching plan courses.", arguments: '{"plan_course_ids":["uuid"]}' },
  { name: "update_plan_courses", mutatesData: true, description: "Atomically apply one coherent batch of exact edits or removals to existing non-transcript plan rows, including selected-school course replacements and placement changes. Use this for a requested subject-sequence or multi-course correction while preserving every unaffected row.", arguments: '{"patches":[{"plan_course_id":"uuid","remove":boolean,"course_id":"uuid","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","letter_grade":"string|null","credits":number,"college_units":number|null,"is_weighted":boolean,"notes":"string|null","prerequisite_override_reason?":"string"}]}' },
  { name: "sort_plan_courses", mutatesData: true, description: "Propose applying the product's canonical course-board ordering across every grade, with graded college courses first, high-school courses next, pass/fail courses last, and full-year rows placed consistently.", arguments: "{}" },
  { name: "update_gpa_scenario", mutatesData: true, description: "Propose saving GPA-planner inclusion and expected-grade choices for current or planned courses. This changes only the calculator scenario, never completed transcript grades or the course plan.", arguments: '{"choices":[{"plan_course_id":"uuid","included":boolean,"expected_grade":"A|B|C|D|F|null"}]}' },
  { name: "update_enrollment_preference", mutatesData: true, description: "Propose changing whether the student plans to use SMCCD concurrent enrollment or a dual-enrollment partnership and whether generated plans respect its recommended limit. District thresholds remain source-backed policy.", arguments: '{"program_type":"concurrent|dual","respect_recommended_limit":boolean}' },
  { name: "update_student_settings", mutatesData: true, description: "Propose changing ordinary student, planning, interface theme, and connected Pilot model/reasoning settings. Include only fields explicitly requested. This cannot change Pilot opt-in consent, authentication, account lifecycle, or the mandatory safety-review policy.", arguments: '{"preferred_name?":"string","age?":number|null,"grade_level?":9|10|11|12|null,"graduation_year?":number|null,"plan_start_grade?":9|10|11|12|null,"plan_end_grade?":9|10|11|12|null,"tracker_mode?":"full|selected","tracked_requirement_areas?":["english|..."],"ai_model?":"gpt-5.6-luna|gpt-5.5|gpt-5.4-mini","ai_reasoning_effort?":"low|medium|high","ui_theme?":"light|dark"}' },
  { name: "submit_shared_data_correction", mutatesData: true, description: "Submit an evidence-backed correction to shared school, course, or provider data for administrator review. This creates a pending proposal only; Pilot cannot publish institutional data. Use exact IDs and include only corrected fields. For the student's selected school ID, call get_student_data_inventory instead of asking the student.", arguments: '{"entity_type":"school|course|provider|provider_link|policy|source","target_table":"schools|courses|education_providers|school_provider_links","target_id":"uuid","proposed_payload":{"field":"corrected value"},"evidence_url":"url|null","evidence_summary":"string"}' },
  { name: "correct_transcript_course", mutatesData: true, description: "Propose an exact correction to imported transcript evidence and its linked completed plan row while preserving the original proposed payload and correction reason.", arguments: '{"review_item_id":"uuid","letter_grade":"string|null","credits":number,"weighted":boolean,"grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","reason":"string"}' },
  { name: "save_prerequisite_evidence", mutatesData: true, description: "Submit placement, equivalency, challenge, approval, admission, or audition evidence for independent verification. Pilot cannot mark institutional evidence approved.", arguments: '{"target_course_id":"string","clearance_type":"placement|approved_equivalency|prerequisite_challenge|instructor_approval|program_admission|audition_or_portfolio","authority":"string","evidence_summary":"string","source_url":"url|null"}' },
  { name: "create_plan_snapshot", mutatesData: true, description: "Create a named snapshot copy of the current four-year plan for comparison or rollback reference.", arguments: '{"label":"string"}' },
  { name: "set_smccd_ge_completion", mutatesData: true, description: "Mark or unmark a supported manual local-degree completion: Area 7A for any college pattern, or Skyline's information-literacy tutorial/equivalent.", arguments: '{"college_code":"CSM|SKY|CAN","requirement":"7A|information_literacy","completed":boolean}' },
  { name: "set_college_goal", mutatesData: true, description: "Propose bookmarking one SMCCD AA or AS degree. Existing bookmarks remain marked.", arguments: '{"program_id":"string","notes":"string"}' },
  { name: "set_college_goals", mutatesData: true, description: "Atomically bookmark every explicitly requested SMCCD AA or AS degree in one action. Use this instead of separate set_college_goal calls when the student names multiple degrees. Existing bookmarks remain marked.", arguments: '{"program_ids":["string"],"notes":"string"}' },
  { name: "clear_college_goal", mutatesData: true, description: "Propose removing one SMCCD degree bookmark.", arguments: '{"program_id":"string"}' },
  { name: "clear_academic_plan", mutatesData: true, description: "Clear any requested combination of editable schedule rows, degree bookmarks, and saved GPA assumptions as one coherent action. Transcript-backed evidence is always retained. The complete deleted state is stored as one durable inverse so a single later request can restore the entire operation.", arguments: '{"courses":boolean,"degree_bookmarks":boolean,"gpa_scenario":boolean}' }
];

export function assistantToolCatalogPrompt(userMessage?: string) {
  const selectedTools = userMessage ? pilotToolNamesForMessage(userMessage) : null;
  return ASSISTANT_TOOL_CATALOG.filter((tool) => !selectedTools || selectedTools.has(tool.name)).map((tool) => [
    `- ${tool.name}${tool.mutatesData ? " (exact validated change; independent review when risk requires it)" : " (read-only)"}`,
    `  ${tool.description}`,
    `  Arguments: ${tool.arguments}`
  ].join("\n")).join("\n");
}

export function assistantToolLabel(name: string) {
  return ({
    get_student_overview: "Read student overview",
    get_academic_context: "Read academic workspace",
    list_plan_courses: "Read course plan",
    search_california_high_schools: "Search California high schools",
    search_course_catalog: "Search course catalogs",
    resolve_academic_course_batch: "Resolve academic course batch",
    get_graduation_progress: "Check graduation progress",
    get_nearby_education_providers: "Find nearby education providers",
    get_transcript_sources: "Read transcript sources",
    get_student_data_inventory: "Inventory student records",
    audit_transcript_data: "Audit transcript evidence",
    get_gpa_evidence: "Read GPA evidence",
    evaluate_gpa_scenario: "Evaluate GPA scenario",
    get_gpa_scenario: "Read saved GPA scenario",
    get_enrollment_constraints: "Check college-unit limits",
    get_course_schedule_options: "Build course schedule options",
    get_prerequisite_evidence: "Check prerequisite evidence",
    get_degree_progress: "Read degree progress",
    get_college_goal: "Read college goal",
    search_smccd_programs: "Search college programs",
    set_current_school: "Change selected school",
    set_college_district_preference: "Change college district",
    undo_change: "Undo previous change",
    add_course_schedule: "Apply course schedule",
    add_dtech_course: "Add high school course",
    add_high_school_course: "Add high school course",
    add_smccd_course: "Add college course",
    add_custom_course: "Add custom course",
    add_academic_courses: "Add academic course plan",
    move_plan_course: "Move course",
    move_plan_courses: "Move courses",
    remove_plan_course: "Remove course",
    remove_plan_courses: "Remove courses",
    update_plan_course: "Update course",
    update_plan_courses: "Update courses",
    sort_plan_courses: "Sort course plan",
    update_gpa_scenario: "Update GPA scenario",
    update_enrollment_preference: "Update college enrollment type",
    update_student_settings: "Update student settings",
    submit_shared_data_correction: "Submit shared data correction",
    correct_transcript_course: "Correct transcript course",
    save_prerequisite_evidence: "Submit prerequisite evidence",
    create_plan_snapshot: "Save plan snapshot",
    set_smccd_ge_completion: "Update college degree completion",
    set_college_goal: "Set college goal",
    set_college_goals: "Set college goals",
    clear_college_goal: "Clear college goal",
    clear_academic_plan: "Clear academic plan"
  } as Record<string, string>)[name] ?? name.replaceAll("_", " ");
}

export function parseAssistantToolCall(name: string, argumentsValue: unknown) {
  if (!(name in toolArgumentSchemas)) throw new Error(`Unknown student-data tool: ${name}`);
  const toolName = name as AssistantToolName;
  const parsed = toolArgumentSchemas[toolName].parse(argumentsValue);
  return {
    name: toolName,
    arguments: parsed as Record<string, unknown>,
    mutatesData: ASSISTANT_TOOL_CATALOG.find((tool) => tool.name === toolName)?.mutatesData === true
  };
}

interface AssistantWorkspace {
  settings: StudentSettings;
  school: School;
  planningProfile: SchoolPlanningProfile | null;
  plan: FourYearPlan;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  gpaScenarioChoices: Array<{ plan_course_id: string; included: boolean; expected_grade: string | null }>;
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  courseDesignations: CourseDesignation[];
  nearbyProviders: Array<Pick<EducationProvider, "provider_code" | "name" | "provider_type" | "city" | "postal_code" | "website_url"> & { provider_id: string; distance_miles: number | null; relationship_type: string; confidence: string }>;
  nearbyCollegeDistricts: NearbyCollegeDistrict[];
  collegeDistrictPreference: StudentCollegeDistrictPreference | null;
  collegeDistrict: CollegeDistrict | null;
  equivalencies: SmccdHighSchoolEquivalency[];
  plannedSmccdCourses: SmccdCourse[];
  sources: OfficialSource[];
  transcriptReviewItems: CatalogReviewItem[];
  collegeGoals: StudentSmccdGoal[];
  degreePrograms: SmccdProgram[];
  degreeRequirements: SmccdProgramRequirement[];
  degreeRequirementCourses: SmccdRequirementCourse[];
  degreeCatalogCourses: SmccdCourse[];
  enrollmentPolicies: EnrollmentPolicy[];
  enrollmentPreference: StudentEnrollmentPreference;
  prerequisiteClearances: SmccdPrerequisiteClearance[];
  manualSmccdCompletions: Array<{ college_code: SmccdCourse["college_code"]; area: "7A" | "information_literacy" }>;
  memories: Array<{ memory_key: string; content: string; tags: string[] }>;
}

async function loadAssistantWorkspace(supabase: SupabaseClient, userId: string): Promise<AssistantWorkspace> {
  const { data, error } = await supabase.rpc("get_assistant_workspace_bootstrap");
  if (error) throw new Error(error.message);
  const bootstrap = normalizeAssistantWorkspaceBootstrap(data);
  if (!bootstrap.settings || !bootstrap.school || !bootstrap.plan || !bootstrap.active_version) {
    throw new Error("Choose a school before Pilot reads academic planning data.");
  }
  if (bootstrap.settings.id !== userId) {
    throw new Error("Pilot could not verify the current student workspace.");
  }

  return {
    settings: bootstrap.settings,
    school: bootstrap.school,
    planningProfile: bootstrap.school_planning_profile,
    plan: bootstrap.plan,
    activeVersion: bootstrap.active_version,
    planCourses: bootstrap.plan_courses,
    gpaScenarioChoices: bootstrap.gpa_scenario_choices,
    courses: bootstrap.courses,
    requirements: bootstrap.requirements,
    mappings: bootstrap.mappings,
    courseDesignations: bootstrap.course_designations,
    nearbyProviders: bootstrap.nearby_providers,
    nearbyCollegeDistricts: bootstrap.nearby_college_districts,
    collegeDistrictPreference: bootstrap.college_district_preference,
    collegeDistrict: bootstrap.college_district,
    equivalencies: bootstrap.equivalencies,
    plannedSmccdCourses: bootstrap.planned_smccd_courses,
    sources: bootstrap.transcript_sources,
    transcriptReviewItems: bootstrap.transcript_review_items,
    collegeGoals: bootstrap.degree_goals,
    degreePrograms: bootstrap.degree_programs,
    degreeRequirements: bootstrap.degree_requirements,
    degreeRequirementCourses: bootstrap.degree_requirement_courses,
    degreeCatalogCourses: [],
    enrollmentPolicies: bootstrap.enrollment_policies,
    enrollmentPreference: bootstrap.enrollment_preference
      ? bootstrap.enrollment_preference
      : defaultEnrollmentPreference(
          userId,
          bootstrap.college_district?.policy_provider_code
            ?? bootstrap.college_district_preference?.district_code
            ?? "SMCCD"
        ),
    prerequisiteClearances: bootstrap.prerequisite_clearances,
    manualSmccdCompletions: bootstrap.manual_smccd_completions,
    memories: bootstrap.memories
  };
}

async function hydrateDegreePlanningCatalog(supabase: SupabaseClient, workspace: AssistantWorkspace, enabled: boolean) {
  if (!enabled || !workspace.collegeGoals.length || workspace.degreeCatalogCourses.length) return workspace;
  const catalog = await supabase.from("smccd_courses").select("*");
  if (catalog.error) throw new Error(catalog.error.message);
  return {
    ...workspace,
    degreeCatalogCourses: catalog.data as unknown as SmccdCourse[]
  };
}

function calculatedWorkspace(workspace: AssistantWorkspace) {
  const tracked = requirementsForSettings(workspace.requirements, workspace.settings);
  const overviewProgress = calculateRequirementProgress(tracked, workspace.planCourses, workspace.mappings, workspace.courses, workspace.equivalencies);
  const graduationProgress = calculateRequirementProgress(workspace.requirements, workspace.planCourses, workspace.mappings, workspace.courses, workspace.equivalencies);
  return {
    overviewProgress,
    graduationProgress,
    gpa: calculateGpa(workspace.planCourses, workspace.equivalencies)
  };
}

function compactPlanningProfile(profile: SchoolPlanningProfile | null) {
  if (!profile) return null;
  return {
    academic_year: profile.academic_year,
    title: profile.title,
    college_course_posture: profile.college_course_posture,
    college_eligible_grades: profile.college_eligible_grades,
    always_high_school_areas: profile.always_high_school_areas,
    grade_rules: Object.fromEntries(Object.entries(profile.grade_rules).map(([grade, rule]) => [grade, rule ? {
      minimum_high_school_courses: rule.minimum_high_school_courses,
      target_total_courses: rule.target_total_courses,
      required_areas: rule.required_areas
    } : null])),
    guidance_notes: profile.guidance_notes,
    source_urls: profile.source_urls
  };
}

function generatedPlanCourseRow(
  workspace: AssistantWorkspace,
  row: ReturnType<typeof generateSuggestedPlan>[number],
  index: number
): PlanCourse {
  return {
    id: `generated:${row.course_id}`,
    plan_version_id: workspace.activeVersion.id,
    user_id: workspace.settings.id,
    course_id: row.course_id,
    custom_course_name: null,
    grade_level: row.grade_level,
    school_year: row.school_year,
    term: row.term,
    status: row.status,
    credits: row.credits,
    college_units: row.college_units,
    letter_grade: null,
    is_weighted: row.is_weighted,
    mapping_verified: row.mapping_verified,
    user_edited: false,
    notes: null,
    sort_order: workspace.planCourses.length + index,
    source_review_item_id: null,
    smccd_course_id: null,
    college_provider_code: row.college_provider_code,
    requirement_area_override: null
  };
}

interface GeneratedDegreeCourse {
  smccd_course_id: string;
  grade_level: GradeLevel;
  school_year: string;
  term: PlanCourse["term"];
  status: "current" | "planned";
  credits: number;
  college_units: number;
  college_provider_code: "SMCCD";
  is_weighted: true;
  mapping_verified: boolean;
  requirement_area_override: PlanCourse["requirement_area_override"];
  notes: string;
}

function generatedDegreeCourseRow(workspace: AssistantWorkspace, row: GeneratedDegreeCourse, index: number): PlanCourse {
  const course = workspace.degreeCatalogCourses.find((candidate) => candidate.id === row.smccd_course_id);
  return {
    id: `generated:smccd:${row.smccd_course_id}`,
    plan_version_id: workspace.activeVersion.id,
    user_id: workspace.settings.id,
    course_id: null,
    custom_course_name: course ? `${course.course_code} ${course.title}` : "College course",
    grade_level: row.grade_level,
    school_year: row.school_year,
    term: row.term,
    status: row.status,
    credits: row.credits,
    college_units: row.college_units,
    letter_grade: null,
    is_weighted: true,
    mapping_verified: row.mapping_verified,
    user_edited: false,
    notes: row.notes,
    sort_order: workspace.planCourses.length + index,
    source_review_item_id: null,
    smccd_course_id: row.smccd_course_id,
    college_provider_code: "SMCCD",
    requirement_area_override: row.requirement_area_override
  };
}

function explicitSmccdPrerequisiteCodes(clause: string) {
  return [...clause.matchAll(/\b([A-Z]{2,5})\s*(C?\d{3,4}[A-Z]?)\b/gi)]
    .map((match) => normalizeCollegeCourseCode(`${match[1]} ${match[2]}`))
    .filter((code): code is string => Boolean(code));
}

function explicitSmccdPrerequisitesReady(
  course: SmccdCourse,
  target: { gradeLevel: GradeLevel; term: PlanCourse["term"] },
  rows: readonly PlanCourse[],
  catalog: readonly SmccdCourse[],
  selectedSchoolCourses: readonly Course[] = [],
  startingMathPlacement?: { gradeLevel: GradeLevel; course: string | null }
) {
  const catalogById = new Map(catalog.map((candidate) => [candidate.id, candidate]));
  const selectedSchoolCourseById = new Map(selectedSchoolCourses.map((candidate) => [candidate.id, candidate]));
  const targetTermIndex = (target.gradeLevel - 9) * 3 + (target.term === "spring" ? 1 : target.term === "summer" ? 2 : 0);
  const priorCodes = new Set(rows.flatMap((row) => {
    const termIndex = (row.grade_level - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
    if (termIndex >= targetTermIndex || !row.smccd_course_id) return [];
    const code = catalogById.get(row.smccd_course_id)?.course_code
      ?? row.custom_course_name
      ?? row.smccd_course_id.split(":").at(-1)
      ?? "";
    const normalized = normalizeCollegeCourseCode(code);
    return normalized ? [normalized] : [];
  }));
  const priorMathRanks = rows.flatMap((row) => {
    const termIndex = (row.grade_level - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
    if (termIndex >= targetTermIndex) return [];
    const selectedCourse = row.course_id ? selectedSchoolCourseById.get(row.course_id) : null;
    const collegeCourse = row.smccd_course_id ? catalogById.get(row.smccd_course_id) : null;
    const rank = mathSequenceRankFromText(`${selectedCourse?.course_code ?? collegeCourse?.course_code ?? ""} ${selectedCourse?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""}`);
    return rank === null ? [] : [rank];
  });
  const startingMathRank = startingMathPlacement?.course ? mathSequenceRankFromText(startingMathPlacement.course) : null;
  if (startingMathRank !== null && startingMathRank !== undefined && startingMathPlacement && target.gradeLevel > startingMathPlacement.gradeLevel) {
    priorMathRanks.push(startingMathRank);
  }
  const highestPriorMathRank = Math.max(0, ...priorMathRanks);
  const codeIsReady = (code: string) => {
    if (priorCodes.has(code)) return true;
    const prerequisiteCourse = [...catalogById.values()].find((candidate) => normalizeCollegeCourseCode(candidate.course_code) === code);
    const requiredMathRank = prerequisiteCourse ? mathSequenceRankFromText(`${prerequisiteCourse.course_code} ${prerequisiteCourse.title}`) : null;
    return requiredMathRank !== null && highestPriorMathRank >= requiredMathRank;
  };
  return course.prerequisites.every((clause) => {
    const codes = [...new Set(explicitSmccdPrerequisiteCodes(clause))];
    if (!codes.length) return true;
    return /\bor\b/i.test(clause)
      ? codes.some(codeIsReady)
      : codes.every(codeIsReady);
  });
}

function collegePlanningDifficulty(course: SmccdCourse) {
  const number = Number(course.course_number.match(/\d+/)?.[0] ?? 0);
  const mathRank = mathSequenceRankFromText(`${course.course_code} ${course.title}`) ?? 0;
  const advancedTitle = /\b(?:advanced|calculus|organic|engineering|data structures|linear algebra|differential equations)\b/i.test(course.title);
  return course.prerequisites.length * 12
    + Number(course.units_max ?? course.units_min) * 3
    + Math.min(12, Math.max(0, number - 100) / 25)
    + mathRank * 5
    + Number(advancedTitle) * 8;
}

function integratedDegreePlan(
  workspace: AssistantWorkspace,
  enrollmentPolicy: EnrollmentPolicy | null,
  respectRecommendedLimit: boolean,
  preferences: { startGrade?: GradeLevel; startingMathCourse?: string | null; startingLanguageCourse?: string | null; maxCoursesPerTerm?: number | null; interests?: string[]; objectives?: string[] }
) {
  const degreeCode = (value: string) => normalizeCollegeCourseCode(value) ?? normalizedScheduleText(value).toUpperCase();
  const programs = workspace.degreePrograms.filter((program) => workspace.collegeGoals.some((goal) => goal.program_id === program.id));
  const catalog = workspace.degreeCatalogCourses;
  if (!workspace.collegeGoals.length) return { additions: [] as GeneratedDegreeCourse[], complete: true, goals: [] as Array<Record<string, unknown>> };
  if (!programs.length || !catalog.length) return {
    additions: [] as GeneratedDegreeCourse[],
    complete: false,
    goals: workspace.collegeGoals.map((goal) => ({
      program_id: goal.program_id,
      limitation: "The bookmarked degree catalog was not loaded, so its requirements cannot be claimed as covered."
    }))
  };
  const requirements = workspace.degreeRequirements.filter((requirement) => programs.some((program) => program.id === requirement.program_id));
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const options = workspace.degreeRequirementCourses.filter((option) => requirementIds.has(option.requirement_id));
  const currentGrade = Math.max(9, Math.min(12, Number(preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9))) as GradeLevel;
  const endGrade = Math.max(currentGrade, Number(workspace.settings.plan_end_grade ?? 12)) as GradeLevel;
  const profileGrades = (workspace.planningProfile?.college_eligible_grades.length
    ? workspace.planningProfile.college_eligible_grades
    : [11, 12] as GradeLevel[]).filter((grade) => grade >= currentGrade && grade <= endGrade);
  // An integrated school profile means the listed grades are the school's
  // normal starting point, not a fabricated eligibility ban. K-12 enrollment
  // approval remains a separate boundary, while a multi-year degree plan may
  // use any open planning grade to satisfy prerequisites and term limits.
  const eligibleGrades = workspace.planningProfile?.college_course_posture === "integrated"
    ? ([9, 10, 11, 12] as GradeLevel[]).filter((grade) => grade >= currentGrade && grade <= endGrade)
    : profileGrades;
  if (!eligibleGrades.length) return {
    additions: [] as GeneratedDegreeCourse[],
    complete: false,
    goals: programs.map((program) => ({ program_id: program.id, title: program.title, limitation: "No source-backed college-eligible planning grade is available." }))
  };
  const usedCodes = new Set(workspace.planCourses.flatMap((row) => {
    const course = row.smccd_course_id ? [...workspace.plannedSmccdCourses, ...catalog].find((candidate) => candidate.id === row.smccd_course_id) : null;
    return course ? [degreeCode(course.course_code)] : [];
  }));
  const additions: GeneratedDegreeCourse[] = [];
  const interestText = normalizedScheduleText([...(preferences.interests ?? []), ...programs.map((program) => program.title)].join(" "));
  const manualCompletions = new Set(workspace.manualSmccdCompletions.map((completion) => completion.area));
  let progressCatalog = catalog;

  const rows = () => [
    ...workspace.planCourses,
    ...additions.map((addition, index) => generatedDegreeCourseRow(workspace, addition, index))
  ];
  const audit = (planRows: PlanCourse[]) => {
    const context = createSmccdProgramProgressContext(requirements, options, planRows, progressCatalog);
    let score = 0;
    let complete = true;
    const neededMajorCodes = new Set<string>();
    const goals = programs.map((program) => {
      const progress = calculateSmccdProgramProgressWithContext(program, context);
      const local = calculateSmccdLocalDegreeProgress(context, program.college_code, manualCompletions);
      const majorComplete = progress.requirements.every((requirement) => requirement.status === "satisfied" || requirement.requirement.constraint_only);
      const geComplete = local.geAreas.every((area) => area.status === "completed" || area.status === "planned");
      const separateComplete = local.graduationRequirements.every((requirement) => requirement.status === "completed" || requirement.status === "planned");
      const unitsComplete = progress.projectedDegreeApplicableUnits >= progress.totalDegreeUnits;
      for (const requirement of progress.requirements.filter((requirement) => requirement.status !== "satisfied" && !requirement.requirement.constraint_only)) {
        const stillUseful = requirement.remainingOptions.length
          ? requirement.remainingOptions.map((option) => option.courseCode)
          : requirement.optionCourseCodes;
        for (const code of stillUseful) neededMajorCodes.add(degreeCode(code));
      }
      complete &&= majorComplete && geComplete && separateComplete && unitsComplete;
      score += progress.satisfiedRequirements * 120_000;
      score += progress.requirements.reduce((total, requirement) => total + requirement.completionRatio * 35_000, 0);
      score += Math.min(progress.projectedDegreeApplicableUnits, progress.totalDegreeUnits) * 500;
      score += local.geAreas.reduce((total, area) => total
        + (["completed", "planned"].includes(area.status) ? 45_000 : 0)
        + Math.min(area.projectedUnits, area.requiredUnits) * 2_000, 0);
      score += local.graduationRequirements.filter((requirement) => ["completed", "planned"].includes(requirement.status)).length * 50_000;
      return {
        program_id: program.id,
        title: program.title,
        college_code: program.college_code,
        major_complete: majorComplete,
        local_ge_complete: geComplete,
        separate_requirements_complete: separateComplete,
        projected_degree_units: progress.projectedDegreeApplicableUnits,
        required_degree_units: progress.totalDegreeUnits,
        unresolved_major_requirements: progress.requirements.filter((requirement) => requirement.status !== "satisfied" && !requirement.requirement.constraint_only).map((requirement) => requirement.missingSummary),
        unresolved_major_details: progress.requirements
          .filter((requirement) => requirement.status !== "satisfied" && !requirement.requirement.constraint_only)
          .map((requirement) => ({
            label: requirement.requirement.label,
            kind: requirement.requirement.kind,
            missing_summary: requirement.missingSummary,
            remaining_course_options: requirement.remainingOptions.map((option) => option.courseCode)
          })),
        unresolved_ge_areas: local.geAreas.filter((area) => !["completed", "planned"].includes(area.status)).map((area) => area.description),
        unresolved_separate_requirements: local.graduationRequirements.filter((requirement) => !["completed", "planned"].includes(requirement.status)).map((requirement) => requirement.label)
      };
    });
    const diploma = calculateRequirementProgress(workspace.requirements, planRows, workspace.mappings, workspace.courses, workspace.equivalencies);
    score += diploma.reduce((total, item) => total + Math.min(item.verifiedProjectedCredits, item.requirement.credits_required) * 10_000, 0);
    return { score, complete, goals, neededMajorCodes };
  };

  const awardingColleges = new Set(programs.map((program) => program.college_code));
  const optionCodes = new Set<string>();
  const majorOptionCodes = new Set<string>();
  const mandatoryMajorCodes = new Set<string>();
  const localGeOptionCodes = new Set<string>();
  const separateGraduationOptionCodes = new Set<string>();
  const majorSubjectRules: Array<{ subject: string; minimumNumber: number }> = [];
  const rankCatalogChoices = (codes: readonly string[], limit: number) => catalog
    .filter((course) => codes.includes(degreeCode(course.course_code)))
    .sort((left, right) => Number(awardingColleges.has(right.college_code)) - Number(awardingColleges.has(left.college_code))
      || Number(normalizedScheduleText(`${right.subject} ${right.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token))) - Number(normalizedScheduleText(`${left.subject} ${left.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token)))
      || left.prerequisites.length - right.prerequisites.length
      || Number(right.units_max ?? right.units_min) - Number(left.units_max ?? left.units_min)
      || left.course_code.localeCompare(right.course_code))
    .slice(0, limit)
    .map((course) => degreeCode(course.course_code));
  for (const requirement of requirements) {
    const codes = options.filter((option) => option.requirement_id === requirement.id).map((option) => degreeCode(option.course_code));
    const selectedCodes = requirement.kind === "all" ? codes : rankCatalogChoices(codes, 12);
    for (const code of selectedCodes) {
      optionCodes.add(code);
      majorOptionCodes.add(code);
      if (requirement.kind === "all") mandatoryMajorCodes.add(code);
    }
    if (requirement.kind === "text_rule") {
      const subjectRule = `${requirement.label} ${requirement.raw_text ?? ""}`.match(/from\s+([A-Z.]+)\s+courses numbered\s+(\d+)\s+or higher/i);
      if (subjectRule) majorSubjectRules.push({ subject: subjectRule[1]!.replace(/\.$/, "").toUpperCase(), minimumNumber: Number(subjectRule[2]) });
    }
  }
  const prerequisiteSupportCodes = new Set<string>();
  const catalogByCode = new Map<string, SmccdCourse[]>();
  for (const course of catalog) {
    const code = degreeCode(course.course_code);
    const matches = catalogByCode.get(code) ?? [];
    matches.push(course);
    catalogByCode.set(code, matches);
  }
  const prerequisiteCodesFromClause = (clause: string) => explicitSmccdPrerequisiteCodes(clause).map(degreeCode);
  const addPrerequisiteSupport = (courseCode: string, depth = 0) => {
    if (depth >= 4) return;
    const source = (catalogByCode.get(courseCode) ?? [])
      .sort((left, right) => Number(awardingColleges.has(right.college_code)) - Number(awardingColleges.has(left.college_code))
        || left.prerequisites.length - right.prerequisites.length)[0];
    if (!source) return;
    for (const clause of source.prerequisites) {
      const codes = [...new Set(prerequisiteCodesFromClause(clause))].filter((code) => catalogByCode.has(code));
      if (!codes.length) continue;
      const selectedCodes = /\bor\b/i.test(clause)
        ? [codes.sort((left, right) => {
            const leftCourse = (catalogByCode.get(left) ?? [])[0];
            const rightCourse = (catalogByCode.get(right) ?? [])[0];
            return Number(leftCourse?.prerequisites.length ?? 99) - Number(rightCourse?.prerequisites.length ?? 99)
              || Number(leftCourse?.units_max ?? leftCourse?.units_min ?? 99) - Number(rightCourse?.units_max ?? rightCourse?.units_min ?? 99)
              || left.localeCompare(right);
          })[0]!]
        : codes;
      for (const code of selectedCodes) {
        if (prerequisiteSupportCodes.has(code)) continue;
        prerequisiteSupportCodes.add(code);
        optionCodes.add(code);
        addPrerequisiteSupport(code, depth + 1);
      }
    }
  };
  for (const code of majorOptionCodes) addPrerequisiteSupport(code);
  const replaceableDiplomaAreas = new Set(workspace.requirements
    .filter((requirement) => !workspace.planningProfile?.always_high_school_areas.includes(requirement.area))
    .map((requirement) => requirement.area));
  const overlapCodes = new Set(workspace.equivalencies
    .filter((equivalency) => replaceableDiplomaAreas.has(equivalency.requirement_area))
    .map((equivalency) => degreeCode(equivalency.normalized_course_code)));
  for (const code of rankCatalogChoices([...overlapCodes], 60)) optionCodes.add(code);
  const initialContext = createSmccdProgramProgressContext(requirements, options, rows(), catalog);
  for (const program of programs) {
    const local = calculateSmccdLocalDegreeProgress(initialContext, program.college_code, manualCompletions);
    for (const area of local.geAreas) for (const code of rankCatalogChoices(area.eligibleCourseCodes.map(degreeCode), 3)) {
      optionCodes.add(code);
      localGeOptionCodes.add(code);
    }
    for (const requirement of local.graduationRequirements) for (const code of rankCatalogChoices(requirement.eligibleCourseCodes.map(degreeCode), 4)) {
      optionCodes.add(code);
      separateGraduationOptionCodes.add(code);
    }
  }
  const requestedLanguageText = normalizedLanguageCourseText(preferences.startingLanguageCourse);
  const requestedLanguageCourses = requestedLanguageText
    ? catalog.filter((course) => {
        const code = degreeCode(course.course_code);
        const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code);
        if (equivalency?.requirement_area !== "world_language") return false;
        const candidateText = normalizedLanguageCourseText(`${course.course_code} ${course.title} ${equivalency.high_school_equivalent}`);
        return candidateText.includes(requestedLanguageText) || requestedLanguageText.includes(candidateText);
      }).sort((left, right) => Number(awardingColleges.has(right.college_code)) - Number(awardingColleges.has(left.college_code))
        || left.prerequisites.length - right.prerequisites.length
        || left.course_code.localeCompare(right.course_code))
    : [];
  const requestedLanguageCodes = new Set(requestedLanguageCourses.map((course) => degreeCode(course.course_code)));
  for (const code of requestedLanguageCodes) optionCodes.add(code);
  const primaryCandidates = catalog.filter((course) => optionCodes.has(degreeCode(course.course_code)));
  const fillerCandidates = catalog.filter((course) => course.degree_applicable
      && course.transfer_credit !== null
      && !optionCodes.has(degreeCode(course.course_code))
      && !/\b(?:baseball|basketball|football|volleyball|soccer|softball|aquatics?|varsity|physical conditioning|intercollegiate|intercollegiate athletics)\b/i.test(`${course.subject} ${course.title}`))
    .sort((left, right) => Number(awardingColleges.has(right.college_code)) - Number(awardingColleges.has(left.college_code))
      || Number(normalizedScheduleText(`${right.subject} ${right.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token))) - Number(normalizedScheduleText(`${left.subject} ${left.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token)))
      || left.prerequisites.length - right.prerequisites.length
      || Number(left.units_max ?? left.units_min) - Number(right.units_max ?? right.units_min))
    .slice(0, 60);
  const candidateByCode = new Map<string, SmccdCourse>();
  for (const course of [...primaryCandidates, ...fillerCandidates]) {
    const code = degreeCode(course.course_code);
    const previous = candidateByCode.get(code);
    if (!previous || (!awardingColleges.has(previous.college_code) && awardingColleges.has(course.college_code))) candidateByCode.set(code, course);
  }
  const verifiedMathRequirementIds = new Set(workspace.requirements
    .filter((requirement) => requirement.area === "math")
    .map((requirement) => requirement.id));
  const verifiedMathCourseIds = new Set(workspace.mappings
    .filter((mapping) => mapping.confidence === "verified" && verifiedMathRequirementIds.has(mapping.requirement_id))
    .map((mapping) => mapping.course_id));
  const inferredSchoolMathRanks = workspace.courses
    .filter((course) => verifiedMathCourseIds.has(course.id)
      && (!course.grade_levels.length || course.grade_levels.includes(currentGrade)))
    .flatMap((course) => {
      const rank = mathSequenceRankFromText(`${course.course_code ?? ""} ${course.name}`);
      return rank === null ? [] : [rank];
    });
  const startingMathRank = preferences.startingMathCourse
    ? mathSequenceRankFromText(preferences.startingMathCourse)
    : inferredSchoolMathRanks.length
      ? Math.min(...inferredSchoolMathRanks)
      : null;
  const candidates = [...candidateByCode.values()].filter((course) => {
    const code = degreeCode(course.course_code);
    const rank = mathSequenceRankFromText(`${course.course_code} ${course.title}`);
    return rank === null
      || startingMathRank === null
      || rank > startingMathRank
      || mandatoryMajorCodes.has(code);
  });
  const dependentCountByCode = new Map<string, number>();
  for (const candidate of candidates) {
    for (const clause of candidate.prerequisites) {
      for (const prerequisiteCode of new Set(explicitSmccdPrerequisiteCodes(clause).map(degreeCode))) {
        dependentCountByCode.set(prerequisiteCode, (dependentCountByCode.get(prerequisiteCode) ?? 0) + 1);
      }
    }
  }
  const primaryCodes = new Set(primaryCandidates.map((course) => degreeCode(course.course_code)));
  const existingCatalogIds = new Set(workspace.planCourses.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)));
  progressCatalog = [...new Map([
    ...workspace.plannedSmccdCourses,
    ...catalog.filter((course) => existingCatalogIds.has(course.id)),
    ...candidates
  ].map((course) => [course.id, course])).values()];
  const termRank = (grade: GradeLevel, term: "fall" | "spring" | "summer") => grade * 10 + ({ fall: 0, spring: 1, summer: 2 } as const)[term];
  const equivalencyPlacementHint = (course: SmccdCourse) => {
    const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === degreeCode(course.course_code));
    if (!equivalency) return null;
    const equivalentText = normalizedScheduleText(equivalency.high_school_equivalent);
    const sequenceText = equivalentText.replace(/\b(?:fall|spring|summer|semester|first|second)\b/g, " ").replace(/\s+/g, " ").trim();
    const grade = eligibleGrades.find((candidateGrade) => {
      const preferred = workspace.planningProfile?.grade_rules[String(candidateGrade) as `${GradeLevel}`]?.preferred_course_names ?? [];
      return preferred.some((name) => {
        const preferredText = normalizedScheduleText(name);
        return sequenceText.length >= 4 && (preferredText.includes(sequenceText) || sequenceText.includes(preferredText));
      });
    });
    const term = /\bfall\b/.test(equivalentText) ? "fall" as const
      : /\bspring\b/.test(equivalentText) ? "spring" as const
        : /\bsummer\b/.test(equivalentText) ? "summer" as const
          : null;
    return grade || term ? { grade: grade ?? null, term } : null;
  };
  const potentialPeriods = eligibleGrades.flatMap((grade) => {
    const terms: Array<"fall" | "spring" | "summer"> = grade < 12 ? ["fall", "spring", "summer"] : ["fall", "spring"];
    return terms.map((term) => ({ grade, term }));
  })
    .sort((left, right) => termRank(left.grade, left.term) - termRank(right.grade, right.term));
  const placementFor = (course: SmccdCourse) => {
    const currentRows = rows();
    const isMajorCourse = majorOptionCodes.has(degreeCode(course.course_code));
    const placementHint = equivalencyPlacementHint(course);
    const courseMathRank = mathSequenceRankFromText(`${course.course_code} ${course.title}`);
    const earliestMathGrade = courseMathRank !== null && startingMathRank !== null
      ? currentGrade + Math.max(0, courseMathRank - startingMathRank)
      : currentGrade;
    const courseCode = degreeCode(course.course_code);
    const isExplicitLanguagePlacement = requestedLanguageCodes.has(courseCode);
    const supportsLaterCourse = prerequisiteSupportCodes.has(courseCode) || (dependentCountByCode.get(courseCode) ?? 0) > 0;
    const difficulty = collegePlanningDifficulty(course);
    // Explicit placement defines the live math ladder. A static school-profile
    // hint must not push prerequisite support such as precalculus to grade 12
    // and make calculus unreachable.
    const preferredGrade = isExplicitLanguagePlacement
      ? currentGrade
      : courseMathRank !== null && startingMathRank !== null
      ? Math.min(endGrade, Math.max(currentGrade, earliestMathGrade)) as GradeLevel
      : placementHint?.grade
        ?? (supportsLaterCourse
        ? currentGrade
        : difficulty >= 42
          ? endGrade
          : difficulty >= 28
            ? Math.min(endGrade, currentGrade + 2) as GradeLevel
            : Math.min(endGrade, currentGrade + 1) as GradeLevel);
    return potentialPeriods
      .map((period) => {
        const count = currentRows.filter((row) => row.grade_level === period.grade && (row.term === period.term || (row.term === "full_year" && period.term !== "summer"))).length;
        const highSchoolCount = period.term === "summer"
          ? 0
          : scheduleTermLoad(currentRows, workspace.courses, period.grade, period.term, true);
        const collegeCount = currentRows.filter((row) => row.grade_level === period.grade
          && row.term === period.term
          && Boolean(row.smccd_course_id)).length;
        const units = currentRows.filter((row) => row.grade_level === period.grade && row.term === period.term).reduce((total, row) => total + Number(row.college_units ?? 0), 0);
        const difficultyLoad = currentRows
          .filter((row) => row.grade_level === period.grade && row.term === period.term && row.smccd_course_id)
          .reduce((total, row) => {
            const existingCourse = catalog.find((candidate) => candidate.id === row.smccd_course_id);
            return total + (existingCourse ? collegePlanningDifficulty(existingCourse) : 0);
          }, 0);
        return { ...period, count, highSchoolCount, collegeCount, units, difficultyLoad };
      })
      .sort((left, right) => {
        const hintScore = (period: typeof left) => Number(placementHint?.grade === period.grade) * 2 + Number(placementHint?.term === period.term);
        const hinted = hintScore(right) - hintScore(left);
        if (hinted) return hinted;
        if (supportsLaterCourse) {
          return termRank(left.grade, left.term) - termRank(right.grade, right.term)
            || left.difficultyLoad - right.difficultyLoad
            || left.units - right.units
            || left.count - right.count;
        }
        return Math.abs(left.grade - preferredGrade) - Math.abs(right.grade - preferredGrade)
          || left.difficultyLoad - right.difficultyLoad
          || left.units - right.units
          || left.count - right.count
          || (isMajorCourse ? termRank(left.grade, left.term) - termRank(right.grade, right.term) : 0);
      })
      .find((period) => {
        if (period.grade < earliestMathGrade) return false;
        const gradeRule = workspace.planningProfile?.grade_rules[String(period.grade) as `${GradeLevel}`];
        const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === degreeCode(course.course_code));
        if (equivalency?.requirement_area === "social_science" && placementHint?.grade && period.grade !== placementHint.grade) return false;
        if (equivalency && gradeRule?.required_areas.includes(equivalency.requirement_area)) {
          const replacementAreas = new Set(currentRows
            .filter((row) => row.grade_level === period.grade && row.smccd_course_id && row.requirement_area_override)
            .map((row) => row.requirement_area_override!));
          const maximumReplacementAreas = Math.max(0, gradeRule.required_areas.length - gradeRule.minimum_high_school_courses);
          if (!replacementAreas.has(equivalency.requirement_area) && replacementAreas.size >= maximumReplacementAreas) return false;
        }
        const targetTotalCourses = preferences.maxCoursesPerTerm ?? gradeRule?.target_total_courses ?? 6;
        const reservedHighSchoolCourses = period.term === "summer"
          ? 0
          : Math.max(period.highSchoolCount, gradeRule?.minimum_high_school_courses ?? 0);
        const collegeCourseCapacity = period.term === "summer"
          ? Math.min(3, targetTotalCourses)
          : Math.max(0, targetTotalCourses - reservedHighSchoolCourses);
        if (period.collegeCount >= collegeCourseCapacity) return false;
        if (preferences.maxCoursesPerTerm && period.count >= preferences.maxCoursesPerTerm) return false;
        const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: period.grade, term: period.term }, catalog, currentRows, workspace.courses);
        if (!isExplicitLanguagePlacement && (prerequisite.result.status === "blocked"
          || (prerequisite.result.status === "needs_review" && !explicitSmccdPrerequisitesReady(
            course,
            { gradeLevel: period.grade, term: period.term },
            currentRows,
            catalog,
            workspace.courses,
            { gradeLevel: currentGrade, course: preferences.startingMathCourse ?? null }
          )))) return false;
        const collegeUnits = Number(course.units_max ?? course.units_min);
        const candidateRow = generatedDegreeCourseRow(workspace, {
          smccd_course_id: course.id,
          grade_level: period.grade,
          school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, period.grade),
          term: period.term,
          status: period.grade === currentGrade ? "current" : "planned",
          credits: resolveCollegeHighSchoolCredits({ collegeUnits, storedHighSchoolCredits: null, equivalencyHighSchoolCredits: equivalency?.high_school_credits, normalizedCourseCode: degreeCode(course.course_code) }).credits,
          college_units: collegeUnits,
          college_provider_code: "SMCCD",
          is_weighted: true,
          mapping_verified: Boolean(equivalency),
          requirement_area_override: equivalency?.requirement_area ?? null,
          notes: "Integrated bookmarked-degree, diploma-overlap, prerequisite, and concurrent-enrollment planning."
        }, additions.length);
        if (!enrollmentPolicy) return true;
        return !evaluateEnrollmentSchedule([...currentRows, candidateRow], enrollmentPolicy).some((evaluation) => evaluation.state === "blocked" || (respectRecommendedLimit && evaluation.state === "over_policy"));
      });
  };

  const explicitLanguageCourse = requestedLanguageCourses.find((course) => !usedCodes.has(degreeCode(course.course_code)));
  if (explicitLanguageCourse) {
    const period = placementFor(explicitLanguageCourse);
    if (period) {
      const code = degreeCode(explicitLanguageCourse.course_code);
      const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code);
      const collegeUnits = Number(explicitLanguageCourse.units_max ?? explicitLanguageCourse.units_min);
      additions.push({
        smccd_course_id: explicitLanguageCourse.id,
        grade_level: period.grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, period.grade),
        term: period.term,
        status: period.grade === currentGrade ? "current" : "planned",
        credits: resolveCollegeHighSchoolCredits({ collegeUnits, storedHighSchoolCredits: null, equivalencyHighSchoolCredits: equivalency?.high_school_credits, normalizedCourseCode: code }).credits,
        college_units: collegeUnits,
        college_provider_code: "SMCCD",
        is_weighted: true,
        mapping_verified: Boolean(equivalency),
        requirement_area_override: equivalency?.requirement_area ?? null,
        notes: `Student-requested ${preferences.startingLanguageCourse} college placement; verified equivalency is used for diploma overlap.`
      });
      usedCodes.add(code);
    }
  }

  let currentAudit = audit(rows());
  for (let pass = 0; pass < 44 && !currentAudit.complete; pass += 1) {
    let best: { course: SmccdCourse; period: NonNullable<ReturnType<typeof placementFor>>; score: number } | null = null;
    const needsMajor = currentAudit.goals.some((goal) => goal.major_complete !== true);
    const needsLocalGe = currentAudit.goals.some((goal) => goal.local_ge_complete !== true);
    const needsSeparateGraduation = currentAudit.goals.some((goal) => goal.separate_requirements_complete !== true);
    const openDiplomaAreas = new Set(calculateRequirementProgress(workspace.requirements, rows(), workspace.mappings, workspace.courses, workspace.equivalencies)
      .filter((item) => item.status === "missing" && !item.requirement.constraint_only)
      .map((item) => item.requirement.area));
    const placedCandidates = candidates.flatMap((course) => {
      const code = degreeCode(course.course_code);
      if (usedCodes.has(code)) return [];
      const period = placementFor(course);
      if (!period) return [];
      const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code);
      const interest = normalizedScheduleText(`${course.subject} ${course.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token));
      const subjectNumber = Number(course.course_number.match(/\d+/)?.[0] ?? 0);
      const matchesMajorSubjectRule = majorSubjectRules.some((rule) => course.subject.replace(/\.$/, "").toUpperCase() === rule.subject && subjectNumber >= rule.minimumNumber);
      const neededMajorCourse = currentAudit.neededMajorCodes.has(code);
      const usefulDiplomaOverlap = Boolean(equivalency && openDiplomaAreas.has(equivalency.requirement_area));
      const shortlistScore = Number(needsMajor && neededMajorCourse && mandatoryMajorCodes.has(code)) * 2_000_000
        + Number(needsLocalGe && localGeOptionCodes.has(code)) * 1_500_000
        + Number(needsMajor && neededMajorCourse) * 1_000_000
        + Number(needsSeparateGraduation && separateGraduationOptionCodes.has(code)) * 900_000
        + Number(needsMajor && prerequisiteSupportCodes.has(code)) * 750_000
        + Number(matchesMajorSubjectRule) * 500_000
        + Number(primaryCodes.has(code)) * 100_000
        + Number(usefulDiplomaOverlap) * 400_000
        + Number(Boolean(equivalency)) * 40_000
        + Number(awardingColleges.has(course.college_code)) * 10_000
        + course.attributes.length * 1_000
        + Number(interest) * 500
        + Number(course.units_max ?? course.units_min) * 10
        - course.prerequisites.length * 5;
      return [{ course, period, shortlistScore, matchesMajorSubjectRule }];
    }).sort((left, right) => right.shortlistScore - left.shortlistScore
      || left.course.course_code.localeCompare(right.course.course_code))
      .slice(0, 24);
    for (const { course, period, matchesMajorSubjectRule } of placedCandidates) {
      const code = degreeCode(course.course_code);
      const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code);
      const collegeUnits = Number(course.units_max ?? course.units_min);
      const draft: GeneratedDegreeCourse = {
        smccd_course_id: course.id,
        grade_level: period.grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, period.grade),
        term: period.term,
        status: period.grade === currentGrade ? "current" : "planned",
        credits: resolveCollegeHighSchoolCredits({ collegeUnits, storedHighSchoolCredits: null, equivalencyHighSchoolCredits: equivalency?.high_school_credits, normalizedCourseCode: code }).credits,
        college_units: collegeUnits,
        college_provider_code: "SMCCD",
        is_weighted: true,
        mapping_verified: Boolean(equivalency),
        requirement_area_override: equivalency?.requirement_area ?? null,
        notes: "Integrated bookmarked-degree, diploma-overlap, prerequisite, and concurrent-enrollment planning."
      };
      const nextRows = [...rows(), generatedDegreeCourseRow(workspace, draft, additions.length)];
      const marginal = audit(nextRows).score - currentAudit.score;
      const interestBonus = normalizedScheduleText(`${course.subject} ${course.title}`).split(" ").some((token) => token.length > 3 && interestText.includes(token)) ? 800 : 0;
      const weightedBonus = preferences.objectives?.includes("maximize_weighted_gpa") ? 250 : 0;
      // Finish exact bookmarked-degree cores and their prerequisite chain
      // before spending capacity on general units, GE alternatives, or diploma
      // overlap. The previous marginal-only score could prefer a random
      // 10-credit science over CIS 256 or Calculus even while the major stayed
      // incomplete.
      const structuralBonus = Number(needsMajor && currentAudit.neededMajorCodes.has(code)) * 2_000_000
        + Number(needsMajor && mandatoryMajorCodes.has(code)) * 1_000_000
        + Number(needsMajor && prerequisiteSupportCodes.has(code)) * 750_000
        + Number(needsMajor && matchesMajorSubjectRule) * 500_000
        + Number(needsLocalGe && localGeOptionCodes.has(code)) * 100_000
        + Number(needsSeparateGraduation && separateGraduationOptionCodes.has(code)) * 75_000;
      const score = marginal + structuralBonus + interestBonus + weightedBonus - course.prerequisites.length * 20;
      if (score > 0 && (!best || score > best.score || (score === best.score && course.course_code.localeCompare(best.course.course_code) < 0))) best = { course, period, score };
    }
    if (!best) break;
    const code = degreeCode(best.course.course_code);
    const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code);
    const collegeUnits = Number(best.course.units_max ?? best.course.units_min);
    additions.push({
      smccd_course_id: best.course.id,
      grade_level: best.period.grade,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, best.period.grade),
      term: best.period.term,
      status: best.period.grade === currentGrade ? "current" : "planned",
      credits: resolveCollegeHighSchoolCredits({ collegeUnits, storedHighSchoolCredits: null, equivalencyHighSchoolCredits: equivalency?.high_school_credits, normalizedCourseCode: code }).credits,
      college_units: collegeUnits,
      college_provider_code: "SMCCD",
      is_weighted: true,
      mapping_verified: Boolean(equivalency),
      requirement_area_override: equivalency?.requirement_area ?? null,
      notes: "Integrated bookmarked-degree, diploma-overlap, prerequisite, and concurrent-enrollment planning."
    });
    usedCodes.add(code);
    currentAudit = audit(rows());
  }

  // When a degree/GE choice starts a verified college sequence that can also
  // replace a flexible diploma area, finish that sequence before falling back
  // to a redundant high-school course. This keeps overlap intentional without
  // treating annual English, mathematics, or history sequences as optional.
  const flexibleOverlapAreas = new Set(["world_language", "visual_performing_arts", "career_technical_education"]);
  for (const area of flexibleOverlapAreas) {
    const requiredCredits = workspace.requirements
      .filter((requirement) => requirement.area === area)
      .reduce((total, requirement) => total + Number(requirement.credits_required ?? 0), 0);
    if (requiredCredits <= 0) continue;
    const areaRows = () => rows().filter((row) => row.requirement_area_override === area);
    const areaIsCovered = () => calculateRequirementProgress(
      workspace.requirements.filter((requirement) => requirement.area === area),
      rows(),
      workspace.mappings,
      workspace.courses,
      workspace.equivalencies
    ).every((item) => item.status !== "missing" || item.requirement.constraint_only);
    if (areaRows().length === 0 || areaIsCovered()) continue;
    for (let pass = 0; pass < 4 && !areaIsCovered(); pass += 1) {
      const choices = candidates
        .filter((course) => {
          const code = degreeCode(course.course_code);
          return !usedCodes.has(code)
            && workspace.equivalencies.some((equivalency) => equivalency.normalized_course_code === code && equivalency.requirement_area === area);
        })
        .flatMap((course) => {
          const period = placementFor(course);
          if (!period) return [];
          const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === degreeCode(course.course_code));
          return [{ course, period, credits: Number(equivalency?.high_school_credits ?? 0) }];
        })
        .sort((left, right) => right.credits - left.credits
          || termRank(left.period.grade, left.period.term) - termRank(right.period.grade, right.period.term)
          || left.course.course_code.localeCompare(right.course.course_code));
      const selected = choices[0];
      if (!selected || selected.credits <= 0) break;
      const code = degreeCode(selected.course.course_code);
      const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === code)!;
      const collegeUnits = Number(selected.course.units_max ?? selected.course.units_min);
      additions.push({
        smccd_course_id: selected.course.id,
        grade_level: selected.period.grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, selected.period.grade),
        term: selected.period.term,
        status: selected.period.grade === currentGrade ? "current" : "planned",
        credits: resolveCollegeHighSchoolCredits({ collegeUnits, storedHighSchoolCredits: null, equivalencyHighSchoolCredits: equivalency.high_school_credits, normalizedCourseCode: code }).credits,
        college_units: collegeUnits,
        college_provider_code: "SMCCD",
        is_weighted: true,
        mapping_verified: true,
        requirement_area_override: area as PlanCourse["requirement_area_override"],
        notes: "Verified college sequence completing both a diploma area and bookmarked-degree/general-education planning."
      });
      usedCodes.add(code);
    }
  }
  currentAudit = audit(rows());
  return { additions, complete: currentAudit.complete, goals: currentAudit.goals };
}

interface SchedulePlacementAdjustment {
  plan_course_id: string;
  from_course_id: string | null;
  course_id: string;
  from_grade_level: GradeLevel;
  grade_level: GradeLevel;
  school_year: string;
  term: PlanCourse["term"];
  status: PlanCourse["status"];
  credits: number | null;
  college_units: number | null;
  is_weighted: boolean;
  mapping_verified: boolean;
}

function normalizedScheduleText(value: string | null | undefined) {
  return String(value ?? "").toLowerCase()
    .replace(/\bpre[ -]?calc(?:ulus)?\b/g, "precalculus")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedLanguageCourseText(value: string | null | undefined) {
  return normalizedScheduleText(value)
    .replace(/\bmandarin\b/g, "chinese")
    .replace(/\biii\b/g, "3")
    .replace(/\bii\b/g, "2")
    .replace(/\bi\b/g, "1")
    .replace(/\b(?:fall|spring|summer|semester|first|second|intermediate|advanced|elementary|beginning)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedBatchCatalogText(value: string | null | undefined) {
  return normalizedScheduleText(value)
    .replace(/\bcalc\b/g, "calculus")
    .replace(/\beng\s+(?=c?\d)/g, "engl ")
    .replace(/\bno\s+sql\b/g, "nosql")
    .replace(/\biii\b/g, "3")
    .replace(/\bii\b/g, "2")
    .replace(/\bi\b/g, "1")
    .replace(/\s+/g, " ")
    .trim();
}

function batchCatalogMatchScore(queryValue: string, candidateValue: string) {
  const query = normalizedBatchCatalogText(queryValue);
  const candidate = normalizedBatchCatalogText(candidateValue);
  if (!query || !candidate) return -1;
  if (!query.includes("physics") && candidate.includes("physics")) return -1;
  let score = candidate === query ? 1000
    : candidate.startsWith(`${query} `) || candidate.endsWith(` ${query}`) ? 850
      : candidate.includes(query) ? 700
        : -1;
  const queryTokens = query.split(" ").filter(Boolean);
  if (score < 0) {
    if (!queryTokens.every((token) => candidate.includes(token))) return -1;
    score = 500 + queryTokens.length * 10;
  }
  if (/^calculus [123]$/.test(query) && candidate.includes("analytic geometry")) score += 220;
  if (/^calculus [123]$/.test(query) && candidate.includes("applied calculus")) score -= 120;
  return score;
}

function batchSequenceIdentity(course: SmccdCourse) {
  const title = normalizedBatchCatalogText(course.title);
  const match = title.match(/^(.*?\b(?:calculus|language|spanish|french|chinese)\b.*?)\s+([123])$/);
  if (!match) return null;
  return { key: `${course.subject}:${match[1]}`, level: Number(match[2]) };
}

function batchPlacementIndex(gradeLevel: GradeLevel, term: PlanCourse["term"]) {
  const termOffset = term === "fall" || term === "full_year" ? 0 : term === "spring" ? 1 : 2;
  return gradeLevel * 4 + termOffset;
}

function assistantPlanCourseCandidate(
  workspace: AssistantWorkspace,
  entry: { source: "selected_school" | "smccd"; course_id: string; status: "current" | "planned"; grade_level: GradeLevel; term: PlanCourse["term"] },
  smccdCourse: SmccdCourse | null,
  index: number
): PlanCourse {
  const selectedSchoolCourse = entry.source === "selected_school"
    ? workspace.courses.find((course) => course.id === entry.course_id) ?? null
    : null;
  const normalizedCode = smccdCourse ? normalizeCollegeCourseCode(smccdCourse.course_code) : null;
  const equivalency = normalizedCode
    ? workspace.equivalencies.find((candidate) => candidate.normalized_course_code === normalizedCode) ?? null
    : null;
  const collegeUnits = smccdCourse ? Number(smccdCourse.units_max ?? smccdCourse.units_min) : selectedSchoolCourse?.college_units ?? null;
  const creditResolution = smccdCourse
    ? resolveCollegeHighSchoolCredits({
        collegeUnits: Number(collegeUnits ?? 0),
        storedHighSchoolCredits: null,
        equivalencyHighSchoolCredits: equivalency?.high_school_credits,
        normalizedCourseCode: normalizedCode ?? ""
      })
    : null;
  return {
    id: `batch-candidate:${index}:${entry.course_id}`,
    plan_version_id: workspace.activeVersion.id,
    user_id: workspace.settings.id,
    course_id: selectedSchoolCourse?.id ?? null,
    custom_course_name: smccdCourse ? `${smccdCourse.course_code} ${smccdCourse.title}` : null,
    smccd_course_id: smccdCourse?.id ?? null,
    college_provider_code: smccdCourse ? "SMCCD" : null,
    requirement_area_override: equivalency?.requirement_area ?? null,
    source_review_item_id: null,
    notes: null,
    mapping_verified: selectedSchoolCourse
      ? workspace.mappings.some((mapping) => mapping.course_id === selectedSchoolCourse.id && mapping.confidence === "verified")
      : Boolean(equivalency),
    is_weighted: smccdCourse ? true : Boolean(selectedSchoolCourse?.is_weighted),
    credits: smccdCourse ? Number(creditResolution?.credits ?? 0) : Number(selectedSchoolCourse?.credits ?? 0),
    college_units: collegeUnits == null ? null : Number(collegeUnits),
    letter_grade: null,
    user_edited: true,
    grade_level: entry.grade_level,
    school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, entry.grade_level),
    term: entry.term,
    status: entry.status,
    sort_order: workspace.planCourses.length + index
  };
}

function automaticPlanningPenalty(course: Course, interestText: string) {
  const text = normalizedScheduleText(`${course.name} ${course.subject} ${course.description ?? ""}`);
  const explicitlyRequested = interestText && text.split(" ").some((token) => token.length > 3 && interestText.includes(token));
  if (explicitlyRequested) return 0;
  if (/\b(leadership|community service|work experience|internship|teacher assistant|teaching assistant|peer tutor|peer mentor|yearbook|early childhood|child development|sports leadership|phoenix|avid)\b/.test(text)) return 4;
  if (/\b(seminar|student government|office aide|campus aide)\b/.test(text)) return 2;
  if (/\b(math|english|science|biology|chemistry|physics|history|government|economics|computer|engineering|language|spanish|french|art|music)\b/.test(text)) return -1;
  return 0;
}

function looksLikeUnmappedCoreCourse(course: Course) {
  const text = normalizedScheduleText(`${course.name} ${course.subject}`);
  if (/\bcomputer science\b/.test(text)) return false;
  return /\b(?:math|algebra|geometry|calculus|statistics|english|history|government|economics|biology|chemistry|physics|environmental science|physical education|spanish|french|chinese|mandarin|japanese|latin|german|italian)\b/.test(text);
}

function scheduleQualityFailures(
  workspace: AssistantWorkspace,
  generatedRows: PlanCourse[],
  adjustedPlanCourses: PlanCourse[],
  preferences: {
    interests?: string[];
    rigor?: "balanced" | "advanced" | "lighter";
    startGrade?: GradeLevel;
    maxCoursesPerTerm?: number | null;
    objectives?: string[];
  }
) {
  const failures: string[] = [];
  const requirementById = new Map(workspace.requirements.map((requirement) => [requirement.id, requirement]));
  const areasByCourse = new Map<string, Set<string>>();
  for (const mapping of workspace.mappings.filter((candidate) => candidate.confidence === "verified")) {
    const area = requirementById.get(mapping.requirement_id)?.area;
    if (!area) continue;
    const values = areasByCourse.get(mapping.course_id) ?? new Set<string>();
    values.add(area);
    areasByCourse.set(mapping.course_id, values);
  }
  const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
  const combined = [...adjustedPlanCourses, ...generatedRows];
  const startGrade = preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9;
  const endGrade = Math.max(startGrade, workspace.settings.plan_end_grade ?? 12) as GradeLevel;
  const planningGrades = ([9, 10, 11, 12] as GradeLevel[]).filter((grade) => grade >= startGrade && grade <= endGrade);
  const advanced = preferences.rigor === "advanced" || preferences.objectives?.includes("maximize_weighted_gpa");
  const accountGrade = Math.max(9, Math.min(12, Number(workspace.settings.grade_level ?? startGrade))) as GradeLevel;
  const gradeRule = (grade: GradeLevel) => workspace.planningProfile?.grade_rules[String(grade) as `${GradeLevel}`];
  const textForRow = (row: PlanCourse) => {
    const course = row.course_id ? courseById.get(row.course_id) : null;
    return normalizedScheduleText(`${course?.name ?? row.custom_course_name ?? ""} ${course?.subject ?? ""}`);
  };
  const rowMatchesArea = (row: PlanCourse, area: string) => {
    if (row.requirement_area_override === area || (row.course_id && areasByCourse.get(row.course_id)?.has(area))) return true;
    const text = textForRow(row);
    if (area === "english") return /\benglish\b/.test(text);
    if (area === "math") return !/\bcomputer science\b/.test(text) && /\bmath\b|\balgebra\b|\bgeometry\b|\bcalculus\b|\bstatistics\b/.test(text);
    if (area === "physical_education") return /\bphysical education\b|\bpe\s*(?:1|2|i|ii)?\b/.test(text);
    return false;
  };
  const yearRows = (grade: GradeLevel) => combined.filter((row) => row.grade_level === grade);
  const generatedYearRows = (grade: GradeLevel) => generatedRows.filter((row) => row.grade_level === grade);
  const flexibleDiplomaAreas = new Set(["world_language", "visual_performing_arts", "career_technical_education"]);
  const diplomaAreaIsCovered = (area: string) => {
    const required = workspace.requirements
      .filter((requirement) => requirement.area === area)
      .reduce((total, requirement) => total + Number(requirement.credits_required ?? 0), 0);
    if (required <= 0) return true;
    return combined
      .filter((row) => rowMatchesArea(row, area))
      .reduce((total, row) => total + Number(row.credits ?? 0), 0) >= required;
  };
  const forwardPolicyAppliesForGrade = (grade: GradeLevel) => grade > accountGrade || !yearRows(grade).some((row) => row.status === "completed");
  for (const grade of planningGrades) {
    const rows = yearRows(grade);
    const policyRule = gradeRule(grade);
    const forwardPolicyApplies = forwardPolicyAppliesForGrade(grade);
    for (const area of forwardPolicyApplies ? policyRule?.required_areas ?? [] : []) {
      if (!rows.some((row) => rowMatchesArea(row, area)) && !(flexibleDiplomaAreas.has(area) && diplomaAreaIsCovered(area))) {
        failures.push(`Grade ${grade} is missing the school-required ${area.replaceAll("_", " ")} area.`);
      }
    }
    for (const area of forwardPolicyApplies ? workspace.planningProfile?.always_high_school_areas ?? [] : []) {
      if (!rows.some((row) => rowMatchesArea(row, area) && !row.smccd_course_id && Number(row.college_units ?? 0) === 0)) {
        failures.push(`Grade ${grade} must take ${area.replaceAll("_", " ")} at ${workspace.school.short_name}.`);
      }
    }
    if (policyRule && forwardPolicyApplies) {
      for (const term of ["fall", "spring"] as const) {
        const highSchoolLoad = scheduleTermLoad(rows, workspace.courses, grade, term, true);
        if (highSchoolLoad < policyRule.minimum_high_school_courses) {
          failures.push(`Grade ${grade} ${term} has ${highSchoolLoad} high-school courses; ${workspace.school.short_name} requires at least ${policyRule.minimum_high_school_courses}.`);
        }
      }
    }
    if (advanced && forwardPolicyApplies && !rows.some((row) => rowMatchesArea(row, "english"))) failures.push(`Grade ${grade} is missing English.`);
    if (advanced && forwardPolicyApplies && !rows.some((row) => rowMatchesArea(row, "math"))) failures.push(`Grade ${grade} is missing mathematics.`);
    for (const area of ["english", "math", "lab_science", "world_language", "design_lab", "visual_performing_arts", "physical_education"]) {
      const count = generatedYearRows(grade).filter((row) => rowMatchesArea(row, area)).length;
      if (count > 1) failures.push(`Grade ${grade} has ${count} automatically selected ${area.replaceAll("_", " ")} courses.`);
    }
  }
  const hasSocialRequirement = workspace.requirements.some((requirement) => requirement.area === "social_science" && requirement.credits_required > 0);
  if (hasSocialRequirement) {
    const socialSequenceRows = (pattern: RegExp) => combined.filter((row) => pattern.test(textForRow(row)));
    const repeatedSequence = (rows: PlanCourse[]) => rows.some((row) => row.status !== "completed")
      && rows.reduce((total, row) => total + Number(row.credits ?? 0), 0) > 10;
    const worldHistoryRows = socialSequenceRows(/\b(?:world|european) history\b/);
    const usHistoryRows = socialSequenceRows(/\b(?:u s|us|united states|american) history\b/);
    if (repeatedSequence(worldHistoryRows)) failures.push(`The plan repeats World History content (${worldHistoryRows.reduce((total, row) => total + Number(row.credits ?? 0), 0)} credits for a 10-credit sequence).`);
    if (repeatedSequence(usHistoryRows)) failures.push(`The plan repeats U.S. History content (${usHistoryRows.reduce((total, row) => total + Number(row.credits ?? 0), 0)} credits for a 10-credit sequence).`);
    if (planningGrades.includes(10) && forwardPolicyAppliesForGrade(10) && (!workspace.planningProfile || gradeRule(10)?.required_areas.includes("social_science")) && !yearRows(10).some((row) => /\b(?:world|european) history\b/.test(textForRow(row)))) failures.push("Grade 10 is missing the World History sequence.");
    if (planningGrades.includes(11) && forwardPolicyAppliesForGrade(11) && (!workspace.planningProfile || gradeRule(11)?.required_areas.includes("social_science")) && !yearRows(11).some((row) => /\b(?:u s|us|united states|american) history\b/.test(textForRow(row)))) failures.push("Grade 11 is missing the U.S. History sequence.");
    if (planningGrades.includes(12) && (!workspace.planningProfile || gradeRule(12)?.required_areas.includes("social_science"))) {
      const seniorHistory = yearRows(12).map(textForRow);
      if (!seniorHistory.some((text) => /\bgovernment\b|\bcivics\b/.test(text)) || !seniorHistory.some((text) => /\beconomics\b/.test(text))) {
        failures.push("Grade 12 must include both Government and Economics.");
      }
    }
  }
  const mathRows = combined
    .flatMap((row) => {
      const rank = mathSequenceRankFromText(textForRow(row));
      return rank === null ? [] : [{ row, rank, text: textForRow(row) }];
    })
    .sort((left, right) => {
      const termIndex = (row: PlanCourse) => (row.grade_level - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
      return termIndex(left.row) - termIndex(right.row) || left.rank - right.rank;
    });
  let highestMathRank = 0;
  for (const entry of mathRows) {
    if (entry.row.status !== "completed" && highestMathRank > 0 && entry.rank < highestMathRank) {
      failures.push(`The math sequence regresses from level ${highestMathRank} to level ${entry.rank} at ${entry.row.custom_course_name ?? courseById.get(entry.row.course_id ?? "")?.name ?? "a later course"}.`);
      break;
    }
    if (entry.row.status !== "completed" && highestMathRank > 0 && entry.rank > highestMathRank + 1) {
      failures.push(`The math sequence skips from level ${highestMathRank} to level ${entry.rank} without an intervening verified course.`);
      break;
    }
    highestMathRank = Math.max(highestMathRank, entry.rank);
  }
  const degreeCatalogById = new Map(workspace.degreeCatalogCourses.map((course) => [course.id, course]));
  for (const row of combined.filter((candidate) => candidate.id.startsWith("generated:smccd:") && candidate.smccd_course_id)) {
    const course = degreeCatalogById.get(row.smccd_course_id!);
    if (!course || course.prerequisites.length === 0) continue;
    const prerequisite = evaluateSmccdPlannerPrerequisites(
      course,
      { gradeLevel: row.grade_level, term: row.term, instanceId: row.id },
      workspace.degreeCatalogCourses,
      combined,
      workspace.courses
    );
    if (prerequisite.result.status === "blocked"
      || (prerequisite.result.status === "needs_review" && !explicitSmccdPrerequisitesReady(course, { gradeLevel: row.grade_level, term: row.term }, combined, workspace.degreeCatalogCourses, workspace.courses))) {
      failures.push(`${course.course_code} is not prerequisite-ready in ${row.school_year} ${row.term.replaceAll("_", " ")}.`);
    }
  }
  const hasPeRequirement = workspace.requirements.some((requirement) => requirement.area === "physical_education" && requirement.credits_required > 0);
  if (hasPeRequirement && planningGrades.includes(9) && forwardPolicyAppliesForGrade(9) && (!workspace.planningProfile || gradeRule(9)?.required_areas.includes("physical_education")) && !yearRows(9).some((row) => /\b(?:pe|physical education)\s*(?:1|i)\b/.test(textForRow(row)))) {
    failures.push("Grade 9 is missing the first-year physical education course.");
  }
  if (hasPeRequirement && planningGrades.includes(10) && forwardPolicyAppliesForGrade(10) && (!workspace.planningProfile || gradeRule(10)?.required_areas.includes("physical_education")) && !yearRows(10).some((row) => /\b(?:pe|physical education)\s*(?:2|ii)\b/.test(textForRow(row)))) {
    failures.push("Grade 10 is missing the second-year physical education course.");
  }
  const hasScienceRequirement = workspace.requirements.some((requirement) => requirement.area === "lab_science" && requirement.credits_required >= 20);
  if (hasScienceRequirement && planningGrades.length === 4) {
    const scienceTexts = combined.filter((row) => rowMatchesArea(row, "lab_science")).map(textForRow);
    if (!scienceTexts.some((text) => /\bbiology\b|\blife science\b/.test(text))) failures.push("The four-year plan is missing a life science course.");
    if (!scienceTexts.some((text) => /\bchemistry\b|\bphysics\b|\bphysical science\b/.test(text))) failures.push("The four-year plan is missing a physical science course.");
    if (advanced) {
      for (const grade of planningGrades.filter((candidate) => candidate <= 11 && forwardPolicyAppliesForGrade(candidate))) {
        if (!yearRows(grade).some((row) => rowMatchesArea(row, "lab_science"))) failures.push(`Grade ${grade} is missing science in the advanced sequence.`);
      }
    }
  }
  for (const row of generatedRows) {
    const course = row.course_id ? courseById.get(row.course_id) : null;
    if (course && courseNeedsExplicitPlanningIntent(course, preferences.interests ?? [])) {
      failures.push(`${course.name} needs an explicit student need or interest before automatic placement.`);
    }
  }
  for (const row of combined) {
    const text = textForRow(row);
    const priorOrConcurrentMath = combined.filter((candidate) => candidate.grade_level <= row.grade_level && rowMatchesArea(candidate, "math")).map(textForRow);
    const priorMath = combined.filter((candidate) => candidate.grade_level < row.grade_level && rowMatchesArea(candidate, "math")).map(textForRow);
    if (/\bap physics c\b/.test(text) && !priorOrConcurrentMath.some((candidate) => /\bcalculus\b/.test(candidate))) {
      failures.push(`${courseById.get(row.course_id ?? "")?.name ?? "AP Physics C"} requires concurrent or prior calculus.`);
    }
    if (/\bap statistics\b/.test(text) && !priorMath.some((candidate) => /\bprecalculus\b/.test(candidate))) {
      failures.push("AP Statistics requires prior Precalculus in this catalog-backed plan.");
    }
    if (/\bap calculus\b/.test(text) && !priorMath.some((candidate) => /\bprecalculus\b/.test(candidate))) {
      failures.push(`${courseById.get(row.course_id ?? "")?.name ?? "AP Calculus"} requires prior Precalculus.`);
    }
  }
  const workloadGrades = planningGrades.filter((grade) => grade > accountGrade || !yearRows(grade).some((row) => row.status === "completed"));
  const loads = workloadGrades.flatMap((grade) => (["fall", "spring"] as const).map((term) => ({
    grade,
    term,
    count: scheduleTermLoad(yearRows(grade), workspace.courses, grade, term)
  })));
  if (loads.length) {
    const maximum = Math.max(...loads.map((load) => load.count));
    for (const grade of workloadGrades) {
      const gradeLoads = loads.filter((load) => load.grade === grade).map((load) => load.count);
      if (gradeLoads.length === 2 && Math.abs(gradeLoads[0] - gradeLoads[1]) > 1) failures.push(`Grade ${grade} is unbalanced between fall and spring (${gradeLoads.join(" to ")} courses).`);
    }
    if (preferences.maxCoursesPerTerm && maximum > preferences.maxCoursesPerTerm) failures.push(`The proposed schedule exceeds the ${preferences.maxCoursesPerTerm}-course workload cap.`);
  }
  return [...new Set(failures)];
}

function scheduleWorkspaceWithPlacementAdjustments(
  workspace: AssistantWorkspace,
  preferences: { rigor: "balanced" | "advanced" | "lighter"; startGrade?: GradeLevel; startingMathCourse?: string | null }
) {
  const requested = normalizedScheduleText(preferences.startingMathCourse);
  if (!requested) return { workspace, adjustments: [] as SchedulePlacementAdjustment[] };
  const targetGrade = (preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9) as GradeLevel;
  const mathRequirementIds = new Set(workspace.requirements.filter((requirement) => requirement.area === "math").map((requirement) => requirement.id));
  const mappedMathCourseIds = new Set(workspace.mappings.filter((mapping) => mathRequirementIds.has(mapping.requirement_id) && mapping.confidence === "verified").map((mapping) => mapping.course_id));
  const matchesRequest = (course: Course) => {
    const candidate = normalizedScheduleText(`${course.course_code ?? ""} ${course.name}`);
    return Boolean(candidate.includes(requested) || requested.includes(normalizedScheduleText(course.name)));
  };
  const candidates = workspace.courses
    .filter((course) => matchesRequest(course) && mappedMathCourseIds.has(course.id))
    .filter((course) => course.grade_levels.length === 0 || course.grade_levels.includes(targetGrade))
    .sort((left, right) => {
      const rigor = preferences.rigor === "advanced"
        ? Number(right.is_weighted) - Number(left.is_weighted)
        : preferences.rigor === "lighter"
          ? Number(left.is_weighted) - Number(right.is_weighted)
          : 0;
      return rigor || right.grade_levels.length - left.grade_levels.length || left.name.localeCompare(right.name);
    });
  const selectedCourse = candidates[0];
  if (!selectedCourse) return { workspace, adjustments: [] as SchedulePlacementAdjustment[] };
  const existingRow = workspace.planCourses.find((row) => {
    if (row.status === "completed" || row.source_review_item_id) return false;
    const course = row.course_id ? workspace.courses.find((candidate) => candidate.id === row.course_id) : null;
    const candidate = normalizedScheduleText(`${course?.course_code ?? ""} ${course?.name ?? row.custom_course_name ?? ""}`);
    return candidate.includes(requested) || requested.includes(normalizedScheduleText(course?.name ?? row.custom_course_name));
  });
  if (!existingRow) return { workspace, adjustments: [] as SchedulePlacementAdjustment[] };
  const term: PlanCourse["term"] = selectedCourse.term_type === "year" ? "full_year" : existingRow.term === "full_year" ? "fall" : existingRow.term;
  if (existingRow.course_id === selectedCourse.id && existingRow.grade_level === targetGrade && existingRow.term === term) {
    return { workspace, adjustments: [] as SchedulePlacementAdjustment[] };
  }
  const adjustment: SchedulePlacementAdjustment = {
    plan_course_id: existingRow.id,
    from_course_id: existingRow.course_id,
    course_id: selectedCourse.id,
    from_grade_level: existingRow.grade_level,
    grade_level: targetGrade,
    school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, targetGrade),
    term,
    status: existingRow.status,
    credits: selectedCourse.credits,
    college_units: selectedCourse.college_units,
    is_weighted: selectedCourse.is_weighted,
    mapping_verified: mappedMathCourseIds.has(selectedCourse.id)
  };
  const planCourses = workspace.planCourses.map((row) => row.id === existingRow.id ? {
    ...row,
    course_id: adjustment.course_id,
    custom_course_name: null,
    grade_level: adjustment.grade_level,
    school_year: adjustment.school_year,
    term: adjustment.term,
    credits: adjustment.credits,
    college_units: adjustment.college_units,
    is_weighted: adjustment.is_weighted,
    mapping_verified: adjustment.mapping_verified,
    user_edited: true
  } : row);
  return { workspace: { ...workspace, planCourses }, adjustments: [adjustment] };
}

function pruneRedundantGeneratedSchedule(
  workspace: AssistantWorkspace,
  schoolAdditions: ReturnType<typeof generateSuggestedPlan>,
  degreeAdditions: GeneratedDegreeCourse[],
  preferences: { startGrade?: GradeLevel; startingMathCourse?: string | null; startingLanguageCourse?: string | null }
) {
  let school = [...schoolAdditions];
  let college = [...degreeAdditions];
  const requirementById = new Map(workspace.requirements.map((requirement) => [requirement.id, requirement]));
  const areasByCourse = new Map<string, Set<string>>();
  for (const mapping of workspace.mappings.filter((candidate) => candidate.confidence === "verified")) {
    const area = requirementById.get(mapping.requirement_id)?.area;
    if (!area) continue;
    const areas = areasByCourse.get(mapping.course_id) ?? new Set<string>();
    areas.add(area);
    areasByCourse.set(mapping.course_id, areas);
  }
  const collegeById = new Map(workspace.degreeCatalogCourses.map((course) => [course.id, course]));
  const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
  const generatedRows = () => [
    ...school.map((row, index) => generatedPlanCourseRow(workspace, row, index)),
    ...college.map((row, index) => generatedDegreeCourseRow(workspace, row, index))
  ];
  const allRows = () => [...workspace.planCourses, ...generatedRows()];
  const diplomaSignature = (rows: PlanCourse[]) => new Map(calculateRequirementProgress(
    workspace.requirements,
    rows,
    workspace.mappings,
    workspace.courses,
    workspace.equivalencies
  ).map((item) => [item.requirement.id, Math.min(item.verifiedProjectedCredits, item.requirement.credits_required)]));
  const bookmarkedPrograms = workspace.degreePrograms.filter((program) => workspace.collegeGoals.some((goal) => goal.program_id === program.id));
  const bookmarkedRequirementIds = new Set(workspace.degreeRequirements
    .filter((requirement) => bookmarkedPrograms.some((program) => program.id === requirement.program_id))
    .map((requirement) => requirement.id));
  const degreeSignature = (rows: PlanCourse[]) => {
    const signature = new Map<string, number>();
    if (!bookmarkedPrograms.length) return signature;
    const context = createSmccdProgramProgressContext(
      workspace.degreeRequirements.filter((requirement) => bookmarkedRequirementIds.has(requirement.id)),
      workspace.degreeRequirementCourses.filter((option) => bookmarkedRequirementIds.has(option.requirement_id)),
      rows,
      workspace.degreeCatalogCourses
    );
    const manual = new Set(workspace.manualSmccdCompletions.map((completion) => completion.area));
    for (const program of bookmarkedPrograms) {
      const progress = calculateSmccdProgramProgressWithContext(program, context);
      const local = calculateSmccdLocalDegreeProgress(context, program.college_code, manual);
      signature.set(`${program.id}:units`, Math.min(progress.projectedDegreeApplicableUnits, progress.totalDegreeUnits));
      for (const requirement of progress.requirements) signature.set(`${program.id}:major:${requirement.requirement.id}`, requirement.completionRatio);
      for (const area of local.geAreas) {
        signature.set(`${program.id}:ge:${area.area}:status`, Number(["completed", "planned"].includes(area.status)));
        signature.set(`${program.id}:ge:${area.area}:units`, Math.min(area.projectedUnits, area.requiredUnits));
      }
      for (const requirement of local.graduationRequirements) {
        signature.set(`${program.id}:other:${requirement.id}`, Number(["completed", "planned"].includes(requirement.status)));
      }
    }
    return signature;
  };
  const initialRows = allRows();
  const requiredDiploma = diplomaSignature(initialRows);
  const requiredDegree = degreeSignature(initialRows);
  const prerequisiteFailures = (rows: PlanCourse[]) => new Set(rows.flatMap((row) => {
    if (!row.smccd_course_id) return [];
    const course = collegeById.get(row.smccd_course_id);
    if (!course) return [];
    const result = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: row.grade_level, term: row.term, instanceId: row.id }, workspace.degreeCatalogCourses, rows, workspace.courses);
    return result.result.status === "blocked" && !/student-provided|placement override/i.test(row.notes ?? "") ? [row.smccd_course_id] : [];
  }));
  const initialPrerequisiteFailures = prerequisiteFailures(initialRows);
  const startGrade = preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9;
  const requestedMath = normalizedScheduleText(preferences.startingMathCourse);
  const requestedLanguage = normalizedLanguageCourseText(preferences.startingLanguageCourse);
  const rowText = (row: PlanCourse) => {
    const schoolCourse = row.course_id ? courseById.get(row.course_id) : null;
    const collegeCourse = row.smccd_course_id ? collegeById.get(row.smccd_course_id) : null;
    const equivalency = collegeCourse
      ? workspace.equivalencies.find((candidate) => candidate.normalized_course_code === normalizeCollegeCourseCode(collegeCourse.course_code))
      : null;
    return normalizedLanguageCourseText(`${schoolCourse?.course_code ?? collegeCourse?.course_code ?? ""} ${schoolCourse?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""} ${equivalency?.high_school_equivalent ?? ""}`);
  };
  const preservesPolicy = (rows: PlanCourse[]) => {
    for (const grade of ([9, 10, 11, 12] as GradeLevel[]).filter((value) => value >= startGrade)) {
      const rule = workspace.planningProfile?.grade_rules[String(grade) as `${GradeLevel}`];
      if (rule) {
        for (const term of ["fall", "spring"] as const) {
          if (scheduleTermLoad(rows, workspace.courses, grade, term, true) < rule.minimum_high_school_courses) return false;
        }
      }
      for (const area of workspace.planningProfile?.always_high_school_areas ?? []) {
        if (!rows.some((row) => row.grade_level === grade && !row.smccd_course_id && Boolean(row.course_id) && areasByCourse.get(row.course_id!)?.has(area))) return false;
      }
    }
    if (requestedMath && !rows.some((row) => row.grade_level === startGrade && rowText(row).includes(requestedMath))) return false;
    if (requestedLanguage && !rows.some((row) => row.grade_level === startGrade && rowText(row).includes(requestedLanguage))) return false;
    return true;
  };
  const preservesVerifiedOutcomes = (rows: PlanCourse[]) => {
    const diploma = diplomaSignature(rows);
    if ([...requiredDiploma].some(([key, value]) => Number(diploma.get(key) ?? 0) + 0.001 < value)) return false;
    const degree = degreeSignature(rows);
    if ([...requiredDegree].some(([key, value]) => Number(degree.get(key) ?? 0) + 0.001 < value)) return false;
    const blocked = prerequisiteFailures(rows);
    if ([...blocked].some((id) => !initialPrerequisiteFailures.has(id))) return false;
    return preservesPolicy(rows);
  };

  // Prefer the concurrent course when it advances the same verified diploma
  // area; then remove any remaining course whose absence changes no verified
  // outcome. Later duplicated school courses are considered before earlier
  // foundations, and college fillers are considered only after school overlap.
  const collegeAreas = new Set(college.map((row) => row.requirement_area_override).filter(Boolean));
  const schoolCandidates = [...school].sort((left, right) => {
    const leftOverlap = Number([...(areasByCourse.get(left.course_id) ?? [])].some((area) => collegeAreas.has(area as PlanCourse["requirement_area_override"])));
    const rightOverlap = Number([...(areasByCourse.get(right.course_id) ?? [])].some((area) => collegeAreas.has(area as PlanCourse["requirement_area_override"])));
    return rightOverlap - leftOverlap || right.grade_level - left.grade_level || left.course_id.localeCompare(right.course_id);
  });
  for (const candidate of schoolCandidates) {
    const index = school.findIndex((row) => row.course_id === candidate.course_id);
    if (index < 0) continue;
    const nextSchool = school.filter((_, rowIndex) => rowIndex !== index);
    const previous = school;
    school = nextSchool;
    if (!preservesVerifiedOutcomes(allRows())) school = previous;
  }
  const collegeCandidates = [...college].sort((left, right) => right.grade_level - left.grade_level
    || (right.term === "spring" ? 1 : 0) - (left.term === "spring" ? 1 : 0)
    || left.smccd_course_id.localeCompare(right.smccd_course_id));
  for (const candidate of collegeCandidates) {
    const index = college.findIndex((row) => row.smccd_course_id === candidate.smccd_course_id);
    if (index < 0) continue;
    const nextCollege = college.filter((_, rowIndex) => rowIndex !== index);
    const previous = college;
    college = nextCollege;
    if (!preservesVerifiedOutcomes(allRows())) college = previous;
  }
  return { schoolAdditions: school, degreeAdditions: college };
}

function generateValidatedSchedule(
  workspace: AssistantWorkspace,
  enrollmentPolicy: EnrollmentPolicy | null,
  respectRecommendedLimit: boolean,
  preferences: { interests: string[]; rigor: "balanced" | "advanced" | "lighter"; maxCoursesPerTerm: number | null; startGrade?: GradeLevel; startingMathCourse?: string | null; startingLanguageCourse?: string | null; includeCollegeCourses?: boolean; replaceExisting?: boolean; replaceGradeLevels?: GradeLevel[]; objectives?: string[] } = { interests: [], rigor: "balanced", maxCoursesPerTerm: null }
) {
  const originalPlanCourses = workspace.planCourses;
  const scopedGrades = new Set(preferences.replaceGradeLevels ?? []);
  const isInReplacementScope = (row: PlanCourse) => scopedGrades.size === 0 || scopedGrades.has(row.grade_level);
  const replacedRows = preferences.replaceExisting
    ? originalPlanCourses.filter((row) => !row.source_review_item_id && isInReplacementScope(row))
    : [];
  if (preferences.replaceExisting) {
    workspace = { ...workspace, planCourses: originalPlanCourses.filter((row) => Boolean(row.source_review_item_id) || !isInReplacementScope(row)) };
  }
  const prepared = preferences.replaceExisting
    ? { workspace, adjustments: [] as SchedulePlacementAdjustment[] }
    : scheduleWorkspaceWithPlacementAdjustments(workspace, preferences);
  workspace = prepared.workspace;
  const rememberedRigor = workspace.memories.find((memory) => memory.memory_key === "schedule_rigor")?.content.toLowerCase() ?? "";
  const objectiveRigor = preferences.objectives?.includes("maximize_weighted_gpa") ? "advanced" : preferences.rigor;
  const effectiveRigor = objectiveRigor !== "balanced"
    ? objectiveRigor
    : rememberedRigor.includes("advanced") || rememberedRigor.includes("rigorous") || rememberedRigor.includes("honor")
      ? "advanced"
      : rememberedRigor.includes("lighter") || rememberedRigor.includes("easier")
        ? "lighter"
        : "balanced";
  const rememberedMaximum = Number(workspace.memories.find((memory) => memory.memory_key === "max_courses_per_term")?.content.match(/\d+/)?.[0]);
  const effectiveMaxCoursesPerTerm = preferences.maxCoursesPerTerm ?? (Number.isInteger(rememberedMaximum) && rememberedMaximum >= 1 && rememberedMaximum <= 12 ? rememberedMaximum : null);
  const basePlanCourses = workspace.planCourses;
  const degreePlan = preferences.includeCollegeCourses === false
    ? { additions: [] as GeneratedDegreeCourse[], complete: true, goals: [] as Array<Record<string, unknown>> }
    : integratedDegreePlan(workspace, enrollmentPolicy, respectRecommendedLimit, {
        startGrade: preferences.startGrade,
        startingMathCourse: preferences.startingMathCourse,
        startingLanguageCourse: preferences.startingLanguageCourse,
        maxCoursesPerTerm: effectiveMaxCoursesPerTerm,
        interests: preferences.interests,
        objectives: preferences.objectives
      });
  const degreeRows = degreePlan.additions.map((row, index) => generatedDegreeCourseRow(workspace, row, index));
  workspace = {
    ...workspace,
    planCourses: [...basePlanCourses, ...degreeRows],
    plannedSmccdCourses: [...new Map([...workspace.plannedSmccdCourses, ...workspace.degreeCatalogCourses].map((course) => [course.id, course])).values()]
  };
  const planningInterests = [...new Set([
    ...preferences.interests,
    ...workspace.degreePrograms
      .filter((program) => workspace.collegeGoals.some((goal) => goal.program_id === program.id))
      .map((program) => program.title)
  ])];
  const candidates = generateSuggestedPlan(
    workspace.settings,
    workspace.courses,
    workspace.planCourses,
    enrollmentPolicy,
    respectRecommendedLimit,
    {
      schoolSlug: workspace.school.slug,
      planningProfile: workspace.planningProfile,
      requirements: workspace.requirements,
      mappings: workspace.mappings,
      equivalencies: workspace.equivalencies,
      startGrade: preferences.startGrade,
      rigor: effectiveRigor,
      maxCoursesPerTerm: effectiveMaxCoursesPerTerm,
      startingMathCourse: preferences.startingMathCourse,
      startingLanguageCourse: preferences.startingLanguageCourse,
      includeCollegeCourses: preferences.includeCollegeCourses,
      interests: planningInterests
    }
  );
  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    const course = workspace.courses.find((row) => row.id === candidate.course_id);
    if (!course) continue;
    const requestedMath = normalizedScheduleText(preferences.startingMathCourse);
    const requestedLanguage = normalizedScheduleText(preferences.startingLanguageCourse);
    const requestedStartGrade = preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9;
    const isExplicitStartingMath = Boolean(requestedMath)
      && candidate.grade_level === requestedStartGrade
      && normalizedScheduleText(`${course.course_code ?? ""} ${course.name}`).includes(requestedMath);
    const isExplicitStartingLanguage = Boolean(requestedLanguage)
      && candidate.grade_level === requestedStartGrade
      && normalizedScheduleText(`${course.course_code ?? ""} ${course.name}`).includes(requestedLanguage);
    const planWithAccepted = [
      ...workspace.planCourses,
      ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))
    ];
    if (effectiveMaxCoursesPerTerm) {
      const terms = candidate.term === "full_year" ? ["fall", "spring"] : [candidate.term];
      if (terms.some((term) => (term === "fall" || term === "spring")
        && scheduleTermLoad(planWithAccepted, workspace.courses, candidate.grade_level, term) >= effectiveMaxCoursesPerTerm)) continue;
    }
    const eligibility = selectedSchoolCatalogEligibility(course, candidate.grade_level, planWithAccepted, workspace.courses, { schoolSlug: workspace.school.slug });
    const isAcceleratedMathContinuation = effectiveRigor === "advanced"
      && Boolean(preferences.startingMathCourse)
      && eligibility.reason === "outside_grade"
      && /\bcalculus\b|\bstatistics\b/.test(normalizedScheduleText(`${course.name} ${course.subject}`))
      && planWithAccepted.some((row) => row.grade_level < candidate.grade_level && row.course_id
        && /\bprecalculus\b|\bcalculus\b/.test(normalizedScheduleText(workspace.courses.find((item) => item.id === row.course_id)?.name)));
    if (!eligibility.eligible
      && !(isExplicitStartingMath && eligibility.reason === "outside_grade")
      && !(isExplicitStartingLanguage && eligibility.reason === "outside_grade")
      && !isAcceleratedMathContinuation) continue;
    const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(
      course,
      { gradeLevel: candidate.grade_level, term: candidate.term },
      workspace.courses,
      planWithAccepted,
      workspace.plannedSmccdCourses,
      workspace.equivalencies
    );
    if (prerequisite.result.status === "blocked" && !isExplicitStartingMath && !isExplicitStartingLanguage) continue;
    accepted.push({
      ...candidate,
      mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === candidate.course_id && mapping.confidence === "verified")
    });
  }

  // The standard flow is the first pass. Then fill remaining verified diploma
  // gaps with eligible catalog courses, preferring remembered interests.
  const currentGrade = Math.max(9, Math.min(12, Number(preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9))) as GradeLevel;
  const finalGrade = Math.max(currentGrade, Number(workspace.settings.plan_end_grade ?? 12)) as GradeLevel;
  const interestText = [...planningInterests, ...workspace.memories
    .filter((memory) => memory.memory_key.includes("interest"))
    .map((memory) => memory.content)].join(" ").toLowerCase();
  const unfillableRequirementIds = new Set<string>();
  for (let pass = 0; pass < workspace.requirements.length * 5 && accepted.length < 40; pass += 1) {
    const planWithAccepted = [
      ...workspace.planCourses,
      ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))
    ];
    const progress = calculateRequirementProgress(workspace.requirements, planWithAccepted, workspace.mappings, workspace.courses, workspace.equivalencies);
    const gap = progress.find((item) => item.status === "missing" && !item.requirement.constraint_only && !unfillableRequirementIds.has(item.requirement.id));
    if (!gap) break;
    const mappedIds = new Set(workspace.mappings
      .filter((mapping) => mapping.requirement_id === gap.requirement.id && mapping.confidence === "verified")
      .map((mapping) => mapping.course_id));
    const ranked = workspace.courses
      .filter((course) => mappedIds.has(course.id) && !planWithAccepted.some((row) => row.course_id === course.id))
      .filter((course) => workspace.school.slug === "design-tech-high-school" || course.grade_levels.length > 0)
      .filter((course) => preferences.includeCollegeCourses !== false || Number(course.college_units ?? 0) === 0)
      .filter((course) => !courseNeedsExplicitPlanningIntent(course, planningInterests))
      .map((course) => ({
        course,
        interestScore: interestText && [course.name, course.subject, course.description ?? ""].join(" ").toLowerCase().split(/\s+/).some((token) => token.length > 3 && interestText.includes(token)) ? 1 : 0,
        automationPenalty: automaticPlanningPenalty(course, interestText)
      }))
      .sort((left, right) => right.interestScore - left.interestScore
        || left.automationPenalty - right.automationPenalty
        || (effectiveRigor === "advanced" ? Number(right.course.is_weighted) - Number(left.course.is_weighted) : effectiveRigor === "lighter" ? Number(left.course.is_weighted) - Number(right.course.is_weighted) : 0)
        || left.course.name.localeCompare(right.course.name));
    let added = false;
    for (const { course } of ranked) {
      const termLoadForGrade = (grade: GradeLevel, term: "fall" | "spring") => scheduleTermLoad(planWithAccepted, workspace.courses, grade, term);
      const eligibleCourseGrades = ([9, 10, 11, 12] as GradeLevel[])
        .filter((candidateGrade) => candidateGrade >= currentGrade
          && candidateGrade <= finalGrade
          && (!course.grade_levels.length || course.grade_levels.includes(candidateGrade))
          && !planWithAccepted.some((row) => row.grade_level === candidateGrade && row.course_id && mappedIds.has(row.course_id)));
      if (!eligibleCourseGrades.length) continue;
      const preferredGrade = course.grade_levels.length && (course.is_weighted || course.prerequisites.length > 0)
        ? Math.max(...eligibleCourseGrades) as GradeLevel
        : Math.min(...eligibleCourseGrades) as GradeLevel;
      const grade = eligibleCourseGrades
        .sort((left, right) => Math.abs(left - preferredGrade) - Math.abs(right - preferredGrade)
          || Math.max(termLoadForGrade(left, "fall"), termLoadForGrade(left, "spring")) - Math.max(termLoadForGrade(right, "fall"), termLoadForGrade(right, "spring"))
          || left - right)[0];
      if (!grade) continue;
      const load = (term: "fall" | "spring") => termLoadForGrade(grade, term);
      const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : load("fall") <= load("spring") ? "fall" : "spring";
      if (effectiveMaxCoursesPerTerm) {
        const terms = term === "full_year" ? ["fall", "spring"] : [term];
        if (terms.some((candidateTerm) => load(candidateTerm as "fall" | "spring") >= effectiveMaxCoursesPerTerm)) continue;
      }
      if (!selectedSchoolCatalogEligibility(course, grade, planWithAccepted, workspace.courses, { schoolSlug: workspace.school.slug }).eligible) continue;
      const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
      if (prerequisite.result.status === "blocked") continue;
      const addition = {
        course_id: course.id,
        grade_level: grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, grade),
        term,
        status: grade === currentGrade ? "current" : "planned",
        credits: course.credits,
        college_units: course.college_units,
        college_provider_code: Number(course.college_units ?? 0) > 0 ? enrollmentPolicy?.provider_code ?? "SMCCD" : null,
        is_weighted: course.is_weighted,
        mapping_verified: true,
        user_edited: false
      } as const;
      if (enrollmentPolicy && Number(course.college_units ?? 0) > 0) {
        const tentative = [...planWithAccepted, generatedPlanCourseRow(workspace, addition, accepted.length)];
        const exceedsLimit = evaluateEnrollmentSchedule(tentative, enrollmentPolicy).some((termEvaluation) =>
          termEvaluation.state === "blocked" || (respectRecommendedLimit && termEvaluation.state === "over_policy")
        );
        if (exceedsLimit) continue;
      }
      accepted.push(addition);
      added = true;
      break;
    }
    if (!added) unfillableRequirementIds.add(gap.requirement.id);
  }

  // Eligibility and prerequisite checks can reject a course selected by the
  // first pass. Rebalance those holes with safe placement-ready electives,
  // without inventing a second core course or a support/pathway need.
  const requirementAreaById = new Map(workspace.requirements.map((requirement) => [requirement.id, requirement.area]));
  const mappedAreasByCourse = new Map<string, Set<string>>();
  for (const mapping of workspace.mappings.filter((mapping) => mapping.confidence === "verified")) {
    const area = requirementAreaById.get(mapping.requirement_id);
    if (!area) continue;
    const values = mappedAreasByCourse.get(mapping.course_id) ?? new Set<string>();
    values.add(area);
    mappedAreasByCourse.set(mapping.course_id, values);
  }
  const coreAreas = new Set(["english", "math", "social_science", "lab_science", "physical_education", "personal_development", "ethnic_studies", "world_language", "visual_performing_arts", "career_technical_education", "design_lab"]);
  const targetLoad = Math.max(1, Math.min(effectiveMaxCoursesPerTerm ?? 6, 6));
  const planningGrades = ([9, 10, 11, 12] as GradeLevel[]).filter((grade) => grade >= currentGrade && grade <= finalGrade);
  const courseText = (course: Course) => normalizedScheduleText(`${course.name} ${course.subject}`);
  const planRowText = (row: PlanCourse) => {
    const course = row.course_id ? workspace.courses.find((candidate) => candidate.id === row.course_id) : null;
    return normalizedScheduleText(`${course?.name ?? row.custom_course_name ?? ""} ${course?.subject ?? ""}`);
  };
  const planRowCoversArea = (row: PlanCourse, area: string) => {
    if (row.requirement_area_override === area || (row.course_id && mappedAreasByCourse.get(row.course_id)?.has(area))) return true;
    const text = planRowText(row);
    if (area === "english") return /\benglish\b/.test(text);
    if (area === "math") return !/\bcomputer science\b/.test(text) && /\bmath\b|\balgebra\b|\bgeometry\b|\bcalculus\b|\bstatistics\b/.test(text);
    if (area === "physical_education") return /\bphysical education\b|\bpe\s*(?:1|2|i|ii)?\b/.test(text);
    return false;
  };
  const flexibleDiplomaAreas = new Set(["world_language", "visual_performing_arts", "career_technical_education"]);
  const diplomaAreaIsCovered = (rows: PlanCourse[], area: string) => {
    const required = workspace.requirements
      .filter((requirement) => requirement.area === area)
      .reduce((total, requirement) => total + Number(requirement.credits_required ?? 0), 0);
    if (required <= 0) return true;
    return rows
      .filter((row) => planRowCoversArea(row, area))
      .reduce((total, row) => total + Number(row.credits ?? 0), 0) >= required;
  };
  const tryAddRequiredCourse = (grade: GradeLevel, area: string, namePattern?: RegExp, requiredMathRank?: number) => {
    const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
    const usedCourseIds = new Set(planWithAccepted.map((row) => row.course_id).filter(Boolean));
    const alwaysHighSchool = workspace.planningProfile?.always_high_school_areas.some((candidate) => candidate === area) ?? false;
    const ranked = workspace.courses
      .filter((course) => !usedCourseIds.has(course.id) && mappedAreasByCourse.get(course.id)?.has(area))
      .filter((course) => !course.grade_levels.length || course.grade_levels.includes(grade))
      .filter((course) => !alwaysHighSchool || Number(course.college_units ?? 0) === 0)
      .filter((course) => preferences.includeCollegeCourses !== false || Number(course.college_units ?? 0) === 0)
      .filter((course) => !namePattern || namePattern.test(courseText(course)))
      .filter((course) => requiredMathRank === undefined
        || mathSequenceRankFromText(`${course.course_code ?? ""} ${course.name}`) === requiredMathRank)
      .filter((course) => !courseNeedsExplicitPlanningIntent(course, planningInterests))
      .sort((left, right) => Number(Number(left.college_units ?? 0) > 0) - Number(Number(right.college_units ?? 0) > 0)
        || (effectiveRigor === "advanced" ? Number(right.is_weighted) - Number(left.is_weighted) : effectiveRigor === "lighter" ? Number(left.is_weighted) - Number(right.is_weighted) : 0)
        || automaticPlanningPenalty(left, interestText) - automaticPlanningPenalty(right, interestText)
        || left.name.localeCompare(right.name));
    for (const course of ranked) {
      const fallLoad = scheduleTermLoad(planWithAccepted, workspace.courses, grade, "fall");
      const springLoad = scheduleTermLoad(planWithAccepted, workspace.courses, grade, "spring");
      const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : fallLoad <= springLoad ? "fall" : "spring";
      const affectedTerms = term === "full_year" ? ["fall", "spring"] as const : [term] as const;
      if (effectiveMaxCoursesPerTerm && affectedTerms.some((termName) => (termName === "fall" ? fallLoad : springLoad) >= effectiveMaxCoursesPerTerm)) continue;
      if (!selectedSchoolCatalogEligibility(course, grade, planWithAccepted, workspace.courses, { schoolSlug: workspace.school.slug }).eligible) continue;
      const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
      if (prerequisite.result.status === "blocked") continue;
      const addition = {
        course_id: course.id,
        grade_level: grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, grade),
        term,
        status: grade === currentGrade ? "current" : "planned",
        credits: course.credits,
        college_units: course.college_units,
        college_provider_code: Number(course.college_units ?? 0) > 0 ? enrollmentPolicy?.provider_code ?? "SMCCD" : null,
        is_weighted: course.is_weighted,
        mapping_verified: true,
        user_edited: false
      } as const;
      if (enrollmentPolicy && Number(course.college_units ?? 0) > 0) {
        const tentative = [...planWithAccepted, generatedPlanCourseRow(workspace, addition, accepted.length)];
        if (evaluateEnrollmentSchedule(tentative, enrollmentPolicy).some((evaluation) => evaluation.state === "blocked" || (respectRecommendedLimit && evaluation.state === "over_policy"))) continue;
      }
      accepted.push(addition);
      return true;
    }
    return false;
  };

  // Repair required yearly subjects before filling elective space. The first
  // pass follows the school's preferred sequence, while this pass closes a
  // rejected/missing core slot with another verified, eligible catalog option.
  for (const grade of planningGrades) {
    const gradeRule = workspace.planningProfile?.grade_rules[String(grade) as `${GradeLevel}`];
    const requiredAreas = new Set(gradeRule?.required_areas ?? []);
    if (effectiveRigor === "advanced") {
      requiredAreas.add("english");
      requiredAreas.add("math");
    }
    for (const area of requiredAreas) {
      if (area === "math") {
        // A college math course may satisfy the yearly math-area check while
        // still jumping over a required high-school prerequisite. Close every
        // intervening level before accepting that later course as coverage.
        for (let repair = 0; repair < 6; repair += 1) {
          const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
          const priorRanks = planWithAccepted
            .filter((row) => row.grade_level < grade)
            .flatMap((row) => {
              const rank = mathSequenceRankFromText(planRowText(row));
              return rank === null ? [] : [rank];
            });
          let highestRank = Math.max(0, ...priorRanks);
          const currentRanks = planWithAccepted
            .filter((row) => row.grade_level === grade)
            .flatMap((row) => {
              const rank = mathSequenceRankFromText(planRowText(row));
              return rank === null ? [] : [rank];
            })
            .sort((left, right) => left - right);
          let missingRank: number | null = null;
          for (const rank of currentRanks) {
            if (highestRank > 0 && rank > highestRank + 1) {
              missingRank = highestRank + 1;
              break;
            }
            highestRank = Math.max(highestRank, rank);
          }
          if (missingRank === null) break;
          if (!tryAddRequiredCourse(grade, "math", undefined, missingRank)) break;
        }
      }
      const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
      const alreadyCovered = planWithAccepted.some((row) => row.grade_level === grade && planRowCoversArea(row, area))
        || (flexibleDiplomaAreas.has(area) && diplomaAreaIsCovered(planWithAccepted, area));
      if (alreadyCovered) continue;
      tryAddRequiredCourse(grade, area);
    }
    if (requiredAreas.has("social_science")) {
      const socialPatterns = grade === 10
        ? [/\b(?:world|european) history\b/]
        : grade === 11
          ? [/\b(?:u s|us|united states|american) history\b/]
          : grade === 12
            ? [/\bgovernment\b|\bcivics\b/, /\beconomics\b/]
            : [];
      for (const pattern of socialPatterns) {
        const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
        const alreadyCovered = planWithAccepted.some((row) => row.grade_level === grade && pattern.test(planRowText(row)));
        if (!alreadyCovered) tryAddRequiredCourse(grade, "social_science", pattern);
      }
    }
  }
  if (effectiveRigor === "advanced") {
    for (const grade of planningGrades.filter((candidate) => candidate <= 11)) {
      const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
      const hasScience = planWithAccepted.some((row) => row.grade_level === grade && planRowCoversArea(row, "lab_science"));
      if (hasScience) continue;
      const usedCourseIds = new Set(planWithAccepted.map((row) => row.course_id).filter(Boolean));
      const fallLoad = scheduleTermLoad(planWithAccepted, workspace.courses, grade, "fall");
      const springLoad = scheduleTermLoad(planWithAccepted, workspace.courses, grade, "spring");
      const candidates = workspace.courses
        .filter((course) => !usedCourseIds.has(course.id) && course.grade_levels.includes(grade) && mappedAreasByCourse.get(course.id)?.has("lab_science"))
        .filter((course) => !courseNeedsExplicitPlanningIntent(course, planningInterests))
        .sort((left, right) => Number(right.credits ?? 0) - Number(left.credits ?? 0)
          || Number(right.is_weighted) - Number(left.is_weighted)
          || left.prerequisites.length - right.prerequisites.length
          || left.name.localeCompare(right.name));
      for (const course of candidates) {
        const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : fallLoad <= springLoad ? "fall" : "spring";
        const affectedTerms = term === "full_year" ? ["fall", "spring"] as const : [term] as const;
        if (affectedTerms.some((termName) => (termName === "fall" ? fallLoad : springLoad) >= targetLoad)) continue;
        if (!selectedSchoolCatalogEligibility(course, grade, planWithAccepted, workspace.courses, { schoolSlug: workspace.school.slug }).eligible) continue;
        const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
        if (prerequisite.result.status === "blocked") continue;
        accepted.push({
          course_id: course.id,
          grade_level: grade,
          school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, grade),
          term,
          status: grade === currentGrade ? "current" : "planned",
          credits: course.credits,
          college_units: course.college_units,
          college_provider_code: null,
          is_weighted: course.is_weighted,
          mapping_verified: true,
          user_edited: false
        });
        break;
      }
    }
  }
  const unfillableLoads = new Set<string>();
  for (let pass = 0; pass < 40 && accepted.length < 40; pass += 1) {
    const planWithAccepted = [...workspace.planCourses, ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))];
    const loads = ([9, 10, 11, 12] as GradeLevel[])
      .filter((grade) => grade >= currentGrade && grade <= finalGrade)
      .map((grade) => ({
        grade,
        fall: scheduleTermLoad(planWithAccepted, workspace.courses, grade, "fall"),
        spring: scheduleTermLoad(planWithAccepted, workspace.courses, grade, "spring"),
        highSchoolFall: scheduleTermLoad(planWithAccepted, workspace.courses, grade, "fall", true),
        highSchoolSpring: scheduleTermLoad(planWithAccepted, workspace.courses, grade, "spring", true),
        minimumHighSchool: workspace.planningProfile?.grade_rules[String(grade) as `${GradeLevel}`]?.minimum_high_school_courses ?? 0
      }))
      .sort((left, right) => Number(Math.min(left.highSchoolFall, left.highSchoolSpring) >= left.minimumHighSchool) - Number(Math.min(right.highSchoolFall, right.highSchoolSpring) >= right.minimumHighSchool)
        || Math.min(left.fall, left.spring) - Math.min(right.fall, right.spring)
        || left.grade - right.grade);
    const open = loads.find((load) => (Math.min(load.highSchoolFall, load.highSchoolSpring) < load.minimumHighSchool || Math.min(load.fall, load.spring) < targetLoad)
      && !unfillableLoads.has(`${load.grade}:${load.fall <= load.spring ? "fall" : "spring"}`));
    if (!open) break;
    const usedCourseIds = new Set(planWithAccepted.map((row) => row.course_id).filter(Boolean));
    const existingDesignLab = planWithAccepted.some((row) => row.grade_level === open.grade && row.course_id && mappedAreasByCourse.get(row.course_id)?.has("design_lab"));
    const existingLabScience = planWithAccepted.some((row) => row.grade_level === open.grade && planRowCoversArea(row, "lab_science"));
    const ranked = workspace.courses
      .filter((course) => !usedCourseIds.has(course.id)
        && (course.grade_levels.includes(open.grade) || (workspace.school.slug === "design-tech-high-school" && course.grade_levels.length === 0))
        && Number(course.college_units ?? 0) === 0)
      .filter((course) => !courseNeedsExplicitPlanningIntent(course, planningInterests))
      .filter((course) => ![...(mappedAreasByCourse.get(course.id) ?? [])].some((area) => coreAreas.has(area)
        && area !== "career_technical_education"
        && !(area === "design_lab" && !existingDesignLab)
        && !(open.grade === 11 && area === "lab_science" && !existingLabScience)))
      .filter((course) => !looksLikeUnmappedCoreCourse(course)
        || (open.grade === 11 && !existingLabScience && mappedAreasByCourse.get(course.id)?.has("lab_science")))
      .filter((course) => !/\bworld language\b|\blote\b|\b(?:spanish|french|chinese|mandarin|japanese|latin|german|italian)\b/.test(normalizedScheduleText(`${course.name} ${course.subject}`)))
      .map((course) => ({
        course,
        mappedElective: Number(mappedAreasByCourse.get(course.id)?.has("electives") ?? false),
        advancedScience: Number(effectiveRigor === "advanced" && mappedAreasByCourse.get(course.id)?.has("lab_science")),
        interest: Number(Boolean(interestText && [course.name, course.subject, course.description ?? ""].join(" ").toLowerCase().split(/\s+/).some((token) => token.length > 3 && interestText.includes(token)))),
        timingPenalty: (course.is_weighted || course.prerequisites.length > 0) && course.grade_levels.length
          ? Math.abs(open.grade - Math.max(...course.grade_levels))
          : 0,
        penalty: automaticPlanningPenalty(course, interestText)
      }))
      .sort((left, right) => right.interest - left.interest
        || right.advancedScience - left.advancedScience
        || right.mappedElective - left.mappedElective
        || left.timingPenalty - right.timingPenalty
        || left.penalty - right.penalty
        || (effectiveRigor === "advanced" ? Number(right.course.is_weighted) - Number(left.course.is_weighted) : effectiveRigor === "lighter" ? Number(left.course.is_weighted) - Number(right.course.is_weighted) : 0)
        || left.course.prerequisites.length - right.course.prerequisites.length
        || left.course.name.localeCompare(right.course.name));
    let added = false;
    for (const { course } of ranked) {
      const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : open.fall <= open.spring ? "fall" : "spring";
      const affectedTerms = term === "full_year" ? ["fall", "spring"] as const : [term] as const;
      if (affectedTerms.some((termName) => (termName === "fall" ? open.fall : open.spring) >= targetLoad)) continue;
      if (!selectedSchoolCatalogEligibility(course, open.grade, planWithAccepted, workspace.courses, { schoolSlug: workspace.school.slug }).eligible) continue;
      const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: open.grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
      if (prerequisite.result.status === "blocked") continue;
      accepted.push({
        course_id: course.id,
        grade_level: open.grade,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, open.grade),
        term,
        status: open.grade === currentGrade ? "current" : "planned",
        credits: course.credits,
        college_units: course.college_units,
        college_provider_code: null,
        is_weighted: course.is_weighted,
        mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === course.id && mapping.confidence === "verified"),
        user_edited: false
      });
      added = true;
      break;
    }
    if (!added && Math.min(open.highSchoolFall, open.highSchoolSpring) < open.minimumHighSchool) {
      const preferredNames = workspace.planningProfile?.grade_rules[String(open.grade) as `${GradeLevel}`]?.preferred_course_names ?? [];
      const preferredCourses = preferredNames.flatMap((preferredName) => {
        const preferredText = normalizedScheduleText(preferredName);
        return workspace.courses.filter((course) => {
          const text = normalizedScheduleText(course.name);
          return !usedCourseIds.has(course.id) && (text.includes(preferredText) || preferredText.includes(text));
        });
      });
      const highestMathRank = Math.max(0, ...planWithAccepted.flatMap((row) => {
        const plannedCourse = row.course_id ? workspace.courses.find((course) => course.id === row.course_id) : null;
        const rank = mathSequenceRankFromText(`${plannedCourse?.course_code ?? ""} ${plannedCourse?.name ?? row.custom_course_name ?? ""}`);
        return rank === null ? [] : [rank];
      }));
      for (const course of preferredCourses) {
        if (existingLabScience && mappedAreasByCourse.get(course.id)?.has("lab_science")) continue;
        const rank = mathSequenceRankFromText(`${course.course_code ?? ""} ${course.name}`);
        if (rank !== null && highestMathRank > rank) continue;
        const text = normalizedScheduleText(course.name);
        if (/\b(?:u s|us|united states|american) history\b/.test(text)
          && planWithAccepted.some((row) => /\b(?:u s|us|united states|american) history\b/.test(planRowText(row)))) continue;
        if (/\b(?:world|european) history\b/.test(text)
          && planWithAccepted.some((row) => /\b(?:world|european) history\b/.test(planRowText(row)))) continue;
        const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : open.fall <= open.spring ? "fall" : "spring";
        const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: open.grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
        if (prerequisite.result.status === "blocked") continue;
        accepted.push({
          course_id: course.id,
          grade_level: open.grade,
          school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, open.grade),
          term,
          status: open.grade === currentGrade ? "current" : "planned",
          credits: course.credits,
          college_units: null,
          college_provider_code: null,
          is_weighted: course.is_weighted,
          mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === course.id && mapping.confidence === "verified"),
          user_edited: false
        });
        added = true;
        break;
      }
    }
    if (!added) unfillableLoads.add(`${open.grade}:${open.fall <= open.spring ? "fall" : "spring"}`);
  }
  const uniqueAreasPerGrade = new Set(["english", "math", "lab_science", "world_language", "design_lab", "visual_performing_arts", "physical_education"]);
  const seenAreaSlots = new Set<string>();
  const deduplicated = accepted.filter((addition) => {
    const areas = [...(mappedAreasByCourse.get(addition.course_id) ?? [])].filter((area) => uniqueAreasPerGrade.has(area));
    if (!areas.length) return true;
    const slots = areas.map((area) => `${addition.grade_level}:${area}`);
    if (slots.some((slot) => seenAreaSlots.has(slot))) return false;
    slots.forEach((slot) => seenAreaSlots.add(slot));
    return true;
  });
  const pruned = pruneRedundantGeneratedSchedule({ ...workspace, planCourses: basePlanCourses }, deduplicated, degreePlan.additions, {
    startGrade: preferences.startGrade,
    startingMathCourse: preferences.startingMathCourse,
    startingLanguageCourse: preferences.startingLanguageCourse
  });
  return {
    additions: pruned.schoolAdditions,
    degreeAdditions: pruned.degreeAdditions,
    degreeRows: pruned.degreeAdditions.map((row, index) => generatedDegreeCourseRow(workspace, row, index)),
    degreeGoals: degreePlan.goals,
    degreeComplete: degreePlan.complete,
    adjustments: prepared.adjustments,
    planCourses: basePlanCourses,
    replacedRows
  };
}

function analyzeGeneratedSchedule(
  workspace: AssistantWorkspace,
  generated: ReturnType<typeof generateSuggestedPlan>,
  preferences: { interests?: string[]; rigor?: "balanced" | "advanced" | "lighter"; maxCoursesPerTerm?: number | null; startGrade?: GradeLevel; startingMathCourse?: string | null; startingLanguageCourse?: string | null; includeCollegeCourses?: boolean; objectives?: string[] } = {},
  adjustedPlanCourses: PlanCourse[] = workspace.planCourses,
  integratedCollegeRows: PlanCourse[] = [],
  adjustments: SchedulePlacementAdjustment[] = [],
  replaceExisting = false,
  enrollmentPolicy: EnrollmentPolicy | null = null,
  respectRecommendedLimit = true
) {
  const verifiedRequirements = workspace.requirements.filter((requirement) => requirement.confidence === "verified" && requirement.review_status === "approved");
  const verifiedMappings = workspace.mappings.filter((mapping) => mapping.confidence === "verified");
  const before = calculateRequirementProgress(
    verifiedRequirements,
    workspace.planCourses,
    verifiedMappings,
    workspace.courses,
    workspace.equivalencies
  );
  const generatedRows: PlanCourse[] = generated.map((row, index) => generatedPlanCourseRow(workspace, row, index));
  const after = calculateRequirementProgress(
    verifiedRequirements,
    [...adjustedPlanCourses, ...integratedCollegeRows, ...generatedRows],
    verifiedMappings,
    workspace.courses,
    workspace.equivalencies
  );
  const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
  const interestText = [...(preferences.interests ?? []), ...workspace.memories
    .filter((memory) => memory.memory_key.includes("interest"))
    .map((memory) => memory.content)].join(" ").toLowerCase();
  const beforeByRequirement = new Map(before.map((item) => [item.requirement.id, item]));
  const courses = generated.map((row) => {
    const generatedId = `generated:${row.course_id}`;
    const rawRequirementEffects = after.flatMap((item) => {
      const contribution = item.contributions.find((candidate) => candidate.planCourseId === generatedId);
      if (!contribution || contribution.creditsApplied <= 0) return [];
      const previous = beforeByRequirement.get(item.requirement.id);
      return [{
        area: item.requirement.area,
        requirement: item.requirement.name,
        credits_added: contribution.creditsApplied,
        remaining_before: Math.max(0, item.requirement.credits_required - Number(previous?.verifiedProjectedCredits ?? 0)),
        remaining_after: Math.max(0, item.requirement.credits_required - item.verifiedProjectedCredits)
      }];
    });
    const substantiveEffects = rawRequirementEffects.filter((effect) => effect.area !== "electives");
    const requirementEffects = substantiveEffects.length ? substantiveEffects : rawRequirementEffects;
    const catalogCourse = courseById.get(row.course_id);
    const preferenceMatch = Boolean(interestText && catalogCourse && [catalogCourse.name, catalogCourse.subject, catalogCourse.description ?? ""].join(" ").toLowerCase().split(/\s+/).some((token) => token.length > 3 && interestText.includes(token)));
    const rigorMatch = preferences.rigor === "advanced" && row.is_weighted
      ? " It matches the requested advanced rigor."
      : preferences.rigor === "lighter" && !row.is_weighted
        ? " It matches the requested lighter rigor."
        : "";
    const rationale = requirementEffects.length
      ? requirementEffects.map((effect) => `${effect.credits_added} verified ${effect.requirement} credits`).join("; ")
      : `Fits ${workspace.school.short_name}'s verified catalog; no additional graduation credit is claimed without a verified mapping.`;
    return {
      course_id: row.course_id,
      name: courseById.get(row.course_id)?.name ?? "Course",
      grade_level: row.grade_level,
      school_year: row.school_year,
      term: row.term,
      status: row.status,
      college_units: row.college_units,
      rationale: `${rationale}${preferenceMatch ? " It also matches a stated or saved student interest." : ""}${rigorMatch}`,
      preference_match: preferenceMatch,
      requirement_effects: requirementEffects
    };
  });
  const remainingGaps = after
    .filter((item) => item.status === "missing")
    .map((item) => ({
      area: item.requirement.area,
      requirement: item.requirement.name,
      credits_remaining: Math.max(0, item.requirement.credits_required - item.verifiedProjectedCredits),
      warnings: item.ruleWarnings
    }));
  const outsideScheduleRequirements = remainingGaps.filter((gap) => {
    const requirement = after.find((item) => item.requirement.name === gap.requirement)?.requirement;
    return /intersession|outside (?:the )?regular schedule|non-course/i.test(requirement?.notes ?? "");
  });
  const blockingGraduationGaps = remainingGaps.filter((gap) => !outsideScheduleRequirements.includes(gap));
  const existingByGrade = ([9, 10, 11, 12] as GradeLevel[]).map((grade) => ({
    grade_level: grade,
    course_count: adjustedPlanCourses.filter((row) => row.grade_level === grade).length
  }));
  const generatedByGrade = new Map<GradeLevel, typeof courses>();
  for (const course of courses) generatedByGrade.set(course.grade_level, [...(generatedByGrade.get(course.grade_level) ?? []), course]);
  const planByGrade = ([9, 10, 11, 12] as GradeLevel[]).map((grade) => ({
    grade_level: grade,
    existing: adjustedPlanCourses.filter((row) => row.grade_level === grade).map((row) => ({ name: courseDisplayName(row, courseById), term: row.term, status: row.status })),
    additions: (generatedByGrade.get(grade) ?? []).map((course) => ({ name: course.name, term: course.term, status: course.status, rationale: course.rationale }))
  }));
  const placementReadyCourseIds = new Set(workspace.courses.filter((course) => course.grade_levels.length > 0).map((course) => course.id));
  const mappingRequirementIds = new Set(verifiedMappings.filter((mapping) => placementReadyCourseIds.has(mapping.course_id)).map((mapping) => mapping.requirement_id));
  const unmappedOpenRequirements = after
    .filter((item) => item.status === "missing"
      && !item.requirement.constraint_only
      && !/\bintersession\b/i.test(item.requirement.notes ?? "")
      && !mappingRequirementIds.has(item.requirement.id))
    .map((item) => item.requirement.name);
  const requestedStartGrade = preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9;
  const startingMathRows = [
    ...adjustedPlanCourses.map((row) => ({ grade_level: row.grade_level, course_id: row.course_id, custom_course_name: row.custom_course_name })),
    ...integratedCollegeRows.map((row) => ({ grade_level: row.grade_level, course_id: row.course_id, custom_course_name: row.custom_course_name, smccd_course_id: row.smccd_course_id })),
    ...generated.map((row) => ({ grade_level: row.grade_level, course_id: row.course_id, custom_course_name: null }))
  ];
  const startingMathSatisfied = !preferences.startingMathCourse || startingMathRows.some((row) => {
    const course = row.course_id ? courseById.get(row.course_id) : null;
    const query = normalizedScheduleText(preferences.startingMathCourse);
    const candidate = normalizedScheduleText(`${course?.course_code ?? ""} ${course?.name ?? row.custom_course_name ?? ""}`);
    return row.grade_level === requestedStartGrade && Boolean(query) && candidate.includes(query);
  });
  const startingLanguageSatisfied = !preferences.startingLanguageCourse || startingMathRows.some((row) => {
    const course = row.course_id ? courseById.get(row.course_id) : null;
    const collegeCourse = "smccd_course_id" in row && row.smccd_course_id
      ? workspace.degreeCatalogCourses.find((candidate) => candidate.id === row.smccd_course_id)
        ?? workspace.plannedSmccdCourses.find((candidate) => candidate.id === row.smccd_course_id)
      : null;
    const equivalency = collegeCourse
      ? workspace.equivalencies.find((candidate) => candidate.normalized_course_code === normalizeCollegeCourseCode(collegeCourse.course_code))
      : null;
    const query = normalizedLanguageCourseText(preferences.startingLanguageCourse);
    const candidate = normalizedLanguageCourseText(`${course?.course_code ?? collegeCourse?.course_code ?? ""} ${course?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""} ${equivalency?.high_school_equivalent ?? ""}`);
    return row.grade_level === requestedStartGrade && Boolean(query) && candidate.includes(query);
  });
  const collegeExclusionSatisfied = preferences.includeCollegeCourses !== false || generated.every((row) => Number(row.college_units ?? 0) === 0);
  const qualityFailures = scheduleQualityFailures(workspace, generatedRows, [...adjustedPlanCourses, ...integratedCollegeRows], preferences);
  const proposedRows = [...adjustedPlanCourses, ...integratedCollegeRows, ...generatedRows];
  const enrollmentTerms = enrollmentPolicy ? evaluateEnrollmentSchedule(proposedRows, enrollmentPolicy) : [];
  const invalidEnrollmentTerms = enrollmentTerms.filter((term) => term.state === "blocked"
    || (respectRecommendedLimit && term.state === "over_policy"));
  const hardQualityFailures = qualityFailures.filter((failure) => /not prerequisite-ready|requires concurrent or prior calculus/i.test(failure));
  const constraintFailures = [
    ...(!startingMathSatisfied ? [`No verified ${preferences.startingMathCourse} course was placed in grade ${requestedStartGrade}.`] : []),
    ...(!startingLanguageSatisfied ? [`No verified ${preferences.startingLanguageCourse} course was placed in grade ${requestedStartGrade}.`] : []),
    ...(!collegeExclusionSatisfied ? ["The proposed batch includes college coursework even though it was excluded."] : []),
    ...invalidEnrollmentTerms.map((term) => `${term.schoolYear} ${term.term} has ${term.units} college units, above the selected ${term.selectedLimit}-unit planning limit.`),
    ...hardQualityFailures
  ];
  const sourceReadiness = {
    selected_school: workspace.school.name,
    catalog_course_count: workspace.courses.length,
    placement_ready_course_count: placementReadyCourseIds.size,
    verified_requirement_count: verifiedRequirements.length,
    verified_mapping_count: verifiedMappings.length,
    unmapped_open_requirements: unmappedOpenRequirements,
    evidence_ready: workspace.courses.length > 0 && placementReadyCourseIds.size > 0 && verifiedRequirements.length > 0 && verifiedMappings.length > 0 && unmappedOpenRequirements.length === 0
  };
  return {
    terminology: "Current four-year plan means the active Done, In progress, and Planned courses shown in Courses.",
    existing_course_count: workspace.planCourses.length,
    existing_courses_retained: adjustedPlanCourses.length,
    existing_courses_replaced: replaceExisting ? Math.max(0, workspace.planCourses.length - adjustedPlanCourses.length) : 0,
    replace_existing: replaceExisting,
    existing_by_grade: existingByGrade,
    plan_by_grade: planByGrade,
    proposed_addition_count: courses.length,
    courses,
    adjustments: adjustments.map((adjustment) => ({
      plan_course_id: adjustment.plan_course_id,
      from_course: courseById.get(adjustment.from_course_id ?? "")?.name ?? "Current course",
      course_id: adjustment.course_id,
      course: courseById.get(adjustment.course_id)?.name ?? "Course",
      from_grade_level: adjustment.from_grade_level,
      grade_level: adjustment.grade_level,
      term: adjustment.term,
      rationale: `Matches the requested starting math placement and ${preferences.rigor === "advanced" ? "uses the strongest verified weighted variant offered" : "uses an official catalog placement"}.`
    })),
    source_readiness: sourceReadiness,
    constraint_validation: {
      satisfied: constraintFailures.length === 0,
      failures: constraintFailures
    },
    enrollment_validation: {
      satisfied: invalidEnrollmentTerms.length === 0,
      respect_recommended_limit: respectRecommendedLimit,
      selected_limit_units: enrollmentPolicy ? Number(enrollmentPolicy.recommended_max_units) : null,
      terms: enrollmentTerms.map((term) => ({
        school_year: term.schoolYear,
        term: term.term,
        units: term.units,
        limit: term.selectedLimit,
        state: term.state
      }))
    },
    quality_validation: {
      satisfied: qualityFailures.length === 0,
      failures: qualityFailures
    },
    graduation_coverage: {
      requirement_count: after.length,
      covered_before: before.filter((item) => item.status !== "missing").length,
      covered_after: after.filter((item) => item.status !== "missing").length,
      all_requirements_covered_after: sourceReadiness.evidence_ready && constraintFailures.length === 0 && after.length > 0 && blockingGraduationGaps.length === 0,
      remaining_gaps: blockingGraduationGaps,
      outside_schedule_requirements: outsideScheduleRequirements.map((gap) => ({
        ...gap,
        completion_path: `Complete this requirement through the school-specific path in its verified notes; it is tracked separately from regular term course rows.`
      }))
    }
  };
}

export interface AssistantToolResult {
  summary: string;
  data: unknown;
  changed?: { entity: string; id: string };
  undo?: AssistantUndo;
}

type AssistantUndo =
  | { kind: "delete_rows"; table: "plan_versions" | "plan_courses" | "student_smccd_goals" | "student_prerequisite_clearances" | "shared_data_proposals"; ids: string[]; summary: string }
  | { kind: "restore_rows"; table: "plan_courses" | "student_smccd_goals" | "student_prerequisite_clearances"; rows: Array<Record<string, unknown>>; summary: string }
  | { kind: "restore_enrollment_preference"; row: Record<string, unknown> | null; summary: string }
  | { kind: "restore_student_settings"; values: Record<string, unknown>; summary: string }
  | { kind: "restore_school_selection"; school_id: string; college_district_preference?: Record<string, unknown> | null; summary: string }
  | { kind: "restore_college_district_preference"; row: Record<string, unknown> | null; summary: string }
  | { kind: "restore_gpa_scenario"; plan_course_ids: string[]; rows: Array<Record<string, unknown>>; summary: string }
  | { kind: "restore_smccd_completion"; college_code: "CSM" | "SKY" | "CAN"; area: "7A" | "information_literacy"; completed: boolean; summary: string }
  | { kind: "restore_transcript_correction"; review_item_id: string; corrected_payload: Record<string, unknown> | null; status: string; plan_rows: Array<Record<string, unknown>>; inserted_plan_course_ids: string[]; summary: string }
  | { kind: "restore_plan_patch"; rows: Array<Record<string, unknown>>; gpa_rows?: Array<Record<string, unknown>>; inserted_plan_course_ids: string[]; summary: string }
  | { kind: "restore_academic_plan"; plan_rows: Array<Record<string, unknown>>; goal_rows: Array<Record<string, unknown>>; gpa_rows: Array<Record<string, unknown>>; summary: string };

export async function executeAssistantReadTool(
  supabase: SupabaseClient,
  userId: string,
  name: AssistantToolName,
  argumentsValue: Record<string, unknown>
): Promise<AssistantToolResult> {
  const workspace = await loadAssistantWorkspace(supabase, userId);
  const calculated = calculatedWorkspace(workspace);
  const courseMap = new Map(workspace.courses.map((course) => [course.id, course]));

  if (name === "get_student_overview") {
    const courseCounts = Object.fromEntries(["completed", "current", "planned"].map((status) => [
      status,
      workspace.planCourses.filter((course) => course.status === status).length
    ]));
    return {
      summary: "Read the current student overview.",
      data: {
        student: { grade_level: workspace.settings.grade_level, graduation_year: workspace.settings.graduation_year },
        graduation: {
          completed_percent: overallCompletedPercent(calculated.overviewProgress),
          projected_percent: overallGraduationPercent(calculated.overviewProgress),
          open_areas: calculated.overviewProgress.filter((item) => item.status === "missing").map((item) => item.requirement.name),
          scope: workspace.settings.tracker_mode === "selected" ? "Focused overview areas" : "Full diploma"
        },
        gpa: calculated.gpa,
        course_counts: courseCounts
      }
    };
  }

  if (name === "get_academic_context") {
    const args = toolArgumentSchemas.get_academic_context.parse(argumentsValue);
    const planningWorkspace = workspace.collegeGoals.length
      ? await hydrateDegreePlanningCatalog(supabase, workspace, true)
      : workspace;
    const planRows = workspace.planCourses.map((row) => ({
      plan_course_id: row.id,
      catalog_course_id: row.course_id,
      smccd_course_id: row.smccd_course_id,
      name: courseDisplayName(row, courseMap),
      status: row.status,
      grade_level: row.grade_level,
      school_year: row.school_year,
      term: row.term,
      credits: row.credits,
      college_units: row.college_units,
      letter_grade: row.letter_grade,
      weighted_for_gpa: row.is_weighted || Boolean(row.smccd_course_id) || Number(row.college_units ?? 0) > 0,
      transcript_locked: Boolean(row.source_review_item_id),
      source_review_item_id: row.source_review_item_id,
      provider: row.college_provider_code
    }));
    return {
      summary: "Read the complete student-owned academic workspace.",
      data: {
        student: {
          preferred_name: workspace.settings.preferred_name,
          age: workspace.settings.age,
          grade_level: workspace.settings.grade_level,
          graduation_year: workspace.settings.graduation_year,
          plan_start_grade: workspace.settings.plan_start_grade,
          plan_end_grade: workspace.settings.plan_end_grade,
          tracker_mode: workspace.settings.tracker_mode,
          tracked_requirement_areas: workspace.settings.tracked_requirement_areas
        },
        school: { id: workspace.school.id, name: workspace.school.name, short_name: workspace.school.short_name },
        school_planning_policy: compactPlanningProfile(workspace.planningProfile),
        plan: { id: workspace.plan.id, active_version_id: workspace.activeVersion.id, courses: planRows },
        graduation: calculated.graduationProgress.map((item) => ({
          area: item.requirement.area,
          requirement: item.requirement.name,
          required_credits: item.requirement.credits_required,
          completed_credits: item.completedCredits,
          projected_credits: item.verifiedProjectedCredits,
          status: item.status,
          warnings: item.ruleWarnings,
          eligible_course_options: workspace.mappings
            .filter((mapping) => mapping.requirement_id === item.requirement.id && mapping.confidence === "verified")
            .flatMap((mapping) => {
              const course = workspace.courses.find((candidate) => candidate.id === mapping.course_id);
              return course && course.confidence === "verified" && course.review_status === "approved"
                ? [{
                    course_id: course.id,
                    name: course.name,
                    subject: course.subject,
                    credits: course.credits,
                    weighted: course.is_weighted,
                    term_type: course.term_type,
                    grade_levels: course.grade_levels,
                    prerequisites: course.prerequisites
                  }]
                : [];
            })
            .sort((left, right) => Number(right.weighted) - Number(left.weighted) || left.name.localeCompare(right.name))
            .slice(0, 40)
        })),
        gpa: calculated.gpa,
        gpa_scenario: workspace.gpaScenarioChoices,
        degree_bookmarks: workspace.collegeGoals,
        college_sequence_options: (() => {
          const bookmarkedProgramIds = new Set(planningWorkspace.collegeGoals.map((goal) => goal.program_id));
          const programById = new Map(planningWorkspace.degreePrograms.map((program) => [program.id, program]));
          const requirementIds = new Set(planningWorkspace.degreeRequirements
            .filter((requirement) => bookmarkedProgramIds.has(requirement.program_id))
            .map((requirement) => requirement.id));
          const outstandingCodes = new Map<string, Set<string>>();
          if (bookmarkedProgramIds.size) {
            const progressContext = createSmccdProgramProgressContext(
              planningWorkspace.degreeRequirements.filter((requirement) => requirementIds.has(requirement.id)),
              planningWorkspace.degreeRequirementCourses.filter((option) => requirementIds.has(option.requirement_id)),
              planningWorkspace.planCourses,
              planningWorkspace.degreeCatalogCourses
            );
            for (const programId of bookmarkedProgramIds) {
              const program = programById.get(programId);
              if (!program) continue;
              const progress = calculateSmccdProgramProgressWithContext(program, progressContext);
              for (const requirement of progress.requirements.filter((item) => item.status !== "satisfied" && !item.requirement.constraint_only)) {
                for (const option of requirement.remainingOptions) {
                  const code = normalizeCollegeCourseCode(option.courseCode);
                  if (!code) continue;
                  const programs = outstandingCodes.get(code) ?? new Set<string>();
                  programs.add(program.title);
                  outstandingCodes.set(code, programs);
                }
              }
            }
          }
          const equivalencyByCode = new Map(planningWorkspace.equivalencies.map((equivalency) => [equivalency.normalized_course_code, equivalency]));
          return planningWorkspace.degreeCatalogCourses
            .flatMap((course) => {
              const code = normalizeCollegeCourseCode(course.course_code);
              if (!code) return [];
              const equivalency = equivalencyByCode.get(code);
              const supportsSequence = equivalency?.requirement_area === "math" || equivalency?.requirement_area === "world_language";
              const requiredBy = [...(outstandingCodes.get(code) ?? [])];
              if (!supportsSequence && !requiredBy.length) return [];
              return [{
                course_id: course.id,
                course_code: course.course_code,
                title: course.title,
                college: course.college_code,
                units: Number(course.units_max ?? course.units_min),
                prerequisites: course.prerequisites,
                high_school_requirement_area: equivalency?.requirement_area ?? null,
                high_school_equivalent: equivalency?.high_school_equivalent ?? null,
                high_school_credits: equivalency?.high_school_credits ?? null,
                required_by_bookmarked_degrees: requiredBy
              }];
            })
            .sort((left, right) => Number(right.required_by_bookmarked_degrees.length > 0) - Number(left.required_by_bookmarked_degrees.length > 0)
              || left.course_code.localeCompare(right.course_code))
            .slice(0, 240);
        })(),
        college_district_preference: workspace.collegeDistrictPreference,
        college_district: workspace.collegeDistrict,
        nearby_college_districts: workspace.nearbyCollegeDistricts,
        enrollment_preference: workspace.enrollmentPreference,
        manual_degree_completions: workspace.manualSmccdCompletions,
        prerequisite_clearances: workspace.prerequisiteClearances,
        requested_plan_constraints: {
          start_grade: args.planning_start_grade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level,
          objectives: args.planning_objectives
        },
        transcript_review: args.include_transcript_review
          ? workspace.transcriptReviewItems.map((item) => ({
              review_item_id: item.id,
              entity_type: item.entity_type,
              status: item.status,
              proposed_payload: item.proposed_payload,
              corrected_payload: item.corrected_payload
            }))
          : { row_count: workspace.transcriptReviewItems.length, use_audit_transcript_data_for_source_text: true }
      }
    };
  }

  if (name === "list_plan_courses") {
    const args = toolArgumentSchemas.list_plan_courses.parse(argumentsValue);
    const rows = workspace.planCourses
      .filter((row) => args.status === "all" || row.status === args.status)
      .filter((row) => args.grade_level === undefined || row.grade_level === args.grade_level)
      .filter((row) => args.term === undefined || row.term === args.term || (args.include_full_year && row.term === "full_year" && (args.term === "fall" || args.term === "spring")))
      .filter((row) => args.school_year === undefined || row.school_year === args.school_year)
      .map((row) => {
        const smccd = row.smccd_course_id ? workspace.plannedSmccdCourses.find((course) => course.id === row.smccd_course_id) : null;
        return {
          plan_course_id: row.id,
          course_id: row.course_id ?? row.smccd_course_id,
          name: courseDisplayName(row, courseMap),
          source: smccd?.college_code ?? (row.smccd_course_id ? "SMCCD" : workspace.school.short_name),
          status: row.status,
          grade_level: row.grade_level,
          school_year: row.school_year,
          term: row.term,
          letter_grade: row.letter_grade,
          transcript_locked: Boolean(row.source_review_item_id)
        };
      });
    return { summary: `Read ${rows.length} courses from the active plan.`, data: rows };
  }

  if (name === "search_california_high_schools") {
    const args = toolArgumentSchemas.search_california_high_schools.parse(argumentsValue);
    const { data, error } = await supabase.rpc("search_california_high_schools", { query_text: args.query, result_limit: 12 });
    if (error) throw new Error(error.message);
    return {
      summary: `Found ${(data ?? []).length} California public or charter high school ${(data ?? []).length === 1 ? "match" : "matches"}.`,
      data: (data ?? []).map((school: Record<string, unknown>) => ({
        school_id: school.id,
        name: school.name,
        district: school.district_name,
        county: school.county_name,
        governance_type: school.governance_type,
        city: school.city,
        postal_code: school.postal_code,
        grades: [school.low_grade, school.high_grade],
        website_url: school.website_url
      }))
    };
  }

  if (name === "search_course_catalog") {
    const rawQuery = String(argumentsValue.query ?? "").trim().toLowerCase();
    const schoolTokens = new Set(normalizedScheduleText(`${workspace.school.name} ${workspace.school.short_name}`).split(" ").filter(Boolean));
    const queryTokens = normalizedScheduleText(rawQuery).split(" ")
      .filter((token) => token && !schoolTokens.has(token) && !["course", "class", "catalog", "at"].includes(token));
    const query = queryTokens.join(" ") || normalizedScheduleText(rawQuery);
    const source = String(argumentsValue.source ?? "all");
    const targetGrade = Number(argumentsValue.grade_level ?? workspace.settings.grade_level ?? 9) as GradeLevel;
    const matches: Array<Record<string, unknown>> = [];
    if (source === "high_school" || source === "dtech" || source === "all") {
      const candidates = workspace.courses.filter((course) => {
        const candidate = normalizedScheduleText([course.name, course.subject, course.course_code ?? ""].join(" "));
        return candidate.includes(query) || queryTokens.every((token) => candidate.includes(token));
      });
      for (const course of candidates) {
        if (!selectedSchoolCatalogEligibility(course, targetGrade, workspace.planCourses, workspace.courses, { schoolSlug: workspace.school.slug }).eligible) continue;
        const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: targetGrade, term: course.term_type === "semester" ? "fall" : "full_year" }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
        if (prerequisite.result.status === "blocked") continue;
        matches.push({
          source: workspace.school.short_name,
          course_id: course.id,
          name: course.name,
          subject: course.subject,
          credits: course.credits,
          weighted: course.is_weighted,
          grade_levels: course.grade_levels,
          prerequisite_status: prerequisite.result.status
        });
        if (matches.length >= 8) break;
      }
    }
    if ((source === "smccd" || source === "all") && matches.length < 10) {
      const searchTerm = String(argumentsValue.query ?? "")
        .replace(/\b(?:csm|college of san mateo|skyline(?: college)?|ca(?:ñ|n)ada(?: college)?)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const courseCode = normalizeCollegeCourseCode(searchTerm);
      const titleTerm = courseCode
        ? searchTerm.replace(new RegExp(`^${courseCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(" ", "\\s*")}\\b`, "i"), "").trim()
        : searchTerm;
      const [codeResult, titleResult] = await Promise.all([
        supabase.from("smccd_courses").select("*").ilike("course_code", `%${courseCode ?? searchTerm}%`).limit(8),
        supabase.from("smccd_courses").select("*").ilike("title", `%${titleTerm || searchTerm}%`).limit(10)
      ]);
      if (codeResult.error) throw new Error(codeResult.error.message);
      if (titleResult.error) throw new Error(titleResult.error.message);
      const index = createSmccdPlanCourseIndex(workspace.planCourses, workspace.plannedSmccdCourses);
      const smccdMatches = new Map<string, SmccdCourse>();
      for (const course of [...(codeResult.data ?? []), ...(titleResult.data ?? [])] as unknown as SmccdCourse[]) smccdMatches.set(course.id, course);
      for (const course of smccdMatches.values()) {
        if (smccdCourseAlreadyInPlanIndex(course, index)) continue;
        matches.push({
          source: course.college_code,
          course_id: course.id,
          course_code: course.course_code,
          name: course.title,
          units: course.units_max ?? course.units_min,
          transfer_credit: course.transfer_credit,
          prerequisites: course.prerequisites,
          catalog_year: course.source_year
        });
        if (matches.length >= 10) break;
      }
    }
    return { summary: `Found ${matches.length} eligible catalog matches for ${String(argumentsValue.query)}.`, data: matches };
  }

  if (name === "resolve_academic_course_batch") {
    const args = toolArgumentSchemas.resolve_academic_course_batch.parse(argumentsValue);
    const entries: Array<{
      source: "selected_school" | "smccd";
      course_id: string;
      status: "current" | "planned";
      grade_level: GradeLevel;
      term: PlanCourse["term"];
    }> = [];
    const resolved: Array<{ query: string; name: string; source: string; grade_level: GradeLevel; term: PlanCourse["term"] }> = [];
    const unresolved: Array<{ query: string; reason: string }> = [];
    const skippedExisting: Array<{ query: string; name: string }> = [];
    const validationRows = [...workspace.planCourses];
    const currentGrade = Math.max(9, Math.min(12, Number(workspace.settings.grade_level ?? 9))) as GradeLevel;
    const targetGraduationGrade = args.graduation_grade_level
      ?? Math.max(currentGrade, Number(workspace.settings.plan_end_grade ?? 12)) as GradeLevel;
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);

    if (args.fill_remaining_graduation_requirements) {
      const initialProgress = calculateRequirementProgress(workspace.requirements, validationRows, workspace.mappings, workspace.courses, workspace.equivalencies);
      const openRequirementIds = new Set(initialProgress
        .filter((item) => item.status === "missing" && !item.requirement.constraint_only)
        .map((item) => item.requirement.id));
      if (openRequirementIds.size) {
        const generated = generateSuggestedPlan(
          workspace.settings,
          workspace.courses,
          validationRows,
          policy,
          args.respect_recommended_limit,
          {
            schoolSlug: workspace.school.slug,
            planningProfile: workspace.planningProfile,
            requirements: workspace.requirements,
            mappings: workspace.mappings,
            startGrade: targetGraduationGrade,
            maxCoursesPerTerm: 12,
            includeCollegeCourses: false,
            rigor: "balanced",
            interests: []
          }
        );
        for (const generatedRow of generated) {
          const course = workspace.courses.find((candidate) => candidate.id === generatedRow.course_id);
          if (!course) continue;
          const entry = {
            source: "selected_school" as const,
            course_id: course.id,
            status: args.graduation_status,
            grade_level: targetGraduationGrade,
            term: course.term_type === "year" ? "full_year" as const : generatedRow.term
          };
          const candidateRow = assistantPlanCourseCandidate(workspace, entry, null, validationRows.length);
          const before = calculateRequirementProgress(workspace.requirements, validationRows, workspace.mappings, workspace.courses, workspace.equivalencies);
          const after = calculateRequirementProgress(workspace.requirements, [...validationRows, candidateRow], workspace.mappings, workspace.courses, workspace.equivalencies);
          const beforeById = new Map(before.map((item) => [item.requirement.id, item.verifiedProjectedCredits]));
          const improvesOpenRequirement = after.some((item) => openRequirementIds.has(item.requirement.id)
            && item.verifiedProjectedCredits > Number(beforeById.get(item.requirement.id) ?? 0));
          if (!improvesOpenRequirement) continue;
          const eligibility = selectedSchoolCatalogEligibility(course, entry.grade_level, validationRows, workspace.courses, { schoolSlug: workspace.school.slug });
          if (!eligibility.eligible) continue;
          const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: entry.grade_level, term: entry.term }, workspace.courses, validationRows, workspace.plannedSmccdCourses, workspace.equivalencies);
          if (prerequisite.result.status === "blocked") continue;
          entries.push(entry);
          validationRows.push(candidateRow);
          resolved.push({ query: "remaining graduation requirements", name: course.name, source: workspace.school.short_name, grade_level: entry.grade_level, term: entry.term });
          const updated = calculateRequirementProgress(workspace.requirements, validationRows, workspace.mappings, workspace.courses, workspace.equivalencies);
          for (const item of updated) if (item.status !== "missing") openRequirementIds.delete(item.requirement.id);
          if (!openRequirementIds.size) break;
        }
        if (openRequirementIds.size) {
          const names = initialProgress.filter((item) => openRequirementIds.has(item.requirement.id)).map((item) => item.requirement.name);
          unresolved.push({ query: "remaining graduation requirements", reason: `No placement-ready selected-school course could close: ${names.join(", ")}.` });
        }
      }
    }

    const needsSmccd = args.requests.some((request) => request.source === "smccd");
    const smccdResult = needsSmccd ? await supabase.from("smccd_courses").select("*") : { data: [], error: null };
    if (smccdResult.error) throw new Error(smccdResult.error.message);
    const smccdCatalog = (smccdResult.data ?? []) as unknown as SmccdCourse[];
    const existingSmccdIndex = createSmccdPlanCourseIndex(workspace.planCourses, workspace.plannedSmccdCourses);
    const existingCollegeCounts = new Map<string, number>();
    for (const row of workspace.planCourses) {
      const college = row.smccd_course_id ? workspace.plannedSmccdCourses.find((course) => course.id === row.smccd_course_id)?.college_code : null;
      if (college) existingCollegeCounts.set(college, (existingCollegeCounts.get(college) ?? 0) + 1);
    }
    const nearbyOrder = new Map(workspace.nearbyProviders.map((provider, index) => [provider.provider_code, index]));
    const collegePreferenceScore = (course: SmccdCourse, query: string) => {
      const normalizedQuery = normalizedBatchCatalogText(query);
      const explicitlyRequested = normalizedQuery.includes(course.college_code.toLowerCase())
        || (course.college_code === "CSM" && normalizedQuery.includes("college of san mateo"))
        || (course.college_code === "SKY" && normalizedQuery.includes("skyline"))
        || (course.college_code === "CAN" && /\bcanada\b/.test(normalizedQuery));
      return Number(explicitlyRequested) * 10_000
        + (existingCollegeCounts.get(course.college_code) ?? 0) * 100
        - (nearbyOrder.get(course.college_code) ?? 50);
    };

    const resolvedRequests = args.requests.map((request, requestIndex) => {
      if (request.source === "selected_school") {
        const grade = request.grade_level ?? targetGraduationGrade;
        const candidates = workspace.courses
          .map((course) => ({ course, score: batchCatalogMatchScore(request.query, `${course.course_code ?? ""} ${course.name}`) }))
          .filter((candidate) => candidate.score >= 0)
          .filter(({ course }) => !validationRows.some((row) => row.course_id === course.id))
          .filter(({ course }) => selectedSchoolCatalogEligibility(course, grade, validationRows, workspace.courses, { schoolSlug: workspace.school.slug }).eligible)
          .sort((left, right) => right.score - left.score || left.course.name.localeCompare(right.course.name));
        return { request, requestIndex, course: candidates[0]?.course ?? null, smccd: null };
      }
      const candidates = smccdCatalog
        .map((course) => ({ course, score: batchCatalogMatchScore(request.query, `${course.course_code} ${course.title} ${course.college_code}`) }))
        .filter((candidate) => candidate.score >= 0)
        .filter(({ course }) => !smccdCourseAlreadyInPlanIndex(course, existingSmccdIndex))
        .sort((left, right) => right.score - left.score
          || collegePreferenceScore(right.course, request.query) - collegePreferenceScore(left.course, request.query)
          || right.course.source_year.localeCompare(left.course.source_year)
          || left.course.college_code.localeCompare(right.course.college_code));
      return { request, requestIndex, course: null, smccd: candidates[0]?.course ?? null };
    }).sort((left, right) => {
      const leftExplicit = left.request.term ? 0 : 1;
      const rightExplicit = right.request.term ? 0 : 1;
      const leftPrerequisites = left.smccd?.prerequisites.length ?? left.course?.prerequisites.length ?? 0;
      const rightPrerequisites = right.smccd?.prerequisites.length ?? right.course?.prerequisites.length ?? 0;
      return leftExplicit - rightExplicit || leftPrerequisites - rightPrerequisites || left.requestIndex - right.requestIndex;
    });

    const lastSequencePlacement = new Map<string, { level: number; index: number }>();
    for (const item of resolvedRequests) {
      const { request } = item;
      const selectedCourse = item.course;
      const smccdCourse = item.smccd;
      if (!selectedCourse && !smccdCourse) {
        const already = request.source === "selected_school"
          ? workspace.courses.find((course) => validationRows.some((row) => row.course_id === course.id) && batchCatalogMatchScore(request.query, `${course.course_code ?? ""} ${course.name}`) >= 0)
          : workspace.plannedSmccdCourses.find((course) => batchCatalogMatchScore(request.query, `${course.course_code} ${course.title}`) >= 0);
        if (already) skippedExisting.push({ query: request.query, name: "name" in already ? already.name : `${already.course_code} ${already.title}` });
        else unresolved.push({ query: request.query, reason: `No eligible exact ${request.source === "smccd" ? "SMCCD" : workspace.school.short_name} catalog match was found.` });
        continue;
      }
      const targetGrade = request.grade_level ?? targetGraduationGrade;
      const defaultTerm: PlanCourse["term"] = selectedCourse?.term_type === "year" ? "full_year" : "fall";
      const sequence = smccdCourse ? batchSequenceIdentity(smccdCourse) : null;
      const previousSequencePlacement = sequence ? lastSequencePlacement.get(sequence.key) : null;
      const placementCandidates: Array<{ grade_level: GradeLevel; term: PlanCourse["term"] }> = (request.term
        ? [{ grade_level: targetGrade, term: request.term }]
        : [
            ...(!request.grade_level && targetGrade > 9 ? [{ grade_level: (targetGrade - 1) as GradeLevel, term: "summer" as const }] : []),
            { grade_level: targetGrade, term: defaultTerm },
            ...(!selectedCourse ? [{ grade_level: targetGrade, term: "spring" as const }] : []),
            ...(targetGrade < 12 ? [{ grade_level: targetGrade, term: "summer" as const }] : [])
          ])
        .filter((placement) => !previousSequencePlacement
          || sequence?.level === undefined
          || sequence.level <= previousSequencePlacement.level
          || batchPlacementIndex(placement.grade_level, placement.term) > previousSequencePlacement.index);
      let selectedEntry: typeof entries[number] | null = null;
      let blockedReason = "No prerequisite-valid placement was available.";
      for (const placement of placementCandidates) {
        try {
          assertPlanningTermExists(placement.grade_level, placement.term);
        } catch {
          continue;
        }
        const entry = {
          source: request.source,
          course_id: (selectedCourse?.id ?? smccdCourse?.id)!,
          status: request.status,
          grade_level: placement.grade_level,
          term: placement.term
        };
        const prerequisite = selectedCourse
          ? evaluateSelectedSchoolPlannerPrerequisites(selectedCourse, { gradeLevel: placement.grade_level, term: placement.term }, workspace.courses, validationRows, [...workspace.plannedSmccdCourses, ...smccdCatalog], workspace.equivalencies)
          : evaluateSmccdPlannerPrerequisites(smccdCourse!, { gradeLevel: placement.grade_level, term: placement.term }, smccdCatalog, validationRows, workspace.courses);
        if (prerequisite.result.status === "blocked") {
          blockedReason = `${selectedCourse?.name ?? `${smccdCourse!.course_code} ${smccdCourse!.title}`} has an unmet prerequisite for the requested planning window.`;
          continue;
        }
        selectedEntry = entry;
        break;
      }
      if (!selectedEntry) {
        unresolved.push({ query: request.query, reason: blockedReason });
        continue;
      }
      entries.push(selectedEntry);
      validationRows.push(assistantPlanCourseCandidate(workspace, selectedEntry, smccdCourse, validationRows.length));
      if (sequence) lastSequencePlacement.set(sequence.key, { level: sequence.level, index: batchPlacementIndex(selectedEntry.grade_level, selectedEntry.term) });
      resolved.push({
        query: request.query,
        name: selectedCourse?.name ?? `${smccdCourse!.course_code} ${smccdCourse!.title}`,
        source: selectedCourse ? workspace.school.short_name : smccdCourse!.college_code,
        grade_level: selectedEntry.grade_level,
        term: selectedEntry.term
      });
    }

    if (policy) {
      const violations = evaluateEnrollmentSchedule(validationRows, policy).filter((evaluation) => evaluation.state === "blocked" || (args.respect_recommended_limit && evaluation.state === "over_policy"));
      if (violations.length) unresolved.push({ query: "college schedule", reason: "The resolved batch exceeds the selected district enrollment boundary in one or more terms." });
    }
    const complete = unresolved.length === 0 && entries.length > 0;
    return {
      summary: complete
        ? `Resolved ${entries.length} exact course placements as one execution-ready batch.`
        : `Resolved ${entries.length} placements; ${unresolved.length} requested item${unresolved.length === 1 ? " remains" : "s remain"} unresolved.`,
      data: {
        complete,
        entries,
        resolved,
        unresolved,
        skipped_existing: skippedExisting,
        respect_recommended_limit: args.respect_recommended_limit
      }
    };
  }

  if (name === "get_graduation_progress") {
    const data = calculated.graduationProgress.map((item) => ({
      area: item.requirement.name,
      required_credits: item.requirement.credits_required,
      completed_credits: item.completedCredits,
      current_credits: item.currentCredits,
      planned_credits: item.plannedCredits,
      verified_projected_credits: item.verifiedProjectedCredits,
      status: item.status,
      warnings: item.ruleWarnings
    }));
    return { summary: "Read the current graduation requirement audit.", data };
  }

  if (name === "get_nearby_education_providers") {
    return {
      summary: `Read ${workspace.nearbyProviders.length} nearby education ${workspace.nearbyProviders.length === 1 ? "provider" : "providers"}.`,
      data: {
        school: { name: workspace.school.name, city: workspace.school.city, postal_code: workspace.school.postal_code },
        selected_district: workspace.collegeDistrictPreference,
        districts: workspace.nearbyCollegeDistricts,
        providers: workspace.nearbyProviders,
        boundary: "Distances are approximate and derived from institution addresses, not student location. Enrollment, partnership, and course availability require provider verification."
      }
    };
  }

  if (name === "get_transcript_sources") {
    const data = workspace.sources.map((source) => ({
      source_id: source.id,
      label: source.title,
      type: source.kind,
      parse_status: source.parse_status,
      confidence: source.confidence,
      source_year: source.source_year,
      imported_at: source.created_at
    }));
    return { summary: `Read ${data.length} transcript ${data.length === 1 ? "source" : "sources"}.`, data };
  }

  if (name === "get_student_data_inventory") {
    const completed = workspace.planCourses.filter((row) => row.status === "completed").length;
    const imported = workspace.planCourses.filter((row) => row.source_review_item_id).length;
    return {
      summary: "Read the available student-record inventory.",
      data: {
        scope: "Current user's RLS-protected academic planning records; no auth secrets, admin data, arbitrary SQL, or other users' records.",
        setup: { onboarding_complete: workspace.settings.onboarding_complete },
        school: { id: workspace.school.id, name: workspace.school.name, catalog_course_count: workspace.courses.length },
        active_plan: { course_count: workspace.planCourses.length, completed_count: completed, transcript_imported_count: imported },
        graduation: { official_diploma_requirement_count: calculated.graduationProgress.length },
        advanced_course_designations: Object.fromEntries(["ap", "ib", "uc_honors", "school_honors", "cte", "dual_enrollment"].map((designation) => [designation, workspace.courseDesignations.filter((row) => row.designation === designation).length])),
        gpa: { graded_credits: calculated.gpa.gradedCredits, pass_credits: calculated.gpa.passCredits },
        transcript: {
          source_count: workspace.sources.length,
          parsed_course_row_count: workspace.transcriptReviewItems.filter((item) => item.entity_type === "transcript_course").length,
          pending_review_count: workspace.transcriptReviewItems.filter((item) => item.entity_type === "transcript_course" && item.status === "pending").length
        },
        college_goal: { selected: workspace.collegeGoals.length > 0 },
        college_district_preference: workspace.collegeDistrictPreference,
        college_enrollment_preference: {
          provider: workspace.enrollmentPreference.provider_code,
          program_type: workspace.enrollmentPreference.program_type,
          respect_recommended_limit: workspace.enrollmentPreference.respect_recommended_limit !== false
        },
        prerequisite_evidence: {
          submitted_count: workspace.prerequisiteClearances.length,
          pending_verification_count: workspace.prerequisiteClearances.filter((row) => row.verification_status === "pending").length
        },
        lightweight_memory: { active_count: workspace.memories.length },
        available_detail_tools: [
          "list_plan_courses",
          "search_california_high_schools",
          "get_graduation_progress",
          "get_nearby_education_providers",
          "get_gpa_evidence",
          "get_gpa_scenario",
          "evaluate_gpa_scenario",
          "get_enrollment_constraints",
          "get_course_schedule_options",
          "get_prerequisite_evidence",
          "audit_transcript_data",
          "get_degree_progress"
        ]
      }
    };
  }

  if (name === "audit_transcript_data") {
    const args = toolArgumentSchemas.audit_transcript_data.parse(argumentsValue);
    const data = buildTranscriptAudit({
      sources: workspace.sources,
      reviewItems: workspace.transcriptReviewItems,
      planCourses: workspace.planCourses,
      courses: workspace.courses,
      smccdCourses: workspace.plannedSmccdCourses,
      includeSourceText: args.include_source_text
    });
    return {
      summary: `${data.summary.verdict} Audited ${data.summary.parsed_course_count} parsed rows against printed totals, source text, review decisions, catalog identities, and imports.`,
      data
    };
  }

  if (name === "get_gpa_evidence") {
    const args = toolArgumentSchemas.get_gpa_evidence.parse(argumentsValue);
    const rows = workspace.planCourses
      .filter((row) => args.scope === "projected" || row.status !== "planned")
      .map((row) => {
        const grade = row.letter_grade?.trim().toUpperCase() ?? "";
        const creditResolution = resolvePlanCourseHighSchoolCredits(row, workspace.equivalencies);
        const credits = creditResolution.credits;
        const points = dtechGradePoint(grade);
        const weighted = row.is_weighted || Boolean(row.smccd_course_id) || Number(row.college_units ?? 0) > 0;
        const included = points !== null && credits > 0;
        const passOnly = grade === "P" && credits > 0;
        return {
          plan_course_id: row.id,
          course_name: courseDisplayName(row, courseMap),
          status: row.status,
          final_grade: row.letter_grade,
          credits,
          high_school_gpa_credits: credits,
          stored_high_school_credits: row.credits,
          college_units: row.college_units,
          credit_basis: creditResolution.basis,
          weighted,
          included_in_gpa: included,
          unweighted_points: included ? points : null,
          weighted_points: included ? Math.min(5, points + (weighted ? 1 : 0)) : null,
          exclusion_reason: passOnly ? "Pass credit does not affect GPA" : included ? null : grade ? "Grade is not GPA-bearing" : "No final grade is recorded",
          transcript_backed: Boolean(row.source_review_item_id)
        };
      });
    return {
      summary: `Read ${args.scope} GPA evidence for ${rows.length} course rows.`,
      data: {
        scope: args.scope,
        calculation: calculated.gpa,
        policy: `A- and other plus/minus variants use the base letter value. College rows are weighted using high-school credit equivalents. ${COLLEGE_HIGH_SCHOOL_CREDIT_POLICY} Pass grades earn credit but no GPA points.`,
        rows
      }
    };
  }

  if (name === "evaluate_gpa_scenario") {
    const args = toolArgumentSchemas.evaluate_gpa_scenario.parse(argumentsValue);
    const openIds = new Set(workspace.planCourses.filter((row) => row.status !== "completed").map((row) => row.id));
    const unknownIds = args.choices.map((choice) => choice.plan_course_id).filter((id) => !openIds.has(id));
    if (unknownIds.length) throw new Error("A GPA scenario can reference only current or planned course IDs from the active plan.");
    const result = evaluateGpaScenario(
      workspace.planCourses,
      args.choices.map((choice) => ({ planCourseId: choice.plan_course_id, included: choice.included, expectedGrade: choice.expected_grade })),
      args.target_weighted_gpa,
      workspace.equivalencies
    );
    return {
      summary: "Evaluated the selected current-plan GPA assumptions without changing student data.",
      data: {
        transcript_weighted_gpa: result.baseline.projectedWeighted,
        scenario_complete: result.missingExpectedGrades === 0,
        scenario_weighted_gpa: result.missingExpectedGrades === 0 ? result.scenario.projectedWeighted : null,
        scenario_unweighted_gpa: result.missingExpectedGrades === 0 ? result.scenario.projectedUnweighted : null,
        saved_schedule_all_a_ceiling: result.bestCase.projectedWeighted,
        target_weighted_gpa: args.target_weighted_gpa,
        uniform_grade_needed: result.targetGrade,
        target_reachable_in_saved_schedule: result.targetReachable,
        target_already_reached: result.targetAlreadyReached,
        missing_expected_grades: result.missingExpectedGrades,
        boundary: "This is deterministic arithmetic over user-supplied grade assumptions. It does not predict grades, admissions, course availability, or the best real-world schedule."
      }
    };
  }

  if (name === "get_gpa_scenario") {
    const saved = new Map(workspace.gpaScenarioChoices.map((choice) => [choice.plan_course_id, choice]));
    const rows = workspace.planCourses.filter((row) => row.status !== "completed").map((row) => {
      const choice = saved.get(row.id);
      return {
        plan_course_id: row.id,
        course_name: courseDisplayName(row, courseMap),
        grade_level: row.grade_level,
        school_year: row.school_year,
        term: row.term,
        included: choice?.included ?? true,
        expected_grade: choice?.expected_grade ?? (row.letter_grade && !["IP", "P"].includes(row.letter_grade.toUpperCase()) ? row.letter_grade : null)
      };
    });
    return { summary: `Read saved GPA-planner choices for ${rows.length} open ${rows.length === 1 ? "course" : "courses"}.`, data: rows };
  }

  if (name === "get_enrollment_constraints") {
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);
    if (!policy) return { summary: "No enrollment policy matches the saved provider and program.", data: null };
    const terms = evaluateEnrollmentSchedule(workspace.planCourses, policy);
    return {
      summary: `Checked ${terms.length} open college ${terms.length === 1 ? "term" : "terms"} against ${policy.provider_name} limits.`,
      data: {
        provider: policy.provider_name,
        program_type: policy.program_type,
        respect_recommended_limit: workspace.enrollmentPreference.respect_recommended_limit !== false,
        planning_threshold_units: policy.recommended_max_units,
        recommended_max_units: policy.recommended_max_units,
        fee_free_max_units: policy.fee_free_max_units,
        absolute_max_units: policy.absolute_max_units,
        approval_required: policy.approval_required,
        source: { label: policy.source_label, year: policy.source_year, url: policy.source_url },
        terms,
        notes: policy.notes,
        boundary: "Unit count does not prove registration eligibility. Prerequisites, school and college approval, impacted-course restrictions, materials, fees, and seat availability remain separate."
      }
    };
  }

  if (name === "get_course_schedule_options") {
    const args = toolArgumentSchemas.get_course_schedule_options.parse(argumentsValue);
    const includeCollegeCourses = !args.exclude_college_courses_explicitly
      && (args.include_college_courses || workspace.collegeGoals.length > 0);
    const planningWorkspace = await hydrateDegreePlanningCatalog(supabase, workspace, includeCollegeCourses);
    const policy = policyForPreference(planningWorkspace.enrollmentPolicies, planningWorkspace.enrollmentPreference);
    const generated = generateValidatedSchedule(planningWorkspace, policy, args.respect_recommended_limit, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, startingMathCourse: args.starting_math_course, startingLanguageCourse: args.starting_language_course, includeCollegeCourses, replaceExisting: args.replace_existing, replaceGradeLevels: args.replace_grade_levels, objectives: args.objectives });
    const analysis = analyzeGeneratedSchedule(planningWorkspace, generated.additions, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, startingMathCourse: args.starting_math_course, startingLanguageCourse: args.starting_language_course, includeCollegeCourses, objectives: args.objectives }, generated.planCourses, generated.degreeRows, generated.adjustments, args.replace_existing, policy, args.respect_recommended_limit);
    return {
      summary: !analysis.source_readiness.evidence_ready
        ? `${workspace.school.short_name}'s official planning evidence is incomplete, so Pilot did not generate or apply a substitute schedule.`
        : generated.additions.length || generated.degreeAdditions.length || generated.adjustments.length
          ? args.replace_existing
            ? `Prepared one reversible rebuild with ${generated.additions.length} high-school and ${generated.degreeAdditions.length} bookmarked-degree courses.`
            : `Kept the existing record and found ${generated.additions.length} high-school plus ${generated.degreeAdditions.length} bookmarked-degree additions.`
          : `Evaluated the current four-year plan and found no additional selected-school courses that satisfy the remaining verified requirements and constraints.`,
      data: {
        respect_recommended_limit: args.respect_recommended_limit,
        requested_preferences: { interests: args.interests, rigor: args.rigor, max_courses_per_term: args.max_courses_per_term, start_grade: args.start_grade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level, starting_math_course: args.starting_math_course, starting_language_course: args.starting_language_course, include_college_courses: includeCollegeCourses, exclude_college_courses_explicitly: args.exclude_college_courses_explicitly, replace_existing: args.replace_existing, replace_grade_levels: args.replace_grade_levels, objectives: args.objectives },
        remembered_preferences_considered: workspace.memories.filter((memory) => ["schedule_interests", "schedule_rigor", "max_courses_per_term"].includes(memory.memory_key)).map((memory) => memory.memory_key),
        school_planning_policy: compactPlanningProfile(workspace.planningProfile),
        provider: policy?.provider_name ?? null,
        recommended_max_units: policy?.recommended_max_units ?? null,
        absolute_max_units: policy?.absolute_max_units ?? null,
        degree_planning: {
          bookmarked_goal_count: planningWorkspace.collegeGoals.length,
          college_course_count: generated.degreeAdditions.length,
          all_bookmarked_goals_covered: generated.degreeComplete,
          goals: generated.degreeGoals,
          term_units: analysis.enrollment_validation.terms,
          courses: generated.degreeAdditions.map((row) => {
            const course = planningWorkspace.degreeCatalogCourses.find((candidate) => candidate.id === row.smccd_course_id);
            return { course_id: row.smccd_course_id, course_code: course?.course_code, title: course?.title, college: course?.college_code, grade_level: row.grade_level, term: row.term, units: row.college_units, high_school_credits: row.credits, high_school_requirement_area: row.requirement_area_override };
          })
        },
        ...analysis,
        boundary: analysis.source_readiness.evidence_ready
          ? `This uses only ${workspace.school.short_name}'s verified catalog and diploma mappings. Section availability and counselor approval remain separate.`
          : `Pilot cannot safely generate or apply a complete schedule until ${workspace.school.short_name}'s official catalog, diploma requirements, and course mappings are loaded and verified.`
      }
    };
  }

  if (name === "get_prerequisite_evidence") {
    const args = toolArgumentSchemas.get_prerequisite_evidence.parse(argumentsValue);
    const gradeLevel = Math.max(9, Math.min(12, Number(workspace.settings.grade_level ?? 9))) as GradeLevel;
    const highSchoolCourse = workspace.courses.find((course) => course.id === args.course_id);
    if (highSchoolCourse) {
      const term = highSchoolCourse.term_type === "year" ? "full_year" : "fall";
      const evaluation = evaluateSelectedSchoolPlannerPrerequisites(highSchoolCourse, { gradeLevel, term }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies, `${workspace.school.name} official course catalog`);
      return {
        summary: `Read prerequisite evidence for ${highSchoolCourse.name}.`,
        data: { source: workspace.school.name, course: highSchoolCourse.name, official_prerequisites: highSchoolCourse.prerequisites, evaluated_for: { grade_level: gradeLevel, term }, evaluation: evaluation.result }
      };
    }
    const [courseResult, catalogResult] = await Promise.all([
      supabase.from("smccd_courses").select("*").eq("id", args.course_id).maybeSingle(),
      supabase.from("smccd_courses").select("*")
    ]);
    if (courseResult.error) throw new Error(courseResult.error.message);
    if (catalogResult.error) throw new Error(catalogResult.error.message);
    if (!courseResult.data) throw new Error(`That course is not in the current ${workspace.school.short_name} or SMCCD catalog.`);
    const course = courseResult.data as unknown as SmccdCourse;
    const evaluation = evaluateSmccdPlannerPrerequisites(course, { gradeLevel, term: "fall" }, catalogResult.data as unknown as SmccdCourse[], workspace.planCourses, workspace.courses);
    const clearances = workspace.prerequisiteClearances.filter((row) => row.target_course_id === course.id);
    return {
      summary: `Read official prerequisites and ${clearances.length} submitted evidence ${clearances.length === 1 ? "record" : "records"} for ${course.course_code}.`,
      data: {
        source: course.college_code,
        course: `${course.course_code} ${course.title}`,
        catalog_year: course.source_year,
        detail_status: course.detail_status,
        prerequisites: course.prerequisites,
        corequisites: course.corequisites,
        recommended_preparation: course.recommended_preparation,
        evaluation: evaluation.result,
        submitted_clearances: clearances.map((row) => ({ clearance_type: row.clearance_type, status: row.status, verification_status: row.verification_status, authority: row.authority, evidence_summary: row.evidence_summary })),
        boundary: "Only independently approved evidence satisfies an institutional prerequisite; a pending submission does not."
      }
    };
  }

  if (name === "get_degree_progress") {
    const args = toolArgumentSchemas.get_degree_progress.parse(argumentsValue);
    const selectedGoal = args.program_id
      ? workspace.collegeGoals.find((goal) => goal.program_id === args.program_id)
      : workspace.collegeGoals[0];
    if (!selectedGoal) return { summary: args.program_id ? "That degree is not bookmarked." : "No SMCCD degree is bookmarked.", data: null };
    const [programResult, requirementResult] = await Promise.all([
      supabase.from("smccd_programs").select("*").eq("id", selectedGoal.program_id).single(),
      supabase.from("smccd_program_requirements").select("*").eq("program_id", selectedGoal.program_id).order("sort_order")
    ]);
    if (programResult.error) throw new Error(programResult.error.message);
    if (requirementResult.error) throw new Error(requirementResult.error.message);
    const program = programResult.data as unknown as SmccdProgram;
    const requirements = (requirementResult.data ?? []) as unknown as SmccdProgramRequirement[];
    const requirementIds = requirements.map((requirement) => requirement.id);
    const optionResult = requirementIds.length
      ? await supabase.from("smccd_requirement_courses").select("*").in("requirement_id", requirementIds)
      : { data: [], error: null };
    if (optionResult.error) throw new Error(optionResult.error.message);
    const options = (optionResult.data ?? []) as unknown as SmccdRequirementCourse[];
    const optionCodes = [...new Set(options.map((option) => option.course_code))];
    const catalogResults = await Promise.all([
      ...Array.from({ length: Math.ceil(optionCodes.length / 100) }, (_, index) => optionCodes.slice(index * 100, index * 100 + 100))
        .map((codes) => supabase.from("smccd_courses").select("*").in("course_code", codes)),
      supabase.from("smccd_courses").select("*").eq("college_code", programResult.data.college_code)
    ]);
    const catalogError = catalogResults.find((result) => result.error)?.error;
    if (catalogError) throw new Error(catalogError.message);
    const catalogCourses = [...new Map(
      (catalogResults.flatMap((result) => result.data ?? []) as unknown as SmccdCourse[])
        .map((course) => [course.id, course])
    ).values()];
    const courseMapById = new Map<string, SmccdCourse>();
    for (const course of [...workspace.plannedSmccdCourses, ...catalogCourses]) courseMapById.set(course.id, course);
    const progressContext = createSmccdProgramProgressContext(requirements, options, workspace.planCourses, [...courseMapById.values()]);
    const progress = calculateSmccdProgramProgressWithContext(program, progressContext);
    const manualCompletions = new Set(workspace.manualSmccdCompletions
      .filter((completion) => completion.college_code === program.college_code || completion.area === "information_literacy")
      .map((completion) => completion.area));
    const localDegreeProgress = calculateSmccdLocalDegreeProgress(progressContext, program.college_code, manualCompletions);
    return {
      summary: `Read requirement evidence for ${program.title}.`,
      data: {
        goal: { program_id: program.id, college_code: program.college_code, title: program.title, award_type: program.award_type, source_year: program.source_year, catalog_url: program.catalog_url },
        totals: {
          completed_college_units: progress.completedCollegeUnits,
          projected_college_units: progress.projectedCollegeUnits,
          total_degree_units: progress.totalDegreeUnits,
          remaining_degree_applicable_units: Math.max(0, progress.totalDegreeUnits - progress.projectedDegreeApplicableUnits),
          completed_major_units: progress.completedMajorUnits,
          projected_major_units: progress.projectedMajorUnits,
          required_major_units: progress.requiredMajorUnits,
          manual_review_requirements: progress.manualReviewRequirements
        },
        requirements: progress.requirements.map((item) => ({
          requirement_id: item.requirement.id,
          label: item.requirement.label,
          status: item.status,
          completed_status: item.completedStatus,
          completed_course_codes: item.completedCourseCodes,
          selected_course_codes: item.selectedCourseCodes,
          remaining_units: item.remainingUnits,
          remaining_count: item.remainingCount,
          missing_summary: item.missingSummary,
          manual_review_reason: item.manualReviewReason,
          eligible_course_options: options
            .filter((option) => option.requirement_id === item.requirement.id)
            .flatMap((option) => catalogCourses
              .filter((course) => normalizeCollegeCourseCode(course.course_code) === normalizeCollegeCourseCode(option.course_code))
              .map((course) => ({
                course_id: course.id,
                college_code: course.college_code,
                course_code: course.course_code,
                title: course.title,
                units: Number(course.units_max ?? course.units_min),
                prerequisite_summary: course.prerequisites,
                awarding_college_option: course.college_code === program.college_code
              })))
            .sort((left, right) => Number(right.awarding_college_option) - Number(left.awarding_college_option)
              || left.course_code.localeCompare(right.course_code))
            .slice(0, 16)
        })),
        local_degree_pattern: {
          college_code: localDegreeProgress.collegeCode,
          pattern: localDegreeProgress.patternLabel,
          minimum_ge_units: localDegreeProgress.minimumGeUnits,
          ge_areas: localDegreeProgress.geAreas.map((area) => ({
            area: area.area,
            description: area.description,
            status: area.status,
            completed_course_codes: area.completedCourseCodes,
            projected_course_codes: area.projectedCourseCodes,
            completed_units: area.completedUnits,
            projected_units: area.projectedUnits,
            required_units: area.requiredUnits,
            reciprocity_applied: area.reciprocityApplied,
            missing_summary: area.missingSummary,
            eligible_course_options: area.eligibleCourseCodes
              .flatMap((courseCode) => catalogCourses
                .filter((course) => course.college_code === program.college_code
                  && normalizeCollegeCourseCode(course.course_code) === normalizeCollegeCourseCode(courseCode))
                .map((course) => ({
                  course_id: course.id,
                  college_code: course.college_code,
                  course_code: course.course_code,
                  title: course.title,
                  units: Number(course.units_max ?? course.units_min),
                  prerequisite_summary: course.prerequisites
                })))
              .sort((left, right) => left.prerequisite_summary.length - right.prerequisite_summary.length
                || left.course_code.localeCompare(right.course_code))
              .slice(0, 12)
          })),
          separate_graduation_requirements: localDegreeProgress.graduationRequirements.map((requirement) => ({
            requirement: requirement.id,
            label: requirement.label,
            status: requirement.status,
            completed_course_codes: requirement.completedCourseCodes,
            projected_course_codes: requirement.projectedCourseCodes,
            manually_completed: requirement.manuallyCompleted,
            missing_summary: requirement.missingSummary,
            eligible_course_options: requirement.eligibleCourseCodes
              .flatMap((courseCode) => catalogCourses
                .filter((course) => normalizeCollegeCourseCode(course.course_code) === normalizeCollegeCourseCode(courseCode))
                .map((course) => ({
                  course_id: course.id,
                  college_code: course.college_code,
                  course_code: course.course_code,
                  title: course.title,
                  units: Number(course.units_max ?? course.units_min),
                  prerequisite_summary: course.prerequisites,
                  awarding_college_option: course.college_code === program.college_code
                })))
              .sort((left, right) => Number(right.awarding_college_option) - Number(left.awarding_college_option)
                || left.prerequisite_summary.length - right.prerequisite_summary.length
                || left.course_code.localeCompare(right.course_code))
              .slice(0, 12)
          }))
        },
        boundary: "This is deterministic major, local-GE, and separate graduation-requirement evidence for the awarding college. Residency, catalog-right exceptions, substitutions, and final counselor approval remain separate."
      }
    };
  }

  if (name === "get_college_goal") {
    if (!workspace.collegeGoals.length) return { summary: "No SMCCD degree is bookmarked.", data: [] };
    const programIds = workspace.collegeGoals.map((goal) => goal.program_id);
    const { data: programs, error } = await supabase.from("smccd_programs").select("id, college_code, title, award_type, source_year").in("id", programIds);
    if (error) throw new Error(error.message);
    const programMap = new Map((programs ?? []).map((program) => [program.id, program]));
    const data = workspace.collegeGoals.map((goal) => ({ ...goal, program: programMap.get(goal.program_id) ?? null }));
    return { summary: `Read ${data.length} bookmarked ${data.length === 1 ? "degree" : "degrees"}.`, data };
  }

  if (name === "search_smccd_programs") {
    const args = toolArgumentSchemas.search_smccd_programs.parse(argumentsValue);
    const { data, error } = await supabase
      .from("smccd_programs")
      .select("id, college_code, program_code, title, award_type, total_degree_units, total_major_units_text, catalog_url, source_year")
      .order("title")
      .limit(500);
    if (error) throw new Error(error.message);
    const queryTerms = args.query.toLocaleLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1);
    const matches = ((data ?? []) as unknown as SmccdProgram[])
      .filter((program) => args.college === "all" || program.college_code === args.college)
      .filter((program) => args.award_type === "all" || program.award_type === args.award_type)
      .filter((program) => {
        const searchable = `${program.title} ${program.program_code} ${program.award_type} ${program.college_code}`.toLocaleLowerCase();
        return queryTerms.length > 0 && queryTerms.every((term) => searchable.includes(term));
      })
      .slice(0, 12)
      .map((program) => ({
        program_id: program.id,
        college_code: program.college_code,
        program_code: program.program_code,
        title: program.title,
        award_type: program.award_type,
        total_degree_units: program.total_degree_units,
        major_units: program.total_major_units_text,
        source_year: program.source_year,
        catalog_url: program.catalog_url
      }));
    return { summary: `Found ${matches.length} SMCCD degree ${matches.length === 1 ? "program" : "programs"} matching ${args.query}.`, data: matches };
  }

  throw new Error(`${assistantToolLabel(name)} is not a read-only tool.`);
}

export async function executeAssistantMutationTool(
  supabase: SupabaseClient,
  userId: string,
  name: AssistantToolName,
  argumentsValue: Record<string, unknown>,
  context: { conversationId?: string } = {}
): Promise<AssistantToolResult> {
  if (name === "undo_change") {
    const args = toolArgumentSchemas.undo_change.parse(argumentsValue);
    if (!context.conversationId) throw new Error("Pilot can only undo a change from the active conversation.");
    const result = await undoAssistantToolCall({
      supabase,
      userId,
      toolCallId: args.tool_call_id,
      conversationId: context.conversationId
    });
    return {
      summary: result.summary,
      data: { undone_tool: assistantToolLabel(result.toolName) },
      changed: { entity: "ai_tool_call", id: result.toolCallId }
    };
  }

  const workspace = await loadAssistantWorkspace(supabase, userId);

  if (name === "set_current_school") {
    const args = toolArgumentSchemas.set_current_school.parse(argumentsValue);
    const schoolResult = await supabase.from("schools")
      .select("id,name,district_name,governance_type,status,high_grade")
      .eq("id", args.school_id)
      .maybeSingle();
    if (schoolResult.error) throw new Error(schoolResult.error.message);
    const school = schoolResult.data;
    if (!school || !["active", "pending"].includes(school.status) || !["district", "charter"].includes(school.governance_type) || Number(school.high_grade ?? 12) < 9) {
      throw new Error("Choose an active California public or charter high school.");
    }
    if (school.id === workspace.school.id) throw new Error(`${school.name} is already the selected school.`);
    const { error } = await supabase.rpc("select_current_school", { target_school_id: school.id });
    if (error) throw new Error(error.message);
    return {
      summary: `${school.name} is now the selected high school. Existing plan courses were retained.`,
      data: { school_id: school.id, school_name: school.name, district_name: school.district_name },
      changed: { entity: "student_settings", id: userId },
      undo: { kind: "restore_school_selection", school_id: workspace.school.id, college_district_preference: workspace.collegeDistrictPreference as unknown as Record<string, unknown> | null, summary: `${workspace.school.name} and its prior college-district preference were restored.` }
    };
  }

  if (name === "set_college_district_preference") {
    const args = toolArgumentSchemas.set_college_district_preference.parse(argumentsValue);
    const districtResult = await supabase.from("college_districts").select("district_code,name,status").eq("district_code", args.district_code).maybeSingle();
    if (districtResult.error) throw new Error(districtResult.error.message);
    const district = districtResult.data;
    if (!district || district.status !== "active") throw new Error("Choose an active California community-college district.");
    if (workspace.collegeDistrictPreference?.district_code === district.district_code) throw new Error(`${district.name} is already the selected college district.`);
    const { error } = await supabase.rpc("set_college_district_preference", {
      target_district_code: district.district_code,
      preference_method: "pilot"
    });
    if (error) throw new Error(error.message);
    return {
      summary: `${district.name} is now the selected community-college district.`,
      data: { district_code: district.district_code, district_name: district.name },
      changed: { entity: "student_college_district_preference", id: userId },
      undo: { kind: "restore_college_district_preference", row: workspace.collegeDistrictPreference as unknown as Record<string, unknown> | null, summary: "The previous college-district preference was restored." }
    };
  }

  if (name === "add_course_schedule") {
    const args = toolArgumentSchemas.add_course_schedule.parse(argumentsValue);
    const includeCollegeCourses = !args.exclude_college_courses_explicitly
      && (args.include_college_courses || workspace.collegeGoals.length > 0);
    const planningWorkspace = await hydrateDegreePlanningCatalog(supabase, workspace, includeCollegeCourses);
    const policy = policyForPreference(planningWorkspace.enrollmentPolicies, planningWorkspace.enrollmentPreference);
    const available = generateValidatedSchedule(planningWorkspace, policy, args.respect_recommended_limit, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, startingMathCourse: args.starting_math_course, startingLanguageCourse: args.starting_language_course, includeCollegeCourses, replaceExisting: args.replace_existing, replaceGradeLevels: args.replace_grade_levels, objectives: args.objectives });
    const availableById = new Map(available.additions.map((row) => [row.course_id, row]));
    const selected = args.course_ids.map((id) => availableById.get(id));
    if (selected.some((row) => !row)) throw new Error("One or more schedule suggestions are stale or no longer satisfy the plan rules. Generate the options again.");
    const selectedRows = selected as typeof available.additions;
    const analysis = analyzeGeneratedSchedule(planningWorkspace, selectedRows, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, startingMathCourse: args.starting_math_course, startingLanguageCourse: args.starting_language_course, includeCollegeCourses, objectives: args.objectives }, available.planCourses, available.degreeRows, available.adjustments, args.replace_existing, policy, args.respect_recommended_limit);
    if (!analysis.source_readiness.evidence_ready) {
      throw new Error(`${workspace.school.short_name}'s verified catalog, diploma requirements, or course mappings are incomplete. Pilot will not substitute another school's sequence.`);
    }
    if (!analysis.constraint_validation.satisfied) {
      throw new Error(`The proposed schedule does not satisfy the student's exact constraints: ${analysis.constraint_validation.failures.join(" ")}`);
    }
    const highSchoolInsertRows = selectedRows.map((row, index) => ({
      ...row,
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      sort_order: (args.replace_existing ? available.planCourses.length : workspace.planCourses.length) + index
    }));
    const collegeInsertRows = available.degreeAdditions.map((row, index) => {
      const course = planningWorkspace.degreeCatalogCourses.find((candidate) => candidate.id === row.smccd_course_id)!;
      return {
        plan_version_id: workspace.activeVersion.id,
        user_id: userId,
        course_id: null,
        smccd_course_id: row.smccd_course_id,
        college_provider_code: "SMCCD",
        custom_course_name: `${course.course_code} ${course.title}`,
        grade_level: row.grade_level,
        school_year: row.school_year,
        term: row.term,
        status: row.status,
        credits: row.credits,
        college_units: row.college_units,
        is_weighted: true,
        mapping_verified: row.mapping_verified,
        user_edited: false,
        notes: row.notes,
        requirement_area_override: row.requirement_area_override,
        sort_order: (args.replace_existing ? available.planCourses.length : workspace.planCourses.length) + highSchoolInsertRows.length + index
      };
    });
    const insertRows = [...highSchoolInsertRows, ...collegeInsertRows];
    const adjustedIds = new Set(available.adjustments.map((adjustment) => adjustment.plan_course_id));
    const previousAdjustedRows = workspace.planCourses.filter((row) => adjustedIds.has(row.id));
    let replacedRows: Array<Record<string, unknown>> = [];
    let replacedGpaRows: Array<Record<string, unknown>> = [];
    let insertedIds: string[] = [];
    if (args.replace_existing) {
      const replacement = await supabase.rpc("replace_pilot_course_schedule", {
        p_course_rows: insertRows,
        p_grade_levels: args.replace_grade_levels.length ? args.replace_grade_levels : null
      });
      if (replacement.error) throw new Error(replacement.error.message);
      const payload = replacement.data && typeof replacement.data === "object" && !Array.isArray(replacement.data)
        ? replacement.data as Record<string, unknown>
        : {};
      replacedRows = Array.isArray(payload.plan_rows) ? payload.plan_rows as Array<Record<string, unknown>> : [];
      replacedGpaRows = Array.isArray(payload.gpa_rows) ? payload.gpa_rows as Array<Record<string, unknown>> : [];
      insertedIds = Array.isArray(payload.inserted_plan_course_ids) ? payload.inserted_plan_course_ids.map(String) : [];
      if (insertedIds.length !== insertRows.length) throw new Error("The schedule rebuild did not atomically insert the complete verified batch.");
    } else try {
      for (const adjustment of available.adjustments) {
        const update = await supabase.from("plan_courses").update({
          course_id: adjustment.course_id,
          custom_course_name: null,
          grade_level: adjustment.grade_level,
          school_year: adjustment.school_year,
          term: adjustment.term,
          status: adjustment.status,
          credits: adjustment.credits,
          college_units: adjustment.college_units,
          is_weighted: adjustment.is_weighted,
          mapping_verified: adjustment.mapping_verified,
          user_edited: true
        }).eq("id", adjustment.plan_course_id).eq("user_id", userId).is("source_review_item_id", null).select("id").maybeSingle();
        if (update.error || !update.data) throw new Error(update.error?.message ?? "A planned course is no longer editable.");
      }
      if (insertRows.length) {
        const insertion = await supabase.from("plan_courses").insert(insertRows).select("id");
        if (insertion.error) throw new Error(insertion.error.message);
        insertedIds = (insertion.data ?? []).map((row) => row.id);
      }
    } catch (error) {
      if (previousAdjustedRows.length) await supabase.from("plan_courses").upsert(previousAdjustedRows);
      throw error;
    }
    const rollbackPersistedSchedule = async () => {
      if (insertedIds.length) await supabase.from("plan_courses").delete().eq("user_id", userId).in("id", insertedIds);
      if (args.replace_existing && replacedRows.length) await supabase.from("plan_courses").upsert(replacedRows);
      if (args.replace_existing && replacedGpaRows.length) await supabase.from("gpa_scenario_choices").upsert(replacedGpaRows);
      if (!args.replace_existing && previousAdjustedRows.length) await supabase.from("plan_courses").upsert(previousAdjustedRows);
    };
    const persistedResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (persistedResult.error) {
      await rollbackPersistedSchedule();
      throw new Error(`Pilot could not verify the saved schedule: ${persistedResult.error.message}`);
    }
    const persistedRows = persistedResult.data as unknown as PlanCourse[];
    const insertedIdSet = new Set(insertedIds);
    const persistedInsertedCount = persistedRows.filter((row) => insertedIdSet.has(row.id)).length;
    const persistedEnrollmentTerms = policy ? evaluateEnrollmentSchedule(persistedRows, policy) : [];
    const persistedLimitFailures = persistedEnrollmentTerms.filter((term) => term.state === "blocked"
      || (args.respect_recommended_limit && term.state === "over_policy"));
    if (persistedInsertedCount !== insertRows.length || persistedLimitFailures.length) {
      await rollbackPersistedSchedule();
      const reason = persistedInsertedCount !== insertRows.length
        ? "not every validated course row was saved"
        : persistedLimitFailures.map((term) => `${term.schoolYear} ${term.term} saved ${term.units} college units above the ${term.selectedLimit}-unit limit`).join("; ");
      throw new Error(`Pilot rolled back the schedule because its post-save verification failed: ${reason}.`);
    }
    const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
    const courseNames = [
      ...selectedRows.map((row) => courseById.get(row.course_id)?.name ?? "Course"),
      ...available.degreeAdditions.map((row) => {
        const course = planningWorkspace.degreeCatalogCourses.find((candidate) => candidate.id === row.smccd_course_id);
        return course ? `${course.course_code} ${course.title}` : "College course";
      })
    ];
    return {
      summary: args.replace_existing
        ? `Replaced ${replacedRows.length} editable courses with a verified ${courseNames.length}-course schedule and retained ${analysis.existing_courses_retained} unaffected or transcript-backed courses.`
        : `Updated ${available.adjustments.length} existing placement ${available.adjustments.length === 1 ? "constraint" : "constraints"} and added ${courseNames.length} ${courseNames.length === 1 ? "course" : "courses"}; kept all ${analysis.existing_courses_retained} existing courses.`,
      data: {
        courses: courseNames,
        course_details: analysis.courses,
        degree_planning: { college_courses_added: available.degreeAdditions.length, all_bookmarked_goals_covered: available.degreeComplete, goals: available.degreeGoals },
        post_apply_validation: {
          verified: true,
          inserted_course_count: persistedInsertedCount,
          enrollment_terms: persistedEnrollmentTerms.map((term) => ({ school_year: term.schoolYear, term: term.term, units: term.units, limit: term.selectedLimit, state: term.state }))
        },
        existing_courses_retained: analysis.existing_courses_retained,
        existing_courses_replaced: replacedRows.length,
        graduation_coverage: analysis.graduation_coverage,
        graduation_coverage_after: analysis.graduation_coverage.all_requirements_covered_after
          ? analysis.graduation_coverage.outside_schedule_requirements.length
            ? `Every regular-schedule requirement is covered; ${analysis.graduation_coverage.outside_schedule_requirements[0].credits_remaining} credits remain in a school-specific outside-schedule requirement.`
            : `All ${analysis.graduation_coverage.requirement_count} tracked areas covered`
          : `${analysis.graduation_coverage.remaining_gaps.length} ${analysis.graduation_coverage.remaining_gaps.length === 1 ? "area" : "areas"} still open: ${analysis.graduation_coverage.remaining_gaps.map((gap) => gap.requirement).join(", ")}`,
        respect_recommended_limit: args.respect_recommended_limit,
        requested_preferences: { interests: args.interests, rigor: args.rigor, max_courses_per_term: args.max_courses_per_term, start_grade: args.start_grade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level, starting_math_course: args.starting_math_course, starting_language_course: args.starting_language_course, include_college_courses: includeCollegeCourses, exclude_college_courses_explicitly: args.exclude_college_courses_explicitly, replace_existing: args.replace_existing, replace_grade_levels: args.replace_grade_levels, objectives: args.objectives },
        remembered_preferences_considered: workspace.memories.filter((memory) => ["schedule_interests", "schedule_rigor", "max_courses_per_term"].includes(memory.memory_key)).map((memory) => memory.memory_key),
        planning_threshold_units: policy?.recommended_max_units ?? null,
        absolute_max_units: policy?.absolute_max_units ?? null
      },
      changed: { entity: "plan_course", id: [...adjustedIds, ...insertedIds].join(",") },
      undo: { kind: "restore_plan_patch", rows: args.replace_existing ? replacedRows : previousAdjustedRows as unknown as Array<Record<string, unknown>>, gpa_rows: replacedGpaRows, inserted_plan_course_ids: insertedIds, summary: args.replace_existing ? "The generated schedule was removed and the previous editable schedule was restored." : "The previous course placements were restored and the generated additions were removed." }
    };
  }

  if (name === "add_dtech_course" || name === "add_high_school_course") {
    const args = toolArgumentSchemas[name].parse(argumentsValue);
    assertPlanningTermExists(args.grade_level, args.term);
    const course = workspace.courses.find((candidate) => candidate.id === args.course_id);
    if (!course) throw new Error(`That ${workspace.school.short_name} catalog course is no longer available.`);
    const eligibility = selectedSchoolCatalogEligibility(course, args.grade_level, workspace.planCourses, workspace.courses, { schoolSlug: workspace.school.slug });
    if (!eligibility.eligible) throw new Error(eligibility.reason === "already_in_plan" ? "That course is already in the plan." : eligibility.reason === "outside_grade" ? `That course is not offered in grade ${args.grade_level}.` : "That course is below the math level already demonstrated in the plan.");
    const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: args.grade_level, term: args.term }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
    if (prerequisite.result.status === "blocked" && !args.prerequisite_override_reason) throw new Error("The listed prerequisite is not satisfied for that placement. The student must explicitly correct or override that evidence to continue.");
    const mappingVerified = workspace.mappings.some((mapping) => mapping.course_id === course.id && mapping.confidence === "verified");
    const { data, error } = await supabase.from("plan_courses").insert({
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      course_id: course.id,
      grade_level: args.grade_level,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
      term: args.term,
      status: args.status,
      credits: course.credits,
      college_units: course.college_units,
      is_weighted: course.is_weighted,
      mapping_verified: mappingVerified,
      user_edited: true,
      notes: args.prerequisite_override_reason ? `Student-provided prerequisite override (unverified): ${args.prerequisite_override_reason}` : null,
      sort_order: workspace.planCourses.filter((row) => row.grade_level === args.grade_level).length
    }).select("id").single();
    if (error) throw new Error(error.message);
    return {
      summary: `${course.name} was added to ${args.status === "current" ? "In progress" : "Planned"}.`,
      data: { course: course.name, status: args.status, grade_level: args.grade_level },
      changed: { entity: "plan_course", id: data.id },
      undo: { kind: "delete_rows", table: "plan_courses", ids: [data.id], summary: `${course.name} was removed from the plan.` }
    };
  }

  if (name === "add_smccd_course") {
    const args = toolArgumentSchemas.add_smccd_course.parse(argumentsValue);
    assertPlanningTermExists(args.grade_level, args.term);
    const [courseResult, catalogResult] = await Promise.all([
      supabase.from("smccd_courses").select("*").eq("id", args.course_id).single(),
      supabase.from("smccd_courses").select("*")
    ]);
    if (courseResult.error) throw new Error("That SMCCD catalog course is no longer available.");
    if (catalogResult.error) throw new Error(catalogResult.error.message);
    const course = courseResult.data as unknown as SmccdCourse;
    const smccdCatalog = (catalogResult.data ?? []) as unknown as SmccdCourse[];
    const index = createSmccdPlanCourseIndex(workspace.planCourses, workspace.plannedSmccdCourses);
    if (smccdCourseAlreadyInPlanIndex(course, index)) throw new Error("That SMCCD course is already represented in the plan.");
    const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: args.grade_level, term: args.term }, smccdCatalog, workspace.planCourses, workspace.courses);
    if (prerequisite.result.status === "blocked" && !args.prerequisite_override_reason) throw new Error("The listed SMCCD prerequisite is not satisfied for that placement. The student must explicitly correct or override that evidence to continue.");
    const normalizedCode = normalizeCollegeCourseCode(course.course_code);
    const equivalency = workspace.equivalencies.find((row) => row.normalized_course_code === normalizedCode);
    const collegeUnits = Number(course.units_max ?? course.units_min);
    const creditResolution = resolveCollegeHighSchoolCredits({
      collegeUnits,
      storedHighSchoolCredits: null,
      equivalencyHighSchoolCredits: equivalency?.high_school_credits,
      normalizedCourseCode: normalizedCode
    });
    const { data, error } = await supabase.from("plan_courses").insert({
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      smccd_course_id: course.id,
      college_provider_code: "SMCCD",
      custom_course_name: `${course.course_code} ${course.title}`,
      grade_level: args.grade_level,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
      term: args.term,
      status: args.status,
      credits: creditResolution.credits,
      college_units: collegeUnits,
      is_weighted: true,
      mapping_verified: Boolean(equivalency),
      user_edited: true,
      notes: args.prerequisite_override_reason
        ? `Student-provided prerequisite override (unverified): ${args.prerequisite_override_reason}`
        : equivalency
        ? `${course.college_code} ${course.source_year} catalog. The selected school's reviewed equivalency chart lists ${equivalency.high_school_credits} high-school credits as ${equivalency.high_school_equivalent}. Confirm current approval, prerequisites, schedule, and transcript delivery.`
        : `${course.college_code} ${course.source_year} catalog. ${creditResolution.credits > 0 ? `${collegeUnits} college units are provisionally represented as ${creditResolution.credits} high-school credits for GPA calculations. ` : "High-school credit is unresolved. "}Verify schedule availability, prerequisites, high-school approval, and transcript delivery.`,
      requirement_area_override: equivalency?.requirement_area ?? null,
      sort_order: workspace.planCourses.length
    }).select("id").single();
    if (error) throw new Error(error.message);
    return {
      summary: `${course.course_code} ${course.title} was added to ${args.status === "current" ? "In progress" : "Planned"}.`,
      data: {
        course_code: course.course_code,
        status: args.status,
        grade_level: args.grade_level,
        college_units: collegeUnits,
        high_school_gpa_credits: creditResolution.credits,
        credit_basis: creditResolution.basis,
        equivalency_verified: Boolean(equivalency)
      },
      changed: { entity: "plan_course", id: data.id },
      undo: { kind: "delete_rows", table: "plan_courses", ids: [data.id], summary: `${course.course_code} ${course.title} was removed from the plan.` }
    };
  }

  if (name === "add_custom_course") {
    const args = toolArgumentSchemas.add_custom_course.parse(argumentsValue);
    assertPlanningTermExists(args.grade_level, args.term);
    const duplicate = workspace.planCourses.some((row) => normalizedScheduleText(courseDisplayName(row, new Map(workspace.courses.map((course) => [course.id, course])))) === normalizedScheduleText(args.name));
    if (duplicate) throw new Error("That custom course is already represented in the plan.");
    const noteParts = ["Student-provided custom course; not verified against an institutional catalog.", args.notes].filter(Boolean);
    const { data, error } = await supabase.from("plan_courses").insert({
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      course_id: null,
      smccd_course_id: null,
      college_provider_code: null,
      custom_course_name: args.name,
      grade_level: args.grade_level,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
      term: args.term,
      status: args.status,
      credits: args.credits,
      college_units: args.college_units,
      is_weighted: args.is_weighted,
      mapping_verified: false,
      requirement_area_override: args.requirement_area,
      user_edited: true,
      notes: noteParts.join(" "),
      sort_order: workspace.planCourses.filter((row) => row.grade_level === args.grade_level).length
    }).select("id").single();
    if (error) throw new Error(error.message);
    return {
      summary: `${args.name} was added as an unverified custom course.`,
      data: {
        course: args.name,
        status: args.status,
        grade_level: args.grade_level,
        term: args.term,
        credits: args.credits,
        college_units: args.college_units,
        is_weighted: args.is_weighted,
        requirement_area: args.requirement_area,
        verification: "student_provided_custom"
      },
      changed: { entity: "plan_course", id: data.id },
      undo: { kind: "delete_rows", table: "plan_courses", ids: [data.id], summary: `${args.name} was removed from the plan.` }
    };
  }

  if (name === "add_academic_courses") {
    const args = toolArgumentSchemas.add_academic_courses.parse(argumentsValue);
    for (const entry of args.entries) assertPlanningTermExists(entry.grade_level, entry.term);
    const smccdIds = args.entries.filter((entry) => entry.source === "smccd").map((entry) => entry.course_id);
    const smccdCatalogResult = smccdIds.length ? await supabase.from("smccd_courses").select("*") : { data: [], error: null };
    if (smccdCatalogResult.error) throw new Error(smccdCatalogResult.error.message);
    const smccdCatalog = (smccdCatalogResult.data ?? []) as unknown as SmccdCourse[];
    const smccdById = new Map(smccdCatalog.map((course) => [course.id, course]));
    if (smccdIds.some((id) => !smccdById.has(id))) throw new Error("One or more selected SMCCD courses are no longer in the current catalog.");
    const prepared: Array<Record<string, unknown>> = [];
    const validationRows: PlanCourse[] = [...workspace.planCourses];
    const names: string[] = [];

    for (const [index, entry] of args.entries.entries()) {
      const base = {
        plan_version_id: workspace.activeVersion.id,
        user_id: userId,
        grade_level: entry.grade_level,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, entry.grade_level),
        term: entry.term,
        status: entry.status,
        letter_grade: null,
        user_edited: true,
        sort_order: workspace.planCourses.length + index
      };
      let row: Record<string, unknown>;
      if (entry.source === "selected_school") {
        const course = workspace.courses.find((candidate) => candidate.id === entry.course_id);
        if (!course) throw new Error("One or more selected-school courses are no longer in the approved catalog.");
        const eligibility = selectedSchoolCatalogEligibility(course, entry.grade_level, validationRows, workspace.courses, { schoolSlug: workspace.school.slug });
        if (!eligibility.eligible) throw new Error(`${course.name} cannot be added: ${(eligibility.reason ?? "not eligible").replaceAll("_", " ")}.`);
        const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(course, { gradeLevel: entry.grade_level, term: entry.term }, workspace.courses, validationRows, [...workspace.plannedSmccdCourses, ...smccdCatalog], workspace.equivalencies);
        if (prerequisite.result.status === "blocked" && !entry.prerequisite_override_reason) throw new Error(`${course.name} has an unmet prerequisite for that placement. The student must explicitly correct or override that evidence to continue.`);
        row = {
          ...base,
          course_id: course.id,
          credits: course.credits,
          college_units: course.college_units,
          is_weighted: course.is_weighted,
          mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === course.id && mapping.confidence === "verified"),
          notes: entry.prerequisite_override_reason ? `Student-provided prerequisite override (unverified): ${entry.prerequisite_override_reason}` : null
        };
        names.push(course.name);
      } else {
        const course = smccdById.get(entry.course_id)!;
        const indexByCourse = createSmccdPlanCourseIndex(validationRows, [...workspace.plannedSmccdCourses, ...smccdCatalog]);
        if (smccdCourseAlreadyInPlanIndex(course, indexByCourse)) throw new Error(`${course.course_code} is already represented in the plan.`);
        const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: entry.grade_level, term: entry.term }, smccdCatalog, validationRows, workspace.courses);
        if (prerequisite.result.status === "blocked" && !entry.prerequisite_override_reason) throw new Error(`${course.course_code} has an unmet prerequisite for that placement. The student must explicitly correct or override that evidence to continue.`);
        const normalizedCode = normalizeCollegeCourseCode(course.course_code);
        const equivalency = workspace.equivalencies.find((candidate) => candidate.normalized_course_code === normalizedCode);
        const collegeUnits = Number(course.units_max ?? course.units_min);
        const creditResolution = resolveCollegeHighSchoolCredits({
          collegeUnits,
          storedHighSchoolCredits: null,
          equivalencyHighSchoolCredits: equivalency?.high_school_credits,
          normalizedCourseCode: normalizedCode
        });
        row = {
          ...base,
          smccd_course_id: course.id,
          college_provider_code: "SMCCD",
          custom_course_name: `${course.course_code} ${course.title}`,
          credits: creditResolution.credits,
          college_units: collegeUnits,
          is_weighted: true,
          mapping_verified: Boolean(equivalency),
          requirement_area_override: equivalency?.requirement_area ?? null,
          notes: entry.prerequisite_override_reason
            ? `Student-provided prerequisite override (unverified): ${entry.prerequisite_override_reason}`
            : equivalency
            ? `${course.college_code} ${course.source_year} catalog; verified selected-school equivalency: ${equivalency.high_school_equivalent}.`
            : `${course.college_code} ${course.source_year} catalog; high-school credit follows the college-credit conversion policy and remains separate from ${collegeUnits} college units.`
        };
        names.push(`${course.course_code} ${course.title}`);
      }
      prepared.push(row);
      validationRows.push({
        id: `candidate:${index}`,
        course_id: (row.course_id as string | undefined) ?? null,
        custom_course_name: (row.custom_course_name as string | undefined) ?? null,
        smccd_course_id: (row.smccd_course_id as string | undefined) ?? null,
        college_provider_code: (row.college_provider_code as string | undefined) ?? null,
        requirement_area_override: (row.requirement_area_override as PlanCourse["requirement_area_override"] | undefined) ?? null,
        source_review_item_id: null,
        notes: (row.notes as string | undefined) ?? null,
        mapping_verified: Boolean(row.mapping_verified),
        is_weighted: Boolean(row.is_weighted),
        credits: Number(row.credits ?? 0),
        college_units: row.college_units == null ? null : Number(row.college_units),
        letter_grade: null,
        user_edited: true,
        plan_version_id: workspace.activeVersion.id,
        user_id: userId,
        grade_level: entry.grade_level,
        school_year: String(row.school_year),
        term: entry.term,
        status: entry.status,
        sort_order: Number(row.sort_order)
      });
    }
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);
    if (policy) {
      const violations = evaluateEnrollmentSchedule(validationRows, policy).filter((evaluation) => evaluation.state === "blocked" || (args.respect_recommended_limit && evaluation.state === "over_policy"));
      if (violations.length) throw new Error("The mixed schedule exceeds the selected SMCCD enrollment boundary in one or more terms.");
    }
    const insertion = await supabase.from("plan_courses").insert(prepared).select("id");
    if (insertion.error) throw new Error(insertion.error.message);
    const ids = (insertion.data ?? []).map((row) => row.id);
    return {
      summary: `Added ${ids.length} validated high-school and college ${ids.length === 1 ? "course" : "courses"} across the requested plan years.`,
      data: {
        courses: names,
        added_count: ids.length,
        high_school_count: args.entries.filter((entry) => entry.source === "selected_school").length,
        college_count: smccdIds.length,
        college_weighting: "Every SMCCD course is weighted in the app GPA.",
        college_credit_rule: "College units and high-school credits are calculated separately.",
        respected_recommended_limit: args.respect_recommended_limit
      },
      changed: { entity: "plan_courses", id: ids.join(",") },
      undo: { kind: "delete_rows", table: "plan_courses", ids, summary: "The mixed academic course batch was removed from the plan." }
    };
  }

  if (name === "move_plan_course") {
    const args = toolArgumentSchemas.move_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed Done courses cannot be moved.");
    const patch = planCourseMovePatch(workspace.settings, row, args.status, workspace.planCourses.filter((candidate) => candidate.status === args.status).length);
    if (!patch) throw new Error("That course cannot be moved.");
    const { error } = await supabase.from("plan_courses").update({ ...patch, user_edited: true }).eq("id", row.id);
    if (error) throw new Error(error.message);
    return {
      summary: `The course was moved to ${args.status === "completed" ? "Done" : args.status === "current" ? "In progress" : "Planned"}.`,
      data: { plan_course_id: row.id, status: args.status },
      changed: { entity: "plan_course", id: row.id },
      undo: { kind: "restore_rows", table: "plan_courses", rows: [row as unknown as Record<string, unknown>], summary: "The course was moved back." }
    };
  }

  if (name === "move_plan_courses") {
    const args = toolArgumentSchemas.move_plan_courses.parse(argumentsValue);
    const rows = args.plan_course_ids.map((id) => workspace.planCourses.find((candidate) => candidate.id === id));
    if (rows.some((row) => !row)) throw new Error("One or more courses are no longer in the active plan.");
    const matchedRows = rows as PlanCourse[];
    if (matchedRows.some((row) => row.source_review_item_id)) throw new Error("Transcript-backed Done courses cannot be moved.");
    if (matchedRows.some((row) => row.status === args.status)) throw new Error("One or more courses are already in the requested state.");
    const currentGrade = Math.max(9, Math.min(12, Number(workspace.settings.grade_level ?? matchedRows[0].grade_level))) as GradeLevel;
    const gradeLevel = (args.status === "planned" ? Math.min(12, currentGrade + 1) : currentGrade) as GradeLevel;
    const patch: Record<string, unknown> = {
      status: args.status,
      grade_level: gradeLevel,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, gradeLevel),
      user_edited: true
    };
    if (args.status !== "completed") patch.letter_grade = null;
    const { error } = await supabase.from("plan_courses").update(patch).in("id", args.plan_course_ids);
    if (error) throw new Error(error.message);
    const courseMap = new Map(workspace.courses.map((course) => [course.id, course]));
    const statusLabel = args.status === "completed" ? "Done" : args.status === "current" ? "In progress" : "Planned";
    return {
      summary: `${matchedRows.length} ${matchedRows.length === 1 ? "course was" : "courses were"} moved to ${statusLabel}.`,
      data: { plan_course_ids: args.plan_course_ids, courses: matchedRows.map((row) => courseDisplayName(row, courseMap)), status: args.status, moved_count: matchedRows.length },
      changed: { entity: "plan_courses", id: args.plan_course_ids.join(",") },
      undo: { kind: "restore_rows", table: "plan_courses", rows: matchedRows as unknown as Array<Record<string, unknown>>, summary: `${matchedRows.length} ${matchedRows.length === 1 ? "course was" : "courses were"} moved back.` }
    };
  }

  if (name === "remove_plan_course") {
    const args = toolArgumentSchemas.remove_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed courses must be corrected through transcript review and cannot be removed here.");
    const { error } = await supabase.from("plan_courses").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    return {
      summary: "The course was removed from the active plan.",
      data: { plan_course_id: row.id },
      changed: { entity: "plan_course", id: row.id },
      undo: { kind: "restore_rows", table: "plan_courses", rows: [row as unknown as Record<string, unknown>], summary: "The course was restored to the active plan." }
    };
  }

  if (name === "remove_plan_courses") {
    const args = toolArgumentSchemas.remove_plan_courses.parse(argumentsValue);
    const rows = args.plan_course_ids.map((id) => workspace.planCourses.find((candidate) => candidate.id === id));
    if (rows.some((row) => !row)) throw new Error("One or more courses are no longer in the active plan.");
    const matchedRows = rows as PlanCourse[];
    if (matchedRows.some((row) => row.source_review_item_id)) {
      throw new Error("Transcript-backed courses must be corrected through transcript review and cannot be removed here.");
    }
    const { error } = await supabase.from("plan_courses").delete().in("id", args.plan_course_ids);
    if (error) throw new Error(error.message);
    const courseMap = new Map(workspace.courses.map((course) => [course.id, course]));
    return {
      summary: `${matchedRows.length} ${matchedRows.length === 1 ? "course was" : "courses were"} removed from the active plan.`,
      data: {
        plan_course_ids: args.plan_course_ids,
        courses: matchedRows.map((row) => courseDisplayName(row, courseMap)),
        removed_count: matchedRows.length
      },
      changed: { entity: "plan_courses", id: args.plan_course_ids.join(",") },
      undo: { kind: "restore_rows", table: "plan_courses", rows: matchedRows as unknown as Array<Record<string, unknown>>, summary: `${matchedRows.length} ${matchedRows.length === 1 ? "course was" : "courses were"} restored to the active plan.` }
    };
  }

  if (name === "update_plan_courses") {
    const args = toolArgumentSchemas.update_plan_courses.parse(argumentsValue);
    const originalRows = args.patches.map((patch) => workspace.planCourses.find((row) => row.id === patch.plan_course_id));
    if (originalRows.some((row) => !row)) throw new Error("One or more courses are no longer in the active plan.");
    const rows = originalRows as PlanCourse[];
    if (rows.some((row) => row.source_review_item_id)) throw new Error("Transcript-backed course evidence must be corrected through transcript review.");
    const patchById = new Map(args.patches.map((patch) => [patch.plan_course_id, patch]));
    const nextRows = workspace.planCourses.filter((row) => !patchById.get(row.id)?.remove).map((row) => {
      const patch = patchById.get(row.id);
      if (!patch) return row;
      const replacement = patch.course_id ? workspace.courses.find((course) => course.id === patch.course_id) : null;
      const gradeLevel = patch.grade_level ?? row.grade_level;
      return {
        ...row,
        ...(replacement ? {
          course_id: replacement.id,
          smccd_course_id: null,
          college_provider_code: null,
          custom_course_name: null,
          credits: patch.credits ?? replacement.credits,
          college_units: patch.college_units ?? replacement.college_units,
          is_weighted: patch.is_weighted ?? replacement.is_weighted,
          mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === replacement.id && mapping.confidence === "verified"),
          requirement_area_override: null
        } : {}),
        grade_level: gradeLevel,
        school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, gradeLevel),
        term: patch.term ?? row.term,
        ...(patch.letter_grade !== undefined ? { letter_grade: patch.letter_grade } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(!replacement && patch.credits !== undefined ? { credits: patch.credits } : {}),
        ...(!replacement && patch.college_units !== undefined ? { college_units: patch.college_units } : {}),
        ...(!replacement && patch.is_weighted !== undefined ? { is_weighted: patch.is_weighted } : {}),
        user_edited: true
      };
    });
    const selectedCourseIds = nextRows.map((row) => row.course_id).filter((id): id is string => Boolean(id));
    if (new Set(selectedCourseIds).size !== selectedCourseIds.length) throw new Error("The requested batch would place the same selected-school course more than once.");
    let smccdCatalog: SmccdCourse[] | null = null;
    for (const patch of args.patches) {
      if (patch.remove) continue;
      const original = workspace.planCourses.find((row) => row.id === patch.plan_course_id)!;
      const next = nextRows.find((row) => row.id === patch.plan_course_id)!;
      assertPlanningTermExists(next.grade_level, next.term);
      const selectedCourse = next.course_id ? workspace.courses.find((course) => course.id === next.course_id) : null;
      if (patch.course_id && !selectedCourse) throw new Error("One or more replacement courses are no longer in the selected-school catalog.");
      if (selectedCourse) {
        if (selectedCourse.grade_levels.length && !selectedCourse.grade_levels.includes(next.grade_level) && !patch.prerequisite_override_reason) throw new Error(`${selectedCourse.name} is not offered in grade ${next.grade_level}. The student must explicitly correct or override that placement evidence to continue.`);
        if (selectedCourse.term_type === "year" && next.term !== "full_year") throw new Error(`${selectedCourse.name} is a full-year course.`);
        const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(selectedCourse, { gradeLevel: next.grade_level, term: next.term, instanceId: next.id }, workspace.courses, nextRows, workspace.plannedSmccdCourses, workspace.equivalencies, `${workspace.school.name} official course catalog`);
        if (prerequisite.result.status === "blocked" && !patch.prerequisite_override_reason) throw new Error(`${selectedCourse.name} has an unmet prerequisite for that placement. The student must explicitly correct or override that evidence to continue.`);
      } else if (original.smccd_course_id && (patch.grade_level !== undefined || patch.term !== undefined)) {
        if (!smccdCatalog) {
          const catalogResult = await supabase.from("smccd_courses").select("*");
          if (catalogResult.error) throw new Error(catalogResult.error.message);
          smccdCatalog = catalogResult.data as unknown as SmccdCourse[];
        }
        const course = smccdCatalog.find((candidate) => candidate.id === original.smccd_course_id);
        if (!course) throw new Error("One of the edited college courses is no longer in the catalog.");
        const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: next.grade_level, term: next.term, instanceId: next.id }, smccdCatalog, nextRows, workspace.courses);
        if (prerequisite.result.status === "blocked" && !patch.prerequisite_override_reason) throw new Error(`${course.course_code} has an unmet prerequisite for that placement. The student must explicitly correct or override that evidence to continue.`);
      }
    }
    const updates = args.patches.filter((patch) => !patch.remove).map((patch) => {
      const original = workspace.planCourses.find((row) => row.id === patch.plan_course_id)!;
      const next = nextRows.find((row) => row.id === patch.plan_course_id)!;
      const replacement = patch.course_id ? workspace.courses.find((course) => course.id === patch.course_id)! : null;
      const values: Record<string, unknown> = { user_edited: true };
      if (replacement) {
        Object.assign(values, {
          course_id: replacement.id,
          smccd_course_id: null,
          college_provider_code: null,
          custom_course_name: null,
          credits: next.credits,
          college_units: next.college_units,
          is_weighted: next.is_weighted,
          mapping_verified: next.mapping_verified,
          requirement_area_override: null
        });
      }
      if (next.grade_level !== original.grade_level) Object.assign(values, { grade_level: next.grade_level, school_year: next.school_year });
      if (next.term !== original.term) values.term = next.term;
      for (const field of ["letter_grade", "notes", "credits", "college_units", "is_weighted"] as const) {
        if (field in patch) values[field] = next[field];
      }
      if (patch.prerequisite_override_reason) {
        values.notes = [typeof values.notes === "string" ? values.notes : next.notes, `Student-provided prerequisite override (unverified): ${patch.prerequisite_override_reason}`].filter(Boolean).join(" ");
      }
      return { id: original.id, values };
    });
    const editRows = [
      ...args.patches.filter((patch) => patch.remove).map((patch) => {
        const original = workspace.planCourses.find((row) => row.id === patch.plan_course_id)!;
        return { id: original.id, remove: true };
      }),
      ...updates.map((update) => {
      const next = nextRows.find((row) => row.id === update.id)!;
      return {
        id: next.id,
        remove: false,
        course_id: next.course_id,
        smccd_course_id: next.smccd_course_id,
        college_provider_code: next.college_provider_code ?? null,
        custom_course_name: next.custom_course_name,
        grade_level: next.grade_level,
        school_year: next.school_year,
        term: next.term,
        letter_grade: "letter_grade" in update.values ? update.values.letter_grade : next.letter_grade,
        notes: "notes" in update.values ? update.values.notes : next.notes,
        credits: "credits" in update.values ? update.values.credits : next.credits,
        college_units: "college_units" in update.values ? update.values.college_units : next.college_units,
        is_weighted: "is_weighted" in update.values ? update.values.is_weighted : next.is_weighted,
        mapping_verified: next.mapping_verified,
        requirement_area_override: next.requirement_area_override
      };
      })
    ];
    const result = await supabase.rpc("apply_pilot_plan_course_edits_v1", { p_rows: editRows });
    if (result.error) throw new Error(result.error.message);
    const courseMap = new Map(workspace.courses.map((course) => [course.id, course]));
    return {
      summary: `${rows.length} ${rows.length === 1 ? "course was" : "courses were"} updated or removed without changing unaffected plan rows.`,
      data: {
        updated_count: rows.length,
        courses: nextRows.filter((row) => patchById.has(row.id)).map((row) => courseDisplayName(row, courseMap)),
        plan_course_ids: rows.map((row) => row.id)
      },
      changed: { entity: "plan_courses", id: rows.map((row) => row.id).join(",") },
      undo: { kind: "restore_rows", table: "plan_courses", rows: rows as unknown as Array<Record<string, unknown>>, summary: "The previous course sequence and placements were restored." }
    };
  }

  if (name === "update_plan_course") {
    const args = toolArgumentSchemas.update_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed course evidence must be corrected through transcript review.");
    const gradeLevel = args.grade_level ?? row.grade_level;
    const term = args.term ?? row.term;
    assertPlanningTermExists(gradeLevel, term);
    const highSchoolCourse = row.course_id ? workspace.courses.find((course) => course.id === row.course_id) : null;
    if (highSchoolCourse) {
      if (highSchoolCourse.grade_levels.length && !highSchoolCourse.grade_levels.includes(gradeLevel)) throw new Error(`That course is not offered in grade ${gradeLevel}.`);
      if (highSchoolCourse.term_type === "year" && term !== "full_year") throw new Error(`That ${workspace.school.short_name} course is a full-year course.`);
      const prerequisite = evaluateSelectedSchoolPlannerPrerequisites(highSchoolCourse, { gradeLevel, term, instanceId: row.id }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies, `${workspace.school.name} official course catalog`);
      if (prerequisite.result.status === "blocked") throw new Error("The listed prerequisite is not satisfied for that placement.");
    }
    if (row.smccd_course_id && (args.grade_level !== undefined || args.term !== undefined)) {
      const catalogResult = await supabase.from("smccd_courses").select("*");
      if (catalogResult.error) throw new Error(catalogResult.error.message);
      const course = (catalogResult.data as unknown as SmccdCourse[]).find((candidate) => candidate.id === row.smccd_course_id);
      if (!course) throw new Error("That SMCCD course is no longer in the catalog.");
      const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel, term, instanceId: row.id }, catalogResult.data as unknown as SmccdCourse[], workspace.planCourses, workspace.courses);
      if (prerequisite.result.status === "blocked") throw new Error("The listed SMCCD prerequisite is not satisfied for that placement.");
    }
    const patch: Record<string, unknown> = { user_edited: true };
    if (args.grade_level !== undefined) {
      patch.grade_level = args.grade_level;
      patch.school_year = schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level);
    }
    if (args.term !== undefined) patch.term = args.term;
    if (args.letter_grade !== undefined) patch.letter_grade = args.letter_grade;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.credits !== undefined) patch.credits = args.credits;
    if (args.college_units !== undefined) patch.college_units = args.college_units;
    if (args.is_weighted !== undefined) patch.is_weighted = args.is_weighted;
    const { error } = await supabase.from("plan_courses").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    return {
      summary: "The course details were updated.",
      data: { plan_course_id: row.id, ...patch },
      changed: { entity: "plan_course", id: row.id },
      undo: { kind: "restore_rows", table: "plan_courses", rows: [row as unknown as Record<string, unknown>], summary: "The previous course details were restored." }
    };
  }

  if (name === "sort_plan_courses") {
    const previousRows = workspace.planCourses as unknown as Array<Record<string, unknown>>;
    const updates: Array<{ id: string; sort_order: number }> = [];
    for (const gradeLevel of [9, 10, 11, 12] as GradeLevel[]) {
      orderedCourseIdsForAutomaticBoardSort(workspace.planCourses, gradeLevel).forEach((id, sortOrder) => {
        const row = workspace.planCourses.find((candidate) => candidate.id === id);
        if (row && row.sort_order !== sortOrder) updates.push({ id, sort_order: sortOrder });
      });
    }
    for (const update of updates) {
      const result = await supabase.from("plan_courses").update({ sort_order: update.sort_order }).eq("id", update.id).eq("user_id", userId);
      if (result.error) {
        await supabase.from("plan_courses").upsert(previousRows);
        throw new Error(result.error.message);
      }
    }
    return {
      summary: updates.length ? `Sorted ${updates.length} course placements into the standard board order.` : "The course plan was already in the standard order.",
      data: { sorted_count: updates.length },
      changed: { entity: "plan_courses", id: updates.map((update) => update.id).join(",") || workspace.activeVersion.id },
      undo: { kind: "restore_rows", table: "plan_courses", rows: previousRows, summary: "The previous course order was restored." }
    };
  }

  if (name === "update_gpa_scenario") {
    const args = toolArgumentSchemas.update_gpa_scenario.parse(argumentsValue);
    const openCourseIds = new Set(workspace.planCourses.filter((row) => row.status === "current" || row.status === "planned").map((row) => row.id));
    if (args.choices.some((choice) => !openCourseIds.has(choice.plan_course_id))) throw new Error("GPA scenarios can only change current or planned courses in the active plan.");
    const affectedIds = args.choices.map((choice) => choice.plan_course_id);
    const previousRows = workspace.gpaScenarioChoices.filter((choice) => affectedIds.includes(choice.plan_course_id));
    if (affectedIds.length) {
      const removal = await supabase.from("student_gpa_scenario_choices").delete().eq("user_id", userId).in("plan_course_id", affectedIds);
      if (removal.error) throw new Error(removal.error.message);
    }
    if (args.choices.length) {
      const insertion = await supabase.from("student_gpa_scenario_choices").insert(args.choices.map((choice) => ({ ...choice, user_id: userId })));
      if (insertion.error) {
        if (previousRows.length) await supabase.from("student_gpa_scenario_choices").insert(previousRows.map((row) => ({ ...row, user_id: userId })));
        throw new Error(insertion.error.message);
      }
    }
    return {
      summary: `Saved GPA assumptions for ${args.choices.length} ${args.choices.length === 1 ? "course" : "courses"}.`,
      data: { updated_count: args.choices.length },
      changed: { entity: "student_gpa_scenario", id: affectedIds.join(",") },
      undo: { kind: "restore_gpa_scenario", plan_course_ids: affectedIds, rows: previousRows as unknown as Array<Record<string, unknown>>, summary: "The previous GPA assumptions were restored." }
    };
  }

  if (name === "update_enrollment_preference") {
    const args = toolArgumentSchemas.update_enrollment_preference.parse(argumentsValue);
    if (workspace.collegeDistrict?.policy_provider_code !== "SMCCD") {
      throw new Error("The selected college district does not have a reviewed concurrent/dual-enrollment policy in Pilot yet.");
    }
    const policy = workspace.enrollmentPolicies.find((candidate) => candidate.provider_code === "SMCCD" && candidate.program_type === args.program_type);
    if (!policy) throw new Error("No source-backed SMCCD policy matches that enrollment type.");
    const previousResult = await supabase.from("student_enrollment_preferences").select("*").eq("user_id", userId).eq("provider_code", "SMCCD").maybeSingle();
    if (previousResult.error) throw new Error(previousResult.error.message);
    const { data, error } = await supabase.from("student_enrollment_preferences").upsert({
      user_id: userId,
      provider_code: "SMCCD",
      program_type: args.program_type,
      limit_mode: "recommended",
      custom_unit_limit: null,
      respect_recommended_limit: args.respect_recommended_limit ?? workspace.enrollmentPreference.respect_recommended_limit !== false
    }, { onConflict: "user_id,provider_code" }).select("user_id,provider_code").single();
    if (error) throw new Error(error.message);
    return {
      summary: `The SMCCD ${args.program_type === "dual" ? "dual-enrollment" : "concurrent-enrollment"} preference was updated.`,
      data: { provider_code: "SMCCD", ...args, planning_threshold_units: policy.recommended_max_units, published_absolute_max_units: policy.absolute_max_units },
      changed: { entity: "student_enrollment_preference", id: `${data.user_id}:${data.provider_code}` },
      undo: { kind: "restore_enrollment_preference", row: previousResult.data as Record<string, unknown> | null, summary: "The previous college enrollment type was restored." }
    };
  }

  if (name === "update_student_settings") {
    const args = toolArgumentSchemas.update_student_settings.parse(argumentsValue);
    const nextStart = args.plan_start_grade === undefined ? workspace.settings.plan_start_grade : args.plan_start_grade;
    const nextEnd = args.plan_end_grade === undefined ? workspace.settings.plan_end_grade : args.plan_end_grade;
    if (nextStart && nextEnd && nextStart > nextEnd) throw new Error("The planning start grade cannot be after the planning end grade.");
    const nextTracker = args.tracker_mode ?? workspace.settings.tracker_mode;
    const nextAreas = args.tracked_requirement_areas ?? workspace.settings.tracked_requirement_areas;
    if (nextTracker === "selected" && nextAreas.length === 0) throw new Error("Focused tracking needs at least one requirement area.");
    const patch = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
    const previousValues = Object.fromEntries(Object.keys(patch).map((key) => [key, (workspace.settings as unknown as Record<string, unknown>)[key]]));
    const { error } = await supabase.from("student_settings").update(patch).eq("id", userId);
    if (error) throw new Error(error.message);
    return {
      summary: "The student and planning settings were updated.",
      data: patch,
      changed: { entity: "student_settings", id: userId },
      undo: { kind: "restore_student_settings", values: previousValues, summary: "The previous student settings were restored." }
    };
  }

  if (name === "submit_shared_data_correction") {
    const args = toolArgumentSchemas.submit_shared_data_correction.parse(argumentsValue);
    const allowedFields = SHARED_CORRECTION_FIELDS[args.target_table];
    const proposedFields = Object.keys(args.proposed_payload);
    const invalidFields = proposedFields.filter((field) => !allowedFields?.has(field));
    if (invalidFields.length) throw new Error(`These shared fields cannot be proposed through Pilot: ${invalidFields.join(", ")}.`);
    const { data: target, error: targetError } = await supabase.from(args.target_table).select("id").eq("id", args.target_id).maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("The shared record no longer exists or is not visible to this student.");
    const { data, error } = await supabase.from("shared_data_proposals").insert({
      submitted_by: userId,
      submitted_via: "pilot",
      entity_type: args.entity_type,
      action: "correct",
      school_id: workspace.settings.school_id,
      target_table: args.target_table,
      target_id: args.target_id,
      proposed_payload: args.proposed_payload,
      evidence_url: args.evidence_url,
      evidence_summary: args.evidence_summary,
      status: "pending"
    }).select("id,status").single();
    if (error) throw new Error(error.message);
    return {
      summary: "The correction was submitted for administrator review.",
      data: { proposal_id: data.id, status: data.status, corrected_fields: proposedFields },
      changed: { entity: "shared_data_proposal", id: data.id },
      undo: { kind: "delete_rows", table: "shared_data_proposals", ids: [data.id], summary: "The pending shared-data correction was withdrawn." }
    };
  }

  if (name === "correct_transcript_course") {
    const args = toolArgumentSchemas.correct_transcript_course.parse(argumentsValue);
    const review = workspace.transcriptReviewItems.find((item) => item.id === args.review_item_id && item.entity_type === "transcript_course");
    if (!review) throw new Error("That transcript course review row no longer exists.");
    const original = (review.corrected_payload ?? review.proposed_payload) as unknown as TranscriptCoursePayload;
    const corrected: TranscriptCoursePayload & { assistant_correction_reason: string } = {
      ...original,
      ...(args.letter_grade !== undefined ? { letter_grade: args.letter_grade } : {}),
      ...(args.credits !== undefined ? { credits: args.credits } : {}),
      ...(args.grade_level !== undefined ? { grade_level: args.grade_level, school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level) } : {}),
      ...(args.term !== undefined ? { term: args.term } : {}),
      ...(args.weighted !== undefined ? { weighted: args.weighted, weighting_basis: "student_correction" as const } : {}),
      assistant_correction_reason: args.reason
    };
    const reviewUpdate = await supabase.from("catalog_review_items").update({ corrected_payload: corrected, status: "approved" }).eq("id", review.id).eq("user_id", userId);
    if (reviewUpdate.error) throw new Error(reviewUpdate.error.message);
    const restoreReview = async () => {
      await supabase.from("catalog_review_items").update({ corrected_payload: review.corrected_payload, status: review.status }).eq("id", review.id).eq("user_id", userId);
    };
    const planPatch: Record<string, unknown> = { user_edited: true };
    if (args.letter_grade !== undefined) planPatch.letter_grade = args.letter_grade;
    if (args.credits !== undefined) planPatch.credits = args.credits;
    if (args.weighted !== undefined) planPatch.is_weighted = args.weighted;
    if (args.grade_level !== undefined) {
      planPatch.grade_level = args.grade_level;
      planPatch.school_year = corrected.school_year;
    }
    if (args.term !== undefined) planPatch.term = args.term;
    const linkedRows = workspace.planCourses.filter((row) => row.source_review_item_id === review.id);
    let linkedPlanCourseIds = linkedRows.map((row) => row.id);
    let insertedPlanCourseIds: string[] = [];
    if (linkedRows.length) {
      const planUpdate = await supabase.from("plan_courses").update(planPatch).eq("source_review_item_id", review.id).eq("user_id", userId);
      if (planUpdate.error) {
        await restoreReview();
        throw new Error(planUpdate.error.message);
      }
    } else {
      const draft = transcriptPlanCourseDraft(corrected, workspace.settings, workspace.courses, workspace.mappings, review.id, workspace.equivalencies);
      const insertResult = await supabase.from("plan_courses").insert({
        ...draft,
        plan_version_id: workspace.activeVersion.id,
        user_id: userId,
        user_edited: true,
        sort_order: workspace.planCourses.length
      }).select("id").single();
      if (insertResult.error) {
        await restoreReview();
        throw new Error(insertResult.error.message);
      }
      linkedPlanCourseIds = [insertResult.data.id];
      insertedPlanCourseIds = [insertResult.data.id];
    }
    return {
      summary: `Corrected ${original.course_name ?? "the transcript course"}; the original imported evidence remains preserved.`,
      data: { review_item_id: review.id, linked_plan_course_ids: linkedPlanCourseIds, corrected_fields: planPatch, reason: args.reason, gpa_recalculation: "automatic from the corrected course fields" },
      changed: { entity: "catalog_review_item", id: review.id },
      undo: {
        kind: "restore_transcript_correction",
        review_item_id: review.id,
        corrected_payload: review.corrected_payload as Record<string, unknown> | null,
        status: review.status,
        plan_rows: linkedRows as unknown as Array<Record<string, unknown>>,
        inserted_plan_course_ids: insertedPlanCourseIds,
        summary: "The previous transcript correction and linked course values were restored."
      }
    };
  }

  if (name === "save_prerequisite_evidence") {
    const args = toolArgumentSchemas.save_prerequisite_evidence.parse(argumentsValue);
    const courseResult = await supabase.from("smccd_courses").select("id,course_code,title,college_code").eq("id", args.target_course_id).maybeSingle();
    if (courseResult.error) throw new Error(courseResult.error.message);
    if (!courseResult.data) throw new Error("That target course is not in the current SMCCD catalog.");
    const previous = workspace.prerequisiteClearances.find((row) => row.target_course_id === args.target_course_id && row.clearance_type === args.clearance_type);
    const { data, error } = await supabase.from("student_prerequisite_clearances").upsert({
      user_id: userId,
      target_course_id: args.target_course_id,
      clearance_type: args.clearance_type,
      status: "pending",
      verification_status: "pending",
      authority: args.authority,
      evidence_summary: args.evidence_summary,
      source_url: args.source_url,
      decided_at: null,
      expires_at: null,
      verified_by: null,
      verified_at: null
    }, { onConflict: "user_id,target_course_id,clearance_type" }).select("id").single();
    if (error) throw new Error(error.message);
    return {
      summary: `Submitted prerequisite evidence for ${courseResult.data.course_code}; it remains pending independent verification.`,
      data: { course: courseResult.data, clearance_type: args.clearance_type, authority: args.authority, verification_status: "pending" },
      changed: { entity: "student_prerequisite_clearance", id: data.id },
      undo: previous
        ? { kind: "restore_rows", table: "student_prerequisite_clearances", rows: [previous as unknown as Record<string, unknown>], summary: "The previous prerequisite evidence was restored." }
        : { kind: "delete_rows", table: "student_prerequisite_clearances", ids: [data.id], summary: "The submitted prerequisite evidence was removed." }
    };
  }

  if (name === "create_plan_snapshot") {
    const args = toolArgumentSchemas.create_plan_snapshot.parse(argumentsValue);
    const versionResult = await supabase.from("plan_versions").insert({ plan_id: workspace.plan.id, user_id: userId, label: args.label, kind: "snapshot", generation_config: {}, ai_summary: "Saved by Pilot from the current active plan." }).select("id").single();
    if (versionResult.error) throw new Error(versionResult.error.message);
    const copies = workspace.planCourses.map((row) => {
      const { id: _id, ...copy } = row;
      return { ...copy, plan_version_id: versionResult.data.id };
    });
    if (copies.length) {
      const copyResult = await supabase.from("plan_courses").insert(copies);
      if (copyResult.error) {
        await supabase.from("plan_versions").delete().eq("id", versionResult.data.id);
        throw new Error(copyResult.error.message);
      }
    }
    return {
      summary: `Saved “${args.label}” with ${copies.length} courses.`,
      data: { label: args.label, course_count: copies.length },
      changed: { entity: "plan_version", id: versionResult.data.id },
      undo: { kind: "delete_rows", table: "plan_versions", ids: [versionResult.data.id], summary: `The “${args.label}” snapshot was deleted.` }
    };
  }

  if (name === "set_smccd_ge_completion") {
    const args = toolArgumentSchemas.set_smccd_ge_completion.parse(argumentsValue);
    if (args.requirement === "information_literacy" && args.college_code !== "SKY") {
      throw new Error("Manual information-literacy completion is supported only for Skyline's tutorial or equivalent requirement.");
    }
    const wasCompleted = workspace.manualSmccdCompletions.some((row) => row.college_code === args.college_code && row.area === args.requirement);
    if (args.completed) {
      const { error } = await supabase.from("student_smccd_ge_completions").upsert({ user_id: userId, college_code: args.college_code, area: args.requirement, completion_source: "manual" }, { onConflict: "user_id,college_code,area" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("student_smccd_ge_completions").delete().eq("user_id", userId).eq("college_code", args.college_code).eq("area", args.requirement);
      if (error) throw new Error(error.message);
    }
    const label = args.requirement === "7A" ? "Area 7A" : "information literacy";
    return {
      summary: `SMCCD ${args.college_code} ${label} was ${args.completed ? "marked complete" : "marked incomplete"}.`,
      data: { college_code: args.college_code, area: args.requirement, completed: args.completed },
      changed: { entity: "student_smccd_ge_completion", id: `${userId}:${args.college_code}:${args.requirement}` },
      undo: { kind: "restore_smccd_completion", college_code: args.college_code, area: args.requirement, completed: wasCompleted, summary: `The previous ${label} completion was restored.` }
    };
  }

  if (name === "set_college_goal") {
    const args = toolArgumentSchemas.set_college_goal.parse(argumentsValue);
    const programResult = await supabase.from("smccd_programs").select("id, title, award_type, college_code").eq("id", args.program_id).single();
    if (programResult.error || !programResult.data) throw new Error("That SMCCD degree program is no longer available.");
    const previous = workspace.collegeGoals.find((goal) => goal.program_id === args.program_id);
    const { data, error } = await supabase.from("student_smccd_goals").upsert({ user_id: userId, program_id: args.program_id, is_primary: false, notes: args.notes }, { onConflict: "user_id,program_id" }).select("id").single();
    if (error) throw new Error(error.message);
    return {
      summary: `${programResult.data.title} was bookmarked.`,
      data: { ...programResult.data, notes: args.notes },
      changed: { entity: "student_smccd_goal", id: data.id },
      undo: previous
        ? { kind: "restore_rows", table: "student_smccd_goals", rows: [previous as unknown as Record<string, unknown>], summary: "The previous degree bookmark was restored." }
        : { kind: "delete_rows", table: "student_smccd_goals", ids: [data.id], summary: "The degree bookmark was removed." }
    };
  }

  if (name === "set_college_goals") {
    const args = toolArgumentSchemas.set_college_goals.parse(argumentsValue);
    const programResult = await supabase.from("smccd_programs")
      .select("id, title, award_type, college_code")
      .in("id", args.program_ids);
    if (programResult.error) throw new Error(programResult.error.message);
    const programs = programResult.data ?? [];
    if (programs.length !== args.program_ids.length) {
      throw new Error("One or more requested SMCCD degree programs are no longer available.");
    }
    const existingProgramIds = new Set(workspace.collegeGoals.map((goal) => goal.program_id));
    const missingPrograms = programs.filter((program) => !existingProgramIds.has(program.id));
    if (!missingPrograms.length) throw new Error("All requested degrees are already bookmarked.");
    const insertResult = await supabase.from("student_smccd_goals").insert(missingPrograms.map((program) => ({
      user_id: userId,
      program_id: program.id,
      is_primary: false,
      notes: args.notes
    }))).select("id, program_id");
    if (insertResult.error) throw new Error(insertResult.error.message);
    const inserted = insertResult.data ?? [];
    if (inserted.length !== missingPrograms.length) throw new Error("The complete degree-bookmark batch was not saved.");
    return {
      summary: `${missingPrograms.length} ${missingPrograms.length === 1 ? "degree was" : "degrees were"} bookmarked.`,
      data: missingPrograms.map((program) => ({ ...program, notes: args.notes })),
      changed: { entity: "student_smccd_goal", id: inserted.map((row) => row.id).join(",") },
      undo: {
        kind: "delete_rows",
        table: "student_smccd_goals",
        ids: inserted.map((row) => row.id),
        summary: `${missingPrograms.length === 1 ? "The degree bookmark was" : "The degree bookmarks were"} removed.`
      }
    };
  }

  if (name === "clear_college_goal") {
    const args = toolArgumentSchemas.clear_college_goal.parse(argumentsValue);
    const goal = workspace.collegeGoals.find((candidate) => candidate.program_id === args.program_id);
    if (!goal) throw new Error("That degree is not currently bookmarked.");
    const { error } = await supabase.from("student_smccd_goals").delete().eq("id", goal.id);
    if (error) throw new Error(error.message);
    return {
      summary: "The degree bookmark was removed.",
      data: { program_id: args.program_id },
      changed: { entity: "student_smccd_goal", id: goal.id },
      undo: { kind: "restore_rows", table: "student_smccd_goals", rows: [goal as unknown as Record<string, unknown>], summary: "The degree bookmark was restored." }
    };
  }

  if (name === "clear_academic_plan") {
    const args = toolArgumentSchemas.clear_academic_plan.parse(argumentsValue);
    const operation = await supabase.rpc("clear_pilot_academic_plan", {
      p_clear_courses: args.courses,
      p_clear_degree_bookmarks: args.degree_bookmarks,
      p_clear_gpa_scenario: args.gpa_scenario
    });
    if (operation.error) throw new Error(operation.error.message);
    const payload = operation.data && typeof operation.data === "object" && !Array.isArray(operation.data)
      ? operation.data as Record<string, unknown>
      : {};
    const planRows = Array.isArray(payload.plan_rows) ? payload.plan_rows as Array<Record<string, unknown>> : [];
    const goalRows = Array.isArray(payload.goal_rows) ? payload.goal_rows as Array<Record<string, unknown>> : [];
    const gpaRows = Array.isArray(payload.gpa_rows) ? payload.gpa_rows as Array<Record<string, unknown>> : [];
    const removedCount = planRows.length + goalRows.length + (args.gpa_scenario && !args.courses ? gpaRows.length : 0);
    return {
      summary: removedCount
        ? `Cleared ${planRows.length} editable courses, ${goalRows.length} degree bookmarks, and ${gpaRows.length} saved GPA assumptions in one reversible change.`
        : "The selected academic-plan areas were already clear.",
      data: {
        courses_removed: planRows.length,
        transcript_courses_retained: workspace.planCourses.filter((row) => Boolean(row.source_review_item_id)).length,
        degree_bookmarks_removed: goalRows.length,
        gpa_assumptions_removed: gpaRows.length
      },
      changed: { entity: "academic_plan", id: workspace.plan.id },
      undo: {
        kind: "restore_academic_plan",
        plan_rows: planRows,
        goal_rows: goalRows,
        gpa_rows: gpaRows,
        summary: `Restored ${planRows.length} courses, ${goalRows.length} degree bookmarks, and ${gpaRows.length} GPA assumptions.`
      }
    };
  }

  throw new Error(`${assistantToolLabel(name)} is not a mutating tool.`);
}
