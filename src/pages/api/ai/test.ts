import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { codexRuntimeStatus, runCodexStructured } from "@/server/codex";

export const prerender = false;

const testSchema = z.object({
  ok: z.literal(true),
  message: z.string().min(1).max(80)
});

const testJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "message"],
  properties: {
    ok: { type: "boolean", const: true },
    message: { type: "string" }
  }
} as const;

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  try {
    const runtime = codexRuntimeStatus();
    const result = await runCodexStructured({
      feature: "connection_test",
      prompt: "Return ok true and the message Codex connection verified. Do not inspect files or use tools.",
      schema: testSchema,
      outputSchema: testJsonSchema,
      timeoutMs: 60000,
      reasoningEffort: "low"
    });
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "codex_connection_tested",
      feature_name: "connection_test",
      latency_ms: result.latencyMs,
      success: true,
      fallback_used: false,
      uncertainty_involved: false,
      properties: { model: result.model }
    });
    return new Response(JSON.stringify({
      ok: true,
      message: result.value.message,
      model: result.model,
      reasoningEffort: runtime.reasoningEffort,
      latencyMs: result.latencyMs,
      testedAt: new Date().toISOString()
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Codex did not respond before the 60 second test timeout."
      : error instanceof Error ? error.message : "Codex connection test failed.";
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "codex_connection_tested",
      feature_name: "connection_test",
      latency_ms: null,
      success: false,
      fallback_used: false,
      uncertainty_involved: false,
      properties: { error: message }
    });
    return jsonError(message, 503);
  }
};
