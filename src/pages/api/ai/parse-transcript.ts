import type { APIRoute } from "astro";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { normalizeSmccdCourseCode } from "@/lib/smccd";
import type { Course, SmccdCourse } from "@/lib/models";
import {
  parsedTranscriptJsonSchema,
  parsedTranscriptSchema,
  type ParsedTranscriptResult
} from "@/server/ai-schemas";
import { runCodexStructured } from "@/server/codex";
import { extractSource } from "@/server/source-extraction";
import { parseDtechTranscriptText, TRANSCRIPT_PARSER_VERSION } from "@/server/transcript-parser";
import { transcriptReviewRows } from "@/server/transcript-review";

export const prerender = false;

const requestSchema = z.object({
  sourceId: z.uuid()
});

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

    let parsedResult: ParsedTranscriptResult;
    let parserMethod: "deterministic_text" | "codex_vision";
    let model: string | null = null;
    let parserLatencyMs: number;
    let aiInstruction: string | null = null;
    if (extractedText.trim()) {
      const parserStartedAt = Date.now();
      parsedResult = parseDtechTranscriptText(extractedText);
      parserLatencyMs = Date.now() - parserStartedAt;
      parserMethod = "deterministic_text";
    } else {
      const prompt = [
        "This transcript has no usable text layer and is provided as images. Extract only courses explicitly shown as completed or carrying a final grade.",
        "For every course, preserve the printed course name, institution, grade level, school year, term, final letter grade, high-school credits, college units, and weighting when present.",
        "On d.tech transcripts, Q1 through Q4 rows graded P or F are intersession pass/fail courses. Preserve the Q prefix and use Personal Development as the subject; they are not expected to have an annual d.tech catalog match.",
        "Do not treat in-progress, requested, or planned courses as completed. Omit them from courses and mention them in conflicts when relevant.",
        "Use verified only when the field is explicit and legible. Use uncertain for inferred, incomplete, or conflicting values.",
        "Evidence must be a short location or wording from the transcript, not invented context.",
        extractionNote
      ].join("\n\n");
      aiInstruction = prompt;
      const codexResult = await runCodexStructured({
        feature: "transcript_image_ocr",
        prompt,
        input: attachments,
        schema: parsedTranscriptSchema,
        outputSchema: parsedTranscriptJsonSchema,
        workingDirectory: scratchDirectory,
        timeoutMs: 45000
      });
      parsedResult = codexResult.value;
      parserLatencyMs = codexResult.latencyMs;
      parserMethod = "codex_vision";
      model = codexResult.model;
    }

    const { data: catalogData, error: catalogError } = await auth.supabase
      .from("courses")
      .select("*")
      .eq("review_status", "approved");
    if (catalogError) throw catalogError;
    const collegeCourseCodes = [...new Set(parsedResult.courses
      .map((course) => course.course_code ? normalizeSmccdCourseCode(course.course_code) : null)
      .filter((value): value is string => Boolean(value)))];
    const smccdResult = collegeCourseCodes.length > 0
      ? await auth.supabase.from("smccd_courses").select("*").in("course_code", collegeCourseCodes)
      : { data: [], error: null };
    if (smccdResult.error) throw smccdResult.error;
    const rows = transcriptReviewRows(
      auth.user.id,
      source.id,
      parsedResult,
      (catalogData ?? []) as unknown as Course[],
      (smccdResult.data ?? []) as unknown as SmccdCourse[]
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
        model,
        output: { ...parsedResult, parser_method: parserMethod, parser_version: TRANSCRIPT_PARSER_VERSION },
        latency_ms: parserLatencyMs,
        fallback_used: parserMethod === "codex_vision",
        uncertainty_involved: uncertaintyInvolved,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);
    await auth.supabase.from("event_logs").insert({
      user_id: auth.user.id,
      event_name: "transcript_parsed",
      feature_name: "transcript_parse",
      source_used: source.kind,
      latency_ms: parserLatencyMs,
      success: true,
      fallback_used: parserMethod === "codex_vision",
      uncertainty_involved: uncertaintyInvolved,
      properties: {
        source_id: source.id,
        completed_course_count: parsedResult.courses.length,
        parser_method: parserMethod,
        parser_version: TRANSCRIPT_PARSER_VERSION
      }
    });
    return new Response(
      JSON.stringify({
        summary: parsedResult.summary,
        courseCount: parsedResult.courses.length,
        reviewItems: insertedRows ?? [],
        fallbackUsed: parserMethod === "codex_vision",
        parserMethod,
        parserVersion: TRANSCRIPT_PARSER_VERSION,
        aiUsed: parserMethod === "codex_vision",
        aiTransparency: parserMethod === "codex_vision" ? {
          model,
          reasoningEffort: "low",
          instruction: aiInstruction,
          input: `${attachments.length} transcript image ${attachments.length === 1 ? "page" : "pages"}`,
          toolsUsed: [],
          filesChanged: [],
          mutations: "Extracted rows were saved to the review queue only. Nothing was imported automatically."
        } : null
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Transcript parsing failed.";
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
