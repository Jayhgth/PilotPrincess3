export type AssistantRequestScope =
  | "read"
  | "targeted_course_edit"
  | "course_batch"
  | "full_plan"
  | "plan_optimization"
  | "destructive"
  | "settings"
  | "other";

function includesAny(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * Classifies how much of the student's workspace the request is allowed to
 * change. This is deliberately about scope, not academic quality. Diploma,
 * degree, GPA, and workload objectives are interpreted separately.
 */
export function classifyAssistantRequest(userMessage: string): AssistantRequestScope {
  const value = userMessage.toLowerCase().replace(/[’']/g, "'");
  if (/\b(?:study|homework|meeting|appointment|calendar|workout|sleep)\s+(?:schedule|plan)\b/.test(value)) return "other";
  if (/\b(?:clear|empty|wipe|replace|remove)\b.{0,45}\b(?:schedule|plan)\b/.test(value)
    && (/\b(?:find|generate|build|create|make|redo|rebuild|replace)\b.{0,35}\b(?:new\s+)?(?:schedule|plan)\b/.test(value)
      || /\b(?:find|generate|build|create|make|redo|rebuild|replace)\s+(?:a\s+)?new\s+one\b/.test(value))) {
    return "full_plan";
  }
  const destructive = includesAny(value, [
    /\b(clear|empty|wipe|delete|remove)\b.{0,40}\b(all|every|whole|entire)\b/,
    /\b(clear|empty|wipe)\b.{0,24}\b(schedule|plan|degree bookmarks?|gpa assumptions?)\b/
  ]);
  if (destructive) return "destructive";

  if (includesAny(value, [/\b(dark|light) mode\b/, /\b(theme|preferred name|settings?|profile|selected school|college district)\b/])) {
    return "settings";
  }

  const fullPlanNoun = includesAny(value, [
    /\b(?:full|complete|entire|whole|new|replacement)\s+(?:four[ -]?year\s+|academic\s+|course\s+)?(?:schedule|plan)\b/,
    /\bfour[ -]?year\s+(?:schedule|plan)\b/,
    /\b(?:schedule|plan)\s+(?:from|starting (?:from|in|at))\s+(?:grade\s*)?(?:9|10|11|12|freshman|sophomore|junior|senior)\b/
  ]);
  const fullPlanVerb = includesAny(value, [
    /\b(generate|build|create|make|design|draft|redo|rebuild|regenerate|redesign|suggest|recommend|find)\b/,
    /\bcome up with\b/
  ]);
  if (fullPlanVerb && /\b(?:schedule|plan)\b/.test(value) && !/\b(?:snapshot|backup|copy)\b/.test(value)) return "full_plan";
  if (/\b(?:suggest|recommend)\s+(?:a\s+)?(?:course\s+)?(?:schedule|plan)\b/.test(value)) return "full_plan";
  if (fullPlanNoun && fullPlanVerb) return "full_plan";

  const optimization = includesAny(value, [
    /\b(optimi[sz]e|maximi[sz]e|highest|best)\b.{0,35}\b(gpa|degree|overlap|schedule|plan|rigor)\b/,
    /\b(gpa|degree|overlap)\b.{0,35}\b(optimi[sz]e|maximi[sz]e|highest|best)\b/
  ]);
  if (optimization && includesAny(value, [/\b(schedule|plan|courses?|classes?)\b/])) return "plan_optimization";

  const courseEdit = includesAny(value, [
    /\b(course|class|schedule|plan|math|language|semester|term|grade)\b/,
    /\b(?:alg(?:ebra)?\s*(?:1|2|i|ii)|geometry|pre[ -]?calc(?:ulus)?|calculus(?:\s+(?:ab|bc|i{1,3}|1|2|3))?)\b/,
    /\b(?:spanish|french|chinese|mandarin|japanese|latin|german|italian|asl|american sign language)(?:\s+(?:1|2|3|4|i|ii|iii|iv|ap))?\b/
  ])
    && includesAny(value, [/\b(change|edit|move|switch|replace|start|set|put|shift|update)\b/]);
  if (courseEdit) return "targeted_course_edit";

  const courseBatch = includesAny(value, [/\b(add|include|schedule|enroll)\b/])
    && includesAny(value, [/\b(courses?|classes?|graduation requirements?|college)\b/])
    && includesAny(value, [/,/, /\band\b/, /\b(all|every|remaining|needed)\b/]);
  if (courseBatch) return "course_batch";

  if (/\b(add|include|schedule|enroll|remove|drop)\b/.test(value) && /\b(course|class)\b/.test(value)) {
    return "targeted_course_edit";
  }
  if (/\b(what|which|show|list|check|explain|why|how|can i|do i)\b/.test(value)) return "read";
  return "other";
}

export function requestUsesFullPlanner(scope: AssistantRequestScope) {
  return scope === "full_plan" || scope === "plan_optimization";
}
