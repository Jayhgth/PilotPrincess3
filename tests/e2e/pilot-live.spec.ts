import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { mathSequenceRankFromText } from "@/lib/planning";

const qaEmail = process.env.QA_EMAIL;
const qaPassword = process.env.QA_PASSWORD;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const appOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4388";
const liveConfigured = process.env.RUN_LIVE_PILOT === "1"
  && Boolean(supabaseUrl && supabaseAnonKey);

type Proposal = { id: string; name: string; arguments?: Record<string, unknown> };

async function authorizedPost(
  request: APIRequestContext,
  path: string,
  accessToken: string,
  data: Record<string, unknown>
) {
  return request.post(path, {
    headers: { authorization: `Bearer ${accessToken}`, origin: appOrigin },
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
    headers: { authorization: `Bearer ${accessToken}`, origin: appOrigin },
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
    runtime?: { latencyMs?: number };
  });
  const failure = events.find((event) => event.kind === "turn.failed");
  expect(failure?.message).toBeUndefined();
  const completed = events.findLast((event) => event.kind === "turn.completed");
  expect(completed).toBeDefined();
  return {
    message: completed?.assistantMessage?.content ?? "",
    proposals: completed?.proposals ?? [],
    runtime: completed?.runtime ?? {}
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
    let livePromptCount = 0;
    const promptPilot = async (conversationId: string, message: string) => {
      livePromptCount += 1;
      return sendTurn(request, accessToken, conversationId, message);
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
    const themeConversation = await createConversation("Theme persistence");
    const darkThemeTurn = await promptPilot(themeConversation, "Change the app to dark mode.");
    expect(darkThemeTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_student_settings"]);
    await apply(darkThemeTurn);
    expect((await supabase.from("student_settings").select("ui_theme").eq("id", userId).single()).data?.ui_theme).toBe("dark");
    const lightThemeTurn = await promptPilot(themeConversation, "Change the app back to light mode.");
    expect(lightThemeTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_student_settings"]);
    await apply(lightThemeTurn);
    expect((await supabase.from("student_settings").select("ui_theme").eq("id", userId).single()).data?.ui_theme).toBe("light");
    const preferredNameTurn = await promptPilot(themeConversation, "Set my preferred name to Jay.");
    await apply(preferredNameTurn);
    expect((await supabase.from("student_settings").select("preferred_name").eq("id", userId).single()).data?.preferred_name).toBe("Jay");
    const restoreNameTurn = await promptPilot(themeConversation, "Set my preferred name back to Pilot QA.");
    await apply(restoreNameTurn);
    expect((await supabase.from("student_settings").select("preferred_name").eq("id", userId).single()).data?.preferred_name).toBe("Pilot QA");
    const enrollmentTurn = await promptPilot(themeConversation, "Use concurrent enrollment and respect the recommended unit limit.");
    await apply(enrollmentTurn);
    expect((await supabase.from("student_enrollment_preferences").select("program_type,respect_recommended_limit").eq("user_id", userId).eq("provider_code", "SMCCD").single()).data).toMatchObject({ program_type: "concurrent", respect_recommended_limit: true });
    const programId = "CSM:communication-studies-aa";
    const bookmarkTurn = await promptPilot(themeConversation, "Bookmark the Communication Studies AA degree at CSM.");
    await apply(bookmarkTurn);
    const savedGoals = await supabase.from("student_smccd_goals").select("program_id").eq("user_id", userId);
    if (savedGoals.error) throw savedGoals.error;
    expect((savedGoals.data ?? []).map((goal) => goal.program_id)).toEqual([programId]);

    const controlCatalog = await supabase.from("courses")
      .select("name,grade_levels,prerequisites")
      .eq("school_id", dtech.data.id)
      .eq("confidence", "verified")
      .eq("review_status", "approved")
      .contains("grade_levels", [12]);
    if (controlCatalog.error) throw controlCatalog.error;
    const removableCourse = (controlCatalog.data ?? []).find((course) => Array.isArray(course.prerequisites) && course.prerequisites.length === 0)
      ?? controlCatalog.data?.[0];
    expect(removableCourse, "The selected-school fixture needs one eligible grade-12 catalog course.").toBeDefined();
    const addHighSchoolTurn = await promptPilot(themeConversation, `Add ${removableCourse!.name} to grade 12 full year.`);
    expect(addHighSchoolTurn.proposals.map((proposal) => proposal.name), addHighSchoolTurn.message).toEqual(["add_high_school_course"]);
    await apply(addHighSchoolTurn);
    const clearPlanTurn = await promptPilot(themeConversation, "clear plan");
    expect(clearPlanTurn.proposals.map((proposal) => proposal.name)).toEqual(["clear_academic_plan"]);
    expect(clearPlanTurn.proposals[0]?.arguments).toEqual({ courses: true, degree_bookmarks: false, gpa_scenario: false });
    await apply(clearPlanTurn);
    const clearedPlanRows = await supabase.from("plan_courses").select("id").eq("user_id", userId).is("source_review_item_id", null);
    if (clearedPlanRows.error) throw clearedPlanRows.error;
    expect(clearedPlanRows.data).toHaveLength(0);
    const retainedGoals = await supabase.from("student_smccd_goals").select("program_id").eq("user_id", userId);
    if (retainedGoals.error) throw retainedGoals.error;
    expect((retainedGoals.data ?? []).map((goal) => goal.program_id)).toEqual([programId]);
    const clearPlanUndo = await promptPilot(themeConversation, "Undo that clear.");
    expect(clearPlanUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(clearPlanUndo);
    const restoredPlanRows = await supabase.from("plan_courses").select("id").eq("user_id", userId).is("source_review_item_id", null);
    if (restoredPlanRows.error) throw restoredPlanRows.error;
    expect(restoredPlanRows.data).toHaveLength(1);
    const removeHighSchoolTurn = await promptPilot(themeConversation, "Remove every planned course in grade 12.");
    expect(removeHighSchoolTurn.proposals.map((proposal) => proposal.name)).toEqual(["remove_plan_courses"]);
    await apply(removeHighSchoolTurn);

    const addCollegeTurn = await promptPilot(themeConversation, "Add CSM ACTG 100 Accounting Procedures to grade 11 fall.");
    expect(addCollegeTurn.proposals.map((proposal) => proposal.name)).toEqual(["add_smccd_course"]);
    await apply(addCollegeTurn);
    const gpaTurn = await promptPilot(themeConversation, "Set every current and planned course in my GPA calculator to an expected A.");
    expect(gpaTurn.proposals.map((proposal) => proposal.name)).toEqual(["update_gpa_scenario"]);
    await apply(gpaTurn);
    const gpaUndoTurn = await promptPilot(themeConversation, "Undo that GPA change.");
    expect(gpaUndoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(gpaUndoTurn);
    const collegeUndoTurn = await promptPilot(themeConversation, "Undo that college course addition.");
    expect(collegeUndoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(collegeUndoTurn);

    const activePlan = await supabase.from("four_year_plans").select("id").eq("user_id", userId).eq("is_active", true).single();
    const activeVersion = await supabase.from("plan_versions").select("id").eq("plan_id", activePlan.data!.id).eq("kind", "active").single();
    const requirements = await supabase.from("graduation_requirements").select("*").eq("school_id", dtech.data!.id);
    const dtechCatalog = await supabase.from("courses").select("*").eq("school_id", dtech.data!.id).eq("confidence", "verified").eq("review_status", "approved");
    const mappings = await supabase.from("course_requirement_mappings").select("*").in("requirement_id", (requirements.data ?? []).map((row) => row.id));
    const equivalencies = await supabase.from("smccd_high_school_equivalencies").select("normalized_course_code,requirement_area");
    if (equivalencies.error) throw equivalencies.error;
    const personalDevelopment = (requirements.data ?? []).find((requirement) => requirement.area === "personal_development");
    expect(personalDevelopment?.notes).toContain("through d.tech intersession courses");
    expect(personalDevelopment?.notes).toContain("does not count toward this requirement");
    const courseById = new Map((dtechCatalog.data ?? []).map((course) => [course.id, course]));
    const languageEquivalencyCodes = new Set((equivalencies.data ?? [])
      .filter((equivalency) => equivalency.requirement_area === "world_language")
      .map((equivalency) => equivalency.normalized_course_code));
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
    const languageSmccdIds = new Set(catalog
      .filter((course) => languageEquivalencyCodes.has(course.course_code.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()))
      .map((course) => course.id));
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
    const scheduleTurn = await promptPilot(scheduleConversation,
      "Use my saved progress to build and apply the rest of my schedule from grade 11 summer through grade 12. My intended major is Communication Studies. Keep every completed or in-progress class, finish my d.tech diploma and my bookmarked CSM Communication Studies AA—including every remaining major, local GE, separate graduation, and 60-unit requirement—under my already-saved concurrent-enrollment preference and its recommended per-term unit limit. Do not change that preference. Balance the remaining work across the available terms and do not just describe the plan; add it.");
    expect(scheduleTurn.message).not.toMatch(/Grade\s+(?:9|10|11|12),\s+(?:fall|spring|summer|full year):/i);
    expect(scheduleTurn.message).not.toContain("College-unit check:");
    const scheduleTools = await supabase.from("ai_tool_calls").select("tool_name,status,result,arguments")
      .eq("conversation_id", scheduleConversation).order("created_at");
    if (scheduleTools.error) throw scheduleTools.error;
    expect(scheduleTools.data?.some((tool) => tool.tool_name === "get_course_schedule_options" && tool.status === "completed"), JSON.stringify(scheduleTools.data)).toBe(true);
    const scheduleRead = scheduleTools.data?.find((tool) => tool.tool_name === "get_course_schedule_options")?.result as { data?: { degree_planning?: { bookmarked_goal_count?: number; college_course_count?: number; all_bookmarked_goals_covered?: boolean } } } | undefined;
    expect(scheduleRead?.data?.degree_planning, JSON.stringify(scheduleRead?.data?.degree_planning)).toMatchObject({ bookmarked_goal_count: 1, all_bookmarked_goals_covered: true });
    expect(Number(scheduleRead?.data?.degree_planning?.college_course_count ?? 0)).toBeGreaterThan(0);
    const proposalRecord = scheduleTools.data?.find((tool) => tool.tool_name === "add_course_schedule");
    expect(proposalRecord, `${scheduleTurn.message}\n${JSON.stringify(scheduleTools.data)}`).toBeDefined();
    expect(proposalRecord?.arguments, `${scheduleTurn.message}\n${JSON.stringify(scheduleTools.data)}`).toMatchObject({ respect_recommended_limit: true, include_college_courses: true });
    expect(scheduleTurn.proposals.map((proposal) => proposal.name), scheduleTurn.message).toEqual(["add_course_schedule"]);
    await apply(scheduleTurn);

    const finalRowsResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (finalRowsResult.error) throw finalRowsResult.error;
    const finalRows = finalRowsResult.data ?? [];
    expect([...baselineIds].every((id) => finalRows.some((row) => row.id === id))).toBe(true);
    const additions = finalRows.filter((row) => !baselineIds.has(row.id));
    expect(additions.some((row) => Boolean(row.course_id))).toBe(true);
    expect(additions.some((row) => Boolean(row.smccd_course_id))).toBe(true);
    expect(additions.filter((row) => row.smccd_course_id).every((row) => row.is_weighted)).toBe(true);
    const designLabRequirementIds = new Set((requirements.data ?? []).filter((requirement) => requirement.area === "design_lab").map((requirement) => requirement.id));
    const designLabCourseIds = new Set((mappings.data ?? []).filter((mapping) => designLabRequirementIds.has(mapping.requirement_id)).map((mapping) => mapping.course_id));
    expect(additions.filter((row) => row.grade_level === 12 && row.course_id && designLabCourseIds.has(row.course_id))).toHaveLength(1);

    const openCollegeTerms = new Map<string, number>();
    for (const row of finalRows.filter((course) => course.status !== "completed" && course.smccd_course_id)) {
      const key = `${row.school_year}:${row.term}`;
      openCollegeTerms.set(key, (openCollegeTerms.get(key) ?? 0) + Number(row.college_units ?? 0));
    }
    expect([...openCollegeTerms.values()].every((units) => units <= 11)).toBe(true);

    const undoTurn = await promptPilot(scheduleConversation, "Undo that schedule addition.");
    expect(undoTurn.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(undoTurn);
    const restoredRows = await supabase.from("plan_courses").select("id").eq("user_id", userId);
    expect(new Set((restoredRows.data ?? []).map((row) => row.id))).toEqual(baselineIds);

    // Regression for the terse workflow that previously asked unnecessary
    // questions and then timed out after completing the schedule read.
    const emptyPlan = await supabase.from("plan_courses").delete().eq("user_id", userId);
    if (emptyPlan.error) throw emptyPlan.error;
    const resetGoals = await supabase.from("student_smccd_goals").delete().eq("user_id", userId);
    if (resetGoals.error) throw resetGoals.error;
    const twoDegreeGoals = await supabase.from("student_smccd_goals").insert([
      { user_id: userId, program_id: "CSM:computer-and-information-science-as", is_primary: true, notes: "Live multi-degree planner fixture" },
      { user_id: userId, program_id: "CSM:computer-science-applications-and-development-as", is_primary: false, notes: "Live multi-degree planner fixture" }
    ]);
    if (twoDegreeGoals.error) throw twoDegreeGoals.error;
    const freshmanSettings = await supabase.from("student_settings").update({ grade_level: 9, graduation_year: 2030, plan_start_grade: 9, plan_end_grade: 12 }).eq("id", userId);
    if (freshmanSettings.error) throw freshmanSettings.error;
    const fullPlanConversation = await createConversation("Terse integrated full plan");
    const fullPlanTurn = await promptPilot(fullPlanConversation, "Create a full plan for me. I am starting Algebra 2 in grade 9; finish my diploma and both bookmarked CS degrees with verified prerequisite order, maximum useful high-school/college overlap, and no more than 11 college units in any term.");
    expect(fullPlanTurn.message).not.toMatch(/Grade\s+(?:9|10|11|12),\s+(?:fall|spring|summer|full year):/i);
    expect(fullPlanTurn.message).not.toContain("College-unit check:");
    expect(fullPlanTurn.runtime.latencyMs).toBeLessThan(120_000);
    const fullPlanTools = await supabase.from("ai_tool_calls").select("tool_name,status,result").eq("conversation_id", fullPlanConversation).order("created_at");
    if (fullPlanTools.error) throw fullPlanTools.error;
    const fullPlanRead = fullPlanTools.data?.find((tool) => tool.tool_name === "get_course_schedule_options")?.result as { data?: { degree_planning?: { bookmarked_goal_count?: number; college_course_count?: number; all_bookmarked_goals_covered?: boolean; goals?: Array<{ major_complete?: boolean; local_ge_complete?: boolean; separate_requirements_complete?: boolean; projected_degree_units?: number; required_degree_units?: number }> }; enrollment_validation?: { satisfied?: boolean; terms?: Array<{ units?: number; limit?: number }> } } } | undefined;
    expect(fullPlanRead?.data?.degree_planning, JSON.stringify(fullPlanRead?.data?.degree_planning)).toMatchObject({ bookmarked_goal_count: 2, all_bookmarked_goals_covered: true });
    expect(Number(fullPlanRead?.data?.degree_planning?.college_course_count ?? 0), `${fullPlanTurn.message}\n${JSON.stringify(fullPlanTools.data)}`).toBeGreaterThan(0);
    expect(fullPlanRead?.data?.degree_planning?.goals).toHaveLength(2);
    expect(fullPlanRead?.data?.degree_planning?.goals?.every((goal) => goal.major_complete && goal.local_ge_complete && goal.separate_requirements_complete && Number(goal.projected_degree_units) >= Number(goal.required_degree_units))).toBe(true);
    expect(fullPlanRead?.data?.enrollment_validation?.satisfied).toBe(true);
    expect(fullPlanRead?.data?.enrollment_validation?.terms?.every((term) => Number(term.units) <= Number(term.limit))).toBe(true);
    expect(fullPlanTurn.proposals.map((proposal) => proposal.name), fullPlanTurn.message).toEqual(["add_course_schedule"]);
    await apply(fullPlanTurn);
    const generatedFullPlan = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (generatedFullPlan.error) throw generatedFullPlan.error;
    expect(generatedFullPlan.data?.some((row) => Boolean(row.course_id))).toBe(true);
    expect(generatedFullPlan.data?.some((row) => Boolean(row.smccd_course_id))).toBe(true);
    expect(generatedFullPlan.data?.some((row) => row.smccd_course_id && row.grade_level === 9)).toBe(true);
    expect(generatedFullPlan.data?.some((row) => row.smccd_course_id && row.grade_level === 10)).toBe(true);
    const generatedCollegeCodes = new Set((generatedFullPlan.data ?? [])
      .flatMap((row) => row.smccd_course_id ? [catalog.find((course) => course.id === row.smccd_course_id)?.course_code] : [])
      .filter((code): code is string => Boolean(code)));
    expect(generatedCollegeCodes.has("MATH 251")).toBe(true);
    expect(generatedCollegeCodes.has("MATH 252")).toBe(true);
    expect(generatedCollegeCodes.has("CIS 256") || generatedCollegeCodes.has("CIS 279")).toBe(true);
    const generatedCourseLabels = (generatedFullPlan.data ?? []).map((row) => {
      const schoolCourse = row.course_id ? courseById.get(row.course_id) : null;
      const collegeCourse = row.smccd_course_id ? catalog.find((course) => course.id === row.smccd_course_id) : null;
      return `${schoolCourse?.name ?? ""} ${collegeCourse?.course_code ?? ""} ${collegeCourse?.title ?? ""}`.trim();
    });
    expect(generatedCourseLabels.filter((label) => /\bbiology\b/i.test(label)).length).toBeLessThanOrEqual(1);
    expect(generatedCourseLabels.filter((label) => /\bchemistry\b/i.test(label)).length).toBeLessThanOrEqual(1);
    const generatedCollegeTerms = new Map<string, number>();
    for (const row of (generatedFullPlan.data ?? []).filter((course) => course.status !== "completed" && course.smccd_course_id)) {
      const key = `${row.school_year}:${row.term}`;
      generatedCollegeTerms.set(key, (generatedCollegeTerms.get(key) ?? 0) + Number(row.college_units ?? 0));
    }
    expect([...generatedCollegeTerms.values()].every((units) => units <= 11)).toBe(true);
    const languageRequirementIds = new Set((requirements.data ?? []).filter((requirement) => requirement.area === "world_language").map((requirement) => requirement.id));
    const highSchoolLanguageIds = new Set((mappings.data ?? []).filter((mapping) => languageRequirementIds.has(mapping.requirement_id)).map((mapping) => mapping.course_id));
    const languageRows = (generatedFullPlan.data ?? []).filter((row) => row.requirement_area_override === "world_language");
    if (languageRows.reduce((total, row) => total + Number(row.credits ?? 0), 0) >= 20) {
      expect((generatedFullPlan.data ?? []).filter((row) => row.course_id && highSchoolLanguageIds.has(row.course_id))).toHaveLength(0);
    }
    const hist201 = (generatedFullPlan.data ?? []).find((row) => row.smccd_course_id === "CSM:HIST 201");
    const hist202 = (generatedFullPlan.data ?? []).find((row) => row.smccd_course_id === "CSM:HIST 202");
    if (hist201 && hist202) {
      expect(hist201).toMatchObject({ grade_level: 11, term: "fall", requirement_area_override: "social_science" });
      expect(hist202).toMatchObject({ grade_level: 11, term: "spring", requirement_area_override: "social_science" });
      const highSchoolUsHistoryIds = new Set((dtechCatalog.data ?? [])
        .filter((course) => /\b(?:u\.?s\.?|united states) history\b/i.test(course.name))
        .map((course) => course.id));
      expect((generatedFullPlan.data ?? []).filter((row) => row.course_id && highSchoolUsHistoryIds.has(row.course_id))).toHaveLength(0);
    }
    const mathSequence = (generatedFullPlan.data ?? [])
      .flatMap((row) => {
        const highSchoolCourse = row.course_id ? courseById.get(row.course_id) : null;
        const rank = mathSequenceRankFromText(`${highSchoolCourse?.course_code ?? ""} ${highSchoolCourse?.name ?? row.custom_course_name ?? ""}`);
        return rank === null ? [] : [{ row, rank }];
      })
      .sort((left, right) => {
        const termIndex = (row: typeof left.row) => (Number(row.grade_level) - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
        return termIndex(left.row) - termIndex(right.row) || left.rank - right.rank;
      });
    for (let index = 1; index < mathSequence.length; index += 1) {
      expect(mathSequence[index]!.rank).toBeGreaterThanOrEqual(mathSequence[index - 1]!.rank);
      expect(mathSequence[index]!.rank - mathSequence[index - 1]!.rank).toBeLessThanOrEqual(1);
    }
    for (const grade of [9, 10, 11, 12]) {
      expect((generatedFullPlan.data ?? []).filter((row) => row.grade_level === grade && row.course_id && designLabCourseIds.has(row.course_id)).length).toBeLessThanOrEqual(1);
    }
    const labScienceRequirementIds = new Set((requirements.data ?? []).filter((requirement) => requirement.area === "lab_science").map((requirement) => requirement.id));
    const labScienceCourseIds = new Set((mappings.data ?? []).filter((mapping) => labScienceRequirementIds.has(mapping.requirement_id)).map((mapping) => mapping.course_id));
    for (const grade of [9, 10, 11, 12]) {
      expect((generatedFullPlan.data ?? []).filter((row) => row.grade_level === grade && row.course_id && labScienceCourseIds.has(row.course_id)).length).toBeLessThanOrEqual(1);
      const collegeScienceReplacesSchoolScience = (generatedFullPlan.data ?? []).some((row) => row.grade_level === grade
        && row.smccd_course_id
        && row.requirement_area_override === "lab_science");
      if (collegeScienceReplacesSchoolScience) {
        expect((generatedFullPlan.data ?? []).filter((row) => row.grade_level === grade && row.course_id && labScienceCourseIds.has(row.course_id))).toHaveLength(0);
      }
    }

    // A compound placement edit changes both requested sequences in one
    // atomic call, preserves unrelated rows, applies, and remains reversible.
    // Seed one editable language slot when degree overlap replaced every
    // high-school language row in the generated fixture.
    let placementBaseline = generatedFullPlan.data ?? [];
    let seededLanguageRowId: string | null = null;
    if (!placementBaseline.some((row) => row.course_id && highSchoolLanguageIds.has(row.course_id))) {
      const fallbackLanguageCourse = (dtechCatalog.data ?? []).find((course) => highSchoolLanguageIds.has(course.id) && /spanish|french/i.test(course.name));
      expect(fallbackLanguageCourse, "The d.tech fixture needs one editable high-school language course.").toBeDefined();
      const insertedLanguage = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.data!.id,
        user_id: userId,
        course_id: fallbackLanguageCourse!.id,
        grade_level: 9,
        school_year: "2026-2027",
        term: fallbackLanguageCourse!.term_type === "year" ? "full_year" : "fall",
        status: "planned",
        credits: fallbackLanguageCourse!.credits,
        college_units: fallbackLanguageCourse!.college_units,
        is_weighted: fallbackLanguageCourse!.is_weighted,
        mapping_verified: true,
        user_edited: true,
        sort_order: 5_000
      }).select("id").single();
      if (insertedLanguage.error) throw insertedLanguage.error;
      seededLanguageRowId = insertedLanguage.data.id;
      const refreshedBaseline = await supabase.from("plan_courses").select("*").eq("user_id", userId);
      if (refreshedBaseline.error) throw refreshedBaseline.error;
      placementBaseline = refreshedBaseline.data ?? [];
    }
    const generatedFullPlanIds = new Set(placementBaseline.map((row) => row.id));
    const belongsToMathSequence = (value: string) => mathSequenceRankFromText(value) !== null
      || /\b(?:trigonometry|path to calculus)\b/i.test(value);
    const unrelatedBeforePlacement = placementBaseline
      .filter((row) => {
        const course = row.course_id ? courseById.get(row.course_id) : null;
        const collegeCourse = row.smccd_course_id ? catalog.find((candidate) => candidate.id === row.smccd_course_id) : null;
        return !belongsToMathSequence(`${course?.course_code ?? collegeCourse?.course_code ?? ""} ${course?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""}`)
          && !(row.course_id && highSchoolLanguageIds.has(row.course_id))
          && !(row.smccd_course_id && languageSmccdIds.has(row.smccd_course_id))
          && row.requirement_area_override !== "world_language"
          && !/\b(?:spanish|french|chinese|mandarin|american sign language|asl)\b/i.test(String(row.custom_course_name ?? ""));
      })
      .map((row) => ({ id: row.id, course_id: row.course_id, grade_level: row.grade_level, term: row.term }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const placementEditTurn = await promptPilot(fullPlanConversation,
      "Replace my existing language path with just one semester of Chinese 3 in grade 9. Also start my math at Algebra 2 in grade 9 and reorganize every later math course into prerequisite order. Preserve unrelated courses.");
    const placementToolDebug = await supabase.from("ai_tool_calls").select("tool_name,status,result,arguments").eq("conversation_id", fullPlanConversation).order("created_at");
    if (placementToolDebug.error) throw placementToolDebug.error;
    expect(placementEditTurn.message).not.toContain("if final validation passes");
    expect(placementEditTurn.proposals.map((proposal) => proposal.name), `${placementEditTurn.message}\n${JSON.stringify(placementToolDebug.data?.slice(-3))}`).toEqual(["update_plan_courses"]);
    await apply(placementEditTurn);
    const placementRowsResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (placementRowsResult.error) throw placementRowsResult.error;
    const placementRows = placementRowsResult.data ?? [];
    const placementMathSequence = placementRows.flatMap((row) => {
      const schoolCourse = row.course_id ? courseById.get(row.course_id) : null;
      const collegeCourse = row.smccd_course_id ? catalog.find((course) => course.id === row.smccd_course_id) : null;
      const rank = mathSequenceRankFromText(`${schoolCourse?.course_code ?? collegeCourse?.course_code ?? ""} ${schoolCourse?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""}`);
      return rank === null ? [] : [{ row, rank }];
    }).sort((left, right) => {
      const termIndex = (row: typeof left.row) => (Number(row.grade_level) - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
      return termIndex(left.row) - termIndex(right.row) || left.rank - right.rank;
    });
    const gradeNineMathRanks = placementMathSequence.filter((item) => item.row.grade_level === 9).map((item) => item.rank);
    expect(gradeNineMathRanks).toContain(3);
    expect(gradeNineMathRanks).toEqual([3]);
    const placementCollegeMathCodes = placementMathSequence.flatMap((item) => {
      if (!item.row.smccd_course_id) return [];
      const code = catalog.find((course) => course.id === item.row.smccd_course_id)?.course_code;
      return code ? [code] : [];
    });
    expect(placementCollegeMathCodes).toContain("MATH 251");
    expect(placementCollegeMathCodes).not.toContain("PHYS 250");
    for (let index = 1; index < placementMathSequence.length; index += 1) {
      expect(placementMathSequence[index]!.rank).toBeGreaterThanOrEqual(placementMathSequence[index - 1]!.rank);
      expect(placementMathSequence[index]!.rank - placementMathSequence[index - 1]!.rank).toBeLessThanOrEqual(1);
    }
    expect(placementMathSequence.filter((item) => item.rank >= 5).every((item) => item.row.grade_level > 9)).toBe(true);
    const selectedLanguageAfterPlacement = placementRows
      .filter((row) => (row.course_id && highSchoolLanguageIds.has(row.course_id))
        || (row.smccd_course_id && languageSmccdIds.has(row.smccd_course_id))
        || row.requirement_area_override === "world_language")
      .map((row) => {
        const schoolCourse = row.course_id ? courseById.get(row.course_id) : null;
        const collegeCourse = row.smccd_course_id ? catalog.find((course) => course.id === row.smccd_course_id) : null;
        return `${schoolCourse?.name ?? ""} ${collegeCourse?.course_code ?? ""} ${collegeCourse?.title ?? row.custom_course_name ?? ""}`.trim();
      });
    expect(selectedLanguageAfterPlacement).toHaveLength(1);
    expect(selectedLanguageAfterPlacement[0]).toMatch(/CHIN 131|Chinese 3|Intermediate Chinese/i);
    expect(selectedLanguageAfterPlacement[0]).not.toMatch(/Spanish|ASL|American Sign Language/i);
    const unrelatedAfterPlacement = placementRows
      .filter((row) => {
        const course = row.course_id ? courseById.get(row.course_id) : null;
        const collegeCourse = row.smccd_course_id ? catalog.find((candidate) => candidate.id === row.smccd_course_id) : null;
        return !belongsToMathSequence(`${course?.course_code ?? collegeCourse?.course_code ?? ""} ${course?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""}`)
          && !(row.course_id && highSchoolLanguageIds.has(row.course_id))
          && !(row.smccd_course_id && languageSmccdIds.has(row.smccd_course_id))
          && row.requirement_area_override !== "world_language"
          && !/\b(?:spanish|french|chinese|mandarin|american sign language|asl)\b/i.test(String(row.custom_course_name ?? ""));
      })
      .map((row) => ({ id: row.id, course_id: row.course_id, grade_level: row.grade_level, term: row.term }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(unrelatedAfterPlacement).toEqual(unrelatedBeforePlacement);
    const placementUndo = await promptPilot(fullPlanConversation, "Undo that schedule edit.");
    expect(placementUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(placementUndo);
    const restoredFullPlan = await supabase.from("plan_courses").select("id").eq("user_id", userId);
    if (restoredFullPlan.error) throw restoredFullPlan.error;
    expect(new Set((restoredFullPlan.data ?? []).map((row) => row.id))).toEqual(generatedFullPlanIds);
    if (seededLanguageRowId) {
      const removeSeed = await supabase.from("plan_courses").delete().eq("id", seededLanguageRowId);
      if (removeSeed.error) throw removeSeed.error;
    }

    // Exact regression for the terse production prompt that previously fell
    // through to catalog search and misclassified update_plan_course as a
    // read. It must route straight through academic context, apply the whole
    // downstream sequence, and remain reversible.
    const algebraOneCourse = (dtechCatalog.data ?? []).find((course) => mathSequenceRankFromText(`${course.course_code ?? ""} ${course.name}`) === 1);
    const gradeNineMathSeed = placementBaseline.find((row) => {
      const course = row.course_id ? courseById.get(row.course_id) : null;
      return row.grade_level === 9 && mathSequenceRankFromText(`${course?.course_code ?? ""} ${course?.name ?? ""}`) !== null;
    });
    expect(algebraOneCourse).toBeDefined();
    expect(gradeNineMathSeed).toBeDefined();
    const algebraOneSeed = await supabase.from("plan_courses").update({
      course_id: algebraOneCourse!.id,
      smccd_course_id: null,
      college_provider_code: null,
      custom_course_name: null,
      credits: algebraOneCourse!.credits,
      college_units: algebraOneCourse!.college_units,
      is_weighted: algebraOneCourse!.is_weighted,
      mapping_verified: true
    }).eq("id", gradeNineMathSeed!.id).eq("user_id", userId);
    if (algebraOneSeed.error) throw algebraOneSeed.error;
    const tersePlacementConversation = await createConversation("Terse Algebra 2 placement");
    const tersePlacementTurn = await promptPilot(tersePlacementConversation, "Start at algebra 2");
    expect(tersePlacementTurn.proposals.map((proposal) => proposal.name), tersePlacementTurn.message).toEqual(["update_plan_courses"]);
    const terseToolCalls = await supabase.from("ai_tool_calls").select("tool_name,status").eq("conversation_id", tersePlacementConversation).order("created_at");
    if (terseToolCalls.error) throw terseToolCalls.error;
    expect(terseToolCalls.data?.map((call) => call.tool_name)).toEqual(["get_academic_context", "update_plan_courses"]);
    await apply(tersePlacementTurn);
    const tersePlacementRows = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (tersePlacementRows.error) throw tersePlacementRows.error;
    const terseGradeNineMathRanks = (tersePlacementRows.data ?? []).flatMap((row) => {
      if (row.grade_level !== 9) return [];
      const schoolCourse = row.course_id ? courseById.get(row.course_id) : null;
      const collegeCourse = row.smccd_course_id ? catalog.find((course) => course.id === row.smccd_course_id) : null;
      const rank = mathSequenceRankFromText(`${schoolCourse?.course_code ?? collegeCourse?.course_code ?? ""} ${schoolCourse?.name ?? collegeCourse?.title ?? row.custom_course_name ?? ""}`);
      return rank === null ? [] : [rank];
    });
    expect(terseGradeNineMathRanks).toEqual([3]);
    const tersePlacementUndo = await promptPilot(tersePlacementConversation, "Undo that course change.");
    expect(tersePlacementUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(tersePlacementUndo);
    const restoredAlgebraOne = await supabase.from("plan_courses").select("course_id").eq("id", gradeNineMathSeed!.id).single();
    if (restoredAlgebraOne.error) throw restoredAlgebraOne.error;
    expect(restoredAlgebraOne.data.course_id).toBe(algebraOneCourse!.id);

    const fullPlanUndo = await promptPilot(fullPlanConversation, "Undo that generated plan.");
    expect(fullPlanUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(fullPlanUndo);

    // Standard placement must still produce an applied best-effort degree
    // plan without skipping math, duplicating science, or exceeding the
    // school's total course-load guidance. College equivalents may replace
    // diploma areas, while school-owned English and Design Lab remain local.
    const standardPlanConversation = await createConversation("Standard math integrated plan");
    const standardPlanTurn = await promptPilot(standardPlanConversation,
      "Create and apply a reasonable four-year plan from grade 9 using d.tech's standard math starting point. Finish my diploma and make the maximum verified progress on both bookmarked CS degrees while following prerequisites, school course-count rules, and the 11-unit concurrent limit.");
    expect(standardPlanTurn.message).not.toMatch(/Grade\s+(?:9|10|11|12),\s+(?:fall|spring|summer|full year):/i);
    expect(standardPlanTurn.proposals.map((proposal) => proposal.name), standardPlanTurn.message).toEqual(["add_course_schedule"]);
    await apply(standardPlanTurn);
    const standardRowsResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (standardRowsResult.error) throw standardRowsResult.error;
    const standardRows = standardRowsResult.data ?? [];
    const standardMath = standardRows
      .flatMap((row) => {
        const course = row.course_id ? courseById.get(row.course_id) : null;
        const rank = mathSequenceRankFromText(`${course?.course_code ?? ""} ${course?.name ?? row.custom_course_name ?? ""}`);
        return rank === null ? [] : [{ row, rank }];
      })
      .sort((left, right) => {
        const index = (row: typeof left.row) => (Number(row.grade_level) - 9) * 3 + (row.term === "spring" ? 1 : row.term === "summer" ? 2 : 0);
        return index(left.row) - index(right.row) || left.rank - right.rank;
      });
    for (let index = 1; index < standardMath.length; index += 1) {
      const mathTimeline = JSON.stringify(standardMath.map((item) => ({
        rank: item.rank,
        grade_level: item.row.grade_level,
        term: item.row.term,
        course_id: item.row.course_id,
        smccd_course_id: item.row.smccd_course_id,
        name: item.row.course_id ? courseById.get(item.row.course_id)?.name : item.row.custom_course_name
      })));
      expect(standardMath[index]!.rank, mathTimeline).toBeGreaterThanOrEqual(standardMath[index - 1]!.rank);
      expect(standardMath[index]!.rank - standardMath[index - 1]!.rank, mathTimeline).toBeLessThanOrEqual(1);
    }
    const targetCoursesByGrade = new Map([[9, 7], [10, 7], [11, 6], [12, 6]]);
    for (const [grade, target] of targetCoursesByGrade) {
      for (const term of ["fall", "spring"] as const) {
        const count = standardRows.filter((row) => row.grade_level === grade
          && (row.term === term || row.term === "full_year")).length;
        expect(count, JSON.stringify({ grade, term, courses: standardRows
          .filter((row) => row.grade_level === grade && (row.term === term || row.term === "full_year"))
          .map((row) => ({
            term: row.term,
            school: row.course_id ? courseById.get(row.course_id)?.name : null,
            college: row.smccd_course_id ? catalog.find((course) => course.id === row.smccd_course_id)?.course_code : null
          })) })).toBeLessThanOrEqual(target);
      }
      expect(standardRows.filter((row) => row.grade_level === grade && row.course_id && labScienceCourseIds.has(row.course_id)).length).toBeLessThanOrEqual(1);
    }
    const standardCollegeTerms = new Map<string, number>();
    for (const row of standardRows.filter((course) => course.status !== "completed" && course.smccd_course_id)) {
      const key = `${row.school_year}:${row.term}`;
      standardCollegeTerms.set(key, (standardCollegeTerms.get(key) ?? 0) + Number(row.college_units ?? 0));
    }
    expect([...standardCollegeTerms.values()].every((units) => units <= 11)).toBe(true);
    const standardUndo = await promptPilot(standardPlanConversation, "Undo that plan.");
    expect(standardUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(standardUndo);

    // Carlmont is the second complete high-school profile. Exercise the same
    // real read -> deterministic proposal -> apply -> undo contract without
    // borrowing d.tech courses, degree goals, or concurrent coursework.
    const clearBeforeCarlmont = await promptPilot(standardPlanConversation, "Clear my whole schedule and all degree bookmarks.");
    await apply(clearBeforeCarlmont);
    const carlmont = await supabase.from("schools").select("id").ilike("name", "Carlmont High").single();
    if (carlmont.error) throw carlmont.error;
    const carlmontSelection = await supabase.rpc("select_current_school", { target_school_id: carlmont.data.id });
    if (carlmontSelection.error) throw carlmontSelection.error;
    const carlmontContext = await supabase.from("student_settings").update({
      grade_level: 9,
      graduation_year: 2030,
      plan_start_grade: 9,
      plan_end_grade: 12
    }).eq("id", userId);
    if (carlmontContext.error) throw carlmontContext.error;
    const carlmontCoursesResult = await supabase.from("courses").select("*").eq("school_id", carlmont.data.id);
    if (carlmontCoursesResult.error) throw carlmontCoursesResult.error;
    const carlmontCourseById = new Map((carlmontCoursesResult.data ?? []).map((course) => [course.id, course]));
    const carlmontConversation = await createConversation("Carlmont verified four-year plan");
    const carlmontTurn = await promptPilot(carlmontConversation,
      "Create and apply a balanced four-year Carlmont plan from grade 9, starting math at Precalculus. Finish the verified diploma requirements, use only Carlmont high-school courses, and do not add college courses.");
    expect(carlmontTurn.proposals.map((proposal) => proposal.name), carlmontTurn.message).toEqual(["add_course_schedule"]);
    await apply(carlmontTurn);
    const carlmontPlanResult = await supabase.from("plan_courses").select("*").eq("user_id", userId);
    if (carlmontPlanResult.error) throw carlmontPlanResult.error;
    const carlmontPlan = carlmontPlanResult.data ?? [];
    expect(carlmontPlan.length).toBeGreaterThan(0);
    expect(carlmontPlan.every((row) => !row.smccd_course_id && Number(row.college_units ?? 0) === 0)).toBe(true);
    const carlmontMath = carlmontPlan.flatMap((row) => {
      const course = row.course_id ? carlmontCourseById.get(row.course_id) : null;
      const rank = mathSequenceRankFromText(`${course?.course_code ?? ""} ${course?.name ?? row.custom_course_name ?? ""}`);
      return rank === null ? [] : [{ row, rank }];
    }).sort((left, right) => Number(left.row.grade_level) - Number(right.row.grade_level));
    expect(carlmontMath.some(({ row, rank }) => row.grade_level === 9 && rank === 4)).toBe(true);
    for (let index = 1; index < carlmontMath.length; index += 1) {
      expect(carlmontMath[index]!.rank).toBeGreaterThanOrEqual(carlmontMath[index - 1]!.rank);
      expect(carlmontMath[index]!.rank - carlmontMath[index - 1]!.rank).toBeLessThanOrEqual(1);
    }
    const carlmontUndo = await promptPilot(carlmontConversation, "Undo that generated Carlmont plan.");
    expect(carlmontUndo.proposals.map((proposal) => proposal.name)).toEqual(["undo_change"]);
    await apply(carlmontUndo);
    expect(livePromptCount).toBeGreaterThanOrEqual(20);
  });
});
