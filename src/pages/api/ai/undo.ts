import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";

export const prerender = false;

const requestSchema = z.object({ toolCallId: z.uuid() });
const rowSchema = z.record(z.string(), z.unknown());
const undoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delete_rows"), table: z.enum(["plan_versions", "plan_courses"]), ids: z.array(z.uuid()).min(1).max(40), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_rows"), table: z.enum(["plan_courses", "student_smccd_goals"]), rows: z.array(rowSchema).min(1).max(40), summary: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("restore_enrollment_preference"), row: rowSchema.nullable(), summary: z.string().min(1).max(500) })
]);

const RESTORABLE_KEYS = {
  plan_courses: ["id", "plan_version_id", "user_id", "course_id", "custom_course_name", "grade_level", "school_year", "term", "status", "credits", "college_units", "letter_grade", "is_weighted", "mapping_verified", "user_edited", "notes", "sort_order", "source_review_item_id", "smccd_course_id", "college_provider_code", "requirement_area_override"],
  student_smccd_goals: ["id", "user_id", "program_id", "is_primary", "notes"]
} as const;

function pickRow(row: Record<string, unknown>, keys: readonly string[], userId: string) {
  if (row.user_id !== userId) throw new Error("The saved undo data does not belong to this student.");
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid undo request.", 400);

  const toolResult = await auth.supabase.from("ai_tool_calls")
    .select("*")
    .eq("id", parsed.data.toolCallId)
    .eq("user_id", auth.user.id)
    .single();
  if (toolResult.error || !toolResult.data) return jsonError("Applied change not found.", 404);
  const toolCall = toolResult.data;
  if (toolCall.status !== "completed") return jsonError("This change is not available to undo.", 409);
  const result = toolCall.result && typeof toolCall.result === "object" && !Array.isArray(toolCall.result)
    ? toolCall.result as Record<string, unknown>
    : {};
  if (result.undone_at) return jsonError("This change has already been undone.", 409);
  if (typeof result.undo_expires_at !== "string" || Date.parse(result.undo_expires_at) <= Date.now()) return jsonError("The undo window for this change has ended.", 409);
  const undo = undoSchema.safeParse(result.undo);
  if (!undo.success) return jsonError("This change does not have a safe undo action.", 409);

  const claim = await auth.supabase.from("ai_tool_calls")
    .update({ status: "running" })
    .eq("id", toolCall.id)
    .eq("user_id", auth.user.id)
    .eq("status", "completed")
    .select("id")
    .maybeSingle();
  if (claim.error) return jsonError(claim.error.message, 500);
  if (!claim.data) return jsonError("This change is already being handled.", 409);

  try {
    if (undo.data.kind === "delete_rows") {
      const mutation = await auth.supabase.from(undo.data.table).delete().in("id", undo.data.ids).eq("user_id", auth.user.id);
      if (mutation.error) throw new Error(mutation.error.message);
    } else if (undo.data.kind === "restore_rows") {
      const table = undo.data.table;
      const rows = undo.data.rows.map((row) => pickRow(row, RESTORABLE_KEYS[table], auth.user.id));
      const mutation = await auth.supabase.from(table).upsert(rows);
      if (mutation.error) throw new Error(mutation.error.message);
    } else if (undo.data.row) {
      const row = pickRow(undo.data.row, ["user_id", "provider_code", "program_type", "limit_mode", "custom_unit_limit"], auth.user.id);
      const restoration = await auth.supabase.from("student_enrollment_preferences").upsert(row, { onConflict: "user_id,provider_code" });
      if (restoration.error) throw new Error(restoration.error.message);
    } else {
      const removal = await auth.supabase.from("student_enrollment_preferences").delete().eq("user_id", auth.user.id).eq("provider_code", "SMCCD");
      if (removal.error) throw new Error(removal.error.message);
    }

    const undoneAt = new Date().toISOString();
    const summary = sanitizeCodexText(undo.data.summary, 500);
    const storedResult = sanitizeCodexValue({ ...result, undone_at: undoneAt, undo_summary: summary });
    const updateTool = await auth.supabase.from("ai_tool_calls").update({ status: "completed", result: storedResult }).eq("id", toolCall.id).eq("user_id", auth.user.id);
    if (updateTool.error) throw new Error(updateTool.error.message);

    const messageResult = await auth.supabase.from("ai_messages")
      .select("id,page_context")
      .eq("conversation_id", toolCall.conversation_id)
      .eq("user_id", auth.user.id)
      .eq("role", "tool")
      .eq("turn_id", toolCall.turn_id);
    if (!messageResult.error) {
      const message = (messageResult.data ?? []).find((candidate) => (candidate.page_context as Record<string, unknown> | null)?.tool_call_id === toolCall.id);
      if (message) {
        await auth.supabase.from("ai_messages").update({
          content: summary,
          page_context: { ...(message.page_context as Record<string, unknown>), undo_available: false, undone_at: undoneAt }
        }).eq("id", message.id).eq("user_id", auth.user.id);
      }
    }

    const latest = await auth.supabase.from("ai_events").select("sequence").eq("turn_id", toolCall.turn_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
    const sequence = Number(latest.data?.sequence ?? 0) + 1;
    await auth.supabase.from("ai_events").insert({
      conversation_id: toolCall.conversation_id,
      user_id: auth.user.id,
      turn_id: toolCall.turn_id,
      sequence,
      event_type: "tool.undone",
      payload: { source: "application", type: "tool.undone", sequence, occurredAt: undoneAt, turnId: toolCall.turn_id, toolCallId: toolCall.id, summary }
    });
    await auth.supabase.from("ai_conversations").update({ updated_at: undoneAt }).eq("id", toolCall.conversation_id).eq("user_id", auth.user.id);
    return new Response(JSON.stringify({ undone: true, summary }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await auth.supabase.from("ai_tool_calls").update({ status: "completed" }).eq("id", toolCall.id).eq("user_id", auth.user.id);
    return jsonError(error instanceof Error ? error.message : "The change could not be undone.", 400);
  }
};
