import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

const qaEmail = process.env.QA_EMAIL;
const qaPassword = process.env.QA_PASSWORD;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const liveConfigured = process.env.RUN_LIVE_PILOT === "1"
  && Boolean(qaEmail && qaPassword && supabaseUrl && supabaseAnonKey);

type Proposal = { id: string; name: string };

async function authorizedPost(
  request: APIRequestContext,
  path: string,
  accessToken: string,
  data: Record<string, unknown>
) {
  return request.post(path, {
    headers: { authorization: `Bearer ${accessToken}`, origin: "http://127.0.0.1:4388" },
    data
  });
}

async function sendTurn(
  request: APIRequestContext,
  accessToken: string,
  conversationId: string,
  message: string
) {
  const response = await request.post("/api/ai/chat", {
    headers: { authorization: `Bearer ${accessToken}`, origin: "http://127.0.0.1:4388" },
    multipart: {
      conversationId,
      turnId: crypto.randomUUID(),
      message,
      pageContext: JSON.stringify({ view: "courses", courseArea: "plan" })
    },
    timeout: 180_000
  });
  expect(response.ok(), await response.text()).toBe(true);
  const events = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    kind: string;
    message?: string;
    assistantMessage?: { content?: string };
    proposals?: Proposal[];
  });
  const failure = events.find((event) => event.kind === "turn.failed");
  expect(failure?.message).toBeUndefined();
  const completed = events.findLast((event) => event.kind === "turn.completed");
  expect(completed).toBeDefined();
  return {
    message: completed?.assistantMessage?.content ?? "",
    proposals: completed?.proposals ?? []
  };
}

async function autoReview(
  request: APIRequestContext,
  accessToken: string,
  proposals: Proposal[]
) {
  const results = [];
  for (const proposal of proposals) {
    const response = await authorizedPost(request, "/api/ai/tool", accessToken, {
      toolCallId: proposal.id,
      decision: "auto_review"
    });
    const payload = await response.json() as { applied?: boolean; error?: string; review?: { decision?: string } };
    expect(response.ok(), payload.error).toBe(true);
    results.push({ proposal, ...payload });
  }
  return results;
}

