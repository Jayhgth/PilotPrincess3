export type {
  Activity,
  CatalogReviewItem,
  Confidence,
  Course,
  CourseRequirementMapping,
  FourYearPlan,
  GraduationRequirement,
  GradeLevel,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SimulationConfig,
  SimulationResult,
  StudentProfile,
  TimelineTask
} from "@/lib/models";

export interface GeneratedSummary {
  id: string;
  user_id: string;
  plan_version_id: string | null;
  content: string;
  generation_source: "codex" | "fallback";
  created_at: string;
}
