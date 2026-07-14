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
    const school = await supabase.from("schools").select("id").eq("slug", "design-tech-high-school").single();
    if (school.error) throw school.error;
    const schoolSelection = await supabase.rpc("select_current_school", { target_school_id: school.data.id });
    if (schoolSelection.error) throw schoolSelection.error;
    const settings = await supabase.from("student_settings").update({
      preferred_name: "Pilot QA",
      age: 17,
      grade_level: 11,
      graduation_year: 2027,
      plan_start_grade: 11,
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

    const providerTurn = await sendTurn(request, accessToken, conversationId, "Which community colleges are closest to my school?");
    expect(providerTurn.proposals).toHaveLength(0);
    const providerTools = await supabase.from("ai_tool_calls").select("tool_name,status").eq("conversation_id", conversationId).eq("tool_name", "get_nearby_education_providers");
    expect(providerTools.data).toContainEqual({ tool_name: "get_nearby_education_providers", status: "completed" });

    const correctionTurn = await sendTurn(request, accessToken, conversationId, "Submit a shared school-data correction for administrator review: the school's directory_source_url should be https://sd.cde.ca.gov/schooldirectory/details?cdscode=41690470129759, and that same official CDE page is the evidence.");
    expect(correctionTurn.proposals.map((proposal) => proposal.name)).toEqual(["submit_shared_data_correction"]);
    const correctionReviews = await autoReview(request, accessToken, correctionTurn.proposals);
    expect(correctionReviews.every((result) => result.applied === true), JSON.stringify(correctionReviews)).toBe(true);
    const pendingCorrection = await supabase.from("shared_data_proposals").select("id,status").eq("submitted_by", userId).eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    if (pendingCorrection.error) throw pendingCorrection.error;
    const publishCorrection = await authorizedPost(request, "/api/admin/shared-proposals", accessToken, { proposalId: pendingCorrection.data.id, decision: "approved", note: "Live QA publish-path verification." });
    expect(publishCorrection.ok(), await publishCorrection.text()).toBe(true);

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

    const scheduleTurn = await sendTurn(
      request,
      accessToken,
      conversationId,
      "Create a complete schedule for me through graduation using my saved preferences and keep any college work within the recommended limit."
    );
    const scheduleTools = await supabase.from("ai_tool_calls")
      .select("tool_name, status")
      .eq("conversation_id", conversationId)
      .eq("tool_name", "get_course_schedule_options");
    if (scheduleTools.error) throw scheduleTools.error;
    expect(scheduleTools.data).toContainEqual({ tool_name: "get_course_schedule_options", status: "completed" });
    if (scheduleTurn.proposals.length) {
      expect(scheduleTurn.proposals.map((proposal) => proposal.name)).toEqual(["add_course_schedule"]);
      const scheduleReviews = await autoReview(request, accessToken, scheduleTurn.proposals);
      expect(scheduleReviews.every((result) => result.applied === true), JSON.stringify(scheduleReviews)).toBe(true);
    } else {
      expect(scheduleTurn.message.toLowerCase()).toMatch(/partial|remaining|remain|not complete|cannot complete|couldn't complete/);
    }

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
