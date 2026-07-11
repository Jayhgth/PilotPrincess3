import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const url = new URL(request.url);
  const requestedId = url.searchParams.get("conversationId");
  const conversationResult = await auth.supabase
    .from("ai_conversations")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (conversationResult.error) return jsonError(conversationResult.error.message, 500);
  const conversations = conversationResult.data ?? [];
  const activeConversation = requestedId
    ? conversations.find((conversation) => conversation.id === requestedId) ?? null
    : conversations[0] ?? null;
  if (!activeConversation) {
    return new Response(JSON.stringify({ conversations, activeConversation: null, messages: [], events: [], toolCalls: [] }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  const [messageResult, eventResult, toolResult] = await Promise.all([
    auth.supabase.from("ai_messages").select("*").eq("conversation_id", activeConversation.id).order("created_at", { ascending: false }).limit(100),
    auth.supabase.from("ai_events").select("*").eq("conversation_id", activeConversation.id).order("id", { ascending: false }).limit(400),
    auth.supabase.from("ai_tool_calls").select("*").eq("conversation_id", activeConversation.id).order("created_at", { ascending: false }).limit(120)
  ]);
  const error = messageResult.error ?? eventResult.error ?? toolResult.error;
  if (error) return jsonError(error.message, 500);
  return new Response(JSON.stringify({
    conversations,
    activeConversation,
    messages: [...(messageResult.data ?? [])].reverse(),
    events: [...(eventResult.data ?? [])].reverse(),
    toolCalls: [...(toolResult.data ?? [])].reverse()
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid conversation.", 400);
  const { data, error } = await auth.supabase.from("ai_conversations").insert({
    user_id: auth.user.id,
    title: parsed.data.title ?? "New conversation"
  }).select("*").single();
  if (error) return jsonError(error.message, 500);
  return new Response(JSON.stringify({ conversation: data }), {
    status: 201,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
