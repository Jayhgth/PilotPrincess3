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
  "college-district selection",
  "selected-school change",
  "enrollment-policy mutation",
  "d.tech major-aware four-year rebuild",
  "exact weighted concurrent-course addition",
  "compound graduation and college course batch"
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
    expect(STRESS_WORKFLOWS).toHaveLength(14);

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

  test("executes cross-institution controls and a d.tech major-aware rebuild", async ({ request }) => {
    test.setTimeout(600_000);
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

    // 9. College district is independent student data and can be changed through Pilot.
    const districtConversation = await createConversation("College district");
    const districtTurn = await sendTurn(request, accessToken, districtConversation, "Change my community-college district to Foothill-De Anza Community College District.");
    expect(districtTurn.proposals.map((proposal) => proposal.name)).toEqual(["set_college_district_preference"]);
    await apply(districtTurn);
    const district = await supabase.from("student_college_district_preferences").select("district_code").eq("user_id", userId).single();
    expect(district.data?.district_code).toMatch(/FOOTHILL|FHDA/i);
    await apply(await sendTurn(request, accessToken, districtConversation, "Undo the district change."));

    // 10. Changing the selected school refreshes every school-owned rule and catalog.
    const schoolConversation = await createConversation("School selection");
    const schoolTurn = await sendTurn(request, accessToken, schoolConversation, "Switch my selected high school to Design Tech High School.");
    expect(schoolTurn.proposals.map((proposal) => proposal.name)).toEqual(["set_current_school"]);
    await apply(schoolTurn);
    const selected = await supabase.from("student_settings").select("school_id").eq("id", userId).single();
    const dtech = await supabase.from("schools").select("id").eq("slug", "design-tech-high-school").single();
    expect(selected.data?.school_id).toBe(dtech.data?.id);

    // 11. Enrollment behavior is a source-backed, undoable preference.
    const enrollmentConversation = await createConversation("Enrollment preference");
    const enrollmentTurn = await sendTurn(request, accessToken, enrollmentConversation, "Use concurrent enrollment and respect the district's recommended unit limit.");
    expect(enrollmentTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_enrollment_preference"]);
    await apply(enrollmentTurn);
    const enrollment = await supabase.from("student_enrollment_preferences").select("program_type,respect_recommended_limit").eq("user_id", userId).single();
    expect(enrollment.data).toMatchObject({ program_type: "concurrent", respect_recommended_limit: true });

    // 12. A compound request resolves every graduation gap and named college
    // course in one read, then produces one executable reversible write.
    const activePlan = await supabase.from("four_year_plans").select("id").eq("user_id", userId).eq("is_active", true).single();
    const activeVersion = await supabase.from("plan_versions").select("id").eq("plan_id", activePlan.data!.id).eq("kind", "active").single();
    const requirements = await supabase.from("graduation_requirements").select("id,area,credits_required").eq("school_id", dtech.data!.id);
    const dtechCatalog = await supabase.from("courses").select("*").eq("school_id", dtech.data!.id).eq("confidence", "verified").eq("review_status", "approved");
    const mappings = await supabase.from("course_requirement_mappings").select("course_id,requirement_id,confidence").in("requirement_id", (requirements.data ?? []).map((row) => row.id));
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
    const math251 = await supabase.from("smccd_courses").select("*").eq("college_code", "CSM").eq("course_code", "MATH 251").order("source_year", { ascending: false }).limit(1).single();
    if (math251.error) throw math251.error;
    const prerequisiteSeed = await supabase.from("plan_courses").insert({
      plan_version_id: activeVersion.data!.id, user_id: userId, smccd_course_id: math251.data.id,
      college_provider_code: "SMCCD", custom_course_name: `${math251.data.course_code} ${math251.data.title}`,
      grade_level: 11, school_year: "2025-2026", term: "spring", status: "current", credits: 10,
      college_units: math251.data.units_max ?? math251.data.units_min, is_weighted: true,
      mapping_verified: false, user_edited: true, sort_order: 999
    });
    if (prerequisiteSeed.error) throw prerequisiteSeed.error;
    const compoundConversation = await createConversation("Compound academic batch");
    const compoundTurn = await sendTurn(request, accessToken, compoundConversation,
      "Add the three classes needed for high school graduation in 12th. From college, add linear algebra, calc 3, physics with calculus 1, 2, and 3. Put in 11th grade summer calc 2, intercultural communication, eng c1000, nosql databases.");
    expect(compoundTurn.proposals.map((proposal) => proposal.name), compoundTurn.message).toEqual(["add_academic_courses"]);
    const compoundTools = await supabase.from("ai_tool_calls").select("tool_name,status,result").eq("conversation_id", compoundConversation).order("created_at");
    expect(compoundTools.data?.some((tool) => tool.tool_name === "resolve_academic_course_batch" && tool.status === "completed"), JSON.stringify(compoundTools.data)).toBe(true);
    await apply(compoundTurn);
    const compoundRows = await supabase.from("plan_courses").select("custom_course_name,grade_level,term,is_weighted").eq("user_id", userId).not("smccd_course_id", "is", null);
    const compoundNames = (compoundRows.data ?? []).map((row) => row.custom_course_name ?? "").join(" | ");
    for (const expectedName of ["Linear Algebra", "Calculus with Analytic Geometry III", "Physics with Calculus I", "Physics with Calculus II", "Physics with Calculus III", "Calculus with Analytic Geometry II", "Intercultural Communication", "Academic Reading and Writing", "NoSQL Databases"]) {
      expect(compoundNames, expectedName).toContain(expectedName);
    }
    expect(compoundRows.data?.filter((row) => row.grade_level === 11 && row.term === "summer").length).toBeGreaterThanOrEqual(4);
    expect(compoundRows.data?.every((row) => row.is_weighted)).toBe(true);
    const clearCompound = await sendTurn(request, accessToken, compoundConversation, "Clear my whole schedule.");
    expect(clearCompound.proposals.map((proposal) => proposal.name)).toEqual(["clear_academic_plan"]);
    await apply(clearCompound);

    // 13. Complex d.tech rebuild preserves explicit placement and major intent, then applies.
    const scheduleConversation = await createConversation("d.tech four-year schedule");
    const scheduleTurn = await sendTurn(request, accessToken, scheduleConversation,
      "Clear my whole schedule and build a rigorous four-year d.tech plan from grade 9. Start math at Algebra 1 and Spanish at Spanish 2, keep at most 7 courses per term, include concurrent courses where useful, maximize weighted GPA, and align electives to an intended computer science major.");
    expect(scheduleTurn.proposals.map((proposal) => proposal.name), scheduleTurn.message).toEqual(["add_course_schedule"]);
    const scheduleRecord = await supabase.from("ai_tool_calls").select("arguments").eq("id", scheduleTurn.proposals[0]!.id).single();
    expect(scheduleRecord.data?.arguments).toMatchObject({ replace_existing: true, start_grade: 9, starting_math_course: "algebra 1", starting_language_course: "spanish 2", interests: ["computer science"], rigor: "advanced", max_courses_per_term: 7 });
    await apply(scheduleTurn);
    const dtechRows = await supabase.from("plan_courses").select("course_id,grade_level").eq("user_id", userId);
    const dtechCourseIds = (dtechRows.data ?? []).map((row) => row.course_id).filter((id): id is string => Boolean(id));
    const dtechCourses = await supabase.from("courses").select("id,name,subject").in("id", dtechCourseIds);
    const names = new Map((dtechCourses.data ?? []).map((course) => [course.id, `${course.name} ${course.subject}`]));
    expect(dtechRows.data?.some((row) => row.grade_level === 9 && /algebra 1/i.test(names.get(row.course_id ?? "") ?? ""))).toBe(true);
    expect(dtechRows.data?.some((row) => row.grade_level === 9 && /spanish 2/i.test(names.get(row.course_id ?? "") ?? ""))).toBe(true);
    expect(dtechRows.data?.some((row) => /computer|coding|programming|game design|engineering/i.test(names.get(row.course_id ?? "") ?? ""))).toBe(true);

    // 14. Exact concurrent enrollment uses the college catalog identity and is always weighted.
    const collegeCourseConversation = await createConversation("Concurrent course addition");
    const collegeCourseTurn = await sendTurn(request, accessToken, collegeCourseConversation,
      "Add CSM CIS 110 to grade 11 summer as a planned college course.");
    expect(collegeCourseTurn.proposals.map((proposal) => proposal.name)).toEqual(["add_smccd_course"]);
    await apply(collegeCourseTurn);
    const collegeRow = await supabase.from("plan_courses").select("smccd_course_id,college_units,is_weighted,grade_level,term")
      .eq("user_id", userId).eq("smccd_course_id", "CSM:CIS 110").single();
    expect(collegeRow.data).toMatchObject({ smccd_course_id: "CSM:CIS 110", college_units: 3, is_weighted: true, grade_level: 11, term: "summer" });
  });
});
