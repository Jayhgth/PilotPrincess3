import type { APIRoute } from "astro";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { parsedSourceJsonSchema, parsedSourceSchema, type ParsedSourceResult } from "@/server/ai-schemas";
import { CODEX_RUNTIME_CAPABILITIES, runCodexStructuredStream } from "@/server/codex";
import { codexTraceSummary } from "@/server/codex-events";
import { extractSource } from "@/server/source-extraction";

export const prerender = false;

const requestSchema = z.object({
  sourceId: z.uuid()
});

function reviewRows(userId: string, sourceId: string, result: ParsedSourceResult) {
  const courseRows = result.courses.map((course) => ({
    user_id: userId,
    source_id: sourceId,
    entity_type: "course",
    proposed_payload: course,
    confidence: course.confidence,
    uncertainty_notes: course.confidence === "uncertain" ? ["Course details need manual verification."] : []
  }));
  const requirementRows = result.requirements.map((requirement) => ({
    user_id: userId,
    source_id: sourceId,
    entity_type: "requirement",
    proposed_payload: requirement,
    confidence: requirement.confidence,
    uncertainty_notes: requirement.confidence === "uncertain" ? ["Requirement details need manual verification."] : []
  }));
  const policyRows = result.policies.map((policy) => ({
    user_id: userId,
    source_id: sourceId,
    entity_type: "policy",
    proposed_payload: policy,
    confidence: policy.confidence,
    uncertainty_notes: policy.confidence === "uncertain" ? ["Policy details need manual verification."] : []
  }));
  const noteRows = [
    {
      user_id: userId,
      source_id: sourceId,
      entity_type: "source_note",
      proposed_payload: {
        summary: result.summary,
        conflicts: result.conflicts,
        counselor_questions: result.counselor_questions
      },
      confidence: result.conflicts.length > 0 ? "uncertain" : "likely",
      uncertainty_notes: result.conflicts
    }
  ];
  return [...courseRows, ...requirementRows, ...policyRows, ...noteRows];
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  const bodyResult = requestSchema.safeParse(await request.json().catch(() => null));
  if (!bodyResult.success) return jsonError("A valid sourceId is required.", 400);

  const { data: source, error: sourceError } = await auth.supabase
    .from("official_sources")
    .select("*")
    .eq("id", bodyResult.data.sourceId)
    .eq("user_id", auth.user.id)
    .single();
  if (sourceError || !source) return jsonError("Source not found.", 404);

  const startedAt = Date.now();
  const scratchDirectory = await mkdtemp(join(tmpdir(), "pilot-princess-source-"));
  const { data: job, error: jobError } = await auth.supabase
    .from("parse_jobs")
    .insert({
      source_id: source.id,
      user_id: auth.user.id,
      feature_name: "source_parse",
      status: "processing",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (jobError || !job) {
    await rm(scratchDirectory, { recursive: true, force: true });
    return jsonError("Could not start the parse job.", 500);
  }

  await auth.supabase.from("official_sources").update({ parse_status: "processing", error_message: null }).eq("id", source.id);

  try {
    let extractedText = source.raw_text ?? "";
    let attachments: Array<{ type: "local_image"; path: string }> = [];
    let extractionNote = source.raw_text ? "Pasted source text supplied by the user." : "";

    if (source.storage_path) {
      const { data: file, error: downloadError } = await auth.supabase.storage
        .from("source-uploads")
        .download(source.storage_path);
      if (downloadError || !file) throw new Error("Uploaded file could not be downloaded.");
      const extracted = await extractSource(
        Buffer.from(await file.arrayBuffer()),
        source.mime_type ?? file.type,
        basename(source.storage_path),
        scratchDirectory
      );
      extractedText = extracted.text;
      attachments = extracted.attachments.filter(
        (entry): entry is { type: "local_image"; path: string } => entry.type === "local_image"
      );
      extractionNote = extracted.extractionNote;
      if (extractedText) {
        await auth.supabase.from("official_sources").update({ raw_text: extractedText }).eq("id", source.id);
      }
    }

    if (!extractedText && attachments.length === 0) {
      throw new Error("No readable source content was found.");
    }

    const prompt = [
      "Extract only claims supported by the supplied official-school source.",
      "Structure courses, graduation requirements, and policies. Include short source evidence for every extracted item.",
      "Use verified only for explicit unambiguous statements, likely for well-supported interpretations, and uncertain for missing or conflicting fields.",
      "Never infer admissions chances. Never convert uncertain values into verified values.",
      extractionNote,
      extractedText ? `SOURCE TEXT:\n${extractedText}` : "The source is provided as one or more attached images."
    ].join("\n\n");
    const codexResult = await runCodexStructuredStream({
      feature: "source_parse",
      prompt,
      input: attachments,
      schema: parsedSourceSchema,
      outputSchema: parsedSourceJsonSchema,
      workingDirectory: scratchDirectory,
      timeoutMs: 30000,
      signal: request.signal
    }, () => undefined);
    const trace = codexTraceSummary(codexResult.events);
    const rows = reviewRows(auth.user.id, source.id, codexResult.value);
    const { error: reviewError } = await auth.supabase.from("catalog_review_items").insert(rows);
    if (reviewError) throw reviewError;

    await auth.supabase
      .from("official_sources")
      .update({ parse_status: "needs_review", confidence: rows.some((row) => row.confidence === "uncertain") ? "uncertain" : "likely" })
      .eq("id", source.id);
    await auth.supabase
      .from("parse_jobs")
      .update({
        status: "needs_review",
        model: codexResult.model,
        output: codexResult.value,
        latency_ms: codexResult.latencyMs,
        fallback_used: false,
        uncertainty_involved: rows.some((row) => row.confidence === "uncertain"),
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "source_parsed",
      feature_name: "source_parse",
      source_used: source.kind,
      latency_ms: codexResult.latencyMs,
      success: true,
      fallback_used: false,
      uncertainty_involved: rows.some((row) => row.confidence === "uncertain"),
      properties: { source_id: source.id, review_item_count: rows.length }
    });
    return new Response(
      JSON.stringify({
        reviewItemCount: rows.length,
        fallbackUsed: false,
        summary: codexResult.value.summary,
        aiUsed: true,
        aiTransparency: {
          model: codexResult.model,
          reasoningEffort: "low",
          threadId: codexResult.threadId,
          latencyMs: codexResult.latencyMs,
          usage: codexResult.usage,
          instruction: prompt,
          input: extractedText ? "Extracted document text" : `${attachments.length} source image ${attachments.length === 1 ? "page" : "pages"}`,
          capabilities: CODEX_RUNTIME_CAPABILITIES,
          events: trace.events,
          toolsUsed: trace.toolsUsed,
          filesChanged: trace.filesChanged,
          mutations: "Proposed items were saved to the review queue only. Nothing was approved automatically."
        }
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source parsing failed.";
    const fallbackPayload = {
      summary: "Automatic parsing was unavailable. Review the preserved source and enter corrected data manually.",
      raw_excerpt: (source.raw_text ?? "").slice(0, 2500),
      manual_entry_required: true
    };
    await auth.supabase.from("catalog_review_items").insert({
      user_id: auth.user.id,
      source_id: source.id,
      entity_type: "source_note",
      proposed_payload: fallbackPayload,
      confidence: "uncertain",
      uncertainty_notes: ["Automatic parsing failed. No extracted value is treated as verified."]
    });
    await auth.supabase
      .from("official_sources")
      .update({ parse_status: "needs_review", confidence: "uncertain", error_message: message })
      .eq("id", source.id);
    await auth.supabase
      .from("parse_jobs")
      .update({
        status: "needs_review",
        latency_ms: Date.now() - startedAt,
        fallback_used: true,
        uncertainty_involved: true,
        error_message: message,
        output: fallbackPayload,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "source_parse_failed",
      feature_name: "source_parse",
      source_used: source.kind,
      latency_ms: Date.now() - startedAt,
      success: false,
      fallback_used: true,
      uncertainty_involved: true,
      properties: { source_id: source.id }
    });
    return new Response(
      JSON.stringify({
        reviewItemCount: 1,
        fallbackUsed: true,
        summary: fallbackPayload.summary
      }),
      { headers: { "content-type": "application/json" } }
    );
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
};
