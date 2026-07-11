import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { assistantToolLabel, executeAssistantMutationTool, parseAssistantToolCall } from "@/server/ai-tools";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

const requestSchema = z.object({
  toolCallId: z.uuid(),
  decision: z.enum(["confirm", "reject"])
});

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid tool decision.", 400);
  const toolResult = await auth.supabase.from("ai_tool_calls").select("*").eq("id", parsed.data.toolCallId).eq("user_id", auth.user.id).single();
  if (toolResult.error || !toolResult.data) return jsonError("Tool request not found.", 404);
  const toolCall = toolResult.data;
  if (toolCall.status !== "pending_confirmation") return jsonError("This tool request has already been handled.", 409);

  const latestEventResult = await auth.supabase.from("ai_events").select("sequence").eq("turn_id", toolCall.turn_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
  const nextSequence = Number(latestEventResult.data?.sequence ?? 0) + 1;
  if (parsed.data.decision === "reject") {
    const result = { summary: `${assistantToolLabel(toolCall.tool_name)} was not applied.` };
    const { data, error } = await auth.supabase.from("ai_tool_calls")
      .update({ status: "rejected", result, completed_at: new Date().toISOString() })
      .eq("id", toolCall.id)
      .eq("status", "pending_confirmation")
      .select("*")
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!data) return jsonError("This tool request has already been handled.", 409);
    await auth.supabase.from("ai_events").insert({
      conversation_id: toolCall.conversation_id,
      user_id: auth.user.id,
      turn_id: toolCall.turn_id,
      sequence: nextSequence,
      event_type: "tool.rejected",
      payload: { source: "application", type: "tool.rejected", sequence: nextSequence, occurredAt: new Date().toISOString(), turnId: toolCall.turn_id, toolCall: data }
    });
    return new Response(JSON.stringify({ toolCall: data, result }), { headers: { "content-type": "application/json" } });
  }

  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) return jsonError("Reconnect Pilot Assistant before applying this change.", 403);

  const validated = parseAssistantToolCall(toolCall.tool_name, toolCall.arguments);
  if (!validated.mutatesData) return jsonError("This tool does not require confirmation.", 400);
  const confirmedAt = new Date().toISOString();
  const claimResult = await auth.supabase.from("ai_tool_calls")
    .update({ status: "running", confirmed_at: confirmedAt })
    .eq("id", toolCall.id)
    .eq("status", "pending_confirmation")
    .select("id")
    .maybeSingle();
  if (claimResult.error) return jsonError(claimResult.error.message, 500);
  if (!claimResult.data) return jsonError("This tool request has already been handled.", 409);
  try {
    const result = await executeAssistantMutationTool(auth.supabase, auth.user.id, validated.name, validated.arguments);
    const completedAt = new Date().toISOString();
    const { data, error } = await auth.supabase.from("ai_tool_calls").update({
      status: "completed",
      result: sanitizeCodexValue(result),
      completed_at: completedAt
    }).eq("id", toolCall.id).select("*").single();
    if (error) throw new Error(error.message);
    await Promise.all([
      auth.supabase.from("ai_messages").insert({
        conversation_id: toolCall.conversation_id,
        user_id: auth.user.id,
        turn_id: toolCall.turn_id,
        role: "tool",
        content: sanitizeCodexText(result.summary, 2000),
        page_context: { tool_call_id: toolCall.id, tool_name: validated.name, changed: result.changed ?? null }
      }),
      auth.supabase.from("ai_events").insert({
        conversation_id: toolCall.conversation_id,
        user_id: auth.user.id,
        turn_id: toolCall.turn_id,
        sequence: nextSequence,
        event_type: "tool.completed",
        payload: { source: "application", type: "tool.completed", sequence: nextSequence, occurredAt: completedAt, turnId: toolCall.turn_id, toolCall: data }
      }),
      auth.supabase.from("ai_conversations").update({ updated_at: completedAt }).eq("id", toolCall.conversation_id)
    ]);
    return new Response(JSON.stringify({ toolCall: data, result }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = sanitizeCodexText(error instanceof Error ? error.message : "The change could not be applied.", 1200);
    const completedAt = new Date().toISOString();
    const { data } = await auth.supabase.from("ai_tool_calls").update({ status: "failed", result: { error: message }, completed_at: completedAt }).eq("id", toolCall.id).select("*").single();
    await auth.supabase.from("ai_events").insert({
      conversation_id: toolCall.conversation_id,
      user_id: auth.user.id,
      turn_id: toolCall.turn_id,
      sequence: nextSequence,
      event_type: "tool.failed",
      payload: { source: "application", type: "tool.failed", sequence: nextSequence, occurredAt: completedAt, turnId: toolCall.turn_id, toolCall: data }
    });
    return jsonError(message, 400, { toolCall: data });
  }
};
