import type { APIRoute } from "astro";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { assistantImageExtension, MAX_ASSISTANT_ATTACHMENTS, safeAssistantImageName, validateAssistantImage } from "@/lib/ai-attachments";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import type { AiMessage } from "@/lib/models";
import { assistantUndoIntent, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, runAssistantChat, type AssistantRecentChange, type AssistantRecentToolEvidence } from "@/server/codex";
import { assistantToolLabel, executeAssistantReadTool } from "@/server/ai-tools";
import { assistantUndoAvailability } from "@/server/assistant-undo";
import { retrieveAssistantKnowledge, type AssistantKnowledgeChunk } from "@/server/ai-knowledge";
import { explicitDurableMemoryUpdates, persistAssistantMemoryUpdates, retrieveAssistantMemories, type AssistantMemory } from "@/server/ai-memory";
import { loadUserAiPreferences } from "@/server/ai-preferences";
import { sanitizeCodexEvent, sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { classifyAssistantRequest } from "@/server/assistant-request-scope";

export const prerender = false;

const requestSchema = z.object({
  conversationId: z.uuid(),
  turnId: z.uuid().optional(),
  messageId: z.uuid(),
  message: z.string().trim().max(4000),
  attachments: z.array(z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    storagePath: z.string().trim().min(1).max(500)
  })).max(MAX_ASSISTANT_ATTACHMENTS).default([])
});

