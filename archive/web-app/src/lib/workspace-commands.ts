import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanCourse } from "@/lib/models";

function planCoursePlacementPayload(row: PlanCourse) {
  return {
    id: row.id,
    grade_level: row.grade_level,
    school_year: row.school_year,
    term: row.term,
    status: row.status,
    sort_order: row.sort_order,
    letter_grade: row.letter_grade,
    user_edited: row.user_edited
  };
}

export async function applyPlanCourseUpdates(supabase: SupabaseClient, rows: PlanCourse[]) {
  if (!rows.length) return [];
  const result = await supabase.rpc("apply_plan_course_updates_v1", {
    p_updates: rows.map(planCoursePlacementPayload)
  });
  if (result.error) throw result.error;
  const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as { rows?: unknown }
    : null;
  return Array.isArray(payload?.rows) ? payload.rows as PlanCourse[] : [];
}

export async function commitTranscriptImport(
  supabase: SupabaseClient,
  input: {
    planVersionId: string;
    approvedIds: string[];
    rejectedIds?: string[];
    corrections?: Array<{ id: string; payload: Record<string, unknown> }>;
    planRows: Array<Record<string, unknown>>;
  }
) {
  const result = await supabase.rpc("commit_transcript_import_v1", {
    p_plan_version_id: input.planVersionId,
    p_approved_ids: input.approvedIds,
    p_rejected_ids: input.rejectedIds ?? [],
    p_corrections: input.corrections ?? [],
    p_plan_rows: input.planRows
  });
  if (result.error) throw result.error;
  const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as { rows?: unknown; imported_count?: unknown }
    : null;
  return {
    rows: Array.isArray(payload?.rows) ? payload.rows as PlanCourse[] : [],
    importedCount: Number(payload?.imported_count ?? 0)
  };
}
