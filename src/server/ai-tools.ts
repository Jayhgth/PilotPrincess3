import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSmccdPlanCourseIndex, dtechCatalogEligibility, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
import type {
  Activity,
  Course,
  CourseRequirementMapping,
  FourYearPlan,
  GradeLevel,
  GraduationRequirement,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  StudentSmccdGoal,
  StudentProfile,
  TimelineTask
} from "@/lib/models";
import {
  calculateGpa,
  calculateRequirementProgress,
  calculateWorkload,
  courseDisplayName,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  requirementsForProfile,
  schoolYearForGrade,
  simulatePlan
} from "@/lib/planning";
import { evaluateDtechPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
import { normalizeCollegeCourseCode } from "@/lib/transcript";

const courseStatusSchema = z.enum(["current", "planned"]);
const termSchema = z.enum(["fall", "spring", "summer", "full_year"]);
const gradeSchema = z.union([z.literal(9), z.literal(10), z.literal(11), z.literal(12)]);
const timelineCategorySchema = z.enum(["academics", "activities", "college", "summer", "admin"]);
const activityKindSchema = z.enum(["club", "athletics", "service", "work", "family", "internship", "other"]);
const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable();

const toolArgumentSchemas = {
  get_student_overview: z.object({}),
  list_plan_courses: z.object({ status: z.enum(["completed", "current", "planned", "all"]).default("all") }),
  search_course_catalog: z.object({
    query: z.string().trim().min(1).max(80),
    source: z.enum(["dtech", "smccd", "all"]).default("all"),
    grade_level: gradeSchema.optional()
  }),
  get_graduation_progress: z.object({}),
  get_next_steps: z.object({}),
  get_experiences: z.object({ active_only: z.boolean().default(false) }),
  get_student_profile: z.object({}),
  get_transcript_sources: z.object({}),
  get_college_goal: z.object({}),
  run_load_check: z.object({
    college_units: z.number().min(0).max(18),
    activity_hours_change: z.number().min(-80).max(80)
  }),
  add_dtech_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema
  }),
  add_smccd_course: z.object({
    course_id: z.uuid(),
    status: courseStatusSchema,
    grade_level: gradeSchema,
    term: termSchema
  }),
  move_plan_course: z.object({
    plan_course_id: z.uuid(),
    status: z.enum(["completed", "current", "planned"])
  }),
  remove_plan_course: z.object({ plan_course_id: z.uuid() }),
  update_plan_course: z.object({
    plan_course_id: z.uuid(),
    grade_level: gradeSchema.optional(),
    term: termSchema.optional(),
    letter_grade: optionalText(12).optional(),
    notes: optionalText(1200).optional()
  }).refine((value) => Object.keys(value).some((key) => key !== "plan_course_id"), "Provide at least one course field to update."),
  update_student_profile: z.object({
    preferred_name: z.string().trim().min(1).max(120).optional(),
    academic_interests: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    career_interest_areas: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    work_values: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    exploration_questions: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
    major_direction: z.string().trim().min(1).max(120).optional(),
    career_direction: z.string().trim().max(240).optional(),
    goal_intensity: z.enum(["lower_stress", "balanced", "competitive"]).optional(),
    workload_tolerance: z.enum(["light", "balanced", "high"]).optional(),
    stress_level: z.number().int().min(1).max(5).optional(),
    weekly_commitment_limit: z.number().min(1).max(80).nullable().optional()
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one profile field to update."),
  add_experience: z.object({
    name: z.string().trim().min(1).max(180),
    kind: activityKindSchema,
    role: optionalText(180).default(null),
    organization: optionalText(180).default(null),
    weekly_hours: z.number().min(0).max(80),
    weeks_per_year: z.number().min(0).max(52).nullable().default(null),
    start_grade: gradeSchema.nullable().default(null),
    end_grade: gradeSchema.nullable().default(null),
    description: optionalText(1200).default(null),
    impact: optionalText(1200).default(null),
    is_active: z.boolean().default(true)
  }),
  update_experience: z.object({
    experience_id: z.uuid(),
    name: z.string().trim().min(1).max(180).optional(),
    kind: activityKindSchema.optional(),
    role: optionalText(180).optional(),
    organization: optionalText(180).optional(),
    weekly_hours: z.number().min(0).max(80).optional(),
    weeks_per_year: z.number().min(0).max(52).nullable().optional(),
    start_grade: gradeSchema.nullable().optional(),
    end_grade: gradeSchema.nullable().optional(),
    description: optionalText(1200).optional(),
    impact: optionalText(1200).optional(),
    is_active: z.boolean().optional()
  }).refine((value) => Object.keys(value).some((key) => key !== "experience_id"), "Provide at least one experience field to update."),
  remove_experience: z.object({ experience_id: z.uuid() }),
  add_next_step: z.object({
    title: z.string().trim().min(1).max(240),
    category: timelineCategorySchema,
    due_label: z.string().trim().max(160).nullable().default(null)
  }),
  complete_next_step: z.object({ task_id: z.uuid() }),
  update_next_step: z.object({
    task_id: z.uuid(),
    title: z.string().trim().min(1).max(240).optional(),
    category: timelineCategorySchema.optional(),
    due_label: optionalText(160).optional(),
    is_completed: z.boolean().optional()
  }).refine((value) => Object.keys(value).some((key) => key !== "task_id"), "Provide at least one next-step field to update."),
  remove_next_step: z.object({ task_id: z.uuid() }),
  set_college_goal: z.object({ program_id: z.string().trim().min(1).max(180), notes: z.string().trim().max(1200).default("") }),
  clear_college_goal: z.object({ program_id: z.string().trim().min(1).max(180) })
} as const;

export type AssistantToolName = keyof typeof toolArgumentSchemas;

export const ASSISTANT_TOOL_CATALOG: ReadonlyArray<{
  name: AssistantToolName;
  mutatesData: boolean;
  description: string;
  arguments: string;
}> = [
  { name: "get_student_overview", mutatesData: false, description: "Read the current student profile, graduation, GPA, workload, and course-count summary.", arguments: "{}" },
  { name: "list_plan_courses", mutatesData: false, description: "List courses already in the active plan, with stable IDs and Done/In progress/Planned state.", arguments: '{"status":"completed|current|planned|all"}' },
  { name: "search_course_catalog", mutatesData: false, description: "Search eligible d.tech and/or SMCCD catalog courses. Returns stable course IDs needed for add-course requests.", arguments: '{"query":"string","source":"dtech|smccd|all","grade_level":9|10|11|12}' },
  { name: "get_graduation_progress", mutatesData: false, description: "Read requirement-by-requirement completed, scheduled, and remaining credit evidence.", arguments: "{}" },
  { name: "get_next_steps", mutatesData: false, description: "Read open graduation gaps and saved next-step tasks.", arguments: "{}" },
  { name: "get_experiences", mutatesData: false, description: "Read the student's factual experience register and recorded weekly hours.", arguments: '{"active_only":boolean}' },
  { name: "get_student_profile", mutatesData: false, description: "Read planning preferences, interests, direction, stress, and capacity inputs.", arguments: "{}" },
  { name: "get_transcript_sources", mutatesData: false, description: "Read transcript source labels and review state. Transcript evidence remains read-only in chat.", arguments: "{}" },
  { name: "get_college_goal", mutatesData: false, description: "Read the selected SMCCD associate-degree goal.", arguments: "{}" },
  { name: "run_load_check", mutatesData: false, description: "Run the deterministic current-versus-proposed workload check without saving a scenario.", arguments: '{"college_units":number,"activity_hours_change":number}' },
  { name: "add_dtech_course", mutatesData: true, description: "Propose adding one verified d.tech catalog course to In progress or Planned. The student must confirm.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "add_smccd_course", mutatesData: true, description: "Propose adding one SMCCD catalog course to In progress or Planned. The student must confirm.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "move_plan_course", mutatesData: true, description: "Propose moving an editable plan course between Done, In progress, and Planned. Transcript-backed courses cannot move.", arguments: '{"plan_course_id":"uuid","status":"completed|current|planned"}' },
  { name: "remove_plan_course", mutatesData: true, description: "Propose removing an editable course from the active plan. Transcript-backed courses cannot be removed.", arguments: '{"plan_course_id":"uuid"}' },
  { name: "update_plan_course", mutatesData: true, description: "Propose editing the placement, grade, or notes of an unlocked plan course.", arguments: '{"plan_course_id":"uuid","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","letter_grade":"string|null","notes":"string|null"}' },
  { name: "update_student_profile", mutatesData: true, description: "Propose changing the student's planning preferences, interests, direction, stress, or weekly capacity.", arguments: "Only include fields the student explicitly requested." },
  { name: "add_experience", mutatesData: true, description: "Propose adding a factual experience and its workload evidence.", arguments: '{"name":"string","kind":"club|athletics|service|work|family|internship|other","weekly_hours":number,...}' },
  { name: "update_experience", mutatesData: true, description: "Propose editing one saved experience by experience_id.", arguments: '{"experience_id":"uuid",...changed fields}' },
  { name: "remove_experience", mutatesData: true, description: "Propose removing one saved experience.", arguments: '{"experience_id":"uuid"}' },
  { name: "add_next_step", mutatesData: true, description: "Propose adding one student-owned next step. The student must confirm.", arguments: '{"title":"string","category":"academics|activities|college|summer|admin","due_label":"string|null"}' },
  { name: "complete_next_step", mutatesData: true, description: "Propose completing one saved next step. The student must confirm.", arguments: '{"task_id":"uuid"}' },
  { name: "update_next_step", mutatesData: true, description: "Propose editing a saved next step.", arguments: '{"task_id":"uuid",...changed fields}' },
  { name: "remove_next_step", mutatesData: true, description: "Propose removing a student-created next step. Generated requirement gaps cannot be deleted here.", arguments: '{"task_id":"uuid"}' },
  { name: "set_college_goal", mutatesData: true, description: "Propose selecting one SMCCD AA or AS program as the primary college goal.", arguments: '{"program_id":"string","notes":"string"}' },
  { name: "clear_college_goal", mutatesData: true, description: "Propose removing a selected SMCCD degree goal.", arguments: '{"program_id":"string"}' }
];

export function assistantToolCatalogPrompt() {
  return ASSISTANT_TOOL_CATALOG.map((tool) => [
    `- ${tool.name}${tool.mutatesData ? " (requires student confirmation)" : " (read-only)"}`,
    `  ${tool.description}`,
    `  Arguments: ${tool.arguments}`
  ].join("\n")).join("\n");
}

export function assistantToolLabel(name: string) {
  return ({
    get_student_overview: "Read student overview",
    list_plan_courses: "Read course plan",
    search_course_catalog: "Search course catalogs",
    get_graduation_progress: "Check graduation progress",
    get_next_steps: "Read next steps",
    get_experiences: "Read experiences",
    get_student_profile: "Read planning preferences",
    get_transcript_sources: "Read transcript sources",
    get_college_goal: "Read college goal",
    run_load_check: "Run load check",
    add_dtech_course: "Add d.tech course",
    add_smccd_course: "Add SMCCD course",
    move_plan_course: "Move course",
    remove_plan_course: "Remove course",
    update_plan_course: "Update course",
    update_student_profile: "Update planning preferences",
    add_experience: "Add experience",
    update_experience: "Update experience",
    remove_experience: "Remove experience",
    add_next_step: "Add next step",
    complete_next_step: "Complete next step",
    update_next_step: "Update next step",
    remove_next_step: "Remove next step",
    set_college_goal: "Set college goal",
    clear_college_goal: "Clear college goal"
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
  profile: StudentProfile;
  plan: FourYearPlan;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  activities: Activity[];
  tasks: TimelineTask[];
  plannedSmccdCourses: SmccdCourse[];
  sources: OfficialSource[];
  collegeGoals: StudentSmccdGoal[];
}

function firstError(results: ReadonlyArray<{ error: { message: string } | null }>) {
  return results.find((result) => result.error)?.error ?? null;
}

async function loadAssistantWorkspace(supabase: SupabaseClient, userId: string): Promise<AssistantWorkspace> {
  const [profileResult, planResult, courseResult, requirementResult, mappingResult, equivalencyResult, activityResult, taskResult, sourceResult, goalResult] = await Promise.all([
    supabase.from("student_profiles").select("*").eq("id", userId).single(),
    supabase.from("four_year_plans").select("*").eq("user_id", userId).eq("is_active", true).single(),
    supabase.from("courses").select("*").eq("review_status", "approved").order("subject").order("name"),
    supabase.from("graduation_requirements").select("*").eq("review_status", "approved").order("name"),
    supabase.from("course_requirement_mappings").select("*"),
    supabase.from("smccd_high_school_equivalencies").select("*"),
    supabase.from("activities").select("*").eq("user_id", userId).order("created_at"),
    supabase.from("timeline_tasks").select("*").eq("user_id", userId).order("is_completed").order("due_date"),
    supabase.from("official_sources").select("*").eq("user_id", userId).eq("document_type", "transcript").order("created_at", { ascending: false }),
    supabase.from("student_smccd_goals").select("*").eq("user_id", userId).order("is_primary", { ascending: false })
  ]);
  const error = firstError([profileResult, planResult, courseResult, requirementResult, mappingResult, equivalencyResult, activityResult, taskResult, sourceResult, goalResult]);
  if (error) throw new Error(error.message);

  const plan = planResult.data as unknown as FourYearPlan;
  const versionResult = await supabase.from("plan_versions").select("*").eq("plan_id", plan.id).eq("kind", "active").single();
  if (versionResult.error) throw new Error(versionResult.error.message);
  const activeVersion = versionResult.data as unknown as PlanVersion;
  const planCourseResult = await supabase.from("plan_courses").select("*").eq("plan_version_id", activeVersion.id).order("grade_level").order("sort_order");
  if (planCourseResult.error) throw new Error(planCourseResult.error.message);
  const planCourses = (planCourseResult.data ?? []) as unknown as PlanCourse[];
  const plannedSmccdIds = [...new Set(planCourses.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
  const smccdResult = plannedSmccdIds.length
    ? await supabase.from("smccd_courses").select("*").in("id", plannedSmccdIds)
    : { data: [], error: null };
  if (smccdResult.error) throw new Error(smccdResult.error.message);

  const rawProfile = profileResult.data as unknown as StudentProfile;
  return {
    profile: {
      ...rawProfile,
      career_interest_areas: rawProfile.career_interest_areas ?? [],
      work_values: rawProfile.work_values ?? [],
      exploration_questions: rawProfile.exploration_questions ?? []
    },
    plan,
    activeVersion,
    planCourses,
    courses: (courseResult.data ?? []) as unknown as Course[],
    requirements: (requirementResult.data ?? []) as unknown as GraduationRequirement[],
    mappings: (mappingResult.data ?? []) as unknown as CourseRequirementMapping[],
    equivalencies: (equivalencyResult.data ?? []) as unknown as SmccdHighSchoolEquivalency[],
    activities: (activityResult.data ?? []) as unknown as Activity[],
    tasks: (taskResult.data ?? []) as unknown as TimelineTask[],
    plannedSmccdCourses: (smccdResult.data ?? []) as unknown as SmccdCourse[],
    sources: (sourceResult.data ?? []) as unknown as OfficialSource[],
    collegeGoals: (goalResult.data ?? []) as unknown as StudentSmccdGoal[]
  };
}

function calculatedWorkspace(workspace: AssistantWorkspace) {
  const tracked = requirementsForProfile(workspace.requirements, workspace.profile);
  const progress = calculateRequirementProgress(tracked, workspace.planCourses, workspace.mappings, workspace.courses, workspace.equivalencies);
  return {
    progress,
    gpa: calculateGpa(workspace.planCourses),
    workload: calculateWorkload(workspace.profile, workspace.planCourses, workspace.courses, workspace.activities)
  };
}

export interface AssistantToolResult {
  summary: string;
  data: unknown;
  changed?: { entity: string; id: string };
}

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
        student: {
          preferred_name: workspace.profile.preferred_name,
          grade_level: workspace.profile.grade_level,
          graduation_year: workspace.profile.graduation_year,
          major_direction: workspace.profile.major_direction,
          academic_interests: workspace.profile.academic_interests
        },
        graduation: {
          completed_percent: overallCompletedPercent(calculated.progress),
          projected_percent: overallGraduationPercent(calculated.progress),
          open_areas: calculated.progress.filter((item) => item.status === "missing").map((item) => item.requirement.name)
        },
        gpa: calculated.gpa,
        workload: calculated.workload,
        course_counts: courseCounts
      }
    };
  }

  if (name === "list_plan_courses") {
    const status = String(argumentsValue.status ?? "all");
    const rows = workspace.planCourses
      .filter((row) => status === "all" || row.status === status)
      .map((row) => {
        const smccd = row.smccd_course_id ? workspace.plannedSmccdCourses.find((course) => course.id === row.smccd_course_id) : null;
        return {
          plan_course_id: row.id,
          course_id: row.course_id ?? row.smccd_course_id,
          name: courseDisplayName(row, courseMap),
          source: smccd?.college_code ?? (row.smccd_course_id ? "SMCCD" : "d.tech"),
          status: row.status,
          grade_level: row.grade_level,
          term: row.term,
          letter_grade: row.letter_grade,
          transcript_locked: Boolean(row.source_review_item_id)
        };
      });
    return { summary: `Read ${rows.length} courses from the active plan.`, data: rows };
  }

  if (name === "search_course_catalog") {
    const query = String(argumentsValue.query ?? "").trim().toLowerCase();
    const source = String(argumentsValue.source ?? "all");
    const targetGrade = Number(argumentsValue.grade_level ?? workspace.profile.grade_level ?? 9) as GradeLevel;
    const matches: Array<Record<string, unknown>> = [];
    if (source === "dtech" || source === "all") {
      const candidates = workspace.courses.filter((course) => [course.name, course.subject, course.course_code ?? ""].join(" ").toLowerCase().includes(query));
      for (const course of candidates) {
        if (!dtechCatalogEligibility(course, targetGrade, workspace.planCourses, workspace.courses).eligible) continue;
        const prerequisite = evaluateDtechPlannerPrerequisites(course, { gradeLevel: targetGrade, term: course.term_type === "semester" ? "fall" : "full_year" }, workspace.courses, workspace.planCourses, workspace.plannedSmccdCourses, workspace.equivalencies);
        if (prerequisite.result.status === "blocked") continue;
        matches.push({
          source: "d.tech",
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
    const data = calculated.progress.map((item) => ({
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

  if (name === "get_next_steps") {
    return {
      summary: "Read current requirement gaps and saved next steps.",
      data: {
        requirement_gaps: calculated.progress.filter((item) => item.status === "missing").map((item) => ({
          area: item.requirement.name,
          remaining_credits: Math.max(0, item.requirement.credits_required - item.verifiedProjectedCredits)
        })),
        tasks: workspace.tasks.filter((task) => !task.is_completed).map((task) => ({
          task_id: task.id,
          title: task.title,
          category: task.category,
          due: task.due_label ?? task.due_date,
          generated: task.is_generated
        }))
      }
    };
  }

  if (name === "get_experiences") {
    const activeOnly = argumentsValue.active_only === true;
    const data = workspace.activities.filter((activity) => !activeOnly || activity.is_active).map((activity) => ({
      experience_id: activity.id,
      name: activity.name,
      type: activity.kind,
      role: activity.role,
      organization: activity.organization,
      weekly_hours: activity.weekly_hours,
      active: activity.is_active,
      contribution_or_growth: activity.impact
    }));
    return { summary: `Read ${data.length} recorded experiences.`, data };
  }

  if (name === "get_student_profile") {
    return {
      summary: "Read the current planning preferences.",
      data: {
        preferred_name: workspace.profile.preferred_name,
        grade_level: workspace.profile.grade_level,
        graduation_year: workspace.profile.graduation_year,
        academic_interests: workspace.profile.academic_interests,
        career_interest_areas: workspace.profile.career_interest_areas,
        work_values: workspace.profile.work_values,
        exploration_questions: workspace.profile.exploration_questions,
        major_direction: workspace.profile.major_direction,
        career_direction: workspace.profile.career_direction,
        planning_priority: workspace.profile.goal_intensity,
        workload_tolerance: workspace.profile.workload_tolerance,
        stress_level: workspace.profile.stress_level,
        weekly_commitment_limit: workspace.profile.weekly_commitment_limit
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

  if (name === "get_college_goal") {
    if (!workspace.collegeGoals.length) return { summary: "No SMCCD degree goal is selected.", data: [] };
    const programIds = workspace.collegeGoals.map((goal) => goal.program_id);
    const { data: programs, error } = await supabase.from("smccd_programs").select("id, college_code, title, award_type, source_year").in("id", programIds);
    if (error) throw new Error(error.message);
    const programMap = new Map((programs ?? []).map((program) => [program.id, program]));
    const data = workspace.collegeGoals.map((goal) => ({ ...goal, program: programMap.get(goal.program_id) ?? null }));
    return { summary: `Read ${data.length} selected college ${data.length === 1 ? "goal" : "goals"}.`, data };
  }

  if (name === "run_load_check") {
    const args = toolArgumentSchemas.run_load_check.parse(argumentsValue);
    const result = simulatePlan({ collegeUnits: args.college_units, activityHoursChange: args.activity_hours_change }, workspace.profile, calculated.progress, calculated.gpa, calculated.workload);
    return { summary: "Ran the deterministic load check without changing the saved plan.", data: result };
  }

  throw new Error(`${assistantToolLabel(name)} is not a read-only tool.`);
}

export async function executeAssistantMutationTool(
  supabase: SupabaseClient,
  userId: string,
  name: AssistantToolName,
  argumentsValue: Record<string, unknown>
): Promise<AssistantToolResult> {
  const workspace = await loadAssistantWorkspace(supabase, userId);

  if (name === "add_dtech_course") {
    const args = toolArgumentSchemas.add_dtech_course.parse(argumentsValue);
    const course = workspace.courses.find((candidate) => candidate.id === args.course_id);
    if (!course) throw new Error("That d.tech catalog course is no longer available.");
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
      school_year: schoolYearForGrade(workspace.profile.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
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
    return { summary: `${course.name} was added to ${args.status === "current" ? "In progress" : "Planned"}.`, data: { course: course.name, status: args.status, grade_level: args.grade_level }, changed: { entity: "plan_course", id: data.id } };
  }

  if (name === "add_smccd_course") {
    const args = toolArgumentSchemas.add_smccd_course.parse(argumentsValue);
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
    const { data, error } = await supabase.from("plan_courses").insert({
      plan_version_id: workspace.activeVersion.id,
      user_id: userId,
      smccd_course_id: course.id,
      custom_course_name: `${course.course_code} ${course.title}`,
      grade_level: args.grade_level,
      school_year: schoolYearForGrade(workspace.profile.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
      term: args.term,
      status: args.status,
      credits: equivalency?.high_school_credits ?? 0,
      college_units: Number(course.units_max ?? course.units_min),
      is_weighted: true,
      mapping_verified: Boolean(equivalency),
      user_edited: true,
      notes: equivalency
        ? `${course.college_code} ${course.source_year} catalog. The reviewed d.tech equivalency chart lists ${equivalency.high_school_credits} high-school credits as ${equivalency.high_school_equivalent}. Confirm current approval, prerequisites, schedule, and transcript delivery.`
        : `${course.college_code} ${course.source_year} catalog. Verify schedule availability, prerequisites, d.tech approval, and transcript delivery.`,
      requirement_area_override: equivalency?.requirement_area ?? null,
      sort_order: workspace.planCourses.length
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { summary: `${course.course_code} ${course.title} was added to ${args.status === "current" ? "In progress" : "Planned"}.`, data: { course_code: course.course_code, status: args.status, grade_level: args.grade_level, equivalency_verified: Boolean(equivalency) }, changed: { entity: "plan_course", id: data.id } };
  }

  if (name === "move_plan_course") {
    const args = toolArgumentSchemas.move_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed Done courses cannot be moved.");
    const patch = planCourseMovePatch(workspace.profile, row, args.status, workspace.planCourses.filter((candidate) => candidate.status === args.status).length);
    if (!patch) throw new Error("That course cannot be moved.");
    const { error } = await supabase.from("plan_courses").update({ ...patch, user_edited: true }).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { summary: `The course was moved to ${args.status === "completed" ? "Done" : args.status === "current" ? "In progress" : "Planned"}.`, data: { plan_course_id: row.id, status: args.status }, changed: { entity: "plan_course", id: row.id } };
  }

  if (name === "remove_plan_course") {
    const args = toolArgumentSchemas.remove_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed courses must be corrected through transcript review and cannot be removed here.");
    const { error } = await supabase.from("plan_courses").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    return { summary: "The course was removed from the active plan.", data: { plan_course_id: row.id }, changed: { entity: "plan_course", id: row.id } };
  }

  if (name === "update_plan_course") {
    const args = toolArgumentSchemas.update_plan_course.parse(argumentsValue);
    const row = workspace.planCourses.find((candidate) => candidate.id === args.plan_course_id);
    if (!row) throw new Error("That course is no longer in the active plan.");
    if (row.source_review_item_id) throw new Error("Transcript-backed course evidence must be corrected through transcript review.");
    const gradeLevel = args.grade_level ?? row.grade_level;
    const term = args.term ?? row.term;
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
      patch.school_year = schoolYearForGrade(workspace.profile.graduation_year ?? new Date().getFullYear() + 3, args.grade_level);
    }
    if (args.term !== undefined) patch.term = args.term;
    if (args.letter_grade !== undefined) patch.letter_grade = args.letter_grade;
    if (args.notes !== undefined) patch.notes = args.notes;
    const { error } = await supabase.from("plan_courses").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { summary: "The course details were updated.", data: { plan_course_id: row.id, ...patch }, changed: { entity: "plan_course", id: row.id } };
  }

  if (name === "update_student_profile") {
    const args = toolArgumentSchemas.update_student_profile.parse(argumentsValue);
    const { error } = await supabase.from("student_profiles").update(args).eq("id", userId);
    if (error) throw new Error(error.message);
    return { summary: "Planning preferences were updated.", data: args, changed: { entity: "student_profile", id: userId } };
  }

  if (name === "add_experience") {
    const args = toolArgumentSchemas.add_experience.parse(argumentsValue);
    const { data, error } = await supabase.from("activities").insert({ user_id: userId, ...args }).select("id").single();
    if (error) throw new Error(error.message);
    return { summary: `${args.name} was added to Experiences.`, data: args, changed: { entity: "activity", id: data.id } };
  }

  if (name === "update_experience") {
    const args = toolArgumentSchemas.update_experience.parse(argumentsValue);
    const activity = workspace.activities.find((candidate) => candidate.id === args.experience_id);
    if (!activity) throw new Error("That experience no longer exists.");
    const { experience_id: _id, ...patch } = args;
    const { error } = await supabase.from("activities").update(patch).eq("id", activity.id);
    if (error) throw new Error(error.message);
    return { summary: `${args.name ?? activity.name} was updated.`, data: { experience_id: activity.id, ...patch }, changed: { entity: "activity", id: activity.id } };
  }

  if (name === "remove_experience") {
    const args = toolArgumentSchemas.remove_experience.parse(argumentsValue);
    const activity = workspace.activities.find((candidate) => candidate.id === args.experience_id);
    if (!activity) throw new Error("That experience no longer exists.");
    const { error } = await supabase.from("activities").delete().eq("id", activity.id);
    if (error) throw new Error(error.message);
    return { summary: `${activity.name} was removed from Experiences.`, data: { experience_id: activity.id }, changed: { entity: "activity", id: activity.id } };
  }

  if (name === "add_next_step") {
    const args = toolArgumentSchemas.add_next_step.parse(argumentsValue);
    const { data, error } = await supabase.from("timeline_tasks").insert({
      user_id: userId,
      plan_version_id: workspace.activeVersion.id,
      title: args.title,
      category: args.category,
      due_label: args.due_label,
      is_generated: false
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { summary: `${args.title} was added to Next steps.`, data: { title: args.title, category: args.category, due_label: args.due_label }, changed: { entity: "timeline_task", id: data.id } };
  }

  if (name === "complete_next_step") {
    const args = toolArgumentSchemas.complete_next_step.parse(argumentsValue);
    const task = workspace.tasks.find((candidate) => candidate.id === args.task_id);
    if (!task) throw new Error("That next step no longer exists.");
    const { error } = await supabase.from("timeline_tasks").update({ is_completed: true }).eq("id", task.id);
    if (error) throw new Error(error.message);
    return { summary: `${task.title} was marked complete.`, data: { task_id: task.id, title: task.title }, changed: { entity: "timeline_task", id: task.id } };
  }

  if (name === "update_next_step") {
    const args = toolArgumentSchemas.update_next_step.parse(argumentsValue);
    const task = workspace.tasks.find((candidate) => candidate.id === args.task_id);
    if (!task) throw new Error("That next step no longer exists.");
    if (task.is_generated) throw new Error("Generated requirement steps update from the plan and cannot be edited directly.");
    const { task_id: _id, ...patch } = args;
    const { error } = await supabase.from("timeline_tasks").update(patch).eq("id", task.id);
    if (error) throw new Error(error.message);
    return { summary: `${args.title ?? task.title} was updated.`, data: { task_id: task.id, ...patch }, changed: { entity: "timeline_task", id: task.id } };
  }

  if (name === "remove_next_step") {
    const args = toolArgumentSchemas.remove_next_step.parse(argumentsValue);
    const task = workspace.tasks.find((candidate) => candidate.id === args.task_id);
    if (!task) throw new Error("That next step no longer exists.");
    if (task.is_generated) throw new Error("Generated requirement steps update from the plan and cannot be deleted directly.");
    const { error } = await supabase.from("timeline_tasks").delete().eq("id", task.id);
    if (error) throw new Error(error.message);
    return { summary: `${task.title} was removed from Next steps.`, data: { task_id: task.id }, changed: { entity: "timeline_task", id: task.id } };
  }

  if (name === "set_college_goal") {
    const args = toolArgumentSchemas.set_college_goal.parse(argumentsValue);
    const programResult = await supabase.from("smccd_programs").select("id, title, award_type, college_code").eq("id", args.program_id).single();
    if (programResult.error || !programResult.data) throw new Error("That SMCCD degree program is no longer available.");
    const clearResult = await supabase.from("student_smccd_goals").update({ is_primary: false }).eq("user_id", userId).eq("is_primary", true);
    if (clearResult.error) throw new Error(clearResult.error.message);
    const { data, error } = await supabase.from("student_smccd_goals").upsert({ user_id: userId, program_id: args.program_id, is_primary: true, notes: args.notes }, { onConflict: "user_id,program_id" }).select("id").single();
    if (error) throw new Error(error.message);
    return { summary: `${programResult.data.title} was selected as the primary college goal.`, data: { ...programResult.data, notes: args.notes }, changed: { entity: "student_smccd_goal", id: data.id } };
  }

  if (name === "clear_college_goal") {
    const args = toolArgumentSchemas.clear_college_goal.parse(argumentsValue);
    const goal = workspace.collegeGoals.find((candidate) => candidate.program_id === args.program_id);
    if (!goal) throw new Error("That college goal is not currently selected.");
    const { error } = await supabase.from("student_smccd_goals").delete().eq("id", goal.id);
    if (error) throw new Error(error.message);
    return { summary: "The selected college goal was removed.", data: { program_id: args.program_id }, changed: { entity: "student_smccd_goal", id: goal.id } };
  }

  throw new Error(`${assistantToolLabel(name)} is not a mutating tool.`);
}
