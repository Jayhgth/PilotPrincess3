import type { AiToolCall } from "@/lib/models";

export interface AssistantQuestion {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  allow_custom: boolean;
}

export function asAssistantRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const DRAFT_PREFIX = "pilot-princess:assistant-draft";

export function assistantDraftKey(userId: string, conversationId: string | null) {
  return `${DRAFT_PREFIX}:${userId}:${conversationId ?? "new"}`;
}

export function assistantDockedMaxWidth(viewportWidth: number, minimum = 360, maximum = 680, workspaceReserve = 1080) {
  return Math.min(maximum, Math.max(minimum, viewportWidth - workspaceReserve));
}

export function prioritizeAssistantQueue<T extends { id: string }>(queue: T[], id: string) {
  const selected = queue.find((item) => item.id === id);
  return selected ? [selected, ...queue.filter((item) => item.id !== id)] : queue;
}

export function assistantQuestionsFromContext(value: unknown): AssistantQuestion[] {
  const context = asAssistantRecord(value);
  if (!Array.isArray(context.questions)) return [];
  return context.questions.slice(0, 3).filter((question): question is AssistantQuestion => {
    if (!question || typeof question !== "object" || Array.isArray(question)) return false;
    const value = question as Record<string, unknown>;
    return typeof value.id === "string"
      && typeof value.prompt === "string"
      && typeof value.allow_custom === "boolean"
      && Array.isArray(value.options)
      && value.options.length >= 2
      && value.options.length <= 4
      && value.options.every((option) => option && typeof option === "object" && !Array.isArray(option) && typeof (option as Record<string, unknown>).id === "string" && typeof (option as Record<string, unknown>).label === "string");
  });
}

export function formatStructuredAnswers(questions: AssistantQuestion[], answers: Record<string, string>) {
  return [
    "Here are my answers:",
    ...questions.map((question) => `- **${question.prompt}** ${answers[question.id] ?? "No answer"}`)
  ].join("\n");
}

export function visibleToolCalls(tools: AiToolCall[], expanded: boolean, limit = 2) {
  const pending = tools.filter((tool) => tool.status === "pending_confirmation");
  const settled = tools.filter((tool) => tool.status !== "pending_confirmation");
  if (expanded || settled.length <= limit) return { visible: tools, hiddenCount: 0 };
  const visibleIds = new Set([...pending, ...settled.slice(-limit)].map((tool) => tool.id));
  return {
    visible: tools.filter((tool) => visibleIds.has(tool.id)),
    hiddenCount: tools.length - visibleIds.size
  };
}

export interface ChangeDetail {
  label: string;
  value: string;
}

const CHANGE_DETAIL_LABELS: Record<string, string> = {
  course: "Course",
  courses: "Courses",
  course_code: "Course",
  status: "Status",
  grade_level: "Grade",
  term: "Term",
  letter_grade: "Grade received",
  title: "Next step",
  titles: "Next steps",
  category: "Category",
  due_label: "Due",
  program_type: "Enrollment type",
  college_code: "College",
  award_type: "Award",
  label: "Snapshot",
  equivalency_verified: "School equivalency reviewed",
  existing_courses_retained: "Existing courses kept",
  graduation_coverage_after: "Graduation coverage after",
  respect_recommended_limit: "Respect district unit limit",
  preferred_name: "Preferred name",
  age: "Age",
  graduation_year: "Graduation year",
  tracker_mode: "Tracker mode",
  tracked_requirement_areas: "Tracked areas",
  ai_model: "Pilot model",
  ai_reasoning_effort: "Reasoning effort",
  credits: "Credits",
  college_units: "College units",
  is_weighted: "Weighted",
  reason: "Correction reason",
  clearance_type: "Evidence type",
  authority: "Evidence authority",
  verification_status: "Verification",
  area: "Requirement area",
  completed: "Completed",
  school_name: "School",
  district_name: "District",
  sorted_count: "Courses reordered",
  updated_count: "Courses updated",
  removed_count: "Courses removed",
  moved_count: "Courses moved",
  added_count: "Courses added",
  high_school_count: "High school courses",
  college_count: "College courses",
  courses_removed: "Courses removed",
  transcript_courses_retained: "Transcript courses kept",
  degree_bookmarks_removed: "Degree bookmarks removed",
  gpa_assumptions_removed: "GPA assumptions removed"
};

function readableValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const values = value.map(readableValue).filter((item): item is string => Boolean(item));
    return values.length > 3 ? values.join("\n") : values.join(", ");
  }
  if (typeof value === "object") return null;
  const text = String(value).replaceAll("_", " ");
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export function changeDetailsFromContext(value: unknown): ChangeDetail[] {
  const context = asAssistantRecord(value);
  const data = context.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .filter(([key]) => key in CHANGE_DETAIL_LABELS)
    .map(([key, value]) => ({ label: CHANGE_DETAIL_LABELS[key], value: readableValue(value) }))
    .filter((entry): entry is ChangeDetail => Boolean(entry.value))
    .slice(0, 8);
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatMessageTimeTitle(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
