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
  userMessage: string
): Promise<AssistantMemory[]> {
  const contextTags = assistantKnowledgeTags(userMessage);
  const queryText = userMessage.trim() || contextTags.join(" ");
  const { data, error } = await supabase.rpc("search_student_memories", {
    query_text: queryText.slice(0, 500),
    context_tags: contextTags,
    result_limit: 6
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

export function explicitDurableMemoryUpdates(userMessage: string, updates: AssistantMemoryUpdate[]) {
  const normalized = userMessage.toLowerCase().replace(/[’']/g, "'");
  const durableCue = /\b(remember|from now on|always|usually|generally|i prefer|my preference|my ongoing goal|my long[ -]?term goal|i am interested in|i'm interested in)\b/.test(normalized);
  const forgetCue = /\b(forget|stop remembering|don't remember|do not remember|no longer)\b/.test(normalized);
  if (!durableCue && !forgetCue) return [];
  const canonical: AssistantMemoryUpdate[] = [];
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const maximum = normalized.match(/\b(?:no more than|max(?:imum)?(?: of)?|limit(?:ed)? to)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:courses|classes)(?:\s+per\s+term)?\b/)?.[1];
  const rigor = normalized.match(/\b(lighter|light|advanced|rigorous|balanced|manageable)\s+(?:schedule|course load|workload)\b/)?.[1]
    ?? normalized.match(/\b(?:schedule|course)\s+rigor\s+(?:is|to be)?\s*(lighter|light|advanced|rigorous|balanced)\b/)?.[1];
  const interest = normalized.match(/\b(?:i am|i'm) interested in\s+([^.!?;]+?)(?=\s*,?\s+and\s+(?:i|my|no|a)|[.!?;]|$)/)?.[1]?.trim();

  if (durableCue && maximum) canonical.push({
    operation: "remember", key: "max_courses_per_term", category: "constraint",
    content: `${numberWords[maximum] ?? Number(maximum)} courses per term`, tags: ["schedule", "workload"], importance: 5
  });
  if (durableCue && rigor) canonical.push({
    operation: "remember", key: "schedule_rigor", category: "preference",
    content: rigor === "light" ? "lighter" : rigor, tags: ["schedule", "rigor"], importance: 4
  });
  if (durableCue && interest) canonical.push({
    operation: "remember", key: "schedule_interests", category: "interest",
    content: interest, tags: ["schedule", "courses"], importance: 4
  });
  if (forgetCue && /\b(schedule|course)\s+rigor\b/.test(normalized)) canonical.push({
    operation: "forget", key: "schedule_rigor", category: "preference", content: null, tags: ["schedule", "rigor"], importance: 4
  });
  if (forgetCue && /\b(maximum|max|max-courses|maximum-courses|course limit)\b/.test(normalized)) canonical.push({
    operation: "forget", key: "max_courses_per_term", category: "constraint", content: null, tags: ["schedule", "workload"], importance: 5
  });

  for (const update of updates) {
    if (update.operation === "remember" && !durableCue) continue;
    if (update.operation === "forget" && !forgetCue) continue;
    const content = String(update.content ?? "").toLowerCase();
    if (update.category === "interest" || update.key.includes("interest")) {
      if (forgetCue && /\bkeep\b.{0,36}\binterest\b/.test(normalized)) continue;
      canonical.push({ ...update, key: "schedule_interests" });
    } else if (/\b(course|class).{0,16}per term\b/.test(content) || update.key.includes("max_courses")) {
      canonical.push({ ...update, key: "max_courses_per_term" });
    } else if (/\b(lighter|light|advanced|rigorous|balanced)\b/.test(content) || update.key.includes("rigor")) {
      canonical.push({ ...update, key: "schedule_rigor" });
    } else if (!/^(schedule_preference|academic_interest)$/.test(update.key)) {
      canonical.push(update);
    }
  }
  return [...new Map(canonical.map((update) => [update.key, update])).values()].slice(0, 5);
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
