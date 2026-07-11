import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { planningReviewJsonSchema, planningReviewSchema } from "@/server/ai-schemas";
import { buildTransparentReviewPrompt, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus, runCodexStructuredStream } from "@/server/codex";
import { sanitizeCodexEvent, sanitizeCodexText } from "@/server/codex-events";

export const prerender = false;

const requestSchema = z.object({
  focus: z.enum(["plan", "gpa", "activities", "timeline", "scenario", "profile", "connection"]),
  question: z.string().trim().min(1).max(600),
  context: z.record(z.string(), z.unknown())
}).superRefine((value, context) => {
  if (JSON.stringify(value.context).length > 50_000) {
    context.addIssue({ code: "custom", message: "The review snapshot is too large." });
  }
});

const focusInstruction = {
  plan: "Review the overall plan for uncovered requirements, sequencing, workload, and decisions that need verification.",
  gpa: "Explain the GPA evidence and methodology. Flag missing grades, uncertain weighting, or interpretations that should not be treated as official.",
  activities: "Review the factual experience record for time balance, missing context, and reusable evidence. Do not rank the student or inflate an experience.",
  timeline: "Review the next-step queue for ordering, dependencies, and steps that are vague or not tied to current evidence.",
  scenario: "Review the deterministic weekly load comparison and its stated assumptions. Do not turn the hypothetical values into predictions.",
  profile: "Review the saved planning preferences, work values, constraints, and open questions. Suggest a low-risk way to test direction without locking in a major.",
  connection: "Confirm whether this authenticated Codex turn completed and explain the exact access limits shown in the supplied runtime snapshot."
} as const;

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid review request.", 400);
  const runtime = codexRuntimeStatus();
  const encoder = new TextEncoder();
  const exactInstruction = [
    focusInstruction[parsed.data.focus],
    `Student question: ${parsed.data.question}`,
    "Return a concise review grounded only in the supplied snapshot. Evidence must name a field, recorded value, course, task, or stated preference from that snapshot.",
    `SNAPSHOT:\n${JSON.stringify(parsed.data.context)}`
  ].join("\n\n");
  const fullInstruction = buildTransparentReviewPrompt(`${parsed.data.focus}_review`, exactInstruction);
  const runController = new AbortController();
  const runSignal = AbortSignal.any([request.signal, runController.signal]);
  const logBestEffort = (record: Record<string, unknown>) => {
    void Promise.resolve(auth.supabase.from("event_logs").insert(record)).catch(() => undefined);
  };
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (runSignal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          return true;
        } catch {
          return false;
        }
      };
      const startedAt = Date.now();
      let runSequence = 0;
      send({
        kind: "run.started",
        sequence: ++runSequence,
        occurredAt: new Date().toISOString(),
        focus: parsed.data.focus,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        access: { network: false, tools: false, files: false, mutations: false },
        capabilities: CODEX_RUNTIME_CAPABILITIES,
        instruction: fullInstruction
      });
      try {
        const result = await runCodexStructuredStream({
          feature: `${parsed.data.focus}_review`,
          prompt: exactInstruction,
          schema: planningReviewSchema,
          outputSchema: planningReviewJsonSchema,
          timeoutMs: 90_000,
          reasoningEffort: "low",
          signal: runSignal
        }, (event) => {
          send({ kind: "sdk.event", event: sanitizeCodexEvent(event, ++runSequence) });
        });
        const eventCounts = result.events.reduce<Record<string, number>>((counts, event) => {
          const key = event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed"
            ? `${event.type}:${event.item.type}`
            : event.type;
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {});
        const latencyMs = Date.now() - startedAt;
        send({ kind: "run.completed", sequence: ++runSequence, occurredAt: new Date().toISOString(), result: result.value, threadId: result.threadId, model: result.model, reasoningEffort: runtime.reasoningEffort, usage: result.usage, latencyMs, executionLatencyMs: result.latencyMs });
        logBestEffort({
          user_id: auth.user.id,
          event_name: "codex_review_completed",
          feature_name: parsed.data.focus,
          latency_ms: result.latencyMs,
          success: true,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { model: result.model, thread_id: result.threadId, usage: result.usage, event_counts: eventCounts }
        });
      } catch (error) {
        const message = sanitizeCodexText(codexErrorMessage(error, "Codex could not complete this review."), 1200);
        if (!runSignal.aborted) send({ kind: "run.failed", sequence: ++runSequence, occurredAt: new Date().toISOString(), message });
        logBestEffort({
          user_id: auth.user.id,
          event_name: "codex_review_failed",
          feature_name: parsed.data.focus,
          latency_ms: Date.now() - startedAt,
          success: false,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { error_category: runSignal.aborted ? "cancelled" : "codex_turn_failed" }
        });
      } finally {
        try {
          controller.close();
        } catch {
          // The browser may have already cancelled the response stream.
        }
      }
    },
    cancel(reason) {
      runController.abort(reason instanceof Error ? reason : new Error("The browser cancelled the Codex review."));
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
