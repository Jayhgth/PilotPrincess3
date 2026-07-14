import { describe, expect, it } from "vitest";
import { assistantDockedMaxWidth, assistantDraftKey, assistantQuestionsFromContext, changeDetailsFromContext, formatStructuredAnswers, prioritizeAssistantQueue, visibleToolCalls } from "@/lib/assistant-chat";
import type { AiToolCall } from "@/lib/models";

const tool = (id: string, status: AiToolCall["status"]): AiToolCall => ({
  id, conversation_id: "conversation", user_id: "user", turn_id: "turn",
  tool_name: "get_student_overview", arguments: {}, explanation: "Read overview",
  mutates_data: false, status, result: null, created_at: "2026-07-11T10:00:00.000Z",
  updated_at: "2026-07-11T10:00:00.000Z", confirmed_at: null, completed_at: null
});

describe("assistant chat helpers", () => {
  it("scopes drafts to a user and conversation", () => {
    expect(assistantDraftKey("u1", null)).toBe("pilot-princess:assistant-draft:u1:new");
    expect(assistantDraftKey("u1", "c1")).toBe("pilot-princess:assistant-draft:u1:c1");
  });

  it("reserves usable workspace width and prioritizes a steered message", () => {
    expect(assistantDockedMaxWidth(1440)).toBe(360);
    expect(assistantDockedMaxWidth(1600)).toBe(520);
    expect(assistantDockedMaxWidth(1760)).toBe(680);
    expect(prioritizeAssistantQueue([{ id: "a" }, { id: "b" }, { id: "c" }], "c").map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps pending changes visible while folding older tool calls", () => {
    const result = visibleToolCalls([tool("a", "completed"), tool("b", "completed"), tool("c", "pending_confirmation"), tool("d", "completed")], false, 2);
    expect(result.visible.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
    expect(result.hiddenCount).toBe(1);
  });

  it("validates questions and formats selected answers", () => {
    const questions = assistantQuestionsFromContext({ questions: [{ id: "goal", prompt: "What matters most?", options: [{ id: "time", label: "Time" }, { id: "depth", label: "Depth" }], allow_custom: false }] });
    expect(questions).toHaveLength(1);
    expect(formatStructuredAnswers(questions, { goal: "Time" })).toContain("**What matters most?** Time");
  });

  it("turns changed data into readable receipt details", () => {
    expect(changeDetailsFromContext({ data: { course_code: "MATH 200", grade_level: 12, equivalency_verified: true, plan_course_id: "private-id", removed_count: 1 } })).toEqual([
      { label: "Course", value: "MATH 200" },
      { label: "Grade", value: "12" },
      { label: "d.tech equivalency reviewed", value: "Yes" },
      { label: "Courses removed", value: "1" }
    ]);
    expect(changeDetailsFromContext({ data: { courses_removed: 10, transcript_courses_retained: 50, degree_bookmarks_removed: 3, gpa_assumptions_removed: 8 } })).toEqual([
      { label: "Courses removed", value: "10" },
      { label: "Transcript courses kept", value: "50" },
      { label: "Degree bookmarks removed", value: "3" },
      { label: "GPA assumptions removed", value: "8" }
    ]);
  });
});
