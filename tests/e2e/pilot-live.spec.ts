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
    const secondaryProgramId = "CSM:computer-science-applications-and-development-as";
    const bookmarkConversation = await createConversation("Bookmark two degree goals");
    const bookmarkTurn = await sendTurn(request, accessToken, bookmarkConversation,
      "Bookmark both the CSM Communication Studies AA and CSM Computer Science Applications and Development AS degrees. Keep both as degree goals for future planning.");
    expect(bookmarkTurn.proposals.map((proposal) => proposal.name), bookmarkTurn.message).toEqual(["set_college_goals"]);
    await apply(bookmarkTurn);
    const savedGoals = await supabase.from("student_smccd_goals").select("program_id").eq("user_id", userId);
    if (savedGoals.error) throw savedGoals.error;
    expect(new Set((savedGoals.data ?? []).map((goal) => goal.program_id))).toEqual(new Set([programId, secondaryProgramId]));

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