function boundedToolEvidence(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value ?? null;
  if (typeof value === "string") return value.length > 400 ? `${value.slice(0, 397)}…` : value;
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : "[details omitted]";
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => boundedToolEvidence(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 16).map(([key, item]) => [key, boundedToolEvidence(item, depth + 1)]));
  }
  return String(value);
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid assistant request.", 400);
  if (!parsed.data.message && !parsed.data.attachments.length) return jsonError("Add a message or an image.", 400);
  for (const attachment of parsed.data.attachments) {
    const validationError = validateAssistantImage({
      name: attachment.name,
      type: attachment.mimeType,
      size: attachment.sizeBytes
    });
    if (validationError) return jsonError(validationError, 400);
    const expectedPath = `${auth.user.id}/${parsed.data.conversationId}/${parsed.data.messageId}/${attachment.id}-${safeAssistantImageName(attachment.name)}`;
    if (attachment.storagePath !== expectedPath) return jsonError("Invalid assistant attachment path.", 400);
  }
  const uploadedPaths = parsed.data.attachments.map((attachment) => attachment.storagePath);
  const cleanupUnclaimedUploads = async () => {
    if (uploadedPaths.length) await auth.supabase.storage.from("ai-attachments").remove(uploadedPaths).catch(() => undefined);
  };
  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) {
    await cleanupUnclaimedUploads();
    return jsonError("Connect and approve Pilot Assistant before starting a conversation.", 403);
  }
  const conversationResult = await auth.supabase.from("ai_conversations").select("*").eq("id", parsed.data.conversationId).eq("user_id", auth.user.id).single();
  if (conversationResult.error || !conversationResult.data) {
    await cleanupUnclaimedUploads();
    return jsonError("Conversation not found.", 404);
  }

  const rateLimitResult = await auth.supabase.rpc("acquire_assistant_turn_v1");
  if (rateLimitResult.error) {
    await cleanupUnclaimedUploads();
    return jsonError("Pilot request protection is unavailable. Try again shortly.", 503);
  }
  const rateLimit = Array.isArray(rateLimitResult.data) ? rateLimitResult.data[0] : rateLimitResult.data;
  if (!rateLimit?.allowed) {
    await cleanupUnclaimedUploads();
    const retryAfter = Math.max(1, Number(rateLimit?.retry_after_seconds ?? 60));
    const response = jsonError("Too many Pilot requests. Wait a moment and try again.", 429);
    response.headers.set("retry-after", String(retryAfter));
    return response;
  }

  const turnId = parsed.data.turnId ?? crypto.randomUUID();
  const userMessageResult = await auth.supabase.from("ai_messages").insert({
    id: parsed.data.messageId,
    conversation_id: parsed.data.conversationId,
    user_id: auth.user.id,
    turn_id: turnId,
    role: "user",
    content: parsed.data.message,
    page_context: {}
  }).select("*").single();
  if (userMessageResult.error) {
    await cleanupUnclaimedUploads();
    return jsonError(userMessageResult.error.message, 500);
  }

  const attachmentRows = parsed.data.attachments.map((attachment) => ({
    id: attachment.id,
    conversation_id: parsed.data.conversationId,
    message_id: userMessageResult.data.id,
    user_id: auth.user.id,
    name: attachment.name,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    storage_path: attachment.storagePath
  }));
  try {
    if (attachmentRows.length) {
      const attachmentResult = await auth.supabase.from("ai_message_attachments").insert(attachmentRows);
      if (attachmentResult.error) throw attachmentResult.error;
    }
  } catch (error) {
    if (uploadedPaths.length) await auth.supabase.storage.from("ai-attachments").remove(uploadedPaths).catch(() => undefined);
    await auth.supabase.from("ai_messages").delete().eq("id", userMessageResult.data.id);
    return jsonError(error instanceof Error ? error.message : "The images could not be uploaded.", 500);
  }

  const toolHistoryLimit = assistantUndoIntent(parsed.data.message) ? 120 : 10;
  const [historyResult, toolHistoryResult] = await Promise.all([
    auth.supabase.from("ai_messages").select("*").eq("conversation_id", parsed.data.conversationId).neq("id", userMessageResult.data.id).order("created_at", { ascending: false }).limit(12),
    auth.supabase.from("ai_tool_calls").select("id,tool_name,result,completed_at,mutates_data").eq("conversation_id", parsed.data.conversationId).eq("user_id", auth.user.id).eq("status", "completed").order("completed_at", { ascending: false }).limit(toolHistoryLimit)
  ]);
  if (historyResult.error) return jsonError(historyResult.error.message, 500);
  if (toolHistoryResult.error) return jsonError(toolHistoryResult.error.message, 500);
  const history = ([...(historyResult.data ?? [])].reverse() as unknown as AiMessage[]).map((message) => {
    const context = message.page_context && typeof message.page_context === "object" && !Array.isArray(message.page_context)
      ? message.page_context as Record<string, unknown>
      : {};
    const data = context.data && typeof context.data === "object" && !Array.isArray(context.data)
      ? context.data as Record<string, unknown>
      : null;
    const actionContext = message.role === "tool" && typeof context.tool_call_id === "string" && typeof context.tool_name === "string"
      ? {
          toolCallId: context.tool_call_id,
          toolName: context.tool_name,
          data,
          undoAvailable: context.undo_available === true,
          undoneAt: typeof context.undone_at === "string" ? context.undone_at : null
        }
      : undefined;
    return { role: message.role, content: message.content, actionContext };
  });
  const recentChanges = (toolHistoryResult.data ?? []).flatMap((toolCall): AssistantRecentChange[] => {
    const result = toolCall.result && typeof toolCall.result === "object" && !Array.isArray(toolCall.result)
      ? toolCall.result as Record<string, unknown>
      : null;
    if (!toolCall.mutates_data || !result || !("undo" in result)) return [];
    const availability = assistantUndoAvailability(result);
    const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? sanitizeCodexValue(result.data) as Record<string, unknown>
      : null;
    return [{
      toolCallId: toolCall.id,
      toolName: toolCall.tool_name,
      label: assistantToolLabel(toolCall.tool_name),
      summary: sanitizeCodexText(String(result.summary ?? assistantToolLabel(toolCall.tool_name)), 500),
      data,
      completedAt: toolCall.completed_at ?? "",
      undoAvailable: availability.available,
      undoneAt: availability.undoneAt,
      undoExpiresAt: availability.expiresAt
    }];
  });
  const recentToolEvidence = (toolHistoryResult.data ?? []).flatMap((toolCall): AssistantRecentToolEvidence[] => {
    const result = toolCall.result && typeof toolCall.result === "object" && !Array.isArray(toolCall.result)
      ? toolCall.result as Record<string, unknown>
      : null;
    if (!result) return [];
    return [{
      toolCallId: toolCall.id,
      toolName: toolCall.tool_name,
      label: assistantToolLabel(toolCall.tool_name),
      summary: sanitizeCodexText(String(result.summary ?? assistantToolLabel(toolCall.tool_name)), 500),
      data: boundedToolEvidence(result.data),
      completedAt: toolCall.completed_at ?? "",
      mutatesData: toolCall.mutates_data === true
    }];
  });
  const encoder = new TextEncoder();
  const runController = new AbortController();
  const signal = AbortSignal.any([request.signal, runController.signal]);
  const eventRows: Array<Record<string, unknown>> = [];
  let sequence = 0;

  const stream = new ReadableStream({
    async start(controller) {
      let attachmentDirectory: string | null = null;
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
      record("turn.started", { turnId, capabilities: CODEX_RUNTIME_CAPABILITIES, attachmentCount: attachmentRows.length });
      try {
        let knowledge: AssistantKnowledgeChunk[] = [];
        let memories: AssistantMemory[] = [];
        const requestScope = classifyAssistantRequest(parsed.data.message);
        const needsKnowledge = !["settings", "destructive", "targeted_course_edit"].includes(requestScope);
        const needsMemory = ["full_plan", "plan_optimization", "course_batch"].includes(requestScope);
        const [knowledgeResult, memoryResult] = await Promise.allSettled([
          needsKnowledge ? retrieveAssistantKnowledge(auth.supabase, parsed.data.message) : Promise.resolve([]),
          needsMemory ? retrieveAssistantMemories(auth.supabase, parsed.data.message) : Promise.resolve([])
        ]);
        if (needsKnowledge && knowledgeResult.status === "fulfilled") {
          knowledge = knowledgeResult.value;
          record("knowledge.retrieved", {
            chunks: knowledge.map((chunk) => ({ id: chunk.id, title: chunk.title, sourcePath: chunk.sourcePath, score: chunk.score, matchReason: chunk.matchReason })),
            summary: `Retrieved ${knowledge.length} application-guidance ${knowledge.length === 1 ? "chunk" : "chunks"}.`
          });
        } else if (needsKnowledge && knowledgeResult.status === "rejected") {
          record("knowledge.failed", {
            summary: knowledgeResult.reason instanceof Error ? knowledgeResult.reason.message : "Pilot application guidance could not be retrieved."
          });
        }
        if (needsMemory && memoryResult.status === "fulfilled") {
          memories = memoryResult.value;
          record("memory.retrieved", { count: memories.length, summary: `Retrieved ${memories.length} relevant student ${memories.length === 1 ? "memory" : "memories"}.` });
        } else if (needsMemory && memoryResult.status === "rejected") {
          record("memory.failed", { summary: memoryResult.reason instanceof Error ? memoryResult.reason.message : "Pilot memory could not be retrieved." });
        }
        const localImages: Array<{ type: "local_image"; path: string }> = [];
        if (attachmentRows.length) {
          attachmentDirectory = await mkdtemp(join(tmpdir(), "pilot-princess-images-"));
          for (const [index, attachment] of attachmentRows.entries()) {
            const download = await auth.supabase.storage.from("ai-attachments").download(attachment.storage_path);
            if (download.error || !download.data) throw download.error ?? new Error(`Could not read ${attachment.name}.`);
            const path = join(attachmentDirectory, `${index + 1}${assistantImageExtension(attachment.mime_type)}`);
            await writeFile(path, Buffer.from(await download.data.arrayBuffer()));
            localImages.push({ type: "local_image", path });
          }
          record("attachments.received", {
            attachments: attachmentRows.map(({ id, name, mime_type, size_bytes }) => ({ id, name, mimeType: mime_type, sizeBytes: size_bytes })),
            summary: `${attachmentRows.length} ${attachmentRows.length === 1 ? "image" : "images"} provided by the student.`
          });
        }
        const result = await runAssistantChat({
          history,
          userMessage: parsed.data.message,
          images: localImages,
          imageNames: attachmentRows.map((attachment) => attachment.name),
          model: preferences.model,
          reasoningEffort: preferences.reasoningEffort,
          knowledge,
          memories,
          recentChanges,
          recentToolEvidence,
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
          page_context: { model: result.model, provider_thread_id: result.threadId, questions: sanitizeCodexValue(result.questions) }
        }).select("*").single();
        if (assistantResult.error) throw new Error(assistantResult.error.message);
        const durableMemoryUpdates = explicitDurableMemoryUpdates(parsed.data.message, result.memoryUpdates ?? []);
        if (durableMemoryUpdates.length) {
          try {
            const memoryChange = await persistAssistantMemoryUpdates(auth.supabase, auth.user.id, parsed.data.conversationId, turnId, durableMemoryUpdates);
            record("memory.updated", { ...memoryChange, summary: `Updated ${memoryChange.remembered + memoryChange.forgotten} lightweight student ${memoryChange.remembered + memoryChange.forgotten === 1 ? "memory" : "memories"}.` });
          } catch (error) {
            record("memory.failed", { summary: error instanceof Error ? error.message : "Pilot memory could not be updated." });
          }
        }
        record("assistant.message", { message: assistantResult.data });
        const turnLatencyMs = Date.now() - startedAt;
        record("turn.completed", { turnId, latencyMs: turnLatencyMs, model: result.model, usage: result.usage, proposalCount: result.proposals.length });
        const title = conversationResult.data.title === "New conversation"
          ? (parsed.data.message || (attachmentRows.length === 1 ? attachmentRows[0].name : `${attachmentRows.length} images`)).replace(/\s+/g, " ").slice(0, 56)
          : conversationResult.data.title;
        await auth.supabase.from("ai_conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", parsed.data.conversationId);
        send({ kind: "turn.completed", turnId, assistantMessage: assistantResult.data, proposals: result.proposals, runtime: { model: result.model, threadId: result.threadId, usage: result.usage, latencyMs: turnLatencyMs } });
        void auth.supabase.from("event_logs").insert({
          user_id: auth.user.id,
          event_name: "assistant_turn_completed",
          feature_name: "global_assistant",
          latency_ms: turnLatencyMs,
          success: true,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { conversation_id: parsed.data.conversationId, tool_count: result.proposals.length, model: result.model }
        });
      } catch (error) {
        const message = sanitizeCodexText(codexErrorMessage(error, "Pilot Assistant could not complete that request."), 1200);
        if (signal.aborted) {
          record("turn.cancelled", { turnId, message: "Stopped by the student." });
        } else {
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
        if (attachmentDirectory) await rm(attachmentDirectory, { recursive: true, force: true }).catch(() => undefined);
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
