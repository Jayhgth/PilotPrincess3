import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { autoReviewResultSchema, reviewAssistantProposal } from "@/server/ai-auto-review";
import { assistantToolLabel, executeAssistantMutationTool, parseAssistantToolCall } from "@/server/ai-tools";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

const requestSchema = z.object({
  toolCallId: z.uuid(),
  decision: z.enum(["confirm", "reject", "auto_review"])
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

  const nextSequence = async () => {
    const latest = await auth.supabase.from("ai_events").select("sequence").eq("turn_id", toolCall.turn_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
    return Number(latest.data?.sequence ?? 0) + 1;
  };
  const recordEvent = async (eventType: string, sequence: number, payload: Record<string, unknown>) => {
    const occurredAt = new Date().toISOString();
    await auth.supabase.from("ai_events").insert({
      conversation_id: toolCall.conversation_id,
      user_id: auth.user.id,
      turn_id: toolCall.turn_id,
      sequence,
      event_type: eventType,
      payload: { source: "application", type: eventType, sequence, occurredAt, turnId: toolCall.turn_id, ...sanitizeCodexValue(payload) as Record<string, unknown> }
    });
  };

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
    await recordEvent("tool.rejected", await nextSequence(), { toolCall: data });
    return new Response(JSON.stringify({ toolCall: data, result }), { headers: { "content-type": "application/json" } });
  }

  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) return jsonError("Reconnect Pilot Assistant before applying this change.", 403);
  const validated = parseAssistantToolCall(toolCall.tool_name, toolCall.arguments);
  if (!validated.mutatesData) return jsonError("This tool does not require review.", 400);

  let review = autoReviewResultSchema.safeParse((toolCall.result as Record<string, unknown> | null)?.auto_review).data ?? null;
  if (parsed.data.decision === "auto_review") {
    if (preferences.reviewMode !== "auto_review") return jsonError("Auto-review is not enabled.", 409);
    const startedSequence = await nextSequence();
    await recordEvent("auto_review.started", startedSequence, {
      toolCallId: toolCall.id,
      toolName: validated.name,
      summary: "A separate reviewer is checking this proposed change."
    });
    try {
      review = await reviewAssistantProposal({
        userMessage: String((await auth.supabase.from("ai_messages").select("content").eq("turn_id", toolCall.turn_id).eq("role", "user").maybeSingle()).data?.content ?? ""),
        toolName: validated.name,
        arguments: validated.arguments,
        explanation: toolCall.explanation,
        model: preferences.model,
        signal: request.signal
      });
    } catch {
      review = { decision: "deny", risk: "high", summary: "Auto-review could not verify this change, so it was not applied." };
    }

    if (review.decision === "deny") {
      const result = { summary: review.summary, auto_review: review };
      const { data, error } = await auth.supabase.from("ai_tool_calls")
        .update({ status: "rejected", result, completed_at: new Date().toISOString() })
        .eq("id", toolCall.id)
        .eq("status", "pending_confirmation")
        .select("*")
        .maybeSingle();
      if (error) return jsonError(error.message, 500);
      if (!data) return jsonError("This tool request has already been handled.", 409);
      await recordEvent("auto_review.completed", await nextSequence(), { review, toolCall: data });
      return new Response(JSON.stringify({ toolCall: data, review, applied: false }), { headers: { "content-type": "application/json" } });
    }
    await recordEvent("auto_review.completed", await nextSequence(), { review, toolCallId: toolCall.id });
  }

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
    const undoExpiresAt = result.undo ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    const storedResult = { ...result, ...(undoExpiresAt ? { undo_expires_at: undoExpiresAt } : {}), ...(review ? { auto_review: review } : {}) };
    const publicResult = { summary: result.summary, data: result.data, changed: result.changed ?? null, ...(review ? { auto_review: review } : {}) };
    const { data, error } = await auth.supabase.from("ai_tool_calls").update({
      status: "completed",
      result: sanitizeCodexValue(storedResult),
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
        page_context: { tool_call_id: toolCall.id, tool_name: validated.name, changed: result.changed ?? null, data: result.data ?? null, auto_review: review, undo_available: Boolean(result.undo), undo_expires_at: undoExpiresAt }
      }),
      recordEvent("tool.completed", await nextSequence(), { toolCall: { ...data, result: publicResult }, review }),
      auth.supabase.from("ai_conversations").update({ updated_at: completedAt }).eq("id", toolCall.conversation_id)
    ]);
    return new Response(JSON.stringify({ toolCall: { ...data, result: publicResult }, result: publicResult, review, applied: true }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = sanitizeCodexText(error instanceof Error ? error.message : "The change could not be applied.", 1200);
    const completedAt = new Date().toISOString();
    const failedResult = { error: message, ...(review ? { auto_review: review } : {}) };
    const { data } = await auth.supabase.from("ai_tool_calls").update({ status: "failed", result: failedResult, completed_at: completedAt }).eq("id", toolCall.id).select("*").single();
    await recordEvent("tool.failed", await nextSequence(), { toolCall: data, review });
    return jsonError(message, 400, { toolCall: data });
  }
};
