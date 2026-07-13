import type { SupabaseClient } from "@supabase/supabase-js";

const CONTEXT_TAGS = [
  "assistant",
  "courses",
  "schedule",
  "graduation",
  "gpa",
  "transcript",
  "college",
  "smccd",
  "settings",
  "overview"
] as const;

export interface AssistantKnowledgeChunk {
  id: string;
  title: string;
  content: string;
  sourcePath: string;
  tags: string[];
  score: number;
  matchReason: "required" | "text_and_context" | "text" | "context";
}
function includesAny(value: string, expressions: RegExp[]) {
  return expressions.some((expression) => expression.test(value));
}

export function assistantKnowledgeTags(userMessage: string, pageContext: Record<string, unknown>) {
  const value = `${userMessage} ${JSON.stringify(pageContext)}`.toLowerCase();
  const tags = new Set<string>(["assistant"]);
  if (includesAny(value, [/\bcourse/, /\bclass/, /\bplan\b/])) tags.add("courses");
  if (includesAny(value, [/\bschedule/, /four[ -]?year plan/, /suggest.*course/, /plan.*course/])) tags.add("schedule");
  if (includesAny(value, [/graduat/, /diploma/, /requirement/, /credit gap/])) tags.add("graduation");
  if (includesAny(value, [/\bgpa\b/, /grade point/, /all[ -]?a/])) tags.add("gpa");
  if (includesAny(value, [/transcript/, /import/, /parsed/])) tags.add("transcript");
  if (includesAny(value, [/college/, /smccd/, /csm/, /skyline/, /cañada/, /canada/])) {
    tags.add("college");
    tags.add("smccd");
  }
  if (includesAny(value, [/setting/, /preference/, /review mode/])) tags.add("settings");
  if (includesAny(value, [/overview/, /dashboard/, /current path/])) tags.add("overview");
  return [...tags].filter((tag) => (CONTEXT_TAGS as readonly string[]).includes(tag));
}

export async function retrieveAssistantKnowledge(
  supabase: SupabaseClient,
  userMessage: string,
  pageContext: Record<string, unknown>
): Promise<AssistantKnowledgeChunk[]> {
  const contextTags = assistantKnowledgeTags(userMessage, pageContext);
  const queryText = userMessage.trim() || contextTags.join(" ");
  const { data, error } = await supabase.rpc("search_ai_knowledge", {
    query_text: queryText.slice(0, 500),
    context_tags: contextTags,
    result_limit: 7
  });
  if (error) throw new Error(`Pilot guidance retrieval failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    sourcePath: String(row.source_path),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    score: Number(row.score ?? 0),
    matchReason: ["required", "text_and_context", "text", "context"].includes(String(row.match_reason))
      ? String(row.match_reason) as AssistantKnowledgeChunk["matchReason"]
      : "context"
  }));
}