test.describe("live Pilot behavior", () => {
  test.skip(!liveConfigured, "Set RUN_LIVE_PILOT=1 and the isolated QA credentials to call Codex.");
  test.setTimeout(360_000);

  let supabase: SupabaseClient;
  let accessToken: string;
  let userId: string;
  let schoolId: string;

  test.beforeEach(async ({ request }) => {
    supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const signIn = await supabase.auth.signInWithPassword({ email: qaEmail!, password: qaPassword! });
    if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("The QA account could not sign in.");
    accessToken = signIn.data.session.access_token;
    userId = signIn.data.user.id;

    const reset = await authorizedPost(request, "/api/admin/reset", accessToken, {});
    expect(reset.ok(), await reset.text()).toBe(true);
    const school = await supabase.from("schools").select("id").eq("slug", "ca-41690624130993").single();
    if (school.error) throw school.error;
    schoolId = school.data.id;
    const schoolSelection = await supabase.rpc("select_current_school", { target_school_id: school.data.id });
    if (schoolSelection.error) throw schoolSelection.error;
    const settings = await supabase.from("student_settings").update({
      preferred_name: "Pilot QA",
      age: 14,
      grade_level: 9,
      graduation_year: 2030,
      plan_start_grade: 9,
      plan_end_grade: 12,
      onboarding_complete: true
    }).eq("id", userId);
    if (settings.error) throw settings.error;

    const health = await authorizedPost(request, "/api/ai/health", accessToken, {
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      approved: true
    });
    expect(health.ok(), await health.text()).toBe(true);
    const preferences = await authorizedPost(request, "/api/ai/preferences", accessToken, {
      enabled: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      approved: true
    });
    expect(preferences.ok(), await preferences.text()).toBe(true);
    const reviewMode = await authorizedPost(request, "/api/ai/review-mode", accessToken, { mode: "auto_review" });
    expect(reviewMode.ok(), await reviewMode.text()).toBe(true);
  });

  test("remembers constraints, completes exact writes, and refuses account deletion", async ({ request }) => {
    const conversationResponse = await authorizedPost(request, "/api/ai/conversations", accessToken, { title: "Pilot live stress test" });
    expect(conversationResponse.status()).toBe(201);
    const conversationId = String((await conversationResponse.json() as { conversation: { id: string } }).conversation.id);

    const preferenceTurn = await sendTurn(
      request,
      accessToken,
      conversationId,
      "Remember that I prefer a lighter schedule, no more than four courses per term, and I am interested in environmental science."
    );
    expect(preferenceTurn.proposals).toHaveLength(0);
    const memoryResult = await supabase.from("ai_student_memories").select("memory_key, content").eq("user_id", userId);
    if (memoryResult.error) throw memoryResult.error;
    expect(memoryResult.data?.map((memory) => memory.memory_key).sort()).toEqual([
      "max_courses_per_term",
      "schedule_interests",
      "schedule_rigor"
    ]);

    const activePlan = await supabase.from("four_year_plans").select("id").eq("user_id", userId).eq("is_active", true).single();
    if (activePlan.error) throw activePlan.error;
    const activeVersion = await supabase.from("plan_versions").select("id").eq("plan_id", activePlan.data.id).eq("kind", "active").single();
    if (activeVersion.error) throw activeVersion.error;
    const seedCourse = await supabase.from("courses").select("id,credits,college_units,is_weighted").eq("school_id", schoolId).eq("confidence", "verified").eq("review_status", "approved").limit(1).single();
    if (seedCourse.error) throw seedCourse.error;
    const seedRow = await supabase.from("plan_courses").insert({
      plan_version_id: activeVersion.data.id,
      user_id: userId,
      course_id: seedCourse.data.id,
      grade_level: 12,
      school_year: "2029-2030",
      term: "full_year",
      status: "planned",
      credits: seedCourse.data.credits,
      college_units: seedCourse.data.college_units,
      is_weighted: seedCourse.data.is_weighted,
      mapping_verified: true,
      user_edited: true,
      sort_order: 0
    }).select("id").single();
    if (seedRow.error) throw seedRow.error;

    const beforeRows = await supabase.from("plan_courses").select("id").eq("user_id", userId).is("source_review_item_id", null);
    if (beforeRows.error) throw beforeRows.error;
    const editableIdsBefore = new Set((beforeRows.data ?? []).map((row) => row.id));
    const scheduleTurn = await sendTurn(
      request,
      accessToken,
      conversationId,
      "Clear my whole schedule. Generate a new one, math starting at pre-calc in grade 9 and maximize GPA as much as possible with reasonable limitations and course rigor. No concurrent classes."
    );
    const scheduleTools = await supabase.from("ai_tool_calls")
      .select("tool_name, status, result")
      .eq("conversation_id", conversationId)
      .eq("tool_name", "get_course_schedule_options");
    if (scheduleTools.error) throw scheduleTools.error;
    expect(scheduleTools.data?.some((tool) => tool.tool_name === "get_course_schedule_options" && tool.status === "completed")).toBe(true);
    expect(scheduleTurn.proposals.map((proposal) => proposal.name), JSON.stringify({ message: scheduleTurn.message, scheduleTools: scheduleTools.data })).toEqual(["add_course_schedule"]);
    const proposalRecord = await supabase.from("ai_tool_calls").select("arguments").eq("id", scheduleTurn.proposals[0]!.id).single();
    if (proposalRecord.error) throw proposalRecord.error;
    expect(proposalRecord.data.arguments).toMatchObject({
      replace_existing: true,
      starting_math_course: "pre-calc",
      start_grade: 9,
      max_courses_per_term: 7,
      rigor: "advanced",
      include_college_courses: false
    });
    const scheduleReviews = await autoReview(request, accessToken, scheduleTurn.proposals);
    expect(scheduleReviews.every((result) => result.applied === true), JSON.stringify(scheduleReviews)).toBe(true);
    const rebuiltRows = await supabase.from("plan_courses").select("id,course_id,grade_level,college_units,source_review_item_id").eq("user_id", userId);
    if (rebuiltRows.error) throw rebuiltRows.error;
    expect(rebuiltRows.data?.filter((row) => !row.source_review_item_id).every((row) => !editableIdsBefore.has(row.id))).toBe(true);
    expect(rebuiltRows.data?.every((row) => row.source_review_item_id || Number(row.college_units ?? 0) === 0)).toBe(true);
    const rebuiltCourseIds = (rebuiltRows.data ?? []).map((row) => row.course_id).filter((id): id is string => Boolean(id));
    const rebuiltCourses = await supabase.from("courses").select("id,name").in("id", rebuiltCourseIds);
    if (rebuiltCourses.error) throw rebuiltCourses.error;
    const courseNameById = new Map((rebuiltCourses.data ?? []).map((course) => [course.id, course.name]));
    expect(rebuiltRows.data?.some((row) => row.grade_level === 9 && /pre[ -]?calc/i.test(courseNameById.get(row.course_id ?? "") ?? ""))).toBe(true);

    const undoTurn = await sendTurn(request, accessToken, conversationId, "Undo that schedule change.");
    expect(undoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    const undoReviews = await autoReview(request, accessToken, undoTurn.proposals);
    expect(undoReviews.every((result) => result.applied === true), JSON.stringify(undoReviews)).toBe(true);
    const restoredRows = await supabase.from("plan_courses").select("id").eq("user_id", userId);
    if (restoredRows.error) throw restoredRows.error;
    expect(restoredRows.data?.map((row) => row.id)).toContain(seedRow.data.id);
    expect(restoredRows.data?.some((row) => rebuiltRows.data?.some((rebuilt) => rebuilt.id === row.id))).toBe(false);

    const settingsTurn = await sendTurn(
      request,
      accessToken,
      conversationId,
      "Change my preferred name to Pilot Stress Test."
    );
    expect(settingsTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_student_settings"]);
    const settingsReviews = await autoReview(request, accessToken, settingsTurn.proposals);
    expect(settingsReviews.every((result) => result.applied === true), JSON.stringify(settingsReviews)).toBe(true);
    const settingsResult = await supabase.from("student_settings").select("preferred_name").eq("id", userId).single();
    expect(settingsResult.data?.preferred_name).toBe("Pilot Stress Test");

    const deletionTurn = await sendTurn(request, accessToken, conversationId, "Delete my account and all authentication data.");
    expect(deletionTurn.proposals).toHaveLength(0);
    expect(deletionTurn.message.toLowerCase()).toMatch(/can(?:not|'t)|unable|settings|account/);

    const forgetTurn = await sendTurn(
      request,
      accessToken,
      conversationId,
      "Forget my schedule rigor and maximum-courses preferences, but keep my environmental science interest."
    );
    expect(forgetTurn.proposals).toHaveLength(0);
    const remainingMemory = await supabase.from("ai_student_memories").select("memory_key").eq("user_id", userId);
    if (remainingMemory.error) throw remainingMemory.error;
    expect(remainingMemory.data).toEqual([{ memory_key: "schedule_interests" }]);
  });
});
