import type { SupabaseClient } from "@supabase/supabase-js";
import { pilotCapabilitiesForMessage } from "@/lib/app-capabilities";

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
  "overview",
  "history",
  "school",
  "degree",
  "prerequisites"
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
export function assistantKnowledgeTags(userMessage: string) {
  const capabilities = pilotCapabilitiesForMessage(userMessage);
  const tags = new Set<string>(["assistant", ...capabilities]);
  if (capabilities.includes("college")) tags.add("smccd");
  if (capabilities.includes("settings")) tags.add("school");
  if (capabilities.includes("core")) tags.add("overview");
  return [...tags].filter((tag) => (CONTEXT_TAGS as readonly string[]).includes(tag));
}

export async function retrieveAssistantKnowledge(
  supabase: SupabaseClient,
  userMessage: string
): Promise<AssistantKnowledgeChunk[]> {
  const contextTags = assistantKnowledgeTags(userMessage);
  const queryText = userMessage.trim() || contextTags.join(" ");
  const { data, error } = await supabase.rpc("search_ai_knowledge", {
    query_text: queryText.slice(0, 500),
    context_tags: contextTags,
    result_limit: 8
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
