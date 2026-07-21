import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { asAssistantRecord } from "@/lib/assistant-chat";

export const prerender = false;

const ARCHIVE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const updateSchema = z.object({
  conversationId: z.uuid(),
  archived: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional()
}).refine((value) => value.archived !== undefined || value.title !== undefined, "Add a title or archive state.");

async function purgeExpiredArchives(auth: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>) {
  const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_MS).toISOString();
  const expiredResult = await auth.supabase
    .from("ai_conversations")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("is_archived", true)
    .lt("archived_at", cutoff)
    .limit(100);
  if (expiredResult.error || !expiredResult.data?.length) return;
  const ids = expiredResult.data.map((conversation) => conversation.id);
  const attachmentResult = await auth.supabase
    .from("ai_message_attachments")
    .select("storage_path")
    .eq("user_id", auth.user.id)
    .in("conversation_id", ids);
  if (attachmentResult.error) return;
  const paths = (attachmentResult.data ?? []).map((attachment) => attachment.storage_path);
  if (paths.length) {
    const storageResult = await auth.supabase.storage.from("ai-attachments").remove(paths);
    if (storageResult.error) return;
  }
  await auth.supabase
    .from("ai_conversations")
    .delete()
    .eq("user_id", auth.user.id)
    .in("id", ids);
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const url = new URL(request.url);
  const requestedId = url.searchParams.get("conversationId");
  const archived = url.searchParams.get("archived") === "true";
  if (archived) await purgeExpiredArchives(auth);
  const conversationResult = await auth.supabase
    .from("ai_conversations")
    .select("id,user_id,title,is_archived,archived_at,created_at,updated_at")
    .eq("user_id", auth.user.id)
    .eq("is_archived", archived)
    .order("updated_at", { ascending: false })
    .limit(archived ? 100 : 50);
  if (conversationResult.error) return jsonError(conversationResult.error.message, 500);
  let conversations = conversationResult.data ?? [];
  if (archived) {
    return new Response(JSON.stringify({ conversations, activeConversation: null, messages: [], events: [], toolCalls: [] }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  let activeConversation = requestedId
    ? conversations.find((conversation) => conversation.id === requestedId) ?? null
    : conversations[0] ?? null;
  if (requestedId && !activeConversation) {
    const requestedResult = await auth.supabase
      .from("ai_conversations")
      .select("id,user_id,title,is_archived,archived_at,created_at,updated_at")
      .eq("id", requestedId)
      .eq("user_id", auth.user.id)
      .eq("is_archived", false)
      .maybeSingle();
    if (requestedResult.error) return jsonError(requestedResult.error.message, 500);
    activeConversation = requestedResult.data;
    if (activeConversation) conversations = [activeConversation, ...conversations];
  }
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
  const messageIds = (messageResult.data ?? []).map((message) => message.id);
  const attachmentResult = messageIds.length
    ? await auth.supabase.from("ai_message_attachments").select("*").eq("conversation_id", activeConversation.id).in("message_id", messageIds).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (attachmentResult.error) return jsonError(attachmentResult.error.message, 500);
  const attachments = attachmentResult.data ?? [];
  const signedResult = attachments.length
    ? await auth.supabase.storage.from("ai-attachments").createSignedUrls(attachments.map((attachment) => attachment.storage_path), 3600)
    : { data: [], error: null };
  if (signedResult.error) return jsonError(signedResult.error.message, 500);
  const previewByPath = new Map((signedResult.data ?? []).map((entry) => [entry.path, entry.signedUrl]));
  const attachmentsByMessage = new Map<string, Array<Record<string, unknown>>>();
  for (const attachment of attachments) {
    const rows = attachmentsByMessage.get(attachment.message_id) ?? [];
    rows.push({
      id: attachment.id,
      conversation_id: attachment.conversation_id,
      message_id: attachment.message_id,
      user_id: attachment.user_id,
      name: attachment.name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      preview_url: previewByPath.get(attachment.storage_path) ?? "",
      created_at: attachment.created_at
    });
    attachmentsByMessage.set(attachment.message_id, rows);
  }
  return new Response(JSON.stringify({
    conversations,
    activeConversation,
    messages: [...(messageResult.data ?? [])].reverse().map((message) => ({
      ...message,
      page_context: asAssistantRecord(message.page_context),
      attachments: attachmentsByMessage.get(message.id) ?? []
    })),
    events: [...(eventResult.data ?? [])].reverse().map((event) => ({
      ...event,
      payload: asAssistantRecord(event.payload)
    })),
    toolCalls: [...(toolResult.data ?? [])].reverse().map((toolCall) => {
      const normalized = { ...toolCall, arguments: asAssistantRecord(toolCall.arguments) };
      if (!toolCall.result || typeof toolCall.result !== "object" || Array.isArray(toolCall.result)) return normalized;
      const { undo: _undo, ...publicResult } = toolCall.result as Record<string, unknown>;
      return { ...normalized, result: publicResult };
    })
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

export const PATCH: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid conversation update.", 400);
  const now = new Date().toISOString();
  const patch = {
    ...(parsed.data.archived !== undefined ? { is_archived: parsed.data.archived, archived_at: parsed.data.archived ? now : null } : {}),
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    updated_at: now
  };
  const { data, error } = await auth.supabase
    .from("ai_conversations")
    .update(patch)
    .eq("id", parsed.data.conversationId)
    .eq("user_id", auth.user.id)
    .select("*")
    .single();
  if (error || !data) return jsonError(error?.message ?? "Conversation not found.", error?.code === "PGRST116" ? 404 : 500);
  return new Response(JSON.stringify({ conversation: data }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
