import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";

const rowSchema = z.record(z.string(), z.unknown());
const undoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delete_rows"), table: z.enum(["plan_versions", "plan_courses", "student_smccd_goals", "student_prerequisite_clearances", "shared_data_proposals"]), ids: z.array(z.uuid()).min(1).max(160), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_rows"), table: z.enum(["plan_courses", "student_smccd_goals", "student_prerequisite_clearances"]), rows: z.array(rowSchema).min(1).max(160), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_enrollment_preference"), row: rowSchema.nullable(), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_student_settings"), values: rowSchema, summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_school_selection"), school_id: z.uuid(), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_gpa_scenario"), plan_course_ids: z.array(z.uuid()).min(1).max(160), rows: z.array(rowSchema).max(160), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_smccd_completion"), college_code: z.enum(["CSM", "SKY", "CAN"]), area: z.enum(["7A", "information_literacy"]), completed: z.boolean(), summary: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal("restore_transcript_correction"),
    review_item_id: z.uuid(),
    corrected_payload: rowSchema.nullable(),
    status: z.string().min(1).max(40),
    plan_rows: z.array(rowSchema).max(40),
    inserted_plan_course_ids: z.array(z.uuid()).max(40),
    summary: z.string().min(1).max(500)
  })
]);

const RESTORABLE_KEYS = {
  plan_courses: ["id", "plan_version_id", "user_id", "course_id", "custom_course_name", "grade_level", "school_year", "term", "status", "credits", "college_units", "letter_grade", "is_weighted", "mapping_verified", "user_edited", "notes", "sort_order", "source_review_item_id", "smccd_course_id", "college_provider_code", "requirement_area_override"],
  student_smccd_goals: ["id", "user_id", "program_id", "is_primary", "notes"],
  student_prerequisite_clearances: ["id", "user_id", "target_course_id", "clearance_type", "status", "verification_status", "authority", "evidence_summary", "decided_at", "expires_at", "source_url", "verified_by", "verified_at"]
} as const;

const RESTORABLE_SETTING_KEYS = [
  "preferred_name", "age", "grade_level", "graduation_year", "plan_start_grade", "plan_end_grade",
  "tracker_mode", "tracked_requirement_areas", "ai_model", "ai_reasoning_effort", "ai_review_mode"
] as const;

function pickRow(row: Record<string, unknown>, keys: readonly string[], userId: string) {
  if (row.user_id !== userId) throw new Error("The saved undo data does not belong to this student.");
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}

export function assistantUndoAvailability(resultValue: unknown, now = Date.now()) {
  const result = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
    ? resultValue as Record<string, unknown>
    : {};
  return {
    available: !result.undone_at
      && typeof result.undo_expires_at === "string"
      && Date.parse(result.undo_expires_at) > now
      && undoSchema.safeParse(result.undo).success,
    undoneAt: typeof result.undone_at === "string" ? result.undone_at : null,
    expiresAt: typeof result.undo_expires_at === "string" ? result.undo_expires_at : null
  };
}

