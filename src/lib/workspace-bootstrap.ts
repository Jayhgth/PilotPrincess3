import type {
  CatalogReviewItem,
  CollegeDistrict,
  Course,
  CourseDesignation,
  CourseRequirementMapping,
  NearbyCollegeDistrict,
  EducationProvider,
  EnrollmentPolicy,
  FourYearPlan,
  GraduationRequirement,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentEnrollmentPreference,
  StudentCollegeDistrictPreference,
  StudentSmccdGoal,
  StudentSettings,
  SmccdPrerequisiteClearance
} from "@/lib/models";

interface StoredGpaScenarioChoice {
  plan_course_id: string;
  included: boolean;
  expected_grade: string | null;
}

export interface WorkspaceBootstrap {
  settings: StudentSettings | null;
  plan: FourYearPlan | null;
  school: School | null;
  active_version: PlanVersion | null;
  sources: OfficialSource[];
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  course_designations: CourseDesignation[];
  equivalencies: SmccdHighSchoolEquivalency[];
  review_items: CatalogReviewItem[];
  enrollment_policies: EnrollmentPolicy[];
  enrollment_preference: StudentEnrollmentPreference | null;
  college_district_preference: StudentCollegeDistrictPreference | null;
  college_district: CollegeDistrict | null;
  plan_courses: PlanCourse[];
  gpa_scenario_choices: StoredGpaScenarioChoice[];
  planned_smccd_courses: SmccdCourse[];
  degree_goals: StudentSmccdGoal[];
  degree_programs: SmccdProgram[];
  degree_requirements: SmccdProgramRequirement[];
  degree_requirement_courses: SmccdRequirementCourse[];
  is_admin: boolean;
}

export interface AssistantWorkspaceBootstrap extends WorkspaceBootstrap {
  transcript_sources: OfficialSource[];
  transcript_review_items: CatalogReviewItem[];
  prerequisite_clearances: SmccdPrerequisiteClearance[];
  manual_smccd_completions: Array<{
    college_code: SmccdCourse["college_code"];
    area: "7A" | "information_literacy";
  }>;
  memories: Array<{ memory_key: string; content: string; tags: string[] }>;
  nearby_providers: Array<{
    provider_id: string;
    provider_code: string;
    name: string;
    provider_type: EducationProvider["provider_type"];
    city: string | null;
    postal_code: string | null;
    website_url: string;
    distance_miles: number | null;
    relationship_type: string;
    confidence: string;
  }>;
  nearby_college_districts: NearbyCollegeDistrict[];
}

export function normalizeWorkspaceBootstrap(value: unknown): WorkspaceBootstrap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The workspace returned an invalid bootstrap response.");
  }
  const snapshot = value as Partial<WorkspaceBootstrap>;
  const requirements = Array.isArray(snapshot.requirements) ? snapshot.requirements : [];
  const planCourses = Array.isArray(snapshot.plan_courses) ? snapshot.plan_courses : [];
  const catalogVersionIds = new Set(requirements.map((requirement) => requirement.catalog_version_id).filter((id): id is string => Boolean(id)));
  const plannedCourseIds = new Set(planCourses.map((course) => course.course_id).filter((id): id is string => Boolean(id)));
  const rawCourses = Array.isArray(snapshot.courses) ? snapshot.courses : [];
  const courses = catalogVersionIds.size
    ? rawCourses.filter((course) => catalogVersionIds.has(course.catalog_version_id) || plannedCourseIds.has(course.id))
    : rawCourses;
  const courseIds = new Set(courses.map((course) => course.id));
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  return {
    settings: snapshot.settings ?? null,
    plan: snapshot.plan ?? null,
    school: snapshot.school ?? null,
    active_version: snapshot.active_version ?? null,
    enrollment_preference: snapshot.enrollment_preference ?? null,
    college_district_preference: snapshot.college_district_preference ?? null,
    college_district: snapshot.college_district ?? null,
    is_admin: snapshot.is_admin === true,
    sources: Array.isArray(snapshot.sources) ? snapshot.sources : [],
    courses,
    requirements,
    mappings: Array.isArray(snapshot.mappings) ? snapshot.mappings.filter((mapping) => courseIds.has(mapping.course_id) && requirementIds.has(mapping.requirement_id)) : [],
    course_designations: Array.isArray(snapshot.course_designations) ? snapshot.course_designations : [],
    equivalencies: Array.isArray(snapshot.equivalencies) ? snapshot.equivalencies : [],
    review_items: Array.isArray(snapshot.review_items) ? snapshot.review_items : [],
    enrollment_policies: Array.isArray(snapshot.enrollment_policies) ? snapshot.enrollment_policies : [],
    plan_courses: planCourses,
    gpa_scenario_choices: Array.isArray(snapshot.gpa_scenario_choices) ? snapshot.gpa_scenario_choices : [],
    planned_smccd_courses: Array.isArray(snapshot.planned_smccd_courses) ? snapshot.planned_smccd_courses : [],
    degree_goals: Array.isArray(snapshot.degree_goals) ? snapshot.degree_goals : [],
    degree_programs: Array.isArray(snapshot.degree_programs) ? snapshot.degree_programs : [],
    degree_requirements: Array.isArray(snapshot.degree_requirements) ? snapshot.degree_requirements : [],
    degree_requirement_courses: Array.isArray(snapshot.degree_requirement_courses) ? snapshot.degree_requirement_courses : []
  };
}

export function normalizeAssistantWorkspaceBootstrap(value: unknown): AssistantWorkspaceBootstrap {
  const workspace = normalizeWorkspaceBootstrap(value);
  const snapshot = value as Partial<AssistantWorkspaceBootstrap>;
  return {
    ...workspace,
    transcript_sources: Array.isArray(snapshot.transcript_sources) ? snapshot.transcript_sources : [],
    transcript_review_items: Array.isArray(snapshot.transcript_review_items) ? snapshot.transcript_review_items : [],
    prerequisite_clearances: Array.isArray(snapshot.prerequisite_clearances) ? snapshot.prerequisite_clearances : [],
    manual_smccd_completions: Array.isArray(snapshot.manual_smccd_completions) ? snapshot.manual_smccd_completions : [],
    memories: Array.isArray(snapshot.memories) ? snapshot.memories : [],
    nearby_providers: Array.isArray(snapshot.nearby_providers) ? snapshot.nearby_providers : [],
    nearby_college_districts: Array.isArray(snapshot.nearby_college_districts) ? snapshot.nearby_college_districts : [],
    college_district_preference: snapshot.college_district_preference ?? null
  };
}
