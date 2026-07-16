import type { APIRoute } from "astro";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { normalizeSmccdCourseCode } from "@/lib/smccd";
import type { CatalogReviewItem, Course, PlanCourse, SmccdCourse } from "@/lib/models";
import { inferTranscriptGradeLevel, resolveTranscriptCourse, resolveTranscriptWeighting, type TranscriptCoursePayload } from "@/lib/transcript";
import {
  parsedTranscriptJsonSchema,
  parsedTranscriptSchema,
  type ParsedTranscriptResult
} from "@/server/ai-schemas";
import { CODEX_RUNTIME_CAPABILITIES, runCodexStructuredStream } from "@/server/codex";
import { codexTraceSummary } from "@/server/codex-events";
import { extractSource } from "@/server/source-extraction";
import { parseDtechTranscriptText, parseSmccdTranscriptText, TRANSCRIPT_PARSER_VERSION } from "@/server/transcript-parser";
import {
  reconcileTranscriptReviewRows,
  transcriptReviewRows
} from "@/server/transcript-review";
import { loadUserAiPreferences } from "@/server/ai-preferences";
import { transcriptMimeType } from "@/lib/transcript-file";

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
  const aiPreferences = await loadUserAiPreferences(auth.supabase, auth.user.id);
  const { data: selectedSchool, error: selectedSchoolError } = source.school_id
    ? await auth.supabase.from("schools").select("id,name,slug").eq("id", source.school_id).maybeSingle()
    : { data: null, error: null };
  if (selectedSchoolError) return jsonError("The selected school could not be loaded.", 500);
  const selectedSchoolIsDtech = selectedSchool?.slug === "design-tech-high-school";

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
    let layoutText = "";
    let attachments: Array<{ type: "local_image"; path: string }> = [];
    let extractionNote = source.raw_text ? "Pasted transcript text supplied by the student." : "";

    if (source.storage_path) {
      const { data: file, error: downloadError } = await auth.supabase.storage
        .from("source-uploads")
        .download(source.storage_path);
      if (downloadError || !file) throw new Error("The transcript file could not be downloaded.");
      const extracted = await extractSource(
        Buffer.from(await file.arrayBuffer()),
        transcriptMimeType(source.mime_type ?? file.type, basename(source.storage_path)),
        basename(source.storage_path),
        scratchDirectory,
        { preserveTableLayout: true }
      );
      extractedText = extracted.text;
      layoutText = extracted.layoutText ?? "";
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
    let parserMethod: "deterministic_text" | "codex_structured";
    let model: string | null = null;
    let parserLatencyMs: number;
    let aiInstruction: string | null = null;
    let aiTrace: ReturnType<typeof codexTraceSummary> | null = null;
    let aiThreadId: string | null = null;
    let aiUsage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null = null;
    const documentText = `${extractedText}\n${layoutText}`;
    const hasSmccdLayout = /San Mateo County CC District[\s\S]{0,300}Unofficial Academic Transcript/i.test(documentText);
    const hasDtechLayout = /Design Tech High School/i.test(documentText) || /\bGR\s+Course\b[\s\S]{0,500}\bS0\b[\s\S]{0,120}\bS1\b[\s\S]{0,120}\bS2\b/i.test(layoutText || extractedText);
    if (extractedText.trim() && layoutText.trim() && hasSmccdLayout) {
      const parserStartedAt = Date.now();
      parsedResult = parseSmccdTranscriptText(extractedText, layoutText);
      parserLatencyMs = Date.now() - parserStartedAt;
      parserMethod = "deterministic_text";
    } else if (extractedText.trim() && hasDtechLayout) {
      const parserStartedAt = Date.now();
      parsedResult = parseDtechTranscriptText(extractedText, layoutText);
      parserLatencyMs = Date.now() - parserStartedAt;
      parserMethod = "deterministic_text";
    } else {
      if (!aiPreferences.enabled || !aiPreferences.approvedAt) {
        throw new Error("This transcript needs selected-school interpretation. Connect Pilot Assistant, or enter the courses manually.");
      }
      const prompt = [
        `Extract only courses explicitly shown as completed or carrying a final grade from this ${selectedSchool?.name ?? "selected high school"} transcript. The source may contain readable text, images, or both.`,
        "For every course, preserve the printed course name, institution, grade level, school year, term, final letter grade, high-school credits, college units, and weighting when present.",
        "Use only the printed transcript and the selected school's approved catalog evidence for weighting. Do not transfer another school's honors or GPA rules.",
        ...(selectedSchoolIsDtech ? [
          "On d.tech transcripts, an asterisk marks UC A-G approval and does not mean weighted. Never infer weighting from an asterisk. A d.tech course is weighted only when the printed course title explicitly includes Honors.",
          "Read the transcript's semester columns directly: S0 is summer, S1 is fall, and S2 is spring. A row graded in both S1 and S2 is full_year; a row graded in only one column belongs to that specific term. Never turn a single semester grade into full_year.",
          "On d.tech transcripts, Q1 through Q4 rows graded P or F are intersession pass/fail courses. Preserve the Q prefix and use Personal Development as the subject; they are not expected to have an annual d.tech catalog match."
        ] : []),
        "Do not treat in-progress, requested, or planned courses as completed. Omit them from courses and mention them in conflicts when relevant.",
        "Use verified only when the field is explicit and legible. Use uncertain for inferred, incomplete, or conflicting values.",
        "Evidence must be a short location or wording from the transcript, not invented context.",
        extractionNote,
        extractedText.trim() ? `Readable transcript text:\n${extractedText.slice(0, 60_000)}` : ""
      ].join("\n\n");
      aiInstruction = prompt;
      const codexResult = await runCodexStructuredStream({
        feature: "transcript_image_ocr",
        prompt,
        input: attachments,
        schema: parsedTranscriptSchema,
        outputSchema: parsedTranscriptJsonSchema,
        workingDirectory: scratchDirectory,
        model: aiPreferences.model,
        timeoutMs: 45000,
        signal: request.signal
      }, () => undefined);
      parsedResult = codexResult.value;
      parserLatencyMs = codexResult.latencyMs;
      parserMethod = "codex_structured";
      model = codexResult.model;
      aiTrace = codexTraceSummary(codexResult.events);
      aiThreadId = codexResult.threadId;
      aiUsage = codexResult.usage;
    }

    const { data: studentSettings, error: studentSettingsError } = await auth.supabase
      .from("student_settings")
      .select("graduation_year")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (studentSettingsError) throw studentSettingsError;
    if (studentSettings?.graduation_year) {
      parsedResult = {
        ...parsedResult,
        courses: parsedResult.courses.map((course) => ({
          ...course,
          grade_level: course.grade_level ?? inferTranscriptGradeLevel(course.school_year, studentSettings.graduation_year)
        }))
      };
    }

    const catalogQuery = auth.supabase
      .from("courses")
      .select("*")
      .eq("review_status", "approved");
    const { data: catalogData, error: catalogError } = source.school_id
      ? await catalogQuery.eq("school_id", source.school_id)
      : { data: [], error: null };
    if (catalogError) throw catalogError;
    const catalogCourses = (catalogData ?? []) as unknown as Course[];
    const catalogCourseIds = catalogCourses.map((course) => course.id);
    const verifiedMappingResult = catalogCourseIds.length > 0
      ? await auth.supabase
          .from("course_requirement_mappings")
          .select("course_id")
          .in("course_id", catalogCourseIds)
          .eq("confidence", "verified")
      : { data: [], error: null };
    if (verifiedMappingResult.error) throw verifiedMappingResult.error;
    const verifiedMappedCourseIds = new Set((verifiedMappingResult.data ?? []).map((mapping) => mapping.course_id));
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
      (smccdResult.data ?? []) as unknown as SmccdCourse[],
      selectedSchool as { id: string; name: string; slug: string } | null
    );
    const { data: existingData, error: existingError } = await auth.supabase
      .from("catalog_review_items")
      .select("*")
      .eq("source_id", source.id)
      .in("entity_type", ["transcript_course", "transcript_note"]);
    if (existingError) throw existingError;
    const existingRows = (existingData ?? []) as unknown as CatalogReviewItem[];
    const reconciliation = reconcileTranscriptReviewRows(existingRows, rows);
    const existingCourseIds = existingRows
      .filter((row) => row.entity_type === "transcript_course")
      .map((row) => row.id);
    const linkedPlanResult = existingCourseIds.length > 0
      ? await auth.supabase.from("plan_courses").select("*").in("source_review_item_id", existingCourseIds)
      : { data: [], error: null };
    if (linkedPlanResult.error) throw linkedPlanResult.error;
    const linkedPlanRows = (linkedPlanResult.data ?? []) as unknown as PlanCourse[];
    const linkedReviewIds = new Set(linkedPlanRows.map((row) => row.source_review_item_id).filter(Boolean));

    const reviewUpdates = reconciliation.matched.map(({ existing, proposed }) => ({
      id: existing.id,
      user_id: existing.user_id,
      source_id: existing.source_id,
      entity_type: existing.entity_type,
      proposed_payload: proposed.proposed_payload,
      corrected_payload: existing.corrected_payload
        ? {
            ...existing.corrected_payload,
            term: proposed.proposed_payload.term,
            evidence: proposed.proposed_payload.evidence
          }
        : null,
      status: existing.status,
      confidence: proposed.confidence,
      uncertainty_notes: proposed.uncertainty_notes
    }));
    if (reconciliation.existingNote && reconciliation.proposedNote) {
      reviewUpdates.push({
        id: reconciliation.existingNote.id,
        user_id: reconciliation.existingNote.user_id,
        source_id: reconciliation.existingNote.source_id,
        entity_type: reconciliation.existingNote.entity_type,
        proposed_payload: reconciliation.proposedNote.proposed_payload,
        corrected_payload: null,
        status: "approved",
        confidence: reconciliation.proposedNote.confidence,
        uncertainty_notes: reconciliation.proposedNote.uncertainty_notes
      });
    }
    if (reviewUpdates.length > 0) {
      const { error: updateError } = await auth.supabase.from("catalog_review_items").upsert(reviewUpdates);
      if (updateError) throw updateError;
    }

    const reviewInserts = [
      ...reconciliation.inserts,
      ...(!reconciliation.existingNote && reconciliation.proposedNote ? [reconciliation.proposedNote] : [])
    ];
    if (reviewInserts.length > 0) {
      const { error: insertError } = await auth.supabase.from("catalog_review_items").insert(reviewInserts);
      if (insertError) throw insertError;
    }

    const staleUnlinkedIds = reconciliation.stale
      .filter((row) => !linkedReviewIds.has(row.id))
      .map((row) => row.id);
    if (staleUnlinkedIds.length > 0) {
      const { error: staleError } = await auth.supabase.from("catalog_review_items").delete().in("id", staleUnlinkedIds);
      if (staleError) throw staleError;
    }

    const proposedByReviewId = new Map(reconciliation.matched.map(({ existing, proposed }) => [existing.id, proposed.proposed_payload]));
    const refreshedPlanRows = linkedPlanRows.flatMap((planRow) => {
      const payload = (planRow.source_review_item_id ? proposedByReviewId.get(planRow.source_review_item_id) : null) as TranscriptCoursePayload | null;
      if (!payload) return [];
      const resolution = resolveTranscriptCourse(payload, catalogCourses);
      const matchedCourse = resolution.matchedCourse;
      const resolvedHighSchoolCourse = resolution.classification === "dtech_catalog" || resolution.classification === "high_school_catalog";
      return [{
        ...planRow,
        course_id: resolvedHighSchoolCourse ? matchedCourse?.id ?? null : planRow.course_id,
        term: payload.term ?? planRow.term,
        grade_level: payload.grade_level ?? planRow.grade_level,
        school_year: payload.school_year ?? planRow.school_year,
        letter_grade: payload.letter_grade,
        is_weighted: resolveTranscriptWeighting(payload, catalogCourses).weighted,
        mapping_verified: resolvedHighSchoolCourse && matchedCourse
          ? verifiedMappedCourseIds.has(matchedCourse.id)
          : planRow.mapping_verified,
        smccd_course_id: resolvedHighSchoolCourse ? null : planRow.smccd_course_id,
        college_provider_code: resolvedHighSchoolCourse ? null : planRow.college_provider_code,
        college_units: resolvedHighSchoolCourse ? null : planRow.college_units
      }];
    });
    if (refreshedPlanRows.length > 0) {
      const { error: planRefreshError } = await auth.supabase.from("plan_courses").upsert(refreshedPlanRows);
      if (planRefreshError) throw planRefreshError;
    }

    const { data: savedRows, error: savedRowsError } = await auth.supabase
      .from("catalog_review_items")
      .select("*")
      .eq("source_id", source.id)
      .in("entity_type", ["transcript_course", "transcript_note"]);
    if (savedRowsError) throw savedRowsError;

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
        fallback_used: parserMethod === "codex_structured",
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
      fallback_used: parserMethod === "codex_structured",
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
        reviewItems: savedRows ?? [],
        fallbackUsed: parserMethod === "codex_structured",
        parserMethod,
        parserVersion: TRANSCRIPT_PARSER_VERSION,
        aiUsed: parserMethod === "codex_structured",
        aiTransparency: parserMethod === "codex_structured" ? {
          model,
          reasoningEffort: "low",
          threadId: aiThreadId,
          latencyMs: parserLatencyMs,
          usage: aiUsage,
          instruction: aiInstruction,
          input: extractedText.trim() ? "Reviewed transcript text and any available page images" : `${attachments.length} transcript image ${attachments.length === 1 ? "page" : "pages"}`,
          capabilities: CODEX_RUNTIME_CAPABILITIES,
          events: aiTrace?.events ?? [],
          toolsUsed: aiTrace?.toolsUsed ?? [],
          filesChanged: aiTrace?.filesChanged ?? [],
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
    const fallbackRow = {
      user_id: auth.user.id,
      source_id: source.id,
      entity_type: "transcript_note",
      proposed_payload: fallbackPayload,
      confidence: "uncertain",
      status: "approved",
      uncertainty_notes: ["Automatic parsing failed. No course was imported as completed."]
    };
    const { data: existingNote } = await auth.supabase
      .from("catalog_review_items")
      .select("id")
      .eq("source_id", source.id)
      .eq("entity_type", "transcript_note")
      .maybeSingle();
    if (existingNote) await auth.supabase.from("catalog_review_items").update(fallbackRow).eq("id", existingNote.id);
    else await auth.supabase.from("catalog_review_items").insert(fallbackRow);
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
      JSON.stringify({ summary: fallbackPayload.summary, courseCount: 0, reviewItems: [], fallbackUsed: true, parseError: message }),
      { headers: { "content-type": "application/json" } }
    );
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
};
