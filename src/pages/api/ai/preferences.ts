import type { APIRoute } from "astro";
import { z } from "zod";
import { AI_REASONING_EFFORT, aiModelSchema } from "@/lib/ai-preferences";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

const preferenceSchema = z.object({
  enabled: z.boolean(),
  model: aiModelSchema,
  approved: z.boolean()
}).superRefine((value, context) => {
  if (value.enabled && !value.approved) context.addIssue({ code: "custom", message: "Approve the Codex connection before enabling Pilot." });
});

export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  try {
    const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
    return new Response(JSON.stringify({ preferences }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "AI preferences could not be loaded.", 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid AI preferences.", 400);
  const current = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (parsed.data.enabled && (!current.testedAt || current.model !== parsed.data.model)) {
    return jsonError("Test the selected model before enabling Pilot.", 400);
  }
  const approvedAt = parsed.data.enabled ? new Date().toISOString() : null;
  const { error } = await auth.supabase.from("student_profiles").update({
    ai_enabled: parsed.data.enabled,
    ai_model: parsed.data.model,
    ai_reasoning_effort: AI_REASONING_EFFORT,
    ai_connection_approved_at: approvedAt,
    ai_setup_tested_at: parsed.data.enabled ? current.testedAt : null
  }).eq("id", auth.user.id);
  if (error) return jsonError(error.message, 500);
  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  return new Response(JSON.stringify({ preferences }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
