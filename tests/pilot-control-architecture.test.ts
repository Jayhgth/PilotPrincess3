import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, requiredAssistantEvidenceRead, requiredAssistantEvidenceReadForConversation, runAssistantChat, type AssistantChatHistoryMessage } from "@/server/codex";
import { parseAssistantToolCall } from "@/server/ai-tools";
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
      { prompt: "Create a full plan from grade 9 that finishes my diploma and bookmarked degrees.", read: "get_course_schedule_options" },
      { prompt: "Edit my schedule, I start math at Algebra 2 in grade 9.", read: "get_course_schedule_options" },
      { prompt: "Here are my answers:\n- **What should the plan prioritize?** All of the above", read: "get_course_schedule_options", history: scheduleHistory },
      { prompt: "Use ASL 1 instead as my world language and update the plan.", read: "get_course_schedule_options", history: scheduleHistory },
      { prompt: "Change my selected high school to Design Tech High School.", read: "search_california_high_schools" },
      { prompt: "Change my community-college district to San Mateo County Community College District.", read: "get_nearby_education_providers" },
      { prompt: "Clear every course in fall 2026.", read: "list_plan_courses" },
      { prompt: "Create a balanced plan starting from freshman year with no college courses.", read: "get_course_schedule_options" },
      { prompt: "Change my intended major to biology and update the plan.", read: "get_course_schedule_options", history: scheduleHistory }
    ];
    for (const scenario of routedCases) {
      const route = requiredAssistantEvidenceReadForConversation(scenario.history ?? [], scenario.prompt);
      expect(route?.name, scenario.prompt).toBe(scenario.read);
    }
    expect(directCases.length + routedCases.length).toBe(24);
  });

  it("enforces reversible app-wide Pilot control and safety boundaries", async () => {
    {
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
    expect(prompt).toContain("Every verified college course is weighted in the app GPA");
    expect(prompt).toContain("College units and high-school transcript credits are different measures");
    expect(prompt).toContain("only through a verified selected-school crosswalk/equivalency");
    expect(prompt).toContain("Never transfer one college's local GE pattern to another college");
    expect(prompt).toContain("Never substitute d.tech's sequence");
    expect(prompt).toContain("Propose only a complete validated schedule");
    expect(prompt).toContain("apply the valid maximum-progress plan");
    expect(prompt).toContain("retrieved school policy and deterministic validator—not a global sequence—control");
    expect(prompt).not.toContain("English and Design Lab remain at d.tech every year");
    expect(prompt).not.toContain("Grades 9 through 11 must carry at least six classes");
    expect(prompt).toContain("there is no arbitrary time window");
    expect(prompt).toContain("get_academic_context is the bounded cross-feature view");
    expect(prompt).toContain("automatically evaluates every bookmarked program's remaining major");
    expect(prompt).toContain("school-specific course-count rules");
    expect(prompt).toContain("server atomically includes the college portion");
    expect(prompt).toContain("call resolve_academic_course_batch exactly once");
    expect(prompt).toContain("converted directly into one reversible add_academic_courses proposal");
    expect(prompt).toContain("independent safety review");
    expect(prompt).not.toContain("Current page context");
    expect(prompt).not.toContain("Selected change-review mode");
    }

    {
    expect(() => parseAssistantToolCall("delete_account", {})).toThrow("Unknown student-data tool");
    expect(() => parseAssistantToolCall("run_sql", { sql: "delete from auth.users" })).toThrow("Unknown student-data tool");
    }
  });
});
