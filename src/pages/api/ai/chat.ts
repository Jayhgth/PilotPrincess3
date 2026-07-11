import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import type { AiMessage } from "@/lib/models";
import { CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, runAssistantChat } from "@/server/codex";
import { executeAssistantReadTool } from "@/server/ai-tools";
import { sanitizeCodexEvent, sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";

export const prerender = false;

const requestSchema = z.object({
  conversationId: z.uuid(),
  turnId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  pageContext: z.record(z.string(), z.unknown()).default({})
}).superRefine((value, context) => {
  if (JSON.stringify(value.pageContext).length > 12_000) context.addIssue({ code: "custom", message: "The page context is too large." });
});

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid assistant request.", 400);
  const conversationResult = await auth.supabase.from("ai_conversations").select("*").eq("id", parsed.data.conversationId).eq("user_id", auth.user.id).single();
  if (conversationResult.error || !conversationResult.data) return jsonError("Conversation not found.", 404);

  const turnId = parsed.data.turnId ?? crypto.randomUUID();
  const userMessageResult = await auth.supabase.from("ai_messages").insert({
    conversation_id: parsed.data.conversationId,
    user_id: auth.user.id,
    turn_id: turnId,
    role: "user",
    content: parsed.data.message,
    page_context: sanitizeCodexValue(parsed.data.pageContext)
  }).select("*").single();
  if (userMessageResult.error) return jsonError(userMessageResult.error.message, 500);

  const historyResult = await auth.supabase.from("ai_messages").select("*").eq("conversation_id", parsed.data.conversationId).neq("id", userMessageResult.data.id).order("created_at", { ascending: false }).limit(24);
  if (historyResult.error) return jsonError(historyResult.error.message, 500);
  const history = ([...(historyResult.data ?? [])].reverse() as unknown as AiMessage[]).map((message) => ({ role: message.role, content: message.content }));
  const encoder = new TextEncoder();
  const runController = new AbortController();
  const signal = AbortSignal.any([request.signal, runController.signal]);
  const eventRows: Array<Record<string, unknown>> = [];
  let sequence = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          return true;
        } catch {
          return false;
        }
      };
      const record = (eventType: string, payload: Record<string, unknown>) => {
        const event = {
          source: eventType.startsWith("sdk.") ? "sdk" : "application",
          type: eventType.replace(/^sdk\./, ""),
          sequence: ++sequence,
          occurredAt: new Date().toISOString(),
          turnId,
          ...sanitizeCodexValue(payload) as Record<string, unknown>
        };
        eventRows.push({
          conversation_id: parsed.data.conversationId,
          user_id: auth.user.id,
          turn_id: turnId,
          sequence,
          event_type: eventType,
          payload: event
        });
        send({ kind: "activity", event });
        return event;
      };

      const startedAt = Date.now();
      record("turn.started", { turnId, capabilities: CODEX_RUNTIME_CAPABILITIES });
      try {
        const result = await runAssistantChat({
          history,
          userMessage: parsed.data.message,
          pageContext: parsed.data.pageContext,
          signal,
          executeReadTool: (name, argumentsValue) => executeAssistantReadTool(auth.supabase, auth.user.id, name, argumentsValue),
          onSdkEvent: (event, iteration) => {
            const sanitized = sanitizeCodexEvent(event, sequence + 1);
            record(`sdk.${event.type}`, { iteration, item: "item" in sanitized ? sanitized.item : undefined, usage: "usage" in sanitized ? sanitized.usage : undefined, message: "message" in sanitized ? sanitized.message : undefined, threadId: "threadId" in sanitized ? sanitized.threadId : undefined });
          },
          onToolActivity: async (activity) => {
            const status = activity.status === "started" ? "running" : activity.status;
            if (activity.status === "started" || activity.status === "pending_confirmation") {
              const { error } = await auth.supabase.from("ai_tool_calls").insert({
                id: activity.id,
                conversation_id: parsed.data.conversationId,
                user_id: auth.user.id,
                turn_id: turnId,
                tool_name: activity.name,
                arguments: sanitizeCodexValue(activity.arguments),
                explanation: sanitizeCodexText(activity.explanation, 1200),
                mutates_data: activity.mutatesData,
                status
              });
              if (error) throw new Error(error.message);
            } else {
              const { error } = await auth.supabase.from("ai_tool_calls").update({
                status,
                result: sanitizeCodexValue(activity.result ?? (activity.error ? { error: activity.error } : {})),
                completed_at: new Date().toISOString()
              }).eq("id", activity.id);
              if (error) throw new Error(error.message);
            }
            record(`tool.${activity.status}`, {
              toolCall: {
                id: activity.id,
                tool_name: activity.name,
                label: activity.label,
                arguments: activity.arguments,
                explanation: activity.explanation,
                mutates_data: activity.mutatesData,
                status,
                result: activity.result,
                error: activity.error
              }
            });
          }
        });
        const assistantMessage = sanitizeCodexText(result.message, 12_000).trim();
        const assistantResult = await auth.supabase.from("ai_messages").insert({
          conversation_id: parsed.data.conversationId,
          user_id: auth.user.id,
          turn_id: turnId,
          role: "assistant",
          content: assistantMessage,
          page_context: { model: result.model, provider_thread_id: result.threadId }
        }).select("*").single();
        if (assistantResult.error) throw new Error(assistantResult.error.message);
        record("assistant.message", { message: assistantResult.data });
        record("turn.completed", { turnId, latencyMs: result.latencyMs, model: result.model, usage: result.usage, proposalCount: result.proposals.length });
        const title = conversationResult.data.title === "New conversation"
          ? parsed.data.message.replace(/\s+/g, " ").slice(0, 56)
          : conversationResult.data.title;
        await auth.supabase.from("ai_conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", parsed.data.conversationId);
        send({ kind: "turn.completed", turnId, assistantMessage: assistantResult.data, proposals: result.proposals, runtime: { model: result.model, threadId: result.threadId, usage: result.usage, latencyMs: result.latencyMs } });
        void auth.supabase.from("event_logs").insert({
          user_id: auth.user.id,
          event_name: "assistant_turn_completed",
          feature_name: "global_assistant",
          latency_ms: result.latencyMs,
          success: true,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { conversation_id: parsed.data.conversationId, tool_count: result.proposals.length, model: result.model }
        });
      } catch (error) {
        const message = sanitizeCodexText(codexErrorMessage(error, "Pilot Assistant could not complete that request."), 1200);
        if (!signal.aborted) {
          record("turn.failed", { turnId, message });
          send({ kind: "turn.failed", turnId, message });
        }
        void auth.supabase.from("event_logs").insert({
          user_id: auth.user.id,
          event_name: "assistant_turn_failed",
          feature_name: "global_assistant",
          latency_ms: Date.now() - startedAt,
          success: false,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { conversation_id: parsed.data.conversationId, error_category: signal.aborted ? "cancelled" : "assistant_turn_failed" }
        });
      } finally {
        if (eventRows.length) await auth.supabase.from("ai_events").insert(eventRows).then(() => undefined, () => undefined);
        try { controller.close(); } catch { /* The client may have closed the stream. */ }
      }
    },
    cancel(reason) {
      runController.abort(reason instanceof Error ? reason : new Error("The browser cancelled the assistant turn."));
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no"
    }
  });
};
