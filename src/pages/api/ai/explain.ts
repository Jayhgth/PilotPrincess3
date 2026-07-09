import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import {
  explanationJsonSchema,
  explanationSchema,
  summaryJsonSchema,
  summarySchema
} from "@/server/ai-schemas";
import { runCodexStructured } from "@/server/codex";

export const prerender = false;

const requestSchema = z.object({
  feature: z.enum(["plan", "simulation", "summary"]),
  context: z.record(z.string(), z.unknown()),
  fallbackSummary: z.string().max(1600).optional()
});

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid explanation request.", 400);
  const startedAt = Date.now();

  try {
    if (parsed.data.feature === "summary") {
      const result = await runCodexStructured({
        feature: "student_summary",
        prompt: [
          "Write a concise, factual progress summary for the student.",
          "Use plain language. State that GPA and graduation results are estimates and should be verified with d.tech.",
          "Do not add data that is not present.",
          JSON.stringify(parsed.data.context)
        ].join("\n\n"),
        schema: summarySchema,
        outputSchema: summaryJsonSchema
      });
      await auth.supabase.from("event_logs").insert({
        user_id: auth.user.id,
        event_name: "summary_generated",
        feature_name: "summary",
        latency_ms: result.latencyMs,
        success: true,
        fallback_used: false,
        uncertainty_involved: true
      });
      return new Response(JSON.stringify({ result: result.value, fallbackUsed: false }), {
        headers: { "content-type": "application/json" }
      });
    }

    const result = await runCodexStructured({
      feature: parsed.data.feature === "plan" ? "plan_explanation" : "simulation_explanation",
      prompt: [
        parsed.data.feature === "plan"
          ? "Explain this suggested four-year plan, its workload tradeoffs, and questions the student should verify."
          : "Explain the comparison between the current and simulated plans in plain language.",
        "Do not guarantee admissions outcomes. Do not imply uncertain mappings are verified.",
        JSON.stringify(parsed.data.context)
      ].join("\n\n"),
      schema: explanationSchema,
      outputSchema: explanationJsonSchema
    });
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: parsed.data.feature === "plan" ? "plan_explained" : "simulation_explained",
      feature_name: parsed.data.feature,
      latency_ms: result.latencyMs,
      success: true,
      fallback_used: false,
      uncertainty_involved: true
    });
    return new Response(JSON.stringify({ result: result.value, fallbackUsed: false }), {
      headers: { "content-type": "application/json" }
    });
  } catch {
    const fallback =
      parsed.data.feature === "summary"
        ? { summary: parsed.data.fallbackSummary ?? "A summary is temporarily unavailable. Your saved plan and trackers still work." }
        : {
            summary: parsed.data.fallbackSummary ?? "The comparison is available, but the AI explanation is temporarily unavailable.",
            what_changed: [],
            tradeoffs: [],
            risks: ["Verify graduation mappings, workload, and policy details with d.tech counseling."],
            counselor_questions: ["Which plan details should I verify before course registration?"]
          };
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "ai_call_failed",
      feature_name: parsed.data.feature,
      latency_ms: Date.now() - startedAt,
      success: false,
      fallback_used: true,
      uncertainty_involved: true
    });
    return new Response(JSON.stringify({ result: fallback, fallbackUsed: true }), {
      headers: { "content-type": "application/json" }
    });
  }
};
