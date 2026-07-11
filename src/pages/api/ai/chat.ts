import type { APIRoute } from "astro";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { assistantImageExtension, MAX_ASSISTANT_ATTACHMENTS, safeAssistantImageName, validateAssistantImage } from "@/lib/ai-attachments";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import type { AiMessage } from "@/lib/models";
import { CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, runAssistantChat } from "@/server/codex";
import { executeAssistantReadTool } from "@/server/ai-tools";
import { assistantKnowledgePrompt, retrieveAssistantKnowledge } from "@/server/assistant-knowledge";
import { loadUserAiPreferences } from "@/server/ai-preferences";
import { sanitizeCodexEvent, sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";

export const prerender = false;

const requestSchema = z.object({
  conversationId: z.uuid(),
  turnId: z.uuid().optional(),
  message: z.string().trim().max(4000),
  pageContext: z.record(z.string(), z.unknown()).default({})
}).superRefine((value, context) => {
  if (JSON.stringify(value.pageContext).length > 12_000) context.addIssue({ code: "custom", message: "The page context is too large." });
});

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("Invalid assistant request.", 400);
  const files = form.getAll("images").filter((entry): entry is File => entry instanceof File);
  let pageContext: unknown;
  try {
    pageContext = JSON.parse(String(form.get("pageContext") ?? "{}"));
  } catch {
    return jsonError("The page context is invalid.", 400);
  }
  const parsed = requestSchema.safeParse({
    conversationId: String(form.get("conversationId") ?? ""),
    turnId: form.get("turnId") ? String(form.get("turnId")) : undefined,
    message: String(form.get("message") ?? ""),
    pageContext
  });
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid assistant request.", 400);
  if (!parsed.data.message && !files.length) return jsonError("Add a message or an image.", 400);
  if (files.length > MAX_ASSISTANT_ATTACHMENTS) return jsonError(`Add no more than ${MAX_ASSISTANT_ATTACHMENTS} images.`, 400);
  for (const file of files) {
    const validationError = validateAssistantImage(file);
    if (validationError) return jsonError(validationError, 400);
  }
  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) return jsonError("Connect and approve Pilot Assistant before starting a conversation.", 403);
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

  const uploadedPaths: string[] = [];
  const attachmentRows: Array<{
    id: string;
    conversation_id: string;
    message_id: string;
    user_id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
  }> = [];
  try {
    for (const file of files) {
      const id = crypto.randomUUID();
      const storagePath = `${auth.user.id}/${parsed.data.conversationId}/${userMessageResult.data.id}/${id}-${safeAssistantImageName(file.name)}`;
      const upload = await auth.supabase.storage.from("ai-attachments").upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false
      });
      if (upload.error) throw upload.error;
      uploadedPaths.push(storagePath);
      attachmentRows.push({
        id,
        conversation_id: parsed.data.conversationId,
        message_id: userMessageResult.data.id,
        user_id: auth.user.id,
        name: file.name.slice(0, 120),
        mime_type: file.type,
        size_bytes: file.size,
        storage_path: storagePath
      });
    }
    if (attachmentRows.length) {
      const attachmentResult = await auth.supabase.from("ai_message_attachments").insert(attachmentRows);
      if (attachmentResult.error) throw attachmentResult.error;
    }
  } catch (error) {
    if (uploadedPaths.length) await auth.supabase.storage.from("ai-attachments").remove(uploadedPaths).catch(() => undefined);
    await auth.supabase.from("ai_messages").delete().eq("id", userMessageResult.data.id);
    return jsonError(error instanceof Error ? error.message : "The images could not be uploaded.", 500);
  }

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
        const knowledge = await retrieveAssistantKnowledge(auth.supabase, parsed.data.message || "student image attachment", parsed.data.pageContext);
        record("retrieval.completed", {
          sources: knowledge.map((chunk) => ({ id: chunk.id, title: chunk.title, sourcePath: chunk.sourcePath })),
          summary: `Used ${knowledge.length} Pilot Princess guidance ${knowledge.length === 1 ? "source" : "sources"}.`
        });
        const result = await runAssistantChat({
          history,
          userMessage: parsed.data.message,
          images: localImages,
          imageNames: attachmentRows.map((attachment) => attachment.name),
          pageContext: parsed.data.pageContext,
          knowledge: assistantKnowledgePrompt(knowledge),
          model: preferences.model,
          reviewMode: preferences.reviewMode,
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
        record("assistant.message", { message: assistantResult.data });
        record("turn.completed", { turnId, latencyMs: result.latencyMs, model: result.model, usage: result.usage, proposalCount: result.proposals.length });
        const title = conversationResult.data.title === "New conversation"
          ? (parsed.data.message || (attachmentRows.length === 1 ? attachmentRows[0].name : `${attachmentRows.length} images`)).replace(/\s+/g, " ").slice(0, 56)
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
