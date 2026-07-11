import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssistantKnowledgeChunk {
  id: string;
  title: string;
  content: string;
  sourcePath: string;
  tags: string[];
  score: number;
}

const CORE_FALLBACK: AssistantKnowledgeChunk = {
  id: "assistant-role-fallback",
  title: "Pilot Assistant role",
  content: "Pilot is a concise d.tech academic planning assistant. Read current records when needed. Keep calculations deterministic. Never certify outcomes. Every write remains pending until the student confirms its exact arguments, and normal product validation runs again during execution.",
  sourcePath: "docs/AI_TRANSPARENCY.md",
  tags: ["assistant", "role", "all"],
  score: 1
};

function contextTags(pageContext: Record<string, unknown>) {
  const tags = new Set(["assistant", "all"]);
  const view = String(pageContext.view ?? "").trim();
  const area = String(pageContext.course_area ?? "").trim();
  if (view) tags.add(view);
  if (area) tags.add(area);
  return [...tags].slice(0, 8);
}

export async function retrieveAssistantKnowledge(
  supabase: SupabaseClient,
  query: string,
  pageContext: Record<string, unknown>
): Promise<AssistantKnowledgeChunk[]> {
  const { data, error } = await supabase.rpc("search_ai_knowledge", {
    query_text: query,
    context_tags: contextTags(pageContext),
    result_limit: 6
  });
  if (error || !data?.length) return [CORE_FALLBACK];
  const chunks = (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    content: String(row.content).slice(0, 6000),
    sourcePath: String(row.source_path),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    score: Number(row.score ?? 0)
  }));
  if (!chunks.some((chunk) => chunk.id === "assistant-role")) chunks.unshift(CORE_FALLBACK);
  return chunks.slice(0, 7);
}

export function assistantKnowledgePrompt(chunks: AssistantKnowledgeChunk[]) {
  return chunks.map((chunk) => [
    `[${chunk.title}]`,
    chunk.content,
    `Source: ${chunk.sourcePath}`
  ].join("\n")).join("\n\n");
}
