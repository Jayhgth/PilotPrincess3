import type { APIRoute } from "astro";
import { z } from "zod";
import { aiReviewModeSchema } from "@/lib/ai-preferences";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { loadUserAiPreferences } from "@/server/ai-preferences";

export const prerender = false;

const requestSchema = z.object({ mode: aiReviewModeSchema });

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose Manual or Auto-review.", 400);
  const preferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  if (!preferences.enabled || !preferences.approvedAt) return jsonError("Connect Pilot Assistant before changing review mode.", 403);
  const { error } = await auth.supabase.from("student_settings").update({ ai_review_mode: parsed.data.mode }).eq("id", auth.user.id);
  if (error) return jsonError(error.message, 500);
  return new Response(JSON.stringify({ mode: parsed.data.mode }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
