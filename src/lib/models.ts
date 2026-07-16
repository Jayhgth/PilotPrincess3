export type Confidence = "verified" | "likely" | "uncertain";
type ReviewStatus = "pending" | "approved" | "rejected";
export type CourseStatus = "completed" | "current" | "planned";
export type GradeLevel = 9 | 10 | 11 | 12;
export type RequirementArea =
  | "english"
  | "social_science"
  | "math"
  | "lab_science"
  | "world_language"
  | "design_lab"
  | "visual_performing_arts"
  | "personal_development"
  | "physical_education"
  | "career_technical_education"
  | "electives"
  | "ethnic_studies"
  | "other";

export interface School {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  website_url: string | null;
  source_year: string | null;
  cds_code: string | null;
  nces_district_id: string | null;
  nces_school_id: string | null;
  district_name: string | null;
  district_cds_code: string | null;
  district_website_url: string | null;
  academic_authority_key: string | null;
  county_name: string | null;
  governance_type: "district" | "charter" | "private" | "other";
  charter_number: string | null;
  status: "active" | "pending" | "closed" | "merged";
  school_type: string | null;
  low_grade: number | null;
  high_grade: number | null;
  street_address: string | null;
  city: string | null;
  state_code: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  uc_ag_institution_id: string | null;
  uc_ag_atp_code: string | null;
  uc_ag_directory_updated_at: string | null;
  directory_source_url: string | null;
  directory_updated_at: string | null;
}

export type CollegeCoursePosture = "integrated" | "supplemental" | "explicit_only";

export interface SchoolPlanningGradeRule {
  minimum_high_school_courses: number;
  target_total_courses: number;
  required_areas: RequirementArea[];
  preferred_course_names: string[];
}

export interface SchoolPlanningProfile {
  id: string;
  school_id: string;
  academic_year: string;
  title: string;
  source_urls: string[];
  status: "verified" | "needs_review" | "retired";
  college_course_posture: CollegeCoursePosture;
  college_eligible_grades: GradeLevel[];
  always_high_school_areas: RequirementArea[];
  grade_rules: Partial<Record<`${GradeLevel}`, SchoolPlanningGradeRule>>;
  guidance_notes: string[];
  created_at: string;
  updated_at: string;
}

export interface StudentSettings {
  id: string;
  school_id: string | null;
  preferred_name: string;
  age: number | null;
  grade_level: number | null;
  graduation_year: number | null;
  school_confirmed: boolean;
  school_selected_at: string | null;
  onboarding_complete: boolean;
  ai_enabled: boolean;
  ai_model: "gpt-5.6-luna" | "gpt-5.5" | "gpt-5.4-mini";
  ai_reasoning_effort: "low" | "medium" | "high";
  ui_theme: "light" | "dark";
  ai_connection_approved_at: string | null;
  ai_setup_tested_at: string | null;
  plan_start_grade: GradeLevel | null;
  plan_end_grade: GradeLevel | null;
  tracker_mode: "full" | "selected";
  tracked_requirement_areas: RequirementArea[];
}

export interface CourseDesignation {
  id: string;
  course_id: string;
  designation: "ap" | "ib" | "uc_honors" | "school_honors" | "cte" | "dual_enrollment";
  source_url: string | null;
  source_year: string | null;
  confidence: Confidence;
  review_status: ReviewStatus;
}

export interface EducationProvider {
  id: string;
  provider_code: string;
  provider_type: "community_college" | "university" | "roc_program" | "online_program";
  district_name: string | null;
  name: string;
  website_url: string;
  street_address: string | null;
  city: string | null;
  state_code: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  status: "active" | "inactive";
  source_url: string;
  source_updated_at: string | null;
}

export interface CollegeDistrict {
  district_code: string;
  name: string;
  website_url: string | null;
  policy_provider_code: string | null;
  status: "active" | "inactive";
  source_url: string;
  source_updated_at: string | null;
}

export interface StudentCollegeDistrictPreference {
  user_id: string;
  district_code: string;
  selection_method: "suggested" | "student" | "pilot";
  school_id_at_selection: string | null;
  updated_at: string;
}

export interface NearbyCollegeDistrict {
  district_code: string;
  district_name: string;
  colleges_count: number;
  nearest_distance_miles: number | null;
  providers: Array<Pick<EducationProvider, "id" | "provider_code" | "name" | "website_url" | "city" | "postal_code"> & {
    distance_miles: number | null;
  }>;
  is_recommended: boolean;
}

