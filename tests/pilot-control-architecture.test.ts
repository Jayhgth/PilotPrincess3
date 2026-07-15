import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, requiredAssistantEvidenceRead } from "@/server/codex";
import { parseAssistantToolCall } from "@/server/ai-tools";
import { assistantUndoAvailability } from "@/server/assistant-undo";

describe("Pilot complete academic control", () => {
  it.each([9, 10, 11, 12] as const)("routes a complete mixed plan starting in grade %i", (grade) => {
    const read = requiredAssistantEvidenceRead(`Create a full schedule starting from ${grade}th grade with concurrent and high school courses for the highest GPA, most degrees, and my major`);
    expect(read).toEqual({
      name: "get_academic_context",
      arguments: {
        include_transcript_review: false,
        planning_start_grade: grade,
        planning_objectives: ["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"]
      }
    });
  });

  it("validates one reversible mixed high-school and college schedule batch", () => {
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
  });

  it("covers transcript repair, GPA assumptions, degree goals, ordinary profile data, and compound clearing", () => {
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
    expect(parseAssistantToolCall("update_student_settings", { preferred_name: "Jay", plan_start_grade: 9, plan_end_grade: 12, ui_theme: "dark" }).mutatesData).toBe(true);
    expect(parseAssistantToolCall("clear_academic_plan", { courses: true, degree_bookmarks: true, gpa_scenario: true }).mutatesData).toBe(true);
  });

  it("keeps stored inverses available without an arbitrary clock deadline", () => {
    const result = {
      undo: { kind: "restore_academic_plan", plan_rows: [], goal_rows: [], gpa_rows: [], summary: "Restored the academic plan." },
      undo_expires_at: "2020-01-01T00:00:00.000Z"
    };
    expect(assistantUndoAvailability(result).available).toBe(true);
    expect(assistantUndoAvailability({ ...result, undone_at: new Date().toISOString() }).available).toBe(false);
  });

  it("grounds the model in the GPA, credit, equivalency, GE, and durable-history contracts", () => {
    const prompt = assistantConversationPrompt({
      history: [],
      userMessage: "Optimize my four-year plan",
      pageContext: { view: "courses" },
      model: "gpt-5.6-luna",
      reviewMode: "auto_review",
      executeReadTool: async () => ({ summary: "", data: null }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("Every verified college course is weighted in the app GPA");
    expect(prompt).toContain("College units and high-school transcript credits are different measures");
    expect(prompt).toContain("only through a verified selected-school crosswalk/equivalency");
    expect(prompt).toContain("Never transfer one college's local GE pattern to another college");
    expect(prompt).toContain("Never substitute d.tech's sequence");
    expect(prompt).toContain("Propose only a complete validated result");
    expect(prompt).toContain("retrieved school policy and deterministic validator—not a global sequence—control");
    expect(prompt).not.toContain("English and Design Lab remain at d.tech every year");
    expect(prompt).not.toContain("Grades 9 through 11 must carry at least six classes");
    expect(prompt).toContain("there is no arbitrary time window");
    expect(prompt).toContain("get_academic_context is the bounded cross-feature view");
  });

  it("does not expose account deletion or arbitrary database operations", () => {
    expect(() => parseAssistantToolCall("delete_account", {})).toThrow("Unknown student-data tool");
    expect(() => parseAssistantToolCall("run_sql", { sql: "delete from auth.users" })).toThrow("Unknown student-data tool");
  });
});
