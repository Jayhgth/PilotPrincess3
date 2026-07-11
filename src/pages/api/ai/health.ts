import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { AI_MODEL_OPTIONS, AI_REASONING_EFFORT, aiModelSchema } from "@/lib/ai-preferences";
import { probeCodexRuntimeStatus, runCodexStructured } from "@/server/codex";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const [status, preferences] = await Promise.all([
    probeCodexRuntimeStatus({ force: url.searchParams.get("refresh") === "1" }),
    loadUserAiPreferences(auth.supabase, auth.user.id)
  ]);
  return new Response(JSON.stringify({ ...status, preferences, models: AI_MODEL_OPTIONS }), {
    headers: { "content-type": "application/json" }
  });
};

const testRequestSchema = z.object({ model: aiModelSchema, approved: z.literal(true) });
const testResultSchema = z.object({ status: z.literal("ready"), message: z.string().min(1).max(160) });
const testResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "message"],
  properties: {
    status: { type: "string", enum: ["ready"] },
    message: { type: "string" }
  }
} as const;

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = testRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a supported Codex model.", 400);
  try {
    const result = await runCodexStructured({
      feature: "connection_test",
      prompt: "Return status ready and the message Connection verified. Do not add other text.",
      schema: testResultSchema,
      outputSchema: testResultJsonSchema,
      model: parsed.data.model,
      reasoningEffort: AI_REASONING_EFFORT,
      timeoutMs: 45_000,
      signal: request.signal
    });
    const testedAt = new Date().toISOString();
    const { error: preferenceError } = await auth.supabase.from("student_profiles").update({
      ai_model: parsed.data.model,
      ai_reasoning_effort: AI_REASONING_EFFORT,
      ai_setup_tested_at: testedAt
    }).eq("id", auth.user.id);
    if (preferenceError) return jsonError("The successful connection test could not be recorded.", 500);
    return new Response(JSON.stringify({
      connected: true,
      model: result.model,
      reasoningEffort: AI_REASONING_EFFORT,
      latencyMs: result.latencyMs,
      testedAt,
      message: "Codex responded successfully."
    }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Codex did not respond.", 503);
  }
};