export interface SharedDataProposal {
  id: string;
  submitted_by: string;
  submitted_via: "student" | "pilot" | "admin";
  entity_type: "school" | "course" | "course_mapping" | "requirement" | "provider" | "provider_link" | "policy" | "source";
  action: "create" | "correct" | "retire";
  school_id: string | null;
  target_table: string;
  target_id: string | null;
  proposed_payload: Record<string, unknown>;
  evidence_url: string | null;
  evidence_summary: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfficialSource {
  id: string;
  school_id: string;
  user_id: string | null;
  title: string;
  kind: "official_url" | "upload" | "pasted_text" | "screenshot";
  source_url: string | null;
  storage_path: string | null;
  raw_text: string | null;
  mime_type: string | null;
  source_year: string | null;
  is_official: boolean;
  parse_status: "pending" | "processing" | "complete" | "needs_review" | "failed";
  confidence: Confidence;
  error_message: string | null;
  document_type: "general" | "transcript" | "course_catalog" | "graduation_requirements";
  created_at: string;
}

export interface Course {
  id: string;
  external_course_id?: string | null;
  school_id: string;
  catalog_version_id: string;
  source_id: string | null;
  course_code: string | null;
  name: string;
  subject: string;
  course_type: string;
  grade_levels: number[];
  credits: number | null;
  college_units: number | null;
  term_type: "semester" | "year" | "variable";
  uc_ag_area: string | null;
  prerequisites: string[];
  description: string | null;
  is_honors: boolean;
  is_weighted: boolean;
  confidence: Confidence;
  review_status: ReviewStatus;
}

export interface GraduationRequirement {
  id: string;
  requirement_key?: string;
  school_id?: string;
  catalog_version_id?: string;
  area: RequirementArea;
  name: string;
  credits_required: number;
  years_required: number | null;
  constraint_only?: boolean;
  notes: string | null;
  confidence: Confidence;
  review_status: ReviewStatus;
}

export interface CourseRequirementMapping {
  id: string;
  course_id: string;
  requirement_id: string;
  confidence: Confidence;
  is_user_override: boolean;
}

export interface FourYearPlan {
  id: string;
  user_id: string;
  school_id: string;
  title: string;
  is_active: boolean;
}

export interface PlanVersion {
  id: string;
  plan_id: string;
  user_id: string;
  label: string;
  kind: "active" | "snapshot" | "simulation";
  generation_config: Record<string, unknown>;
  ai_summary: string | null;
  created_at: string;
}

export interface PlanCourse {
  id: string;
  plan_version_id: string;
  user_id: string;
  course_id: string | null;
  custom_course_name: string | null;
  grade_level: GradeLevel;
  school_year: string;
  term: "fall" | "spring" | "summer" | "full_year";
  status: CourseStatus;
  credits: number | null;
  college_units: number | null;
  letter_grade: string | null;
  is_weighted: boolean;
  mapping_verified: boolean;
  user_edited: boolean;
  notes: string | null;
  sort_order: number;
  source_review_item_id: string | null;
  smccd_course_id: string | null;
  college_provider_code?: string | null;
  requirement_area_override: RequirementArea | null;
}

export interface SmccdCollege {
  code: "CSM" | "SKY" | "CAN";
  name: string;
  catalog_year: string;
  courses_url: string;
  programs_url: string;
  concurrent_enrollment_url: string;
}

export interface SmccdCourse {
  id: string;
  college_code: SmccdCollege["code"];
  course_code: string;
  subject: string;
  course_number: string;
  title: string;
  units_min: number;
  units_max: number | null;
  degree_applicable: boolean;
  transfer_credit: "CSU" | "UC" | "CSU/UC" | null;
  attributes: string[];
  prerequisites: string[];
  corequisites: string[];
  recommended_preparation: string[];
  detail_status: "verified" | "partial" | "unavailable";
  degree_applicability_source: "course_detail" | "number_heuristic";
  catalog_url: string;
  source_year: string;
}

export interface SmccdPrerequisiteClearance {
  id: string;
  user_id: string;
  target_course_id: string;
  clearance_type: "placement" | "approved_equivalency" | "prerequisite_challenge" | "instructor_approval" | "program_admission" | "audition_or_portfolio";
  status: "approved" | "pending" | "denied";
  verification_status: "pending" | "approved" | "rejected";
  authority: string;
  evidence_summary: string | null;
  decided_at: string | null;
  expires_at: string | null;
  source_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export interface SmccdHighSchoolEquivalency {
  normalized_course_code: string;
  college_course_code: string;
  description: string;
  college_units: number;
  high_school_credits: number;
  high_school_equivalent: string;
  requirement_area: RequirementArea;
  pairing_note: string | null;
  source_id: string;
  confidence: Confidence;
}

export interface SmccdProgram {
  id: string;
  college_code: SmccdCollege["code"];
  program_code: string;
  title: string;
  award_type: "AA" | "AS";
  total_degree_units: number;
  total_major_units_text: string;
  catalog_url: string;
  source_year: string;
}

export interface SmccdProgramRequirement {
  id: string;
  program_id: string;
  label: string;
  kind: "all" | "choose_units" | "choose_count" | "or_group" | "text_rule";
  min_units: number | null;
  min_count: number | null;
  raw_text: string | null;
  constraint_only: boolean;
  sort_order: number;
}

export interface SmccdRequirementCourse {
  id: string;
  requirement_id: string;
  course_code: string;
  units_text: string;
  note: string | null;
}

export interface StudentSmccdGoal {
  id: string;
  user_id: string;
  program_id: string;
  is_primary: boolean;
  notes: string;
}

export interface EnrollmentPolicy {
  id: string;
  provider_code: string;
  provider_name: string;
  program_type: "concurrent" | "dual";
  term: "fall" | "spring" | "summer" | "any";
  unit_system: "semester" | "quarter";
  recommended_max_units: number;
  fee_free_max_units: number;
  absolute_max_units: number;
  approval_required: boolean;
  source_url: string;
  source_label: string;
  source_year: string;
  notes: string | null;
  confidence: Confidence;
}

export interface StudentEnrollmentPreference {
  user_id: string;
  provider_code: string;
  program_type: EnrollmentPolicy["program_type"];
  limit_mode: "recommended";
  custom_unit_limit: null;
  respect_recommended_limit: boolean;
  updated_at: string;
}

export interface AiConversation {
  id: string;
  user_id: string;
  title: string;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  turn_id: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  page_context: Record<string, unknown>;
  created_at: string;
  attachments?: AiMessageAttachment[];
}

interface AiMessageAttachment {
  id: string;
  conversation_id: string;
  message_id: string;
  user_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  preview_url: string;
  created_at: string;
}

export interface AiEvent {
  id: number;
  conversation_id: string;
  user_id: string;
  turn_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AiToolCall {
  id: string;
  conversation_id: string;
  user_id: string;
  turn_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  explanation: string;
  mutates_data: boolean;
  status: "running" | "pending_confirmation" | "completed" | "failed" | "rejected";
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
}

export interface CatalogReviewItem {
  id: string;
  user_id: string;
  source_id: string;
  entity_type: "course" | "requirement" | "policy" | "source_note" | "transcript_course" | "transcript_note";
  proposed_payload: Record<string, unknown>;
  corrected_payload: Record<string, unknown> | null;
  status: ReviewStatus;
  confidence: Confidence;
  uncertainty_notes: string[];
  created_at: string;
}

export interface RequirementProgress {
  requirement: GraduationRequirement;
  completedCredits: number;
  currentCredits: number;
  plannedCredits: number;
  verifiedProjectedCredits: number;
  unverifiedCredits: number;
  percent: number;
  status: "complete" | "on_track" | "missing";
  ruleWarnings: string[];
  contributions: RequirementCourseEvidence[];
  unusedCourses: RequirementCourseEvidence[];
  unverifiedCourses: RequirementCourseEvidence[];
}

export interface RequirementCourseEvidence {
  planCourseId: string;
  courseName: string;
  status: CourseStatus;
  creditsApplied: number;
  creditsAvailable: number;
  gradeLevel: GradeLevel;
  institution: "high_school" | "dtech" | "smccd" | SmccdCollege["code"];
  note: string | null;
}

export interface GpaSummary {
  currentUnweighted: number | null;
  currentWeighted: number | null;
  currentGradedCredits: number;
  currentWeightedCredits: number;
  projectedUnweighted: number | null;
  projectedWeighted: number | null;
  gradedCredits: number;
  weightedCredits: number;
  passCredits: number;
  isEstimate: true;
}
