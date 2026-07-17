import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, parseAssistantScheduleIntent, requiredAssistantEvidenceRead, requiredAssistantEvidenceReadForConversation, runAssistantChat, selectAssistantUndoTarget, type AssistantChatHistoryMessage } from "@/server/codex";
import { assistantToolContractNames, parseAssistantToolCall } from "@/server/ai-tools";
import { assistantUndoAvailability } from "@/server/assistant-undo";

describe("Pilot complete academic control", () => {
  it("routes complete mixed plans from every supported starting grade", () => {
    for (const grade of [9, 10, 11, 12] as const) {
      const read = requiredAssistantEvidenceRead(`Create a full schedule starting from ${grade}th grade with concurrent and high school courses for the highest GPA, most degrees, and my major`);
      expect(read).toEqual({
        name: "get_course_schedule_options",
        arguments: {
          respect_recommended_limit: true,
          rigor: "advanced",
          include_college_courses: true,
          objectives: ["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"],
          start_grade: grade
        }
      });
    }
  });

  it("routes a broad 24-prompt student workflow matrix through executable tools", async () => {
    const appliedChangeId = crypto.randomUUID();
    const scheduleHistory: AssistantChatHistoryMessage[] = [
      { role: "user", content: "Create a full four-year plan from grade 9, starting math at Geometry, using ASL 1 for language, and completing my bookmarked computer science degrees." },
      { role: "assistant", content: "I prepared the integrated plan." }
    ];
    const directCases: Array<{ prompt: string; expected: string; recentChanges?: Parameters<typeof runAssistantChat>[0]["recentChanges"] }> = [
      { prompt: "Change the app to dark mode.", expected: "update_student_settings" },
      { prompt: "Switch back to light mode.", expected: "update_student_settings" },
      { prompt: "Set my preferred name to Jay.", expected: "update_student_settings" },
      { prompt: "Set my current grade to 10, graduation year to 2029, and planning window from grade 10 through grade 12.", expected: "update_student_settings" },
      { prompt: "Use concurrent enrollment and respect the recommended unit limit.", expected: "update_enrollment_preference" },
      { prompt: "Sort my entire course board.", expected: "sort_plan_courses" },
      { prompt: "Clear my whole schedule, degree bookmarks, and GPA assumptions.", expected: "clear_academic_plan" },
      { prompt: "Undo that change.", expected: "undo_change", recentChanges: [{ toolCallId: appliedChangeId, toolName: "clear_academic_plan", label: "Clear academic plan", summary: "Cleared the plan.", data: {}, completedAt: new Date().toISOString(), undoAvailable: true, undoneAt: null, undoExpiresAt: null }] }
    ];
    for (const scenario of directCases) {
      const result = await runAssistantChat({
        history: [],
        userMessage: scenario.prompt,
        model: "gpt-5.6-luna",
        recentChanges: scenario.recentChanges,
        executeReadTool: async () => ({ summary: "", data: null }),
        onSdkEvent: () => undefined,
        onToolActivity: () => undefined
      });
      expect(result.proposals.map((proposal) => proposal.name), scenario.prompt).toContain(scenario.expected);
    }

    const routedCases: Array<{ prompt: string; read: string; history?: AssistantChatHistoryMessage[] }> = [
      { prompt: "Remove every planned course.", read: "list_plan_courses" },
      { prompt: "Move every planned course to in progress.", read: "list_plan_courses" },
      { prompt: "Add Biology in 10th grade as a full-year course.", read: "search_course_catalog" },
      { prompt: "Add CSM MATH 251 to grade 11 in fall.", read: "search_course_catalog" },
      { prompt: "Bookmark the Computer Science Applications and Development AS degree at CSM.", read: "search_smccd_programs" },
      { prompt: "Set every current and planned course in my GPA calculator to an expected A.", read: "get_gpa_scenario" },
      { prompt: "From college, add linear algebra and calc 3. Put in 11th grade summer calc 2 and intercultural communication.", read: "resolve_academic_course_batch" },
      { prompt: "In 11th grade, add eng c1000, intercultural communication, nosql, and calc 2.", read: "resolve_academic_course_batch" },
      { prompt: "Create a full plan from grade 9 that finishes my diploma and bookmarked degrees.", read: "get_course_schedule_options" },
      { prompt: "Edit my schedule, I start math at Algebra 2 in grade 9.", read: "get_academic_context" },
      { prompt: "Start at algebra 2", read: "get_academic_context" },
      { prompt: "Here are my answers:\n- **What should the plan prioritize?** All of the above", read: "get_course_schedule_options", history: scheduleHistory },
      { prompt: "Use ASL 1 instead as my world language and update the plan.", read: "get_academic_context", history: scheduleHistory },
      { prompt: "Change my selected high school to Design Tech High School.", read: "search_california_high_schools" },
      { prompt: "Change my community-college district to San Mateo County Community College District.", read: "get_nearby_education_providers" },
      { prompt: "Clear every course in fall 2026.", read: "list_plan_courses" },
      { prompt: "Create a balanced plan starting from freshman year with no college courses.", read: "get_course_schedule_options" },
      { prompt: "Change my intended major to biology and update the plan.", read: "get_academic_context", history: scheduleHistory }
    ];
    for (const scenario of routedCases) {
      const route = requiredAssistantEvidenceReadForConversation(scenario.history ?? [], scenario.prompt);
      expect(route?.name, scenario.prompt).toBe(scenario.read);
    }
    expect(directCases.length + routedCases.length).toBe(26);

    const partiallyResolvedBatch = await runAssistantChat({
      history: [],
      userMessage: "In 11th grade, add eng c1000, intercultural communication, nosql, and calc 2.",
      model: "gpt-5.6-luna",
      executeReadTool: async () => ({
        summary: "Resolved three placements; one remains unresolved.",
        data: {
          complete: false,
          apply_ready: true,
          entries: [
            { source: "smccd", course_id: crypto.randomUUID(), grade_level: 11, term: "fall", status: "planned" },
            { source: "smccd", course_id: crypto.randomUUID(), grade_level: 11, term: "fall", status: "planned" },
            { source: "smccd", course_id: crypto.randomUUID(), grade_level: 11, term: "spring", status: "planned" }
          ],
          resolved: [
            { query: "eng c1000", name: "ENGL C1000 Academic Reading and Writing", grade_level: 11, term: "fall" },
            { query: "intercultural communication", name: "COMM 150 Intercultural Communication", grade_level: 11, term: "fall" },
            { query: "nosql", name: "CIS 133 NoSQL Databases", grade_level: 11, term: "spring" }
          ],
          unresolved: [{ query: "calc 2", reason: "An unmet prerequisite prevents placement." }],
          respect_recommended_limit: true
        }
      }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(partiallyResolvedBatch.proposals.map((proposal) => proposal.name)).toEqual(["add_academic_courses"]);
    expect(partiallyResolvedBatch.proposals[0]?.arguments.entries).toHaveLength(3);
    expect(partiallyResolvedBatch.message).toContain("calc 2");

    const gradeNineRow = crypto.randomUUID();
    const gradeTenRow = crypto.randomUUID();
    const algebraOne = crypto.randomUUID();
    const algebraTwo = crypto.randomUUID();
    const precalculus = crypto.randomUUID();
    const spanishRow = crypto.randomUUID();
    const frenchRow = crypto.randomUUID();
    const spanish = crypto.randomUUID();
    const french = crypto.randomUUID();
    const chineseThree = crypto.randomUUID();
    const collegeChineseThree = "CSM:CHIN 131";
    const calculusOne = "CSM:MATH 251";
    const calculusTwo = "CSM:MATH 252";
    const calculusThree = "CSM:MATH 253";
    const trigonometryRow = crypto.randomUUID();
    const pathToCalculusRow = crypto.randomUUID();
    const combinedEditPrompt = "I want to do chinese as the language, just one semester of chinese 3. Also, start my math at algebra 2";
    const targetedContext = {
      student: { plan_start_grade: 9 },
      plan: { courses: [
        { plan_course_id: gradeNineRow, catalog_course_id: algebraOne, name: "Algebra 1", grade_level: 9, term: "full_year", transcript_locked: false },
        { plan_course_id: gradeTenRow, catalog_course_id: algebraTwo, name: "Algebra 2", grade_level: 10, term: "full_year", transcript_locked: false },
        { plan_course_id: spanishRow, catalog_course_id: spanish, name: "Spanish 1", grade_level: 9, term: "full_year", transcript_locked: false },
        { plan_course_id: frenchRow, catalog_course_id: french, name: "French 2", grade_level: 10, term: "full_year", transcript_locked: false }
      ] },
      graduation: [{
        area: "math",
        eligible_course_options: [
          { course_id: algebraTwo, name: "Algebra 2", subject: "Math", weighted: false, term_type: "year", grade_levels: [9, 10] },
          { course_id: precalculus, name: "Precalculus", subject: "Math", weighted: true, term_type: "year", grade_levels: [9] }
        ]
      }, {
        area: "world_language",
        eligible_course_options: [
          { course_id: spanish, name: "Spanish 1", subject: "World Language", weighted: false, term_type: "year", grade_levels: [9] },
          { course_id: french, name: "French 2", subject: "World Language", weighted: false, term_type: "year", grade_levels: [10] },
          { course_id: chineseThree, name: "Chinese 3", subject: "World Language", weighted: false, term_type: "semester", grade_levels: [9, 10, 11] }
        ]
      }]
    };
    expect(parseAssistantScheduleIntent(combinedEditPrompt)).toMatchObject({ startingMathCourse: "algebra 2", startingLanguageCourse: "chinese 3" });
    expect(requiredAssistantEvidenceReadForConversation(scheduleHistory, combinedEditPrompt)?.name).toBe("get_academic_context");
    const targeted = await runAssistantChat({
      history: scheduleHistory,
      userMessage: combinedEditPrompt,
      model: "gpt-5.6-luna",
      executeReadTool: async () => ({
        summary: "Read workspace.",
        data: targetedContext
      }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(targeted.proposals.map((proposal) => proposal.name)).toEqual(["update_plan_courses"]);
    expect(targeted.questions).toEqual([]);
    expect(targeted.message).toContain("math starting with algebra 2 and language using chinese 3");
    expect(targeted.proposals[0]?.arguments).toMatchObject({ patches: [
      { plan_course_id: gradeNineRow, course_id: algebraTwo, grade_level: 9, term: "full_year" },
      { plan_course_id: gradeTenRow, course_id: precalculus, grade_level: 10, term: "full_year" },
      { plan_course_id: spanishRow, course_id: chineseThree, grade_level: 9, term: "fall" },
      { plan_course_id: frenchRow, remove: true }
    ] });

    const terseMathEdit = await runAssistantChat({
      history: [],
      userMessage: "Start at algebra 2",
      model: "gpt-5.6-luna",
      executeReadTool: async () => ({ summary: "Read workspace.", data: targetedContext }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(terseMathEdit.proposals.map((proposal) => proposal.name)).toEqual(["update_plan_courses"]);
    expect(terseMathEdit.proposals[0]?.arguments).toMatchObject({ patches: [
      { plan_course_id: gradeNineRow, course_id: algebraTwo, grade_level: 9, term: "full_year" },
      { plan_course_id: gradeTenRow, course_id: precalculus, grade_level: 10, term: "full_year" }
    ] });

    const partiallyResolvable = await runAssistantChat({
      history: scheduleHistory,
      userMessage: combinedEditPrompt,
      model: "gpt-5.6-luna",
      executeReadTool: async () => ({
        summary: "Read workspace.",
        data: {
          student: { plan_start_grade: 9 },
          plan: { courses: [
            { plan_course_id: gradeNineRow, catalog_course_id: algebraOne, name: "Algebra 1", grade_level: 9, term: "full_year", transcript_locked: false },
            { plan_course_id: gradeTenRow, catalog_course_id: algebraTwo, name: "Algebra 2", grade_level: 10, term: "full_year", transcript_locked: false },
            { plan_course_id: spanishRow, catalog_course_id: spanish, name: "Spanish 1", grade_level: 9, term: "full_year", transcript_locked: false },
            { plan_course_id: trigonometryRow, smccd_course_id: "CSM:MATH 130", course_code: "MATH 130", name: "MATH 130 Analytic Trigonometry", grade_level: 11, term: "fall", transcript_locked: false, requirement_area: "math" },
            { plan_course_id: pathToCalculusRow, smccd_course_id: "CSM:MATH 222", course_code: "MATH 222", name: "MATH 222 Path to Calculus", grade_level: 12, term: "spring", transcript_locked: false, requirement_area: "math" }
          ] },
          graduation: [{ area: "math", eligible_course_options: [
            { course_id: algebraTwo, name: "Algebra 2 / Algebra 2-Trigonometry Honors", subject: "Math", weighted: true, term_type: "year", grade_levels: [10] },
            { course_id: precalculus, name: "Precalculus", subject: "Math", weighted: true, term_type: "year", grade_levels: [11] }
          ] }, { area: "world_language", eligible_course_options: [
            { course_id: spanish, name: "Spanish 1", subject: "World Language", weighted: false, term_type: "year", grade_levels: [9] }
          ] }],
          college_sequence_options: [
            { course_id: collegeChineseThree, course_code: "CHIN 131", title: "Intermediate Chinese I", high_school_requirement_area: "world_language", high_school_equivalent: "Mandarin 3 Fall", high_school_credits: 5, required_by_bookmarked_degrees: [] },
            { course_id: calculusOne, course_code: "MATH 251", title: "Calculus with Analytic Geometry I", high_school_requirement_area: "math", high_school_equivalent: "Calculus I", high_school_credits: 10, required_by_bookmarked_degrees: ["Computer and Information Science"] },
            { course_id: calculusTwo, course_code: "MATH 252", title: "Calculus with Analytic Geometry II", high_school_requirement_area: "math", high_school_equivalent: "Calculus II", high_school_credits: 10, required_by_bookmarked_degrees: ["Computer and Information Science"] },
            { course_id: calculusThree, course_code: "MATH 253", title: "Calculus with Analytic Geometry III", high_school_requirement_area: "math", high_school_equivalent: "Calculus III", high_school_credits: 10, required_by_bookmarked_degrees: ["Computer and Information Science"] }
          ]
        }
      }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(partiallyResolvable.proposals.map((proposal) => proposal.name)).toEqual(["update_plan_courses"]);
    expect(partiallyResolvable.proposals[0]?.arguments).toMatchObject({ patches: [
      { plan_course_id: gradeNineRow, course_id: algebraTwo, grade_level: 9 },
      { plan_course_id: gradeTenRow, course_id: precalculus, grade_level: 10 },
      { plan_course_id: trigonometryRow, smccd_course_id: calculusOne, grade_level: 11, term: "fall" },
      { plan_course_id: pathToCalculusRow, smccd_course_id: calculusTwo, grade_level: 11, term: "spring" },
      { plan_course_id: spanishRow, smccd_course_id: collegeChineseThree, grade_level: 9, term: "fall" }
    ], additions: [
      { source: "smccd", course_id: calculusThree, grade_level: 12, term: "fall" }
    ] });
    expect(partiallyResolvable.questions).toEqual([]);
    expect(partiallyResolvable.message).toContain("math starting with algebra 2 and language using chinese 3");
  });

  it("enforces reversible app-wide Pilot control and safety boundaries", async () => {
    {
    const contracts = assistantToolContractNames();
    expect(contracts.catalog).toEqual(contracts.schemas);
    expect(contracts.capabilities).toEqual(contracts.schemas);
    expect(contracts.mutationMismatches).toEqual([]);
    expect(parseAssistantToolCall("update_plan_course", {
      plan_course_id: crypto.randomUUID(),
      course_id: crypto.randomUUID(),
      prerequisite_override_reason: "The student explicitly corrected the course placement."
    }).mutatesData).toBe(true);
    const call = parseAssistantToolCall("add_academic_courses", {
      entries: [
        { source: "selected_school", course_id: crypto.randomUUID(), status: "current", grade_level: 9, term: "full_year" },
        { source: "smccd", course_id: "SKY:MATH 251", status: "planned", grade_level: 10, term: "fall" },
        { source: "smccd", course_id: "CSM:CIS 117", status: "planned", grade_level: 10, term: "spring" }
      ],
      respect_recommended_limit: true
    });
    expect(call.mutatesData).toBe(true);
    expect(call.arguments.entries).toHaveLength(3);
    expect(parseAssistantToolCall("update_plan_courses", {
      patches: [{ plan_course_id: crypto.randomUUID(), smccd_course_id: "CSM:MATH 251", grade_level: 11, term: "fall" }]
    }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("add_custom_course", {
      name: "Student-provided seminar",
      status: "planned",
      grade_level: 11,
      term: "fall",
      credits: 5,
      college_units: null,
      is_weighted: false,
      requirement_area: "electives",
      notes: "The verified school catalog does not list this student-supplied course."
    }).mutatesData).toBe(true);
    }

    {
    expect(parseAssistantToolCall("get_academic_context", { include_transcript_review: true }).mutatesData).toBe(false);
    expect(parseAssistantToolCall("correct_transcript_course", {
      review_item_id: crypto.randomUUID(),
      credits: 10,
      weighted: true,
      reason: "The reviewed transcript row was imported with the wrong credit and weighting values."
    }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("update_gpa_scenario", {
      choices: [{ plan_course_id: crypto.randomUUID(), included: true, expected_grade: "A" }]
    }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("set_college_goal", { program_id: "CSM:computer-science-as", notes: "Primary major" }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("set_college_goals", { program_ids: ["CSM:computer-science-as", "CSM:mathematics-as"], notes: "Dual-degree plan" }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("update_student_settings", { preferred_name: "Jay", plan_start_grade: 9, plan_end_grade: 12, ui_theme: "dark" }).mutatesData).toBe(true);
    expect(() => parseAssistantToolCall("update_student_settings", { ai_review_mode: "manual" })).toThrow();
    expect(parseAssistantToolCall("clear_academic_plan", { courses: true, degree_bookmarks: true, gpa_scenario: true }).mutatesData).toBe(true);
    }

    {
    const result = {
      undo: { kind: "restore_academic_plan", plan_rows: [], goal_rows: [], gpa_rows: [], summary: "Restored the academic plan." },
      undo_expires_at: "2020-01-01T00:00:00.000Z"
    };
    expect(assistantUndoAvailability(result).available).toBe(true);
    expect(assistantUndoAvailability({ ...result, undone_at: new Date().toISOString() }).available).toBe(false);
    const recentEdit = { toolCallId: crypto.randomUUID(), toolName: "update_plan_courses", label: "Update courses", summary: "Updated the math sequence.", data: {}, completedAt: new Date().toISOString(), undoAvailable: true, undoneAt: null, undoExpiresAt: null };
    const earlierSchedule = { toolCallId: crypto.randomUUID(), toolName: "add_course_schedule", label: "Add course schedule", summary: "Added the full schedule.", data: {}, completedAt: new Date(Date.now() - 1000).toISOString(), undoAvailable: true, undoneAt: null, undoExpiresAt: null };
    expect(selectAssistantUndoTarget("Undo that schedule edit", [recentEdit, earlierSchedule])?.toolCallId).toBe(recentEdit.toolCallId);
    }

    {
    const prompt = assistantConversationPrompt({
      history: [],
      userMessage: "Optimize my four-year plan",
      model: "gpt-5.6-luna",
      executeReadTool: async () => ({ summary: "", data: null }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("student's explicit request is the primary objective");
    expect(prompt).toContain("never silently broaden a targeted edit into a full-plan rebuild");
    expect(prompt).toContain("College units and high-school credits are different");
    expect(prompt).toContain("another college's local GE pattern");
    expect(prompt).toContain("Never borrow d.tech curriculum");
    expect(prompt).toContain("apply the best feasible verified result");
    expect(prompt).toContain("full schedule optimizer only when the student explicitly asks");
    expect(prompt).not.toContain("English and Design Lab remain at d.tech every year");
    expect(prompt).not.toContain("Grades 9 through 11 must carry at least six classes");
    expect(prompt).toContain("durable inverse");
    expect(prompt).toContain("call get_course_schedule_options");
    expect(prompt).toContain("Bookmarked degrees influence those broader planning requests automatically");
    expect(prompt).toContain("satisfy exact unmet bookmarked-degree cores and their prerequisite chain before generic GE or unit fillers");
    expect(prompt).toContain("audit the entire assembled schedule for duplicate or near-duplicate titles");
    expect(prompt).toContain("use resolve_academic_course_batch once");
    expect(prompt).toContain("normal product validation, RLS, receipts, and undo");
    expect(prompt).not.toContain("Current page context");
    expect(prompt).not.toContain("Selected change-review mode");
    }

    {
    expect(() => parseAssistantToolCall("delete_account", {})).toThrow("Unknown student-data tool");
    expect(() => parseAssistantToolCall("run_sql", { sql: "delete from auth.users" })).toThrow("Unknown student-data tool");
    }

    {
    const migration = readFileSync(new URL("../supabase/migrations/20260716210000_atomic_pilot_course_edits.sql", import.meta.url), "utf8");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("course.user_id = target_user_id");
    expect(migration).toContain("course.source_review_item_id is not null");
    expect(migration).toContain("updated_count <> requested_count");
    const removalMigration = readFileSync(new URL("../supabase/migrations/20260716220000_atomic_pilot_course_edit_removals.sql", import.meta.url), "utf8");
    expect(removalMigration).toContain("updated_count + deleted_count <> requested_count");
    expect(removalMigration).toContain("delete from public.plan_courses");
    }
  });
});
