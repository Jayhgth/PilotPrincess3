import type { APIRoute } from "astro";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { findTranscriptCatalogMatch } from "@/lib/transcript";
import type { Course } from "@/lib/models";
import {
  parsedTranscriptJsonSchema,
  parsedTranscriptSchema,
  type ParsedTranscriptResult
} from "@/server/ai-schemas";
import { runCodexStructured } from "@/server/codex";
import { extractSource } from "@/server/source-extraction";

export const prerender = false;

const requestSchema = z.object({
  sourceId: z.uuid()
});

function transcriptReviewRows(
  userId: string,
  sourceId: string,
  result: ParsedTranscriptResult,
  courses: Course[]
) {
  const courseRows = result.courses.map((course) => {
    const match = findTranscriptCatalogMatch(course.course_name, courses);
    const uncertaintyNotes = [
      ...(!match ? ["No exact official catalog match was found. This course will remain custom until reviewed."] : []),
      ...(course.grade_level === null ? ["Grade level was not explicit in the transcript."] : []),
      ...(course.credits === null && match?.credits === null ? ["Credits need manual confirmation."] : [])
    ];
    return {
      user_id: userId,
      source_id: sourceId,
      entity_type: "transcript_course",
      proposed_payload: {
        ...course,
        matched_course_id: match?.id ?? null,
        matched_course_name: match?.name ?? null,
        import_status: "completed"
      },
      confidence: uncertaintyNotes.length > 0 ? "uncertain" : course.confidence,
      uncertainty_notes: uncertaintyNotes
    };
  });
  const noteRow = {
    user_id: userId,
    source_id: sourceId,
    entity_type: "transcript_note",
    proposed_payload: {
      summary: result.summary,
      student_name: result.student_name,
      school_name: result.school_name,
      academic_years: result.academic_years,
      conflicts: result.conflicts,
      counselor_questions: result.counselor_questions
    },
    confidence: result.conflicts.length > 0 ? "uncertain" : "likely",
    status: "approved",
    uncertainty_notes: result.conflicts
  };
  return [...courseRows, noteRow];
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
    .eq("document_type", "transcript")
    .single();
  if (sourceError || !source) return jsonError("Transcript source not found.", 404);

  const startedAt = Date.now();
  const scratchDirectory = await mkdtemp(join(tmpdir(), "pilot-princess-transcript-"));
  const { data: job, error: jobError } = await auth.supabase
    .from("parse_jobs")
    .insert({
      source_id: source.id,
      user_id: auth.user.id,
      feature_name: "transcript_parse",
      status: "processing",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (jobError || !job) {
    await rm(scratchDirectory, { recursive: true, force: true });
    return jsonError("Could not start the transcript parse job.", 500);
  }

  await auth.supabase.from("official_sources").update({ parse_status: "processing", error_message: null }).eq("id", source.id);

  try {
    let extractedText = source.raw_text ?? "";
    let attachments: Array<{ type: "local_image"; path: string }> = [];
    let extractionNote = source.raw_text ? "Pasted transcript text supplied by the student." : "";

    if (source.storage_path) {
      const { data: file, error: downloadError } = await auth.supabase.storage
        .from("source-uploads")
        .download(source.storage_path);
      if (downloadError || !file) throw new Error("The transcript file could not be downloaded.");
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

    if (!extractedText && attachments.length === 0) throw new Error("No readable transcript content was found.");

    const prompt = [
      "Read this high-school transcript and extract only courses explicitly shown as completed or carrying a final grade.",
      "For every course, preserve the printed course name, grade level, school year, term, final letter grade, credits, and weighting when present.",
      "Do not treat in-progress, requested, or planned courses as completed. Omit them from courses and mention them in conflicts when relevant.",
      "Use verified only when the field is explicit and legible. Use uncertain for inferred, incomplete, or conflicting values.",
      "Evidence must be a short location or wording from the transcript, not invented context.",
      extractionNote,
      extractedText ? `TRANSCRIPT TEXT:\n${extractedText}` : "The transcript is provided as attached images."
    ].join("\n\n");
    const codexResult = await runCodexStructured({
      feature: "transcript_parse",
      prompt,
      input: attachments,
      schema: parsedTranscriptSchema,
      outputSchema: parsedTranscriptJsonSchema,
      workingDirectory: scratchDirectory,
      timeoutMs: 30000
    });

    const { data: catalogData, error: catalogError } = await auth.supabase
      .from("courses")
      .select("*")
      .eq("review_status", "approved");
    if (catalogError) throw catalogError;
    const rows = transcriptReviewRows(
      auth.user.id,
      source.id,
      codexResult.value,
      (catalogData ?? []) as unknown as Course[]
    );
    await auth.supabase
      .from("catalog_review_items")
      .delete()
      .eq("source_id", source.id)
      .in("entity_type", ["transcript_course", "transcript_note"]);
    const { data: insertedRows, error: reviewError } = await auth.supabase
      .from("catalog_review_items")
      .insert(rows)
      .select("*");
    if (reviewError) throw reviewError;

    const uncertaintyInvolved = rows.some((row) => row.confidence === "uncertain");
    await auth.supabase
      .from("official_sources")
      .update({ parse_status: "needs_review", confidence: uncertaintyInvolved ? "uncertain" : "likely" })
      .eq("id", source.id);
    await auth.supabase
      .from("parse_jobs")
      .update({
        status: "needs_review",
        model: codexResult.model,
        output: codexResult.value,
        latency_ms: codexResult.latencyMs,
        fallback_used: false,
        uncertainty_involved: uncertaintyInvolved,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "transcript_parsed",
      feature_name: "transcript_parse",
      source_used: source.kind,
      latency_ms: codexResult.latencyMs,
      success: true,
      fallback_used: false,
      uncertainty_involved: uncertaintyInvolved,
      properties: { source_id: source.id, completed_course_count: codexResult.value.courses.length }
    });
    return new Response(
      JSON.stringify({
        summary: codexResult.value.summary,
        courseCount: codexResult.value.courses.length,
        reviewItems: insertedRows ?? [],
        fallbackUsed: false
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript parsing failed.";
    const fallbackPayload = {
      summary: "Automatic transcript parsing was unavailable. The uploaded transcript is preserved for manual review.",
      raw_excerpt: (source.raw_text ?? "").slice(0, 2500),
      manual_entry_required: true
    };
    await auth.supabase.from("catalog_review_items").insert({
      user_id: auth.user.id,
      source_id: source.id,
      entity_type: "transcript_note",
      proposed_payload: fallbackPayload,
      confidence: "uncertain",
      uncertainty_notes: ["Automatic parsing failed. No course was imported as completed."]
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
    return new Response(
      JSON.stringify({ summary: fallbackPayload.summary, courseCount: 0, reviewItems: [], fallbackUsed: true }),
      { headers: { "content-type": "application/json" } }
    );
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
};
