import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { planningReviewJsonSchema, planningReviewSchema } from "@/server/ai-schemas";
import { buildTransparentReviewPrompt, codexErrorMessage, codexRuntimeStatus, runCodexStructuredStream } from "@/server/codex";

export const prerender = false;

const requestSchema = z.object({
  focus: z.enum(["plan", "gpa", "activities", "timeline", "scenario", "profile"]),
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
  activities: "Review the experience portfolio for time balance, missing context, reflection opportunities, and application-ready details. Do not rank the student.",
  timeline: "Prioritize the next few actions, explain dependencies, and identify tasks that are vague or not tied to current evidence.",
  scenario: "Review the deterministic scenario comparison, its tradeoffs, and assumptions. Do not claim the hypothetical values are predictions.",
  profile: "Review the student's stated interests, work values, constraints, and open questions. Suggest low-risk ways to test directions without locking in a major."
} as const;

function safeEvent(event: Parameters<Parameters<typeof runCodexStructuredStream>[1]>[0]) {
  if (event.type === "thread.started") return { type: event.type, threadId: event.thread_id };
  if (event.type === "turn.started") return { type: event.type };
  if (event.type === "turn.completed") return { type: event.type, usage: event.usage };
  if (event.type === "turn.failed") return { type: event.type, message: event.error.message };
  if (event.type === "error") return { type: event.type, message: event.message };
  const item = event.item;
  if (item.type === "reasoning") return { type: event.type, item: { id: item.id, type: item.type, text: item.text } };
  if (item.type === "agent_message") return { type: event.type, item: { id: item.id, type: item.type, text: event.type === "item.completed" ? item.text : "" } };
  if (item.type === "command_execution") return { type: event.type, item: { id: item.id, type: item.type, command: item.command, status: item.status, exitCode: item.exit_code } };
  if (item.type === "file_change") return { type: event.type, item: { id: item.id, type: item.type, changes: item.changes, status: item.status } };
  if (item.type === "mcp_tool_call") return { type: event.type, item: { id: item.id, type: item.type, server: item.server, tool: item.tool, arguments: item.arguments, status: item.status, error: item.error?.message } };
  if (item.type === "web_search") return { type: event.type, item: { id: item.id, type: item.type, query: item.query } };
  if (item.type === "todo_list") return { type: event.type, item: { id: item.id, type: item.type, items: item.items } };
  return { type: event.type, item: { id: item.id, type: item.type, message: item.message } };
}

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
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      const startedAt = Date.now();
      send({
        kind: "run.started",
        focus: parsed.data.focus,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        access: { network: false, tools: false, files: false, mutations: false },
        instruction: fullInstruction,
        context: parsed.data.context
      });
      try {
        const result = await runCodexStructuredStream({
          feature: `${parsed.data.focus}_review`,
          prompt: exactInstruction,
          schema: planningReviewSchema,
          outputSchema: planningReviewJsonSchema,
          timeoutMs: 90_000,
          reasoningEffort: "low"
        }, (event) => send({ kind: "sdk.event", event: safeEvent(event) }));
        const eventCounts = result.events.reduce<Record<string, number>>((counts, event) => {
          const key = event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed"
            ? `${event.type}:${event.item.type}`
            : event.type;
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {});
        await auth.supabase.from("event_logs").insert({
          user_id: auth.user.id,
          event_name: "codex_review_completed",
          feature_name: parsed.data.focus,
          latency_ms: result.latencyMs,
          success: true,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { model: result.model, thread_id: result.threadId, usage: result.usage, event_counts: eventCounts }
        });
        send({ kind: "run.completed", result: result.value, threadId: result.threadId, model: result.model, reasoningEffort: runtime.reasoningEffort, usage: result.usage, latencyMs: result.latencyMs });
      } catch (error) {
        const message = codexErrorMessage(error, "Codex could not complete this review.");
        await auth.supabase.from("event_logs").insert({
          user_id: auth.user.id,
          event_name: "codex_review_failed",
          feature_name: parsed.data.focus,
          latency_ms: Date.now() - startedAt,
          success: false,
          fallback_used: false,
          uncertainty_involved: true,
          properties: { error: message }
        });
        send({ kind: "run.failed", message });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
};
