import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSmccdPlanCourseIndex, dtechCatalogEligibility, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
import type {
  CatalogReviewItem,
  Course,
  CourseRequirementMapping,
  EnrollmentPolicy,
  FourYearPlan,
  GradeLevel,
  GraduationRequirement,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGoal,
  StudentEnrollmentPreference,
  StudentSettings,
  TimelineTask
} from "@/lib/models";
import {
  calculateGpa,
  calculateRequirementProgress,
  courseDisplayName,
  dtechGradePoint,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  requirementsForSettings,
  schoolYearForGrade
} from "@/lib/planning";
import { calculateSmccdProgramProgress } from "@/lib/smccd";
import { evaluateDtechPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
import { normalizeCollegeCourseCode } from "@/lib/transcript";
import { buildTranscriptAudit } from "@/server/assistant-audits";
import { defaultEnrollmentPreference, evaluateEnrollmentSchedule, policyForPreference } from "@/lib/enrollment-policy";
import { evaluateGpaScenario } from "@/lib/gpa-planner";

const courseStatusSchema = z.enum(["current", "planned"]);
const termSchema = z.enum(["fall", "spring", "summer", "full_year"]);
const gradeSchema = z.union([z.literal(9), z.literal(10), z.literal(11), z.literal(12)]);
const timelineCategorySchema = z.enum(["academics", "activities", "college", "summer", "admin"]);
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
  get_enrollment_constraints: z.object({}),
  get_plan_versions: z.object({}),
  get_degree_progress: z.object({}),
  get_college_goal: z.object({}),
  save_plan_snapshot: z.object({
    label: z.string().trim().min(1).max(80).optional()
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
  remove_plan_courses: z.object({
    plan_course_ids: z.array(z.uuid()).min(1).max(40)
      .refine((ids) => new Set(ids).size === ids.length, "Course IDs must be unique.")
  }),
  update_plan_course: z.object({
    plan_course_id: z.uuid(),
    grade_level: gradeSchema.optional(),
    term: termSchema.optional(),
    letter_grade: optionalText(12).optional(),
    notes: optionalText(1200).optional()
  }).refine((value) => Object.keys(value).some((key) => key !== "plan_course_id"), "Provide at least one course field to update."),
  update_enrollment_preference: z.object({
    program_type: z.enum(["concurrent", "dual"]),
    limit_mode: z.enum(["recommended", "fee_free", "absolute", "custom"]),
    custom_unit_limit: z.number().min(0.5).max(30).nullable().default(null)
  }),
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
  { name: "get_student_overview", mutatesData: false, description: "Read the current graduation, GPA, and course-count summary.", arguments: "{}" },
  { name: "list_plan_courses", mutatesData: false, description: "List courses already in the active plan, with stable IDs and Done/In progress/Planned state.", arguments: '{"status":"completed|current|planned|all"}' },
  { name: "search_course_catalog", mutatesData: false, description: "Search eligible d.tech and/or SMCCD catalog courses. Returns stable course IDs needed for add-course requests.", arguments: '{"query":"string","source":"dtech|smccd|all","grade_level":9|10|11|12}' },
  { name: "get_graduation_progress", mutatesData: false, description: "Read requirement-by-requirement completed, scheduled, and remaining credit evidence.", arguments: "{}" },
  { name: "get_next_steps", mutatesData: false, description: "Read open graduation gaps and saved next-step tasks.", arguments: "{}" },
  { name: "get_transcript_sources", mutatesData: false, description: "Read transcript source labels and review state. Transcript evidence remains read-only in chat.", arguments: "{}" },
  { name: "get_student_data_inventory", mutatesData: false, description: "Read a compact inventory of the current student's available records so the assistant can choose the correct evidence tool.", arguments: "{}" },
  { name: "audit_transcript_data", mutatesData: false, description: "Compare transcript source text, parsed rows, review decisions, catalog identities, and imported plan rows. Use source text for an actual extraction audit; never treat a graduation gap as a parsing error.", arguments: '{"include_source_text":boolean}' },
  { name: "get_gpa_evidence", mutatesData: false, description: "Read course-level GPA inclusion, weighting, points, and exclusion evidence for the current or projected calculation.", arguments: '{"scope":"current|projected"}' },
  { name: "evaluate_gpa_scenario", mutatesData: false, description: "Evaluate grade assumptions for courses already in the saved schedule, including its all-A ceiling. This cannot predict grades or invent a new schedule.", arguments: '{"target_weighted_gpa":number,"choices":[{"plan_course_id":"uuid","included":boolean,"expected_grade":"A|B|C|D|F|null"}]}' },
  { name: "get_enrollment_constraints", mutatesData: false, description: "Read source-backed concurrent or dual-enrollment limits and evaluate the saved college schedule by term.", arguments: "{}" },
  { name: "get_plan_versions", mutatesData: false, description: "Read active and saved plan versions with labels, creation dates, and course counts.", arguments: "{}" },
  { name: "get_degree_progress", mutatesData: false, description: "Read deterministic requirement-level evidence for the selected SMCCD associate-degree goal.", arguments: "{}" },
  { name: "get_college_goal", mutatesData: false, description: "Read the selected SMCCD associate-degree goal.", arguments: "{}" },
  { name: "save_plan_snapshot", mutatesData: true, description: "Propose saving a read-only copy of the active course plan before a larger change.", arguments: '{"label":"optional short label"}' },
  { name: "add_dtech_course", mutatesData: true, description: "Propose adding one verified d.tech catalog course to In progress or Planned. The selected review route must approve it.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "add_smccd_course", mutatesData: true, description: "Propose adding one SMCCD catalog course to In progress or Planned. The selected review route must approve it.", arguments: '{"course_id":"uuid","status":"current|planned","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year"}' },
  { name: "move_plan_course", mutatesData: true, description: "Propose moving an editable plan course between Done, In progress, and Planned. Transcript-backed courses cannot move.", arguments: '{"plan_course_id":"uuid","status":"completed|current|planned"}' },
  { name: "remove_plan_course", mutatesData: true, description: "Propose removing an editable course from the active plan. Transcript-backed courses cannot be removed.", arguments: '{"plan_course_id":"uuid"}' },
  { name: "remove_plan_courses", mutatesData: true, description: "Propose removing an exact set of editable courses from the active plan in one atomic request. Use this for all/every bulk removal requests after listing the matching plan courses.", arguments: '{"plan_course_ids":["uuid"]}' },
  { name: "update_plan_course", mutatesData: true, description: "Propose editing the placement, grade, or notes of an unlocked plan course.", arguments: '{"plan_course_id":"uuid","grade_level":9|10|11|12,"term":"fall|spring|summer|full_year","letter_grade":"string|null","notes":"string|null"}' },
  { name: "update_enrollment_preference", mutatesData: true, description: "Propose changing the student's SMCCD concurrent- or dual-enrollment unit guardrail. Source-backed limits are revalidated when the change runs.", arguments: '{"program_type":"concurrent|dual","limit_mode":"recommended|fee_free|absolute|custom","custom_unit_limit":number|null}' },
  { name: "add_next_step", mutatesData: true, description: "Propose adding one student-owned next step. The selected review route must approve it.", arguments: '{"title":"string","category":"academics|activities|college|summer|admin","due_label":"string|null"}' },
  { name: "complete_next_step", mutatesData: true, description: "Propose completing one saved next step. The selected review route must approve it.", arguments: '{"task_id":"uuid"}' },
  { name: "update_next_step", mutatesData: true, description: "Propose editing a saved next step.", arguments: '{"task_id":"uuid",...changed fields}' },
  { name: "remove_next_step", mutatesData: true, description: "Propose removing a student-created next step. Generated requirement gaps cannot be deleted here.", arguments: '{"task_id":"uuid"}' },
  { name: "set_college_goal", mutatesData: true, description: "Propose selecting one SMCCD AA or AS program as the primary college goal.", arguments: '{"program_id":"string","notes":"string"}' },
  { name: "clear_college_goal", mutatesData: true, description: "Propose removing a selected SMCCD degree goal.", arguments: '{"program_id":"string"}' }
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
    list_plan_courses: "Read course plan",
    search_course_catalog: "Search course catalogs",
    get_graduation_progress: "Check graduation progress",
    get_next_steps: "Read next steps",
    get_transcript_sources: "Read transcript sources",
    get_student_data_inventory: "Inventory student records",
    audit_transcript_data: "Audit transcript evidence",
    get_gpa_evidence: "Read GPA evidence",
    evaluate_gpa_scenario: "Evaluate GPA scenario",
    get_enrollment_constraints: "Check college-unit limits",
    get_plan_versions: "Read plan versions",
    get_degree_progress: "Read degree progress",
    get_college_goal: "Read college goal",
    save_plan_snapshot: "Save plan snapshot",
    add_dtech_course: "Add d.tech course",
    add_smccd_course: "Add SMCCD course",
    move_plan_course: "Move course",
    remove_plan_course: "Remove course",
    remove_plan_courses: "Remove courses",
    update_plan_course: "Update course",
    update_enrollment_preference: "Update enrollment guardrail",
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
  settings: StudentSettings;
  plan: FourYearPlan;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  tasks: TimelineTask[];
  plannedSmccdCourses: SmccdCourse[];
  sources: OfficialSource[];
  transcriptReviewItems: CatalogReviewItem[];
  collegeGoals: StudentSmccdGoal[];
  enrollmentPolicies: EnrollmentPolicy[];
  enrollmentPreference: StudentEnrollmentPreference;
}

function firstError(results: ReadonlyArray<{ error: { message: string } | null }>) {
  return results.find((result) => result.error)?.error ?? null;
}

async function loadAssistantWorkspace(supabase: SupabaseClient, userId: string): Promise<AssistantWorkspace> {
  const [settingsResult, planResult, courseResult, requirementResult, mappingResult, equivalencyResult, taskResult, sourceResult, reviewResult, goalResult, policyResult, preferenceResult] = await Promise.all([
    supabase.from("student_settings").select("*").eq("id", userId).single(),
    supabase.from("four_year_plans").select("*").eq("user_id", userId).eq("is_active", true).single(),
    supabase.from("courses").select("*").eq("review_status", "approved").order("subject").order("name"),
    supabase.from("graduation_requirements").select("*").eq("review_status", "approved").order("name"),
    supabase.from("course_requirement_mappings").select("*"),
    supabase.from("smccd_high_school_equivalencies").select("*"),
    supabase.from("timeline_tasks").select("*").eq("user_id", userId).order("is_completed").order("due_date"),
    supabase.from("official_sources").select("*").eq("user_id", userId).eq("document_type", "transcript").order("created_at", { ascending: false }),
    supabase.from("catalog_review_items").select("*").eq("user_id", userId).in("entity_type", ["transcript_course", "transcript_note"]).order("created_at"),
    supabase.from("student_smccd_goals").select("*").eq("user_id", userId).order("is_primary", { ascending: false }),
    supabase.from("enrollment_policies").select("*").order("provider_code").order("program_type"),
    supabase.from("student_enrollment_preferences").select("*").eq("user_id", userId).eq("provider_code", "SMCCD").maybeSingle()
  ]);
  const error = firstError([settingsResult, planResult, courseResult, requirementResult, mappingResult, equivalencyResult, taskResult, sourceResult, reviewResult, goalResult, policyResult, preferenceResult]);
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

  return {
    settings: settingsResult.data as unknown as StudentSettings,
    plan,
    activeVersion,
    planCourses,
    courses: (courseResult.data ?? []) as unknown as Course[],
    requirements: (requirementResult.data ?? []) as unknown as GraduationRequirement[],
    mappings: (mappingResult.data ?? []) as unknown as CourseRequirementMapping[],
    equivalencies: (equivalencyResult.data ?? []) as unknown as SmccdHighSchoolEquivalency[],
    tasks: (taskResult.data ?? []) as unknown as TimelineTask[],
    plannedSmccdCourses: (smccdResult.data ?? []) as unknown as SmccdCourse[],
    sources: (sourceResult.data ?? []) as unknown as OfficialSource[],
    transcriptReviewItems: (reviewResult.data ?? []) as unknown as CatalogReviewItem[],
    collegeGoals: (goalResult.data ?? []) as unknown as StudentSmccdGoal[],
    enrollmentPolicies: (policyResult.data ?? []) as unknown as EnrollmentPolicy[],
    enrollmentPreference: preferenceResult.data
      ? preferenceResult.data as unknown as StudentEnrollmentPreference
      : defaultEnrollmentPreference(userId)
  };
}

function calculatedWorkspace(workspace: AssistantWorkspace) {
  const tracked = requirementsForSettings(workspace.requirements, workspace.settings);
  const progress = calculateRequirementProgress(tracked, workspace.planCourses, workspace.mappings, workspace.courses, workspace.equivalencies);
  return {
    progress,
    gpa: calculateGpa(workspace.planCourses)
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
        student: { grade_level: workspace.settings.grade_level, graduation_year: workspace.settings.graduation_year },
        graduation: {
          completed_percent: overallCompletedPercent(calculated.progress),
          projected_percent: overallGraduationPercent(calculated.progress),
          open_areas: calculated.progress.filter((item) => item.status === "missing").map((item) => item.requirement.name)
        },
        gpa: calculated.gpa,
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
    const targetGrade = Number(argumentsValue.grade_level ?? workspace.settings.grade_level ?? 9) as GradeLevel;
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
        active_plan: { course_count: workspace.planCourses.length, completed_count: completed, transcript_imported_count: imported },
        graduation: { requirement_count: calculated.progress.length },
        gpa: { graded_credits: calculated.gpa.gradedCredits, pass_credits: calculated.gpa.passCredits },
        transcript: {
          source_count: workspace.sources.length,
          parsed_course_row_count: workspace.transcriptReviewItems.filter((item) => item.entity_type === "transcript_course").length,
          pending_review_count: workspace.transcriptReviewItems.filter((item) => item.entity_type === "transcript_course" && item.status === "pending").length
        },
        next_steps: { count: workspace.tasks.length, open_count: workspace.tasks.filter((task) => !task.is_completed).length },
        college_goal: { selected: workspace.collegeGoals.length > 0 },
        enrollment_guardrail: { provider: workspace.enrollmentPreference.provider_code, program_type: workspace.enrollmentPreference.program_type, limit_mode: workspace.enrollmentPreference.limit_mode },
        available_detail_tools: [
          "list_plan_courses",
          "get_graduation_progress",
          "get_gpa_evidence",
          "evaluate_gpa_scenario",
          "get_enrollment_constraints",
          "audit_transcript_data",
          "get_plan_versions",
          "get_next_steps",
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
        const credits = Number(row.credits ?? 0);
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
        policy: "A- and other plus/minus variants use the base letter value. SMCCD and other college rows are weighted. Pass grades earn credit but no GPA points.",
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
      args.target_weighted_gpa
    );
    return {
      summary: "Evaluated the selected saved-schedule GPA assumptions without changing student data.",
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

  if (name === "get_enrollment_constraints") {
    const policy = policyForPreference(workspace.enrollmentPolicies, workspace.enrollmentPreference);
    if (!policy) return { summary: "No enrollment policy matches the saved provider and program.", data: null };
    const terms = evaluateEnrollmentSchedule(workspace.planCourses, policy, workspace.enrollmentPreference);
    return {
      summary: `Checked ${terms.length} open college ${terms.length === 1 ? "term" : "terms"} against ${policy.provider_name} limits.`,
      data: {
        provider: policy.provider_name,
        program_type: policy.program_type,
        selected_limit_mode: workspace.enrollmentPreference.limit_mode,
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

  if (name === "get_plan_versions") {
    const { data: versions, error: versionError } = await supabase
      .from("plan_versions")
      .select("*")
      .eq("plan_id", workspace.plan.id)
      .order("created_at", { ascending: false });
    if (versionError) throw new Error(versionError.message);
    const versionRows = (versions ?? []) as unknown as PlanVersion[];
    const versionIds = versionRows.map((version) => version.id);
    const courseResult = versionIds.length
      ? await supabase.from("plan_courses").select("plan_version_id").eq("user_id", userId).in("plan_version_id", versionIds)
      : { data: [], error: null };
    if (courseResult.error) throw new Error(courseResult.error.message);
    const counts = new Map<string, number>();
    for (const row of courseResult.data ?? []) counts.set(row.plan_version_id, (counts.get(row.plan_version_id) ?? 0) + 1);
    const data = versionRows.map((version) => ({
      version_id: version.id,
      label: version.label,
      kind: version.kind,
      course_count: counts.get(version.id) ?? 0,
      created_at: version.created_at,
      has_ai_summary: Boolean(version.ai_summary)
    }));
    return { summary: `Read ${data.length} plan ${data.length === 1 ? "version" : "versions"}.`, data };
  }

  if (name === "get_degree_progress") {
    const primaryGoal = workspace.collegeGoals.find((goal) => goal.is_primary) ?? workspace.collegeGoals[0];
    if (!primaryGoal) return { summary: "No SMCCD degree goal is selected.", data: null };
    const [programResult, requirementResult] = await Promise.all([
      supabase.from("smccd_programs").select("*").eq("id", primaryGoal.program_id).single(),
      supabase.from("smccd_program_requirements").select("*").eq("program_id", primaryGoal.program_id).order("sort_order")
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
    const progress = calculateSmccdProgramProgress(program, requirements, options, workspace.planCourses, [...courseMapById.values()]);
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
          manual_review_reason: item.manualReviewReason
        })),
        boundary: "This is parsed major-requirement evidence, not final degree eligibility. General education, residency, substitutions, and counselor approval remain separate."
      }
    };
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

  throw new Error(`${assistantToolLabel(name)} is not a read-only tool.`);
}

export async function executeAssistantMutationTool(
  supabase: SupabaseClient,
  userId: string,
  name: AssistantToolName,
  argumentsValue: Record<string, unknown>
): Promise<AssistantToolResult> {
  const workspace = await loadAssistantWorkspace(supabase, userId);

  if (name === "save_plan_snapshot") {
    const args = toolArgumentSchemas.save_plan_snapshot.parse(argumentsValue);
    const label = args.label ?? `Snapshot ${new Date().toLocaleDateString("en-US")}`;
    const { data: snapshot, error } = await supabase.from("plan_versions").insert({
      plan_id: workspace.plan.id,
      user_id: userId,
      label,
      kind: "snapshot",
      generation_config: { source_version_id: workspace.activeVersion.id, created_by: "pilot_assistant" }
    }).select("id").single();
    if (error) throw new Error(error.message);
    if (workspace.planCourses.length > 0) {
      const copies = workspace.planCourses.map(({ id: _id, ...row }) => ({
        ...row,
        plan_version_id: snapshot.id
      }));
      const copyResult = await supabase.from("plan_courses").insert(copies);
      if (copyResult.error) {
        await supabase.from("plan_versions").delete().eq("id", snapshot.id);
        throw new Error(copyResult.error.message);
      }
    }
    return {
      summary: `${label} was saved.`,
      data: { label, course_count: workspace.planCourses.length },
      changed: { entity: "plan_version", id: snapshot.id }
    };
  }

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
      college_provider_code: "SMCCD",
      custom_course_name: `${course.course_code} ${course.title}`,
      grade_level: args.grade_level,
      school_year: schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level),
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
    const patch = planCourseMovePatch(workspace.settings, row, args.status, workspace.planCourses.filter((candidate) => candidate.status === args.status).length);
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
      changed: { entity: "plan_courses", id: args.plan_course_ids.join(",") }
    };
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
      patch.school_year = schoolYearForGrade(workspace.settings.graduation_year ?? new Date().getFullYear() + 3, args.grade_level);
    }
    if (args.term !== undefined) patch.term = args.term;
    if (args.letter_grade !== undefined) patch.letter_grade = args.letter_grade;
    if (args.notes !== undefined) patch.notes = args.notes;
    const { error } = await supabase.from("plan_courses").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { summary: "The course details were updated.", data: { plan_course_id: row.id, ...patch }, changed: { entity: "plan_course", id: row.id } };
  }

  if (name === "update_enrollment_preference") {
    const args = toolArgumentSchemas.update_enrollment_preference.parse(argumentsValue);
    const policy = workspace.enrollmentPolicies.find((candidate) => candidate.provider_code === "SMCCD" && candidate.program_type === args.program_type);
    if (!policy) throw new Error("No source-backed SMCCD policy matches that enrollment type.");
    if (args.limit_mode === "custom" && args.custom_unit_limit === null) throw new Error("A custom guardrail needs a unit limit.");
    if (args.custom_unit_limit !== null && args.custom_unit_limit > policy.absolute_max_units) {
      throw new Error(`The custom guardrail cannot exceed the published ${policy.absolute_max_units}-unit maximum.`);
    }
    const customMaxUnits = args.limit_mode === "custom" ? args.custom_unit_limit : null;
    const { data, error } = await supabase.from("student_enrollment_preferences").upsert({
      user_id: userId,
      provider_code: "SMCCD",
      program_type: args.program_type,
      limit_mode: args.limit_mode,
      custom_unit_limit: customMaxUnits
    }, { onConflict: "user_id,provider_code" }).select("user_id,provider_code").single();
    if (error) throw new Error(error.message);
    return {
      summary: `The SMCCD ${args.program_type === "dual" ? "dual-enrollment" : "concurrent-enrollment"} guardrail was updated.`,
      data: { provider_code: "SMCCD", ...args, custom_unit_limit: customMaxUnits, published_absolute_max_units: policy.absolute_max_units },
      changed: { entity: "student_enrollment_preference", id: `${data.user_id}:${data.provider_code}` }
    };
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
