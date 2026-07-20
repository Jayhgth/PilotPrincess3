import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const PAGE_SIZE = 500;

export async function readAllUserRows(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  options: { columns?: string; userColumn?: string; order?: string[] } = {}
) {
  const rows: Array<Record<string, unknown>> = [];
  const columns = options.columns ?? "*";
  const userColumn = options.userColumn ?? "user_id";

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from(table).select(columns).eq(userColumn, userId);
    for (const column of options.order ?? ["created_at", "id"]) query = query.order(column);
    const result = await query.range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    const page = (result.data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  const userId = auth.user.id;
  const [
    settings,
    plans,
    versions,
    planCourses,
    sources,
    parseJobs,
    reviewItems,
    degreeGoals,
    prerequisiteClearances,
    geCompletions,
    enrollmentPreferences,
    collegeDistrictPreferences,
    conversations,
    messages,
    events,
    toolCalls,
    memories,
    attachments,
    gpaScenarioChoices,
    supportRequests,
    sharedDataProposals,
    eventLogs
  ] = await Promise.all([
    auth.supabase.from("student_settings").select("*").eq("id", userId).maybeSingle(),
    readAllUserRows(auth.supabase, "four_year_plans", userId),
    readAllUserRows(auth.supabase, "plan_versions", userId),
    readAllUserRows(auth.supabase, "plan_courses", userId, { order: ["grade_level", "sort_order", "id"] }),
    readAllUserRows(auth.supabase, "official_sources", userId),
    readAllUserRows(auth.supabase, "parse_jobs", userId),
    readAllUserRows(auth.supabase, "catalog_review_items", userId),
    readAllUserRows(auth.supabase, "student_smccd_goals", userId),
    readAllUserRows(auth.supabase, "student_prerequisite_clearances", userId),
    readAllUserRows(auth.supabase, "student_smccd_ge_completions", userId, { order: ["created_at", "college_code", "area"] }),
    readAllUserRows(auth.supabase, "student_enrollment_preferences", userId, { order: ["provider_code"] }),
    readAllUserRows(auth.supabase, "student_college_district_preferences", userId),
    readAllUserRows(auth.supabase, "ai_conversations", userId),
    readAllUserRows(auth.supabase, "ai_messages", userId),
    readAllUserRows(auth.supabase, "ai_events", userId, { order: ["id"] }),
    readAllUserRows(auth.supabase, "ai_tool_calls", userId),
    readAllUserRows(auth.supabase, "ai_student_memories", userId),
    readAllUserRows(auth.supabase, "ai_message_attachments", userId, { columns: "id,conversation_id,message_id,user_id,name,mime_type,size_bytes,created_at" }),
    readAllUserRows(auth.supabase, "student_gpa_scenario_choices", userId, { order: ["plan_course_id"] }),
    readAllUserRows(auth.supabase, "support_requests", userId),
    readAllUserRows(auth.supabase, "shared_data_proposals", userId, { userColumn: "submitted_by" }),
    readAllUserRows(auth.supabase, "event_logs", userId)
  ]);
  const error = [
    settings.error,
    plans.error,
    versions.error,
    planCourses.error,
    sources.error,
    parseJobs.error,
    reviewItems.error,
    degreeGoals.error,
    prerequisiteClearances.error,
    geCompletions.error,
    enrollmentPreferences.error,
    collegeDistrictPreferences.error,
    conversations.error,
    messages.error,
    events.error,
    toolCalls.error,
    memories.error,
    attachments.error,
    gpaScenarioChoices.error,
    supportRequests.error,
    sharedDataProposals.error,
    eventLogs.error
  ].find(Boolean);
  if (error) return jsonError(error.message, 500);

  const exportedAt = new Date();
  const body = {
    format_version: 1,
    exported_at: exportedAt.toISOString(),
    account: {
      id: userId,
      email: auth.user.email ?? null,
      created_at: auth.user.created_at,
      last_sign_in_at: auth.user.last_sign_in_at ?? null
    },
    settings: settings.data,
    planning: {
      plans: plans.data ?? [],
      versions: versions.data ?? [],
      courses: planCourses.data ?? [],
      gpa_scenario_choices: gpaScenarioChoices.data ?? []
    },
    transcript: {
      sources: sources.data ?? [],
      parse_jobs: parseJobs.data ?? [],
      review_items: reviewItems.data ?? []
    },
    college: {
      degree_goals: degreeGoals.data ?? [],
      prerequisite_clearances: prerequisiteClearances.data ?? [],
      ge_completions: geCompletions.data ?? [],
      enrollment_preferences: enrollmentPreferences.data ?? [],
      college_district_preferences: collegeDistrictPreferences.data ?? []
    },
    pilot: {
      conversations: conversations.data ?? [],
      messages: messages.data ?? [],
      events: events.data ?? [],
      tool_calls: toolCalls.data ?? [],
      memories: memories.data ?? [],
      attachments: attachments.data ?? []
    },
    support_requests: supportRequests.data ?? [],
    shared_data_proposals: sharedDataProposals.data ?? [],
    event_logs: eventLogs.data ?? []
  };
  const date = exportedAt.toISOString().slice(0, 10);

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="pilot-princess-data-${date}.json"`,
      "cache-control": "no-store"
    }
  });
};
