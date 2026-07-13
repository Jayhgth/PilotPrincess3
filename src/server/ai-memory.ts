import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantKnowledgeTags } from "@/server/ai-knowledge";
import type { AssistantMemoryUpdate } from "@/server/ai-schemas";

export interface AssistantMemory {
  id: string;
  key: string;
  category: "preference" | "goal" | "constraint" | "interest" | "context";
  content: string;
  tags: string[];
  importance: number;
  score: number;
}

export async function retrieveAssistantMemories(
  supabase: SupabaseClient,
  userMessage: string,
  pageContext: Record<string, unknown>
): Promise<AssistantMemory[]> {
  const contextTags = assistantKnowledgeTags(userMessage, pageContext);
  const queryText = userMessage.trim() || contextTags.join(" ");
  const { data, error } = await supabase.rpc("search_student_memories", {
    query_text: queryText.slice(0, 500),
    context_tags: contextTags,
    result_limit: 12
  });
  if (error) throw new Error(`Pilot memory retrieval failed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    key: String(row.memory_key),
    category: String(row.category) as AssistantMemory["category"],
    content: String(row.content),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    importance: Number(row.importance ?? 3),
    score: Number(row.score ?? 0)
  }));
}

export async function persistAssistantMemoryUpdates(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  turnId: string,
  updates: AssistantMemoryUpdate[]
) {
  const forgotten = updates.filter((update) => update.operation === "forget").map((update) => update.key);
  if (forgotten.length) {
    const removal = await supabase.from("ai_student_memories").delete().eq("user_id", userId).in("memory_key", forgotten);
    if (removal.error) throw new Error(removal.error.message);
  }
  const remembered = updates.filter((update) => update.operation === "remember" && update.content);
  if (remembered.length) {
    const result = await supabase.from("ai_student_memories").upsert(remembered.map((update) => ({
      user_id: userId,
      memory_key: update.key,
      category: update.category,
      content: update.content,
      tags: update.tags,
      importance: update.importance,
      source_conversation_id: conversationId,
      source_turn_id: turnId,
      is_active: true
    })), { onConflict: "user_id,memory_key" });
    if (result.error) throw new Error(result.error.message);
  }
  return { remembered: remembered.length, forgotten: forgotten.length };
}
