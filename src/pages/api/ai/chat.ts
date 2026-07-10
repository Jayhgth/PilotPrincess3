import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { codexErrorMessage, codexRuntimeStatus, runCodexStructured } from "@/server/codex";

export const prerender = false;

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(1200)
  })).min(1).max(8)
}).refine((value) => value.messages.at(-1)?.role === "user", {
  message: "The final message must be from the user."
});

const responseSchema = z.object({
  reply: z.string().min(1).max(1200)
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: {
    reply: { type: "string" }
  }
} as const;

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "A valid test message is required.", 400);

  const transcript = parsed.data.messages
    .map((message) => `${message.role === "user" ? "Student" : "Codex"}: ${message.content}`)
    .join("\n\n");
  const runtime = codexRuntimeStatus();

  try {
    const result = await runCodexStructured({
      feature: "diagnostics_chat",
      prompt: [
        "Respond to the final student message in this bounded AI integration test.",
        "Use one to four concise sentences. Do not claim access to any student record, file, database, or tool.",
        "If asked what this test proves, explain that it verifies an authenticated server-side Codex request and structured response, not every product feature.",
        `The server selected ${runtime.model} with ${runtime.reasoningEffort} reasoning for this request. Treat that runtime metadata as authoritative and state it plainly when asked.`,
        `CONVERSATION:\n${transcript}`
      ].join("\n\n"),
      schema: responseSchema,
      outputSchema: responseJsonSchema,
      timeoutMs: 60000,
      reasoningEffort: "low"
    });

    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "codex_diagnostics_chat_completed",
      feature_name: "diagnostics_chat",
      latency_ms: result.latencyMs,
      success: true,
      fallback_used: false,
      uncertainty_involved: false,
      properties: { model: result.model, message_count: parsed.data.messages.length }
    });

    return new Response(JSON.stringify({
      ok: true,
      reply: result.value.reply,
      model: result.model,
      reasoningEffort: runtime.reasoningEffort,
      latencyMs: result.latencyMs,
      testedAt: new Date().toISOString()
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Codex did not respond before the 60 second chat timeout."
      : codexErrorMessage(error, "Codex diagnostics chat failed.");
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "codex_diagnostics_chat_failed",
      feature_name: "diagnostics_chat",
      success: false,
      fallback_used: false,
      uncertainty_involved: false,
      properties: { error: message }
    });
    return jsonError(message, 503);
  }
};
