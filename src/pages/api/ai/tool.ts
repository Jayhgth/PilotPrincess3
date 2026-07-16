import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { academicPlanEvidenceCoversProposal, autoReviewResultSchema, reviewAssistantProposal } from "@/server/ai-auto-review";
import { executeAssistantMutationTool, parseAssistantToolCall } from "@/server/ai-tools";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

const requestSchema = z.object({
  toolCallId: z.uuid()
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

  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) return jsonError("Reconnect Pilot Assistant before applying this change.", 403);
  const validated = parseAssistantToolCall(toolCall.tool_name, toolCall.arguments);
  if (!validated.mutatesData) return jsonError("This tool does not require review.", 400);

  let review: z.infer<typeof autoReviewResultSchema>;
  const startedSequence = await nextSequence();
  await recordEvent("safety_review.started", startedSequence, {
    toolCallId: toolCall.id,
    toolName: validated.name,
    summary: "A separate reviewer is checking this proposed change."
  });
  try {
    let verifiedBatchResolution = false;
    let verifiedAcademicPlanResolution = false;
    if (validated.name === "add_academic_courses") {
      const resolution = await auth.supabase.from("ai_tool_calls")
        .select("result")
        .eq("turn_id", toolCall.turn_id)
        .eq("user_id", auth.user.id)
        .eq("tool_name", "resolve_academic_course_batch")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const resultEnvelope = resolution.data?.result && typeof resolution.data.result === "object" && !Array.isArray(resolution.data.result)
        ? resolution.data.result as Record<string, unknown>
        : null;
      const resolutionData = resultEnvelope?.data && typeof resultEnvelope.data === "object" && !Array.isArray(resultEnvelope.data)
        ? resultEnvelope.data as Record<string, unknown>
        : null;
      const normalizedEntries = (value: unknown) => Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)).map((entry) => ({
            source: entry.source,
            course_id: entry.course_id,
            status: entry.status,
            grade_level: Number(entry.grade_level),
            term: entry.term
          }))
        : [];
      verifiedBatchResolution = resolutionData?.complete === true
        && JSON.stringify(normalizedEntries(resolutionData.entries)) === JSON.stringify(normalizedEntries(validated.arguments.entries))
        && (resolutionData.respect_recommended_limit !== false) === (validated.arguments.respect_recommended_limit !== false);
      if (!verifiedBatchResolution) {
        const evidence = await auth.supabase.from("ai_tool_calls")
          .select("tool_name,result,status")
          .eq("turn_id", toolCall.turn_id)
          .eq("user_id", auth.user.id)
          .in("tool_name", ["get_academic_context", "get_degree_progress", "get_enrollment_constraints"])
          .eq("status", "completed");
        const evidenceResult = (name: string) => {
          const envelope = evidence.data?.find((item) => item.tool_name === name)?.result;
          return envelope && typeof envelope === "object" && !Array.isArray(envelope)
            ? envelope as { data?: unknown }
            : null;
        };
        verifiedAcademicPlanResolution = !evidence.error && academicPlanEvidenceCoversProposal({
          arguments: validated.arguments,
          academicContext: evidenceResult("get_academic_context"),
          degreeProgress: evidenceResult("get_degree_progress"),
          enrollmentConstraints: evidenceResult("get_enrollment_constraints")
        });
      }
    }
    review = await reviewAssistantProposal({
      userMessage: String((await auth.supabase.from("ai_messages").select("content").eq("turn_id", toolCall.turn_id).eq("role", "user").maybeSingle()).data?.content ?? ""),
      toolName: validated.name,
      arguments: validated.arguments,
      explanation: toolCall.explanation,
      model: preferences.model,
      verifiedBatchResolution,
      verifiedAcademicPlanResolution,
      signal: request.signal
    });
  } catch {
    review = { decision: "deny", risk: "high", summary: "The safety review could not verify this change, so it was not applied." };
  }

  if (review.decision === "deny") {
    const result = { summary: review.summary, safety_review: review };
    const { data, error } = await auth.supabase.from("ai_tool_calls")
      .update({ status: "rejected", result, completed_at: new Date().toISOString() })
      .eq("id", toolCall.id)
      .eq("status", "pending_confirmation")
      .select("*")
      .maybeSingle();
    if (error) return jsonError(error.message, 500);
    if (!data) return jsonError("This tool request has already been handled.", 409);
    await recordEvent("safety_review.completed", await nextSequence(), { review, toolCall: data });
    return new Response(JSON.stringify({ toolCall: data, review, applied: false }), { headers: { "content-type": "application/json" } });
  }
  await recordEvent("safety_review.completed", await nextSequence(), { review, toolCallId: toolCall.id });

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
    const result = await executeAssistantMutationTool(auth.supabase, auth.user.id, validated.name, validated.arguments, { conversationId: toolCall.conversation_id });
    const isUndoAction = validated.name === "undo_change";
    if (!result.undo && !isUndoAction) throw new Error("Pilot refused to apply a change that did not include a safe undo action.");
    const completedAt = new Date().toISOString();
    const storedResult = { ...result, ...(review ? { safety_review: review } : {}) };
    const publicResult = { summary: result.summary, data: result.data, changed: result.changed ?? null, ...(review ? { safety_review: review } : {}) };
    const { data, error } = await auth.supabase.from("ai_tool_calls").update({
      status: "completed",
      result: sanitizeCodexValue(storedResult),
      completed_at: completedAt
    }).eq("id", toolCall.id).select("*").single();
    if (error) throw new Error(error.message);
    const receiptWrite = isUndoAction
      ? Promise.resolve()
      : auth.supabase.from("ai_messages").insert({
        conversation_id: toolCall.conversation_id,
        user_id: auth.user.id,
        turn_id: toolCall.turn_id,
        role: "tool",
        content: sanitizeCodexText(result.summary, 2000),
        page_context: { tool_call_id: toolCall.id, tool_name: validated.name, changed: result.changed ?? null, data: result.data ?? null, safety_review: review, undo_available: true }
      }).then(({ error }) => { if (error) throw new Error(error.message); });
    await Promise.all([
      receiptWrite,
      recordEvent("tool.completed", await nextSequence(), { toolCall: { ...data, result: publicResult }, review }),
      auth.supabase.from("ai_conversations").update({ updated_at: completedAt }).eq("id", toolCall.conversation_id)
    ]);
    return new Response(JSON.stringify({ toolCall: { ...data, result: publicResult }, result: publicResult, review, applied: true }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = sanitizeCodexText(error instanceof Error ? error.message : "The change could not be applied.", 1200);
    const completedAt = new Date().toISOString();
    const failedResult = { error: message, ...(review ? { safety_review: review } : {}) };
    const { data } = await auth.supabase.from("ai_tool_calls").update({ status: "failed", result: failedResult, completed_at: completedAt }).eq("id", toolCall.id).select("*").single();
    await recordEvent("tool.failed", await nextSequence(), { toolCall: data, review });
    return jsonError(message, 400, { toolCall: data });
  }
};