export async function undoAssistantToolCall(options: {
  supabase: SupabaseClient;
  userId: string;
  toolCallId: string;
  conversationId?: string;
}) {
  let query = options.supabase.from("ai_tool_calls")
    .select("*")
    .eq("id", options.toolCallId)
    .eq("user_id", options.userId);
  if (options.conversationId) query = query.eq("conversation_id", options.conversationId);
  const toolResult = await query.single();
  if (toolResult.error || !toolResult.data) throw new Error("Applied change not found in this conversation.");
  const toolCall = toolResult.data;
  if (toolCall.status !== "completed") throw new Error("This change is not available to undo.");
  const result = toolCall.result && typeof toolCall.result === "object" && !Array.isArray(toolCall.result)
    ? toolCall.result as Record<string, unknown>
    : {};
  if (result.undone_at) throw new Error("This change has already been undone.");
  if (typeof result.undo_expires_at !== "string" || Date.parse(result.undo_expires_at) <= Date.now()) throw new Error("The undo window for this change has ended.");
  const undo = undoSchema.safeParse(result.undo);
  if (!undo.success) throw new Error("This change does not have a safe undo action.");

  const claim = await options.supabase.from("ai_tool_calls")
    .update({ status: "running" })
    .eq("id", toolCall.id)
    .eq("user_id", options.userId)
    .eq("status", "completed")
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) throw new Error("This change is already being handled.");

  try {
    if (undo.data.kind === "delete_rows") {
      const deleteQuery = options.supabase.from(undo.data.table).delete().in("id", undo.data.ids);
      const mutation = undo.data.table === "shared_data_proposals"
        ? await deleteQuery.eq("submitted_by", options.userId).eq("status", "pending")
        : await deleteQuery.eq("user_id", options.userId);
      if (mutation.error) throw new Error(mutation.error.message);
    } else if (undo.data.kind === "restore_rows") {
      const table = undo.data.table;
      const rows = undo.data.rows.map((row) => pickRow(row, RESTORABLE_KEYS[table], options.userId));
      const mutation = await options.supabase.from(table).upsert(rows);
      if (mutation.error) throw new Error(mutation.error.message);
    } else if (undo.data.kind === "restore_enrollment_preference") {
      if (undo.data.row) {
        const row = pickRow(undo.data.row, ["user_id", "provider_code", "program_type", "limit_mode", "custom_unit_limit", "respect_recommended_limit"], options.userId);
        const restoration = await options.supabase.from("student_enrollment_preferences").upsert(row, { onConflict: "user_id,provider_code" });
        if (restoration.error) throw new Error(restoration.error.message);
      } else {
        const removal = await options.supabase.from("student_enrollment_preferences").delete().eq("user_id", options.userId).eq("provider_code", "SMCCD");
        if (removal.error) throw new Error(removal.error.message);
      }
    } else if (undo.data.kind === "restore_student_settings") {
      const savedValues = undo.data.values;
      const values = Object.fromEntries(RESTORABLE_SETTING_KEYS.filter((key) => key in savedValues).map((key) => [key, savedValues[key]]));
      const restoration = await options.supabase.from("student_settings").update(values).eq("id", options.userId);
      if (restoration.error) throw new Error(restoration.error.message);
    } else if (undo.data.kind === "restore_school_selection") {
      const restoration = await options.supabase.rpc("select_current_school", { target_school_id: undo.data.school_id });
      if (restoration.error) throw new Error(restoration.error.message);
    } else if (undo.data.kind === "restore_gpa_scenario") {
      const removal = await options.supabase.from("student_gpa_scenario_choices").delete().eq("user_id", options.userId).in("plan_course_id", undo.data.plan_course_ids);
      if (removal.error) throw new Error(removal.error.message);
      if (undo.data.rows.length) {
        const rows = undo.data.rows.map((row) => ({
          user_id: options.userId,
          plan_course_id: z.uuid().parse(row.plan_course_id),
          included: z.boolean().parse(row.included),
          expected_grade: z.enum(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]).nullable().parse(row.expected_grade)
        }));
        const restoration = await options.supabase.from("student_gpa_scenario_choices").insert(rows);
        if (restoration.error) throw new Error(restoration.error.message);
      }
    } else if (undo.data.kind === "restore_smccd_completion") {
      if (undo.data.completed) {
        const restoration = await options.supabase.from("student_smccd_ge_completions").upsert({ user_id: options.userId, college_code: undo.data.college_code, area: undo.data.area, completion_source: "manual" }, { onConflict: "user_id,college_code,area" });
        if (restoration.error) throw new Error(restoration.error.message);
      } else {
        const removal = await options.supabase.from("student_smccd_ge_completions").delete().eq("user_id", options.userId).eq("college_code", undo.data.college_code).eq("area", undo.data.area);
        if (removal.error) throw new Error(removal.error.message);
      }
    } else if (undo.data.kind === "restore_transcript_correction") {
      const review = await options.supabase.from("catalog_review_items").select("id").eq("id", undo.data.review_item_id).eq("user_id", options.userId).maybeSingle();
      if (review.error || !review.data) throw new Error("The transcript review item is no longer available.");
      if (undo.data.inserted_plan_course_ids.length) {
        const removal = await options.supabase.from("plan_courses").delete().eq("user_id", options.userId).in("id", undo.data.inserted_plan_course_ids);
        if (removal.error) throw new Error(removal.error.message);
      }
      if (undo.data.plan_rows.length) {
        const rows = undo.data.plan_rows.map((row) => pickRow(row, RESTORABLE_KEYS.plan_courses, options.userId));
        const restoration = await options.supabase.from("plan_courses").upsert(rows);
        if (restoration.error) throw new Error(restoration.error.message);
      }
      const reviewRestoration = await options.supabase.from("catalog_review_items").update({ corrected_payload: undo.data.corrected_payload, status: undo.data.status }).eq("id", undo.data.review_item_id).eq("user_id", options.userId);
      if (reviewRestoration.error) throw new Error(reviewRestoration.error.message);
    }

    const undoneAt = new Date().toISOString();
    const summary = sanitizeCodexText(undo.data.summary, 500);
    const storedResult = sanitizeCodexValue({ ...result, undone_at: undoneAt, undo_summary: summary });
    const updateTool = await options.supabase.from("ai_tool_calls").update({ status: "completed", result: storedResult }).eq("id", toolCall.id).eq("user_id", options.userId);
    if (updateTool.error) throw new Error(updateTool.error.message);

    const messageResult = await options.supabase.from("ai_messages").select("id,page_context").eq("conversation_id", toolCall.conversation_id).eq("user_id", options.userId).eq("role", "tool").eq("turn_id", toolCall.turn_id);
    if (!messageResult.error) {
      const message = (messageResult.data ?? []).find((candidate) => (candidate.page_context as Record<string, unknown> | null)?.tool_call_id === toolCall.id);
      if (message) {
        await options.supabase.from("ai_messages").update({
          content: summary,
          page_context: { ...(message.page_context as Record<string, unknown>), undo_available: false, undone_at: undoneAt }
        }).eq("id", message.id).eq("user_id", options.userId);
      }
    }

    const latest = await options.supabase.from("ai_events").select("sequence").eq("turn_id", toolCall.turn_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
    const sequence = Number(latest.data?.sequence ?? 0) + 1;
    await options.supabase.from("ai_events").insert({
      conversation_id: toolCall.conversation_id,
      user_id: options.userId,
      turn_id: toolCall.turn_id,
      sequence,
      event_type: "tool.undone",
      payload: { source: "application", type: "tool.undone", sequence, occurredAt: undoneAt, turnId: toolCall.turn_id, toolCallId: toolCall.id, summary }
    });
    await options.supabase.from("ai_conversations").update({ updated_at: undoneAt }).eq("id", toolCall.conversation_id).eq("user_id", options.userId);
    return { summary, toolCallId: toolCall.id, toolName: toolCall.tool_name, conversationId: toolCall.conversation_id };
  } catch (error) {
    await options.supabase.from("ai_tool_calls").update({ status: "completed" }).eq("id", toolCall.id).eq("user_id", options.userId);
    throw error;
  }
}
