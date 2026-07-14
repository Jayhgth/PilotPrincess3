import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSmccdPlanCourseIndex, dtechCatalogEligibility, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
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
  courseDisplayName,
  dtechGradePoint,
  generateSuggestedPlan,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  requirementsForSettings,
  schoolYearForGrade
} from "@/lib/planning";
import { calculateSmccdLocalDegreeProgress, calculateSmccdProgramProgressWithContext, createSmccdProgramProgressContext } from "@/lib/smccd";
import { evaluateDtechPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
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
    course_ids: z.array(z.uuid()).min(1).max(24)
      .refine((ids) => new Set(ids).size === ids.length, "Course IDs must be unique."),
    respect_recommended_limit: z.boolean().default(true),
    interests: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
    rigor: z.enum(["balanced", "advanced", "lighter"]).default("balanced"),
    max_courses_per_term: z.number().int().min(1).max(12).nullable().default(null),
    start_grade: gradeSchema.optional(),
    objectives: z.array(z.enum(["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"])).min(1).max(4).default(["complete_diploma"])
  }),
  add_dtech_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema
  }),
  add_high_school_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema
  }),
  add_smccd_course: z.object({
    course_id: z.string().trim().min(1).max(180),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema
  }),
  add_academic_courses: z.object({
    entries: z.array(z.object({
      source: z.enum(["selected_school", "smccd"]),
      course_id: z.string().trim().min(1).max(180),
      status: courseStatusSchema,
      grade_level: gradeSchema,
      term: termSchema
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
    ai_review_mode: z.enum(["manual", "auto_review"]).optional()
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
  { name: "get_graduation_progress", mutatesData: false, description: "Read requirement-by-requirement completed, scheduled, and remaining credit evidence.", arguments: "{}" },
  { name: "get_nearby_education_providers", mutatesData: false, description: "Read community colleges discovered from the selected school's official address and approximate distance. This does not use precise student location or prove enrollment eligibility.", arguments: "{}" },
  { name: "get_transcript_sources", mutatesData: false, description: "Read transcript source labels and review state. Corrections require the separate exact correction tool and preserve the original evidence.", arguments: "{}" },
  { name: "get_student_data_inventory", mutatesData: false, description: "Read a compact inventory of the current student's available records so the assistant can choose the correct evidence tool.", arguments: "{}" },
  { name: "audit_transcript_data", mutatesData: false, description: "Compare transcript source text, parsed rows, review decisions, catalog identities, and imported plan rows. Use source text for an actual extraction audit; never treat a graduation gap as a parsing error.", arguments: '{"include_source_text":boolean}' },
  { name: "get_gpa_evidence", mutatesData: false, description: "Read course-level GPA inclusion, weighting, points, and exclusion evidence for the current or projected calculation.", arguments: '{"scope":"current|projected"}' },
  { name: "evaluate_gpa_scenario", mutatesData: false, description: "Evaluate grade assumptions for courses already in the current four-year plan, including its all-A ceiling. This cannot predict grades or invent a new schedule.", arguments: '{"target_weighted_gpa":number,"choices":[{"plan_course_id":"uuid","included":boolean,"expected_grade":"A|B|C|D|F|null"}]}' },
  { name: "get_gpa_scenario", mutatesData: false, description: "Read the saved GPA-planner inclusion and expected-grade choices for every current or planned course.", arguments: "{}" },
  { name: "get_enrollment_constraints", mutatesData: false, description: "Read source-backed concurrent or dual-enrollment limits and evaluate the saved college schedule by term.", arguments: "{}" },
  { name: "get_course_schedule_options", mutatesData: false, description: "Evaluate the current four-year plan and generate deterministic complete-plan additions from the requested starting grade. Objectives can prioritize diploma completion, weighted-GPA ceiling, degree overlap, and major alignment; the result still obeys verified requirements, prerequisites, and provider limits.", arguments: '{"respect_recommended_limit":boolean,"interests":["string"],"rigor":"balanced|advanced|lighter","max_courses_per_term":number|null,"start_grade":9|10|11|12,"objectives":["complete_diploma|maximize_weighted_gpa|maximize_degree_overlap|align_major"]}' },
  { name: "get_prerequisite_evidence", mutatesData: false, description: "Read official prerequisite evaluation and any student-submitted clearance evidence for one d.tech or SMCCD course.", arguments: '{"course_id":"string"}' },
  { name: "get_degree_progress", mutatesData: false, description: "Read deterministic requirement-level evidence for one bookmarked SMCCD associate degree. Omit program_id only when one bookmark is sufficient context.", arguments: '{"program_id":"string|optional"}' },
  { name: "get_college_goal", mutatesData: false, description: "Read all bookmarked SMCCD associate degrees.", arguments: "{}" },
  { name: "search_smccd_programs", mutatesData: false, description: "Search official SMCCD AA and AS programs by name or program code. Returns exact program IDs needed to bookmark a degree.", arguments: '{"query":"string","college":"CSM|SKY|CAN|all","award_type":"AA|AS|all"}' },
  { name: "set_current_school", mutatesData: true, description: "Propose changing the student's selected California public or charter high school after search_california_high_schools returns its exact ID. Existing plan rows are retained; school-specific catalog and graduation evidence refresh to the new school.", arguments: '{"school_id":"uuid"}' },
  { name: "set_college_district_preference", mutatesData: true, description: "Propose changing the student's California community-college district. Use an exact district_code returned by get_nearby_education_providers. This changes district-aware suggestions and sourced policy context; it never claims enrollment eligibility.", arguments: '{"district_code":"string"}' },
  { name: "undo_change", mutatesData: true, description: "Undo one exact applied change from this conversation using its private stored inverse. Use only a tool_call_id supplied by the recent conversation change ledger; never reconstruct deleted data from the current plan.", arguments: '{"tool_call_id":"uuid"}' },
  { name: "add_course_schedule", mutatesData: true, description: "Propose adding the exact complete-plan batch returned by get_course_schedule_options. Pass the same objectives, starting grade, interests, rigor, workload cap, and unit-limit choice so revalidation is identical.", arguments: '{"course_ids":["uuid"],"respect_recommended_limit":boolean,"interests":["string"],"rigor":"balanced|advanced|lighter","max_courses_per_term":number|null,"start_grade":9|10|11|12,"objectives":["complete_diploma|maximize_weighted_gpa|maximize_degree_overlap|align_major"]}' },
  { name: "add_dtech_course", mutatesData: true, description: "Propose adding one verified d.tech catalog course to In progress or Planned. The selected review route must approve it.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "add_high_school_course", mutatesData: true, description: "Propose adding one approved course from the student's selected high-school catalog to In progress or Planned. The selected review route must approve it.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "add_smccd_course", mutatesData: true, description: "Propose adding one SMCCD catalog course to In progress or Planned. The selected review route must approve it.", arguments: '{"course_id":"string","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "add_academic_courses", mutatesData: true, description: "Add one validated mixed batch of selected-school and SMCCD courses across grades 9–12. Use this for complete multi-year plans after catalog, graduation, degree, prerequisite, GPA, and enrollment evidence has selected exact IDs. The whole batch is one reversible action; every SMCCD row is weighted for d.tech GPA and receives separately resolved high-school credits.", arguments: '{"entries":[{"source":"selected_school|smccd","course_id":"string","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}],"respect_recommended_limit":boolean}' },
  { name: "move_plan_course", mutatesData: true, description: "Propose moving an editable plan course between Done, In progress, and Planned. Transcript-backed courses cannot move.", arguments: '{"plan_course_id":"uuid","status":"completed|current|planned"}' },
  { name: "move_plan_courses", mutatesData: true, description: "Propose moving an exact set of editable plan courses to Done, In progress, or Planned in one request. Use this for all/every bulk state changes after listing the matching courses.", arguments: '{"plan_course_ids":["uuid"],"status":"completed|current|planned"}' },
  { name: "remove_plan_course", mutatesData: true, description: "Propose removing an editable course from the active plan. Transcript-backed courses cannot be removed.", arguments: '{"plan_course_id":"uuid"}' },
  { name: "remove_plan_courses", mutatesData: true, description: "Propose removing an exact set of editable courses from the active plan in one atomic request. Use this for all/every bulk removal requests after listing the matching plan courses.", arguments: '{"plan_course_ids":["uuid"]}' },
  { name: "update_plan_course", mutatesData: true, description: "Propose editing placement, grade, credits, college units, weighting, or notes on a non-transcript plan course. GPA recalculates from the resulting course variables.", arguments: '{"plan_course_id":"uuid","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","letter_grade":"string|null","credits":number,"college_units":number|null,"is_weighted":boolean,"notes":"string|null"}' },
  { name: "sort_plan_courses", mutatesData: true, description: "Propose applying the product's canonical course-board ordering across every grade, with college courses first and locked or full-year rows placed consistently.", arguments: "{}" },
  { name: "update_gpa_scenario", mutatesData: true, description: "Propose saving GPA-planner inclusion and expected-grade choices for current or planned courses. This changes only the calculator scenario, never completed transcript grades or the course plan.", arguments: '{"choices":[{"plan_course_id":"uuid","included":boolean,"expected_grade":"A|B|C|D|F|null"}]}' },
  { name: "update_enrollment_preference", mutatesData: true, description: "Propose changing whether the student plans to use SMCCD concurrent enrollment or a dual-enrollment partnership and whether generated plans respect its recommended limit. District thresholds remain source-backed policy.", arguments: '{"program_type":"concurrent|dual","respect_recommended_limit":boolean}' },
  { name: "update_student_settings", mutatesData: true, description: "Propose changing ordinary student, planning, and connected Pilot model/reasoning/review settings. Include only fields explicitly requested. This cannot change Pilot opt-in consent, authentication, or account lifecycle.", arguments: '{"preferred_name?":"string","age?":number|null,"grade_level?":9|10|11|12|null,"graduation_year?":number|null,"plan_start_grade?":9|10|11|12|null,"plan_end_grade?":9|10|11|12|null,"tracker_mode?":"full|selected","tracked_requirement_areas?":["english|..."],"ai_model?":"gpt-5.6-luna|gpt-5.5|gpt-5.4-mini","ai_reasoning_effort?":"low|medium|high","ai_review_mode?":"manual|auto_review"}' },
  { name: "submit_shared_data_correction", mutatesData: true, description: "Submit an evidence-backed correction to shared school, course, or provider data for administrator review. This creates a pending proposal only; Pilot cannot publish institutional data. Use exact IDs and include only corrected fields. For the student's selected school ID, call get_student_data_inventory instead of asking the student.", arguments: '{"entity_type":"school|course|provider|provider_link|policy|source","target_table":"schools|courses|education_providers|school_provider_links","target_id":"uuid","proposed_payload":{"field":"corrected value"},"evidence_url":"url|null","evidence_summary":"string"}' },
  { name: "correct_transcript_course", mutatesData: true, description: "Propose an exact correction to imported transcript evidence and its linked completed plan row while preserving the original proposed payload and correction reason.", arguments: '{"review_item_id":"uuid","letter_grade":"string|null","credits":number,"weighted":boolean,"grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","reason":"string"}' },
  { name: "save_prerequisite_evidence", mutatesData: true, description: "Submit placement, equivalency, challenge, approval, admission, or audition evidence for independent verification. Pilot cannot mark institutional evidence approved.", arguments: '{"target_course_id":"string","clearance_type":"placement|approved_equivalency|prerequisite_challenge|instructor_approval|program_admission|audition_or_portfolio","authority":"string","evidence_summary":"string","source_url":"url|null"}' },
  { name: "create_plan_snapshot", mutatesData: true, description: "Create a named snapshot copy of the current four-year plan for comparison or rollback reference.", arguments: '{"label":"string"}' },
  { name: "set_smccd_ge_completion", mutatesData: true, description: "Mark or unmark a supported manual local-degree completion: Area 7A for any college pattern, or Skyline's information-literacy tutorial/equivalent.", arguments: '{"college_code":"CSM|SKY|CAN","requirement":"7A|information_literacy","completed":boolean}' },
  { name: "set_college_goal", mutatesData: true, description: "Propose bookmarking one SMCCD AA or AS degree. Existing bookmarks remain marked.", arguments: '{"program_id":"string","notes":"string"}' },
  { name: "clear_college_goal", mutatesData: true, description: "Propose removing one SMCCD degree bookmark.", arguments: '{"program_id":"string"}' },
  { name: "clear_academic_plan", mutatesData: true, description: "Clear any requested combination of editable schedule rows, degree bookmarks, and saved GPA assumptions as one coherent action. Transcript-backed evidence is always retained. The complete deleted state is stored as one durable inverse so a single later request can restore the entire operation.", arguments: '{"courses":boolean,"degree_bookmarks":boolean,"gpa_scenario":boolean}' }
];

export function assistantToolCatalogPrompt() {
  return ASSISTANT_TOOL_CATALOG.map((tool) => [
    `- ${tool.name}${tool.mutatesData ? " (exact proposal; selected review mode required)" : " (read-only)"}`,
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
    add_course_schedule: "Add course schedule",
    add_dtech_course: "Add high school course",
    add_high_school_course: "Add high school course",
    add_smccd_course: "Add college course",
    add_academic_courses: "Add academic course plan",
    move_plan_course: "Move course",
    move_plan_courses: "Move courses",
    remove_plan_course: "Remove course",
    remove_plan_courses: "Remove courses",
    update_plan_course: "Update course",
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

function generateValidatedSchedule(
  workspace: AssistantWorkspace,
  enrollmentPolicy: EnrollmentPolicy | null,
  respectRecommendedLimit: boolean,
  preferences: { interests: string[]; rigor: "balanced" | "advanced" | "lighter"; maxCoursesPerTerm: number | null; startGrade?: GradeLevel; objectives?: string[] } = { interests: [], rigor: "balanced", maxCoursesPerTerm: null }
) {
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
  const candidates = generateSuggestedPlan(
    workspace.settings,
    workspace.courses,
    workspace.planCourses,
    enrollmentPolicy,
    respectRecommendedLimit
  );
  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    const course = workspace.courses.find((row) => row.id === candidate.course_id);
    if (!course) continue;
    const planWithAccepted = [
      ...workspace.planCourses,
      ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))
    ];
    if (effectiveMaxCoursesPerTerm) {
      const terms = candidate.term === "full_year" ? ["fall", "spring"] : [candidate.term];
      if (terms.some((term) => planWithAccepted.filter((row) => row.grade_level === candidate.grade_level && (row.term === term || row.term === "full_year")).length >= effectiveMaxCoursesPerTerm)) continue;
    }
    if (!dtechCatalogEligibility(course, candidate.grade_level, planWithAccepted, workspace.courses).eligible) continue;
    const prerequisite = evaluateDtechPlannerPrerequisites(
      course,
      { gradeLevel: candidate.grade_level, term: candidate.term },
      workspace.courses,
      planWithAccepted,
      workspace.plannedSmccdCourses,
      workspace.equivalencies
    );
    if (prerequisite.result.status === "blocked") continue;
    accepted.push({
      ...candidate,
      mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === candidate.course_id && mapping.confidence === "verified")
    });
  }

  // The standard flow is the first pass. Then fill remaining verified diploma
  // gaps with eligible catalog courses, preferring remembered interests.
  const currentGrade = Math.max(9, Math.min(12, Number(preferences.startGrade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level ?? 9))) as GradeLevel;
  const finalGrade = Math.max(currentGrade, Number(workspace.settings.plan_end_grade ?? 12)) as GradeLevel;
  const interestText = [...preferences.interests, ...workspace.memories
    .filter((memory) => memory.memory_key.includes("interest") || memory.tags.includes("schedule"))
    .map((memory) => memory.content)].join(" ").toLowerCase();
  const unfillableRequirementIds = new Set<string>();
  for (let pass = 0; pass < workspace.requirements.length * 4 && accepted.length < 24; pass += 1) {
    const planWithAccepted = [
      ...workspace.planCourses,
      ...accepted.map((row, index) => generatedPlanCourseRow(workspace, row, index))
    ];
    const progress = calculateRequirementProgress(workspace.requirements, planWithAccepted, workspace.mappings, workspace.courses, workspace.equivalencies);
    const gap = progress.find((item) => item.status === "missing" && !unfillableRequirementIds.has(item.requirement.id));
    if (!gap) break;
    const mappedIds = new Set(workspace.mappings
      .filter((mapping) => mapping.requirement_id === gap.requirement.id && mapping.confidence === "verified")
      .map((mapping) => mapping.course_id));
    const ranked = workspace.courses
      .filter((course) => mappedIds.has(course.id) && !planWithAccepted.some((row) => row.course_id === course.id))
      .map((course) => ({
        course,
        interestScore: interestText && [course.name, course.subject, course.description ?? ""].join(" ").toLowerCase().split(/\s+/).some((token) => token.length > 3 && interestText.includes(token)) ? 1 : 0
      }))
      .sort((left, right) => right.interestScore - left.interestScore
        || (effectiveRigor === "advanced" ? Number(right.course.is_weighted) - Number(left.course.is_weighted) : effectiveRigor === "lighter" ? Number(left.course.is_weighted) - Number(right.course.is_weighted) : 0)
        || left.course.name.localeCompare(right.course.name));
    let added = false;
    for (const { course } of ranked) {
      const grade = ([9, 10, 11, 12] as GradeLevel[]).find((candidateGrade) =>
        candidateGrade >= currentGrade && candidateGrade <= finalGrade && (!course.grade_levels.length || course.grade_levels.includes(candidateGrade))
      );
      if (!grade) continue;
      const load = (term: "fall" | "spring") => planWithAccepted.filter((row) => row.grade_level === grade && (row.term === term || row.term === "full_year")).length;
      const term: PlanCourse["term"] = course.term_type === "year" ? "full_year" : load("fall") <= load("spring") ? "fall" : "spring";
      if (effectiveMaxCoursesPerTerm) {
        const terms = term === "full_year" ? ["fall", "spring"] : [term];
        if (terms.some((candidateTerm) => load(candidateTerm as "fall" | "spring") >= effectiveMaxCoursesPerTerm)) continue;
      }
      if (!dtechCatalogEligibility(course, grade, planWithAccepted, workspace.courses).eligible) continue;
      const prerequisite = evaluateDtechPlannerPrerequisites(course, { gradeLevel: grade, term }, workspace.courses, planWithAccepted, workspace.plannedSmccdCourses, workspace.equivalencies);
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
  return accepted;
}

function analyzeGeneratedSchedule(
  workspace: AssistantWorkspace,
  generated: ReturnType<typeof generateSuggestedPlan>,
  preferences: { interests?: string[]; rigor?: "balanced" | "advanced" | "lighter" } = {}
) {
  const before = calculateRequirementProgress(
    workspace.requirements,
    workspace.planCourses,
    workspace.mappings,
    workspace.courses,
    workspace.equivalencies
  );
  const generatedRows: PlanCourse[] = generated.map((row, index) => generatedPlanCourseRow(workspace, row, index));
  const after = calculateRequirementProgress(
    workspace.requirements,
    [...workspace.planCourses, ...generatedRows],
    workspace.mappings,
    workspace.courses,
    workspace.equivalencies
  );
  const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
  const interestText = [...(preferences.interests ?? []), ...workspace.memories
    .filter((memory) => memory.memory_key.includes("interest") || memory.tags.includes("schedule"))
    .map((memory) => memory.content)].join(" ").toLowerCase();
  const beforeByRequirement = new Map(before.map((item) => [item.requirement.id, item]));
  const courses = generated.map((row) => {
    const generatedId = `generated:${row.course_id}`;
    const requirementEffects = after.flatMap((item) => {
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
    const catalogCourse = courseById.get(row.course_id);
    const preferenceMatch = Boolean(interestText && catalogCourse && [catalogCourse.name, catalogCourse.subject, catalogCourse.description ?? ""].join(" ").toLowerCase().split(/\s+/).some((token) => token.length > 3 && interestText.includes(token)));
    const rigorMatch = preferences.rigor === "advanced" && row.is_weighted
      ? " It matches the requested advanced rigor."
      : preferences.rigor === "lighter" && !row.is_weighted
        ? " It matches the requested lighter rigor."
        : "";
    const rationale = requirementEffects.length
      ? requirementEffects.map((effect) => `${effect.credits_added} verified ${effect.requirement} credits`).join("; ")
      : "Restores the standard d.tech grade-level flow; no additional verified graduation credit is claimed.";
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
  const existingByGrade = ([9, 10, 11, 12] as GradeLevel[]).map((grade) => ({
    grade_level: grade,
    course_count: workspace.planCourses.filter((row) => row.grade_level === grade).length
  }));
  const generatedByGrade = new Map<GradeLevel, typeof courses>();
  for (const course of courses) generatedByGrade.set(course.grade_level, [...(generatedByGrade.get(course.grade_level) ?? []), course]);
  const planByGrade = ([9, 10, 11, 12] as GradeLevel[]).map((grade) => ({
    grade_level: grade,
    existing: workspace.planCourses.filter((row) => row.grade_level === grade).map((row) => ({ name: courseDisplayName(row, courseById), term: row.term, status: row.status })),
    additions: (generatedByGrade.get(grade) ?? []).map((course) => ({ name: course.name, term: course.term, status: course.status, rationale: course.rationale }))
  }));
  return {
    terminology: "Current four-year plan means the active Done, In progress, and Planned courses shown in Courses.",
    existing_course_count: workspace.planCourses.length,
    existing_courses_retained: workspace.planCourses.length,
    existing_by_grade: existingByGrade,
    plan_by_grade: planByGrade,
    proposed_addition_count: courses.length,
    courses,
    graduation_coverage: {
      requirement_count: after.length,
      covered_before: before.filter((item) => item.status !== "missing").length,
      covered_after: after.filter((item) => item.status !== "missing").length,
      all_requirements_covered_after: remainingGaps.length === 0,
      remaining_gaps: remainingGaps
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
        plan: { id: workspace.plan.id, active_version_id: workspace.activeVersion.id, courses: planRows },
        graduation: calculated.graduationProgress.map((item) => ({
          area: item.requirement.area,
          requirement: item.requirement.name,
          required_credits: item.requirement.credits_required,
          completed_credits: item.completedCredits,
          projected_credits: item.verifiedProjectedCredits,
          status: item.status,
          warnings: item.ruleWarnings
        })),
        gpa: calculated.gpa,
        gpa_scenario: workspace.gpaScenarioChoices,
        degree_bookmarks: workspace.collegeGoals,
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
    const query = String(argumentsValue.query ?? "").trim().toLowerCase();
    const source = String(argumentsValue.source ?? "all");
    const targetGrade = Number(argumentsValue.grade_level ?? workspace.settings.grade_level ?? 9) as GradeLevel;
    const matches: Array<Record<string, unknown>> = [];
    if (source === "high_school" || source === "dtech" || source === "all") {
      const candidates = workspace.courses.filter((course) => [course.name, course.subject, course.course_code ?? ""].join(" ").toLowerCase().includes(query));
      for (const course of candidates) {
        if (!dtechCatalogEligibility(course, targetGrade, workspace.planCourses, workspace.courses).eligible) continue;
        const prerequisite = evaluateDtechPlannerPrerequisites(course, { gradeLevel: targetGrade, term: course.term_type === "semester" ? "fall" : "full_year" }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
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
      const searchTerm = String(argumentsValue.query ?? "").trim();
      const [codeResult, titleResult] = await Promise.all([
        supabase.from("smccd_courses").select("*").ilike("course_code", `%${searchTerm}%`).limit(8),
        supabase.from("smccd_courses").select("*").ilike("title", `%${searchTerm}%`).limit(10)
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
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);
    const generated = generateValidatedSchedule(workspace, policy, args.respect_recommended_limit, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, objectives: args.objectives });
    const analysis = analyzeGeneratedSchedule(workspace, generated, { interests: args.interests, rigor: args.rigor });
    return {
      summary: generated.length
        ? `Kept ${analysis.existing_courses_retained} existing courses and found ${generated.length} deterministic ${generated.length === 1 ? "addition" : "additions"} for the current four-year plan.`
        : `Evaluated the current four-year plan and found no additional flow courses that fit the open high-school years and selected college-unit preference.`,
      data: {
        respect_recommended_limit: args.respect_recommended_limit,
        requested_preferences: { interests: args.interests, rigor: args.rigor, max_courses_per_term: args.max_courses_per_term, start_grade: args.start_grade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level, objectives: args.objectives },
        remembered_preferences_considered: workspace.memories.filter((memory) => ["schedule_interests", "schedule_rigor", "max_courses_per_term"].includes(memory.memory_key)).map((memory) => memory.memory_key),
        provider: policy?.provider_name ?? null,
        recommended_max_units: policy?.recommended_max_units ?? null,
        absolute_max_units: policy?.absolute_max_units ?? null,
        ...analysis,
        boundary: "This completes the catalog-backed standard flow within the active planning years; it does not invent electives or prove section availability. Catalog, prerequisite, school approval, schedule, and seat verification still apply."
      }
    };
  }

  if (name === "get_prerequisite_evidence") {
    const args = toolArgumentSchemas.get_prerequisite_evidence.parse(argumentsValue);
    const gradeLevel = Math.max(9, Math.min(12, Number(workspace.settings.grade_level ?? 9))) as GradeLevel;
    const dtechCourse = workspace.courses.find((course) => course.id === args.course_id);
    if (dtechCourse) {
      const term = dtechCourse.term_type === "year" ? "full_year" : "fall";
      const evaluation = evaluateDtechPlannerPrerequisites(dtechCourse, { gradeLevel, term }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
      return {
        summary: `Read prerequisite evidence for ${dtechCourse.name}.`,
        data: { source: "d.tech", course: dtechCourse.name, official_prerequisites: dtechCourse.prerequisites, evaluated_for: { grade_level: gradeLevel, term }, evaluation: evaluation.result }
      };
    }
    const [courseResult, catalogResult] = await Promise.all([
      supabase.from("smccd_courses").select("*").eq("id", args.course_id).maybeSingle(),
      supabase.from("smccd_courses").select("*")
    ]);
    if (courseResult.error) throw new Error(courseResult.error.message);
    if (catalogResult.error) throw new Error(catalogResult.error.message);
    if (!courseResult.data) throw new Error("That course is not in the current d.tech or SMCCD catalog.");
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
    const catalogResults = await Promise.all(
      Array.from({ length: Math.ceil(optionCodes.length / 100) }, (_, index) => optionCodes.slice(index * 100, index * 100 + 100))
        .map((codes) => supabase.from("smccd_courses").select("*").in("course_code", codes))
    );
    const catalogError = catalogResults.find((result) => result.error)?.error;
    if (catalogError) throw new Error(catalogError.message);
    const catalogCourses = catalogResults.flatMap((result) => result.data ?? []) as unknown as SmccdCourse[];
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
            missing_summary: area.missingSummary
          })),
          separate_graduation_requirements: localDegreeProgress.graduationRequirements.map((requirement) => ({
            requirement: requirement.id,
            label: requirement.label,
            status: requirement.status,
            completed_course_codes: requirement.completedCourseCodes,
            projected_course_codes: requirement.projectedCourseCodes,
            manually_completed: requirement.manuallyCompleted,
            missing_summary: requirement.missingSummary
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
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);
    const available = generateValidatedSchedule(workspace, policy, args.respect_recommended_limit, { interests: args.interests, rigor: args.rigor, maxCoursesPerTerm: args.max_courses_per_term, startGrade: args.start_grade, objectives: args.objectives });
    const availableById = new Map(available.map((row) => [row.course_id, row]));
    const selected = args.course_ids.map((id) => availableById.get(id));
    if (selected.some((row) => !row)) throw new Error("One or more schedule suggestions are stale or no longer satisfy the plan rules. Generate the options again.");
    const selectedRows = selected as typeof available;
    const analysis = analyzeGeneratedSchedule(workspace, selectedRows, { interests: args.interests, rigor: args.rigor });
    const insertRows = selectedRows.map((row, index) => ({
      ...row,
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      sort_order: workspace.planCourses.length + index
    }));
    const { data, error } = await supabase.from("plan_courses").insert(insertRows).select("id");
    if (error) throw new Error(error.message);
    const insertedIds = (data ?? []).map((row) => row.id);
    const courseById = new Map(workspace.courses.map((course) => [course.id, course]));
    const courseNames = selectedRows.map((row) => courseById.get(row.course_id)?.name ?? "Course");
    return {
      summary: `Added ${courseNames.length} ${courseNames.length === 1 ? "course" : "courses"} to the current four-year plan; kept ${analysis.existing_courses_retained} existing ${analysis.existing_courses_retained === 1 ? "course" : "courses"}.`,
      data: {
        courses: courseNames,
        course_details: analysis.courses,
        existing_courses_retained: analysis.existing_courses_retained,
        graduation_coverage: analysis.graduation_coverage,
        graduation_coverage_after: analysis.graduation_coverage.all_requirements_covered_after
          ? `All ${analysis.graduation_coverage.requirement_count} tracked areas covered`
          : `${analysis.graduation_coverage.remaining_gaps.length} ${analysis.graduation_coverage.remaining_gaps.length === 1 ? "area" : "areas"} still open: ${analysis.graduation_coverage.remaining_gaps.map((gap) => gap.requirement).join(", ")}`,
        respect_recommended_limit: args.respect_recommended_limit,
        requested_preferences: { interests: args.interests, rigor: args.rigor, max_courses_per_term: args.max_courses_per_term, start_grade: args.start_grade ?? workspace.settings.plan_start_grade ?? workspace.settings.grade_level, objectives: args.objectives },
        remembered_preferences_considered: workspace.memories.filter((memory) => ["schedule_interests", "schedule_rigor", "max_courses_per_term"].includes(memory.memory_key)).map((memory) => memory.memory_key),
        planning_threshold_units: policy?.recommended_max_units ?? null,
        absolute_max_units: policy?.absolute_max_units ?? null
      },
      changed: { entity: "plan_course", id: insertedIds.join(",") },
      undo: { kind: "delete_rows", table: "plan_courses", ids: insertedIds, summary: "The generated course schedule was removed from the plan." }
    };
  }

  if (name === "add_dtech_course" || name === "add_high_school_course") {
    const args = toolArgumentSchemas[name].parse(argumentsValue);
    assertPlanningTermExists(args.grade_level, args.term);
    const course = workspace.courses.find((candidate) => candidate.id === args.course_id);
    if (!course) throw new Error(`That ${workspace.school.short_name} catalog course is no longer available.`);
    const eligibility = dtechCatalogEligibility(course, args.grade_level, workspace.planCourses, workspace.courses);
    if (!eligibility.eligible) throw new Error(eligibility.reason === "already_in_plan" ? "That course is already in the plan." : eligibility.reason === "outside_grade" ? `That course is not offered in grade ${args.grade_level}.` : "That course is below the math level already demonstrated in the plan.");
    const prerequisite = evaluateDtechPlannerPrerequisites(course, { gradeLevel: args.grade_level, term: args.term }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
    if (prerequisite.result.status === "blocked") throw new Error("The listed prerequisite is not satisfied for that placement.");
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
    if (prerequisite.result.status === "blocked") throw new Error("The listed SMCCD prerequisite is not satisfied for that placement.");
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
      notes: equivalency
        ? `${course.college_code} ${course.source_year} catalog. The reviewed d.tech equivalency chart lists ${equivalency.high_school_credits} high-school credits as ${equivalency.high_school_equivalent}. Confirm current approval, prerequisites, schedule, and transcript delivery.`
        : `${course.college_code} ${course.source_year} catalog. ${creditResolution.credits > 0 ? `${collegeUnits} college units are provisionally represented as ${creditResolution.credits} high-school credits for GPA calculations. ` : "High-school credit is unresolved. "}Verify schedule availability, prerequisites, d.tech approval, and transcript delivery.`,
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
        const eligibility = dtechCatalogEligibility(course, entry.grade_level, validationRows, workspace.courses);
        if (!eligibility.eligible) throw new Error(`${course.name} cannot be added: ${(eligibility.reason ?? "not eligible").replaceAll("_", " ")}.`);
        const prerequisite = evaluateDtechPlannerPrerequisites(course, { gradeLevel: entry.grade_level, term: entry.term }, workspace.courses, validationRows, [...workspace.plannedSmccdCourses, ...smccdCatalog], workspace.equivalencies);
        if (prerequisite.result.status === "blocked") throw new Error(`${course.name} has an unmet prerequisite for that placement.`);
        row = {
          ...base,
          course_id: course.id,
          credits: course.credits,
          college_units: course.college_units,
          is_weighted: course.is_weighted,
          mapping_verified: workspace.mappings.some((mapping) => mapping.course_id === course.id && mapping.confidence === "verified")
        };
        names.push(course.name);
      } else {
        const course = smccdById.get(entry.course_id)!;
        const indexByCourse = createSmccdPlanCourseIndex(validationRows, [...workspace.plannedSmccdCourses, ...smccdCatalog]);
        if (smccdCourseAlreadyInPlanIndex(course, indexByCourse)) throw new Error(`${course.course_code} is already represented in the plan.`);
        const prerequisite = evaluateSmccdPlannerPrerequisites(course, { gradeLevel: entry.grade_level, term: entry.term }, smccdCatalog, validationRows, workspace.courses);
        if (prerequisite.result.status === "blocked") throw new Error(`${course.course_code} has an unmet prerequisite for that placement.`);
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
          notes: equivalency
            ? `${course.college_code} ${course.source_year} catalog; verified d.tech equivalency: ${equivalency.high_school_equivalent}.`
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
        college_weighting: "Every SMCCD course is weighted for d.tech GPA.",
        college_credit_rule: "College units and d.tech high-school credits are calculated separately.",
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

  if (name === "update_plan_course") {
    const args = toolArgumentSchemas.update_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed course evidence must be corrected through transcript review.");
    const gradeLevel = args.grade_level ?? row.grade_level;
    const term = args.term ?? row.term;
    assertPlanningTermExists(gradeLevel, term);
    const dtechCourse = row.course_id ? workspace.courses.find((course) => course.id === row.course_id) : null;
    if (dtechCourse) {
      if (dtechCourse.grade_levels.length && !dtechCourse.grade_levels.includes(gradeLevel)) throw new Error(`That course is not offered in grade ${gradeLevel}.`);
      if (dtechCourse.term_type === "year" && term !== "full_year") throw new Error("That d.tech course is a full-year course.");
      const prerequisite = evaluateDtechPlannerPrerequisites(dtechCourse, { gradeLevel, term, instanceId: row.id }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
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
