import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const qaEmail = process.env.QA_EMAIL;
const qaPassword = process.env.QA_PASSWORD;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const liveConfigured = process.env.RUN_LIVE_PILOT === "1"
  && Boolean(supabaseUrl && supabaseAnonKey);

type Proposal = { id: string; name: string };

const STRESS_WORKFLOWS = [
  "theme mutation and undo",
  "profile and planning-window mutation",
  "graduation-gap explanation",
  "exact selected-school course addition",
  "saved GPA assumptions",
  "canonical course sorting",
  "degree search and bookmark",
  "compound academic clearing and restoration",
  "progress-aware diploma and associate-degree schedule"
] as const;

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
      message
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

async function reviewAndApply(
  request: APIRequestContext,
  accessToken: string,
  proposals: Proposal[]
) {
  const results = [];
  for (const proposal of proposals) {
    const response = await authorizedPost(request, "/api/ai/tool", accessToken, { toolCallId: proposal.id });
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
  let ephemeralAccount = false;

  test.beforeEach(async ({ request }) => {
    supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const signIn = qaEmail && qaPassword
      ? await supabase.auth.signInWithPassword({ email: qaEmail, password: qaPassword })
      : await supabase.auth.signUp({
          email: `pilot-live-${randomUUID()}@example.com`,
          password: `Pp-${randomUUID()}!9a`,
          options: { data: { preferred_name: "Pilot QA" } }
        });
    if (signIn.error || !signIn.data.session || !signIn.data.user) throw signIn.error ?? new Error("The QA account could not sign in.");
    ephemeralAccount = !(qaEmail && qaPassword);
    accessToken = signIn.data.session.access_token;
    userId = signIn.data.user.id;

    if (!ephemeralAccount) {
      const reset = await authorizedPost(request, "/api/admin/reset", accessToken, {});
      expect(reset.ok(), await reset.text()).toBe(true);
    }
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
  });

  test.afterEach(async () => {
    if (ephemeralAccount) await supabase.rpc("delete_current_user_account");
    ephemeralAccount = false;
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
      max_courses_per_term: 6,
      rigor: "advanced",
      include_college_courses: false
    });
    const scheduleReviews = await reviewAndApply(request, accessToken, scheduleTurn.proposals);
    expect(scheduleReviews.every((result) => result.applied === true), JSON.stringify(scheduleReviews)).toBe(true);
    const rebuiltRows = await supabase.from("plan_courses").select("id,course_id,grade_level,college_units,source_review_item_id").eq("user_id", userId);
    if (rebuiltRows.error) throw rebuiltRows.error;
    expect(rebuiltRows.data?.filter((row) => !row.source_review_item_id).every((row) => !editableIdsBefore.has(row.id))).toBe(true);
    expect(rebuiltRows.data?.every((row) => row.source_review_item_id || Number(row.college_units ?? 0) === 0)).toBe(true);
    const rebuiltCourseIds = (rebuiltRows.data ?? []).map((row) => row.course_id).filter((id): id is string => Boolean(id));
    const rebuiltCourses = await supabase.from("courses").select("id,name,subject,uc_ag_area").in("id", rebuiltCourseIds);
    if (rebuiltCourses.error) throw rebuiltCourses.error;
    const courseNameById = new Map((rebuiltCourses.data ?? []).map((course) => [course.id, course.name]));
    expect(rebuiltRows.data?.some((row) => row.grade_level === 9 && /pre[ -]?calc/i.test(courseNameById.get(row.course_id ?? "") ?? ""))).toBe(true);
    for (const grade of [9, 10, 11, 12]) {
      const gradeCourseIds = new Set(rebuiltRows.data?.filter((row) => row.grade_level === grade).map((row) => row.course_id));
      expect(rebuiltCourses.data?.some((course) => gradeCourseIds.has(course.id) && (/math|calculus|statistics/i.test(`${course.name} ${course.subject}`) || /^c\b/i.test(course.uc_ag_area ?? ""))), `Grade ${grade} math`).toBe(true);
    }
    const grade10Ids = new Set(rebuiltRows.data?.filter((row) => row.grade_level === 10).map((row) => row.course_id));
    expect(rebuiltCourses.data?.some((course) => grade10Ids.has(course.id) && /science|biology|chemistry|physics/i.test(`${course.name} ${course.subject}`)), "Grade 10 science").toBe(true);
    expect(rebuiltCourses.data?.filter((course) => /ceramic|\bart\b|music|choir|theater|drama|dance/i.test(course.name)).length).toBe(1);

    const undoTurn = await sendTurn(request, accessToken, conversationId, "Undo that schedule change.");
    expect(undoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    const undoReviews = await reviewAndApply(request, accessToken, undoTurn.proposals);
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
    const settingsReviews = await reviewAndApply(request, accessToken, settingsTurn.proposals);
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

  test("executes diverse student workflows across Carlmont and d.tech", async ({ request }) => {
    test.setTimeout(900_000);
    expect(STRESS_WORKFLOWS).toHaveLength(9);

    const createConversation = async (title: string) => {
      const response = await authorizedPost(request, "/api/ai/conversations", accessToken, { title });
      expect(response.status(), await response.text()).toBe(201);
      return String((await response.json() as { conversation: { id: string } }).conversation.id);
    };
    const toolNames = async (conversationId: string) => {
      const rows = await supabase.from("ai_tool_calls").select("tool_name,status").eq("conversation_id", conversationId).order("created_at");
      if (rows.error) throw rows.error;
      return (rows.data ?? []).map((row) => `${row.tool_name}:${row.status}`);
    };
    const apply = async (turn: Awaited<ReturnType<typeof sendTurn>>) => {
      expect(turn.proposals.length, turn.message).toBeGreaterThan(0);
      const results = await reviewAndApply(request, accessToken, turn.proposals);
      expect(results.every((result) => result.applied === true), JSON.stringify(results)).toBe(true);
      return results;
    };

    // 1. Interface preference is a normal, reversible Pilot-controlled setting.
    const themeConversation = await createConversation("Theme control");
    const themeTurn = await sendTurn(request, accessToken, themeConversation, "Switch the whole app to dark mode.");
    expect(themeTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_student_settings"]);
    await apply(themeTurn);
    expect((await supabase.from("student_settings").select("ui_theme").eq("id", userId).single()).data?.ui_theme).toBe("dark");
    await apply(await sendTurn(request, accessToken, themeConversation, "Undo that theme change."));
    expect((await supabase.from("student_settings").select("ui_theme").eq("id", userId).single()).data?.ui_theme).toBe("light");

    // 2. Ordinary profile and planning settings mutate as one exact request.
    const profileConversation = await createConversation("Profile control");
    const profileTurn = await sendTurn(request, accessToken, profileConversation, "Set my current grade to 10, graduation year to 2029, and planning window from grade 10 through grade 12.");
    expect(profileTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_student_settings"]);
    await apply(profileTurn);
    const profile = await supabase.from("student_settings").select("grade_level,graduation_year,plan_start_grade,plan_end_grade").eq("id", userId).single();
    expect(profile.data).toMatchObject({ grade_level: 10, graduation_year: 2029, plan_start_grade: 10, plan_end_grade: 12 });
    await apply(await sendTurn(request, accessToken, profileConversation, "Undo those profile changes."));

    // 3. Read-only graduation guidance must use the deterministic requirement engine.
    const graduationConversation = await createConversation("Graduation gaps");
    const graduationTurn = await sendTurn(request, accessToken, graduationConversation, "What graduation requirements am I still missing, and which planned courses count toward each one?");
    expect(graduationTurn.proposals).toHaveLength(0);
    expect(await toolNames(graduationConversation)).toContain("get_graduation_progress:completed");

    // 4. Search and add one exact Carlmont catalog course without asking for an internal ID.
    const courseConversation = await createConversation("Course addition");
    const courseTurn = await sendTurn(request, accessToken, courseConversation, "Add Carlmont Biology to grade 9 as an in-progress full-year course.");
    expect(courseTurn.proposals.map((proposal) => proposal.name)).toContain("add_high_school_course");
    await apply(courseTurn);
    expect((await supabase.from("plan_courses").select("id").eq("user_id", userId).eq("grade_level", 9).eq("status", "current")).data?.length).toBeGreaterThan(0);

    // 5. GPA assumptions persist through the same product state the GPA tab reads.
    const gpaConversation = await createConversation("GPA assumptions");
    const gpaTurn = await sendTurn(request, accessToken, gpaConversation, "Set every current and planned course in my GPA calculator to an expected A and keep each one included.");
    expect(gpaTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_gpa_scenario"]);
    await apply(gpaTurn);
    const openRows = await supabase.from("plan_courses").select("id").eq("user_id", userId).in("status", ["current", "planned"]);
    const gpaRows = await supabase.from("student_gpa_scenario_choices").select("plan_course_id,included,expected_grade").eq("user_id", userId);
    expect(gpaRows.data).toHaveLength(openRows.data?.length ?? 0);
    expect(gpaRows.data?.every((row) => row.included && row.expected_grade === "A")).toBe(true);

    // 6. Board sorting is an actual reversible mutation, not prose instructions.
    const sortConversation = await createConversation("Sort plan");
    const sortTurn = await sendTurn(request, accessToken, sortConversation, "Sort my entire course board into the app's standard order.");
    expect(sortTurn.proposals.map((proposal) => proposal.name)).toEqual(["sort_plan_courses"]);
    await apply(sortTurn);

    // 7. Degree intent is searched and stored as canonical app data.
    const degreeConversation = await createConversation("Degree goal");
    const degreeTurn = await sendTurn(request, accessToken, degreeConversation, "Bookmark the Computer Science Applications and Development AS degree at College of San Mateo as my college goal.");
    expect(degreeTurn.proposals.map((proposal) => proposal.name)).toEqual(["set_college_goal"]);
    await apply(degreeTurn);
    expect((await supabase.from("student_smccd_goals").select("id").eq("user_id", userId)).data?.length).toBe(1);

    // 8. Cross-feature clearing has one durable inverse and restores all three domains.
    const clearConversation = await createConversation("Clear and restore academic plan");
    const clearTurn = await sendTurn(request, accessToken, clearConversation, "Clear my whole schedule, every degree bookmark, and all saved GPA assumptions.");
    expect(clearTurn.proposals.map((proposal) => proposal.name)).toEqual(["clear_academic_plan"]);
    await apply(clearTurn);
    expect((await supabase.from("plan_courses").select("id").eq("user_id", userId)).data).toHaveLength(0);
    expect((await supabase.from("student_smccd_goals").select("id").eq("user_id", userId)).data).toHaveLength(0);
    expect((await supabase.from("student_gpa_scenario_choices").select("plan_course_id").eq("user_id", userId)).data).toHaveLength(0);
    await apply(await sendTurn(request, accessToken, clearConversation, "Bring all of that back."));
    expect((await supabase.from("plan_courses").select("id").eq("user_id", userId)).data?.length).toBeGreaterThan(0);
    expect((await supabase.from("student_smccd_goals").select("id").eq("user_id", userId)).data?.length).toBe(1);
  });

  test("builds and applies a progress-aware diploma and associate-degree schedule", async ({ request }) => {
    test.setTimeout(900_000);
    const createConversation = async (title: string) => {
      const response = await authorizedPost(request, "/api/ai/conversations", accessToken, { title });
      expect(response.status(), await response.text()).toBe(201);
      return String((await response.json() as { conversation: { id: string } }).conversation.id);
    };
    const apply = async (turn: Awaited<ReturnType<typeof sendTurn>>) => {
      expect(turn.proposals.length, turn.message).toBeGreaterThan(0);
      const results = await reviewAndApply(request, accessToken, turn.proposals);
      expect(results.every((result) => result.applied === true), JSON.stringify(results)).toBe(true);
    };

    // The fixture models a grade-11 d.tech student with a primary Communication
    // Studies goal, substantial completed work, and source-backed concurrent limits.
    const dtech = await supabase.from("schools").select("id").eq("slug", "design-tech-high-school").single();
    if (dtech.error) throw dtech.error;
    const schoolSelection = await supabase.rpc("select_current_school", { target_school_id: dtech.data.id });
    if (schoolSelection.error) throw schoolSelection.error;
    const studentContext = await supabase.from("student_settings").update({
      grade_level: 11,
      graduation_year: 2027,
      plan_start_grade: 11,
      plan_end_grade: 12
    }).eq("id", userId);
    if (studentContext.error) throw studentContext.error;
    const enrollment = await supabase.from("student_enrollment_preferences").upsert({
      user_id: userId,
      provider_code: "SMCCD",
      program_type: "concurrent",
      limit_mode: "recommended",
      respect_recommended_limit: true
    }, { onConflict: "user_id,provider_code" });
    if (enrollment.error) throw enrollment.error;
    const programId = "CSM:communication-studies-aa";
    const degreeGoal = await supabase.from("student_smccd_goals").insert({
      user_id: userId,
      program_id: programId,
      is_primary: true,
      notes: "Intended Communication Studies major"
    });
    if (degreeGoal.error) throw degreeGoal.error;

    const activePlan = await supabase.from("four_year_plans").select("id").eq("user_id", userId).eq("is_active", true).single();
    const activeVersion = await supabase.from("plan_versions").select("id").eq("plan_id", activePlan.data!.id).eq("kind", "active").single();
    const requirements = await supabase.from("graduation_requirements").select("*").eq("school_id", dtech.data!.id);
    const dtechCatalog = await supabase.from("courses").select("*").eq("school_id", dtech.data!.id).eq("confidence", "verified").eq("review_status", "approved");
    const mappings = await supabase.from("course_requirement_mappings").select("*").in("requirement_id", (requirements.data ?? []).map((row) => row.id));
    const courseById = new Map((dtechCatalog.data ?? []).map((course) => [course.id, course]));
    const usedCourseIds = new Set<string>();
    const graduationSeedRows: Array<Record<string, unknown>> = [];
    for (const requirement of requirements.data ?? []) {
      if (requirement.area === "electives") continue;
      const leaveOpen = ["english", "design_lab", "social_science"].includes(requirement.area) ? 10 : 0;
      let creditsToSeed = Math.max(0, Number(requirement.credits_required) - leaveOpen);
      const candidates = (mappings.data ?? [])
        .filter((mapping) => mapping.requirement_id === requirement.id && mapping.confidence === "verified")
        .map((mapping) => courseById.get(mapping.course_id))
        .filter((course): course is NonNullable<typeof course> => Boolean(course) && !usedCourseIds.has(course.id))
        .filter((course) => requirement.area !== "social_science" || !/government|economics/i.test(course.name))
        .sort((left, right) => requirement.area === "lab_science"
          ? Number(/biology/i.test(right.name)) - Number(/biology/i.test(left.name)) || Number(/physics|physical/i.test(right.name)) - Number(/physics|physical/i.test(left.name))
          : left.name.localeCompare(right.name));
      for (const course of candidates) {
        if (creditsToSeed <= 0) break;
        usedCourseIds.add(course.id);
        const offset = graduationSeedRows.length % 3;
        graduationSeedRows.push({
          plan_version_id: activeVersion.data!.id, user_id: userId, course_id: course.id,
          grade_level: 9 + offset, school_year: `${2023 + offset}-${2024 + offset}`,
          term: course.term_type === "year" ? "full_year" : "fall", status: "completed", letter_grade: "A",
          credits: course.credits, college_units: course.college_units, is_weighted: course.is_weighted,
          mapping_verified: true, user_edited: true, sort_order: graduationSeedRows.length
        });
        creditsToSeed -= Number(course.credits ?? 0);
      }
    }
    const seedInsert = await supabase.from("plan_courses").insert([
      ...graduationSeedRows,
      { plan_version_id: activeVersion.data!.id, user_id: userId, custom_course_name: "World History", requirement_area_override: "social_science", grade_level: 10, school_year: "2024-2025", term: "full_year", status: "completed", letter_grade: "A", credits: 10, college_units: null, is_weighted: false, mapping_verified: true, user_edited: true, sort_order: 900 },
      { plan_version_id: activeVersion.data!.id, user_id: userId, custom_course_name: "Verified Intersession Personal Development", requirement_area_override: "personal_development", grade_level: 11, school_year: "2025-2026", term: "summer", status: "completed", letter_grade: "P", credits: 35, college_units: null, is_weighted: false, mapping_verified: true, user_edited: true, sort_order: 901 }
    ]);
    if (seedInsert.error) throw seedInsert.error;
    const [programResult, programRequirementsResult, csmCatalogResult] = await Promise.all([
      supabase.from("smccd_programs").select("*").eq("id", programId).single(),
      supabase.from("smccd_program_requirements").select("*").eq("program_id", programId).order("sort_order"),
      supabase.from("smccd_courses").select("*").eq("college_code", "CSM")
    ]);
    if (programResult.error) throw programResult.error;
    if (programRequirementsResult.error) throw programRequirementsResult.error;
    if (csmCatalogResult.error) throw csmCatalogResult.error;
    const programRequirementIds = (programRequirementsResult.data ?? []).map((row) => row.id);
    const programOptionsResult = await supabase.from("smccd_requirement_courses").select("*").in("requirement_id", programRequirementIds);
    if (programOptionsResult.error) throw programOptionsResult.error;
    const programOptionCodes = new Set((programOptionsResult.data ?? []).map((row) => row.course_code));
    const catalog = csmCatalogResult.data ?? [];
    const catalogByCode = new Map(catalog.map((course) => [course.course_code, course]));
    const initialDegreeCodes = [
      "COMM 115", "COMM C1000", "COMM 130", "COMM 140", "SOCI 110", "PSYC 110",
      "ENGL C1000", "MATH 125", "ART 101", "ASTR 100", "ETHN 103",
      "HIST 201", "AQUA 109.1", "CIS 110"
    ];
    const degreeSeedCourses = initialDegreeCodes.map((code) => catalogByCode.get(code)).filter((course): course is NonNullable<typeof course> => Boolean(course));
    expect(degreeSeedCourses).toHaveLength(initialDegreeCodes.length);
    let seededCollegeUnits = degreeSeedCourses.reduce((total, course) => total + Number(course.units_max ?? course.units_min), 0);
    const selectedCollegeIds = new Set(degreeSeedCourses.map((course) => course.id));
    const fillers = catalog
      .filter((course) => course.degree_applicable && !selectedCollegeIds.has(course.id))
      .filter((course) => !programOptionCodes.has(course.course_code))
      .filter((course) => (course.prerequisites ?? []).length === 0 && Number(course.units_max ?? course.units_min) >= 2.5)
      .sort((left, right) => left.course_code.localeCompare(right.course_code));
    for (const course of fillers) {
      if (seededCollegeUnits >= 57) break;
      degreeSeedCourses.push(course);
      selectedCollegeIds.add(course.id);
      seededCollegeUnits += Number(course.units_max ?? course.units_min);
    }
    expect(seededCollegeUnits).toBeGreaterThanOrEqual(57);
    const degreeSeedInsert = await supabase.from("plan_courses").insert(degreeSeedCourses.map((course, index) => {
      const units = Number(course.units_max ?? course.units_min);
      const current = course.course_code === "COMM 140";
      return {
        plan_version_id: activeVersion.data!.id,
        user_id: userId,
        smccd_course_id: course.id,
        college_provider_code: "SMCCD",
        custom_course_name: `${course.course_code} ${course.title}`,
        grade_level: current ? 11 : index < 8 ? 10 : 11,
        school_year: current ? "2025-2026" : index < 8 ? "2024-2025" : "2025-2026",
        term: current ? "spring" : index % 2 ? "spring" : "fall",
        status: current ? "current" : "completed",
        letter_grade: current ? null : "A",
        credits: units >= 4 ? 10 : 5,
        college_units: units,
        is_weighted: true,
        mapping_verified: false,
        user_edited: true,
        sort_order: 1_000 + index
      };
    }));
    if (degreeSeedInsert.error) throw degreeSeedInsert.error;

    const baselineRows = await supabase.from("plan_courses").select("id").eq("user_id", userId);
    if (baselineRows.error) throw baselineRows.error;
    const baselineIds = new Set((baselineRows.data ?? []).map((row) => row.id));

    // This is the canonical autonomy test: natural-language intent plus saved
    // student context must become one validated, applied, reversible schedule.
    const scheduleConversation = await createConversation("Complete diploma and Communication Studies AA");
    const scheduleTurn = await sendTurn(request, accessToken, scheduleConversation,
      "Use my saved progress to build and apply the rest of my schedule from grade 11 summer through grade 12. My intended major is Communication Studies. Keep every completed or in-progress class, finish my d.tech diploma and my bookmarked CSM Communication Studies AA—including every remaining major, local GE, separate graduation, and 60-unit requirement—under my already-saved concurrent-enrollment preference and its recommended per-term unit limit. Do not change that preference. Balance the remaining work across the available terms and do not just describe the plan; add it.");
    expect(scheduleTurn.proposals.map((proposal) => proposal.name), scheduleTurn.message).toEqual(["add_academic_courses"]);
    const scheduleTools = await supabase.from("ai_tool_calls").select("tool_name,status,result,arguments")
      .eq("conversation_id", scheduleConversation).order("created_at");
    if (scheduleTools.error) throw scheduleTools.error;
    for (const requiredTool of ["get_academic_context", "get_degree_progress", "get_enrollment_constraints"]) {
      expect(scheduleTools.data?.some((tool) => tool.tool_name === requiredTool && tool.status === "completed"), JSON.stringify(scheduleTools.data)).toBe(true);
    }
    const proposalRecord = scheduleTools.data?.find((tool) => tool.tool_name === "add_academic_courses");
    expect(proposalRecord?.arguments).toMatchObject({ respect_recommended_limit: true });
    await apply(scheduleTurn);

    const finalRowsResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (finalRowsResult.error) throw finalRowsResult.error;
    const finalRows = finalRowsResult.data ?? [];
    expect([...baselineIds].every((id) => finalRows.some((row) => row.id === id))).toBe(true);
    const additions = finalRows.filter((row) => !baselineIds.has(row.id));
    expect(additions.some((row) => Boolean(row.course_id))).toBe(true);
    expect(additions.some((row) => Boolean(row.smccd_course_id))).toBe(true);
    expect(additions.filter((row) => row.smccd_course_id).every((row) => row.is_weighted)).toBe(true);

    const openCollegeTerms = new Map<string, number>();
    for (const row of finalRows.filter((course) => course.status !== "completed" && course.smccd_course_id)) {
      const key = `${row.school_year}:${row.term}`;
      openCollegeTerms.set(key, (openCollegeTerms.get(key) ?? 0) + Number(row.college_units ?? 0));
    }
    expect([...openCollegeTerms.values()].every((units) => units <= 11)).toBe(true);

    const verificationTurn = await sendTurn(request, accessToken, scheduleConversation,
      "Verify the saved schedule now completes my d.tech diploma and bookmarked Communication Studies AA, including the major, CSM local GE, separate degree requirements, 60 units, and concurrent-enrollment limit. Read the current records; do not change anything.");
    expect(verificationTurn.proposals).toHaveLength(0);
    const verificationTools = await supabase.from("ai_tool_calls").select("tool_name,status,result")
      .eq("conversation_id", scheduleConversation).order("created_at");
    if (verificationTools.error) throw verificationTools.error;
    const latestResult = (toolName: string) => verificationTools.data?.findLast((tool) => tool.tool_name === toolName && tool.status === "completed")?.result as Record<string, unknown> | undefined;
    const academicData = latestResult("get_academic_context")?.data as { graduation?: Array<{ status?: string }> } | undefined;
    const degreeData = latestResult("get_degree_progress")?.data as {
      totals?: { projected_college_units?: number; total_degree_units?: number; remaining_degree_applicable_units?: number };
      requirements?: Array<{ status?: string }>;
      local_degree_pattern?: {
        ge_areas?: Array<{ status?: string }>;
        separate_graduation_requirements?: Array<{ status?: string }>;
      };
    } | undefined;
    const enrollmentData = latestResult("get_enrollment_constraints")?.data as { terms?: Array<{ state?: string }> } | undefined;
    expect(academicData?.graduation?.every((item) => item.status !== "missing")).toBe(true);
    expect(degreeData?.totals?.remaining_degree_applicable_units).toBe(0);
    expect(Number(degreeData?.totals?.projected_college_units ?? 0)).toBeGreaterThanOrEqual(Number(degreeData?.totals?.total_degree_units ?? 60));
    expect(degreeData?.requirements?.every((item) => item.status === "satisfied")).toBe(true);
    expect(degreeData?.local_degree_pattern?.ge_areas?.every((area) => area.status === "completed" || area.status === "planned")).toBe(true);
    expect(degreeData?.local_degree_pattern?.separate_graduation_requirements?.every((requirement) => requirement.status === "completed" || requirement.status === "planned")).toBe(true);
    expect(enrollmentData?.terms?.every((term) => term.state !== "blocked" && term.state !== "over_policy")).toBe(true);

    const undoTurn = await sendTurn(request, accessToken, scheduleConversation, "Undo that schedule addition.");
    expect(undoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(undoTurn);
    const restoredRows = await supabase.from("plan_courses").select("id").eq("user_id", userId);
    expect(new Set((restoredRows.data ?? []).map((row) => row.id))).toEqual(baselineIds);
  });
});
