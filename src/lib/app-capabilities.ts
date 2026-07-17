export const WORKSPACE_DOMAINS = [
  "identity",
  "institution",
  "plan",
  "graduation",
  "gpa",
  "transcript",
  "college",
  "degree",
  "enrollment",
  "settings",
  "pilot",
  "history"
] as const;

export type WorkspaceDomain = typeof WORKSPACE_DOMAINS[number];

export const PILOT_CAPABILITIES = [
  "core",
  "courses",
  "schedule",
  "graduation",
  "gpa",
  "transcript",
  "college",
  "degree",
  "prerequisites",
  "settings",
  "history"
] as const;

export type PilotCapability = typeof PILOT_CAPABILITIES[number];
export type MutationReviewMode = "none" | "deterministic" | "model";

export interface AppCapabilityDefinition {
  capabilities: readonly PilotCapability[];
  affects: readonly WorkspaceDomain[];
  review: MutationReviewMode;
}

const READ_ONLY: Pick<AppCapabilityDefinition, "affects" | "review"> = { affects: [], review: "none" };

export const APP_CAPABILITY_REGISTRY = {
  get_student_overview: { capabilities: ["core", "graduation", "gpa", "courses"], ...READ_ONLY },
  get_academic_context: { capabilities: ["core", "schedule", "graduation", "gpa", "college", "degree"], ...READ_ONLY },
  list_plan_courses: { capabilities: ["core", "courses", "schedule", "history"], ...READ_ONLY },
  search_california_high_schools: { capabilities: ["settings"], ...READ_ONLY },
  search_course_catalog: { capabilities: ["courses", "schedule", "graduation", "college", "prerequisites"], ...READ_ONLY },
  resolve_academic_course_batch: { capabilities: ["courses", "schedule", "graduation", "college", "degree", "prerequisites"], ...READ_ONLY },
  get_graduation_progress: { capabilities: ["graduation", "schedule"], ...READ_ONLY },
  get_nearby_education_providers: { capabilities: ["college", "settings"], ...READ_ONLY },
  get_transcript_sources: { capabilities: ["transcript"], ...READ_ONLY },
  get_student_data_inventory: { capabilities: ["core", "history"], ...READ_ONLY },
  audit_transcript_data: { capabilities: ["transcript"], ...READ_ONLY },
  get_gpa_evidence: { capabilities: ["gpa", "schedule"], ...READ_ONLY },
  evaluate_gpa_scenario: { capabilities: ["gpa", "schedule"], ...READ_ONLY },
  get_gpa_scenario: { capabilities: ["gpa"], ...READ_ONLY },
  get_enrollment_constraints: { capabilities: ["college", "schedule"], ...READ_ONLY },
  get_course_schedule_options: { capabilities: ["schedule", "graduation", "college", "degree", "prerequisites"], ...READ_ONLY },
  get_prerequisite_evidence: { capabilities: ["prerequisites", "courses", "schedule"], ...READ_ONLY },
  get_degree_progress: { capabilities: ["degree", "schedule", "college"], ...READ_ONLY },
  get_college_goal: { capabilities: ["degree", "college"], ...READ_ONLY },
  search_smccd_programs: { capabilities: ["degree", "college"], ...READ_ONLY },

  set_current_school: { capabilities: ["settings"], affects: ["institution", "plan", "graduation", "college"], review: "deterministic" },
  set_college_district_preference: { capabilities: ["settings", "college"], affects: ["institution", "college", "enrollment"], review: "deterministic" },
  undo_change: { capabilities: ["history", "core"], affects: ["history", "plan", "graduation", "gpa", "college", "degree", "enrollment", "settings", "institution", "transcript"], review: "deterministic" },
  add_course_schedule: { capabilities: ["schedule"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  add_dtech_course: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa"], review: "deterministic" },
  add_high_school_course: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa"], review: "deterministic" },
  add_smccd_course: { capabilities: ["courses", "schedule", "college"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  add_custom_course: { capabilities: ["courses", "schedule", "college"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  add_academic_courses: { capabilities: ["courses", "schedule", "college", "degree"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  move_plan_course: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  move_plan_courses: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  remove_plan_course: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  remove_plan_courses: { capabilities: ["courses", "schedule"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  update_plan_course: { capabilities: ["courses", "schedule", "gpa"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  update_plan_courses: { capabilities: ["courses", "schedule", "gpa"], affects: ["plan", "graduation", "gpa", "college", "enrollment"], review: "deterministic" },
  sort_plan_courses: { capabilities: ["courses", "schedule"], affects: ["plan"], review: "deterministic" },
  update_gpa_scenario: { capabilities: ["gpa"], affects: ["gpa"], review: "deterministic" },
  update_enrollment_preference: { capabilities: ["college", "settings"], affects: ["enrollment", "college"], review: "deterministic" },
  update_student_settings: { capabilities: ["settings"], affects: ["identity", "settings", "plan", "graduation", "pilot"], review: "deterministic" },
  submit_shared_data_correction: { capabilities: ["settings", "courses", "college"], affects: [], review: "deterministic" },
  correct_transcript_course: { capabilities: ["transcript"], affects: ["transcript", "plan", "graduation", "gpa", "college"], review: "model" },
  save_prerequisite_evidence: { capabilities: ["prerequisites", "courses"], affects: ["plan"], review: "deterministic" },
  create_plan_snapshot: { capabilities: ["history", "schedule"], affects: ["history"], review: "deterministic" },
  set_smccd_ge_completion: { capabilities: ["degree", "college"], affects: ["degree"], review: "model" },
  set_college_goal: { capabilities: ["degree", "college"], affects: ["degree"], review: "deterministic" },
  set_college_goals: { capabilities: ["degree", "college"], affects: ["degree"], review: "deterministic" },
  clear_college_goal: { capabilities: ["degree", "college"], affects: ["degree"], review: "model" },
  clear_academic_plan: { capabilities: ["schedule", "degree", "gpa"], affects: ["plan", "graduation", "gpa", "degree", "enrollment"], review: "deterministic" }
} as const satisfies Record<string, AppCapabilityDefinition>;

export type AppCapabilityName = keyof typeof APP_CAPABILITY_REGISTRY;

export function appCapability(name: string): AppCapabilityDefinition | null {
  return name in APP_CAPABILITY_REGISTRY
    ? APP_CAPABILITY_REGISTRY[name as AppCapabilityName]
    : null;
}

export function affectedWorkspaceDomains(name: string): WorkspaceDomain[] {
  return [...(appCapability(name)?.affects ?? [])];
}

export function mutationReviewMode(name: string, argumentsValue: Record<string, unknown> = {}): MutationReviewMode {
  void argumentsValue;
  return appCapability(name)?.review ?? "model";
}

function includesAny(value: string, expressions: RegExp[]) {
  return expressions.some((expression) => expression.test(value));
}

export function pilotCapabilitiesForMessage(userMessage: string): PilotCapability[] {
  const value = userMessage.toLowerCase();
  const capabilities = new Set<PilotCapability>(["core", "history"]);
  if (includesAny(value, [/course/, /class/, /catalog/, /plan\b/])) capabilities.add("courses");
  if (includesAny(value, [/schedule/, /four[ -]?year/, /rebuild/, /balance/, /rigor/, /workload/])) capabilities.add("schedule");
  if (includesAny(value, [/graduat/, /diploma/, /requirement/, /credit gap/])) capabilities.add("graduation");
  if (includesAny(value, [/\bgpa\b/, /grade point/, /weighted/, /all[ -]?a/])) capabilities.add("gpa");
  if (includesAny(value, [/transcript/, /parsed/, /imported course/, /correct.*grade/])) capabilities.add("transcript");
  if (includesAny(value, [/college/, /concurrent/, /dual enrollment/, /community college/, /unit limit/, /smccd/, /skyline/, /cañada/, /canada/, /\bcsm\b/])) capabilities.add("college");
  if (includesAny(value, [/degree/, /associate/, /major/, /general education/, /\bge\b/])) capabilities.add("degree");
  if (includesAny(value, [/prereq/, /placement/, /eligib/, /sequence/])) capabilities.add("prerequisites");
  if (includesAny(value, [/setting/, /profile/, /preferred name/, /theme/, /dark mode/, /light mode/, /school/, /district/, /model/, /reasoning/])) capabilities.add("settings");
  if (includesAny(value, [/undo/, /revert/, /restore/, /bring.*back/, /snapshot/, /history/])) capabilities.add("history");

  if (capabilities.has("schedule")) {
    ["courses", "graduation", "gpa", "college", "degree", "prerequisites"].forEach((capability) => capabilities.add(capability as PilotCapability));
  }
  if (capabilities.has("degree")) capabilities.add("college");
  if (capabilities.has("transcript")) {
    capabilities.add("courses");
    capabilities.add("graduation");
  }
  if (capabilities.size === 2 || includesAny(value, [/everything/, /anything/, /whole app/, /all my data/, /what can you do/])) {
    PILOT_CAPABILITIES.forEach((capability) => capabilities.add(capability));
  }
  return [...capabilities];
}

export function pilotToolNamesForMessage(userMessage: string): Set<AppCapabilityName> {
  const selected = new Set(pilotCapabilitiesForMessage(userMessage));
  return new Set((Object.entries(APP_CAPABILITY_REGISTRY) as Array<[AppCapabilityName, AppCapabilityDefinition]>)
    .filter(([, definition]) => definition.capabilities.some((capability) => selected.has(capability)))
    .map(([name]) => name));
}
