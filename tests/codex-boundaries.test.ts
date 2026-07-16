import { describe, expect, it } from "vitest";
import { assistantConversationPrompt, assistantMessagePromisesFutureWork, assistantQuestionsWithCombinedOption, assistantUndoIntent, buildTransparentReviewPrompt, CODEX_FEATURES, CODEX_RUNTIME_CAPABILITIES, codexErrorMessage, codexRuntimeStatus, parseAcademicClearIntent, parseAssistantScheduleIntent, parseBulkGpaIntent, parseCollegeDistrictSelection, parseCompoundAcademicCourseRequest, parseDegreeGoalIntent, parseEnrollmentPreference, parseExactCourseAddition, parseScheduleAnswer, parseSchoolSelection, requestedCourseSort, requestedPreferredName, requestedStudentSettings, requestedUiTheme, requiredAssistantEvidenceRead, runAssistantChat, schedulePreview, scheduleProposalAction, scheduleResultIsComplete, selectAssistantUndoTarget, type AssistantRecentChange } from "@/server/codex";
import { sanitizeCodexText, sanitizeCodexValue } from "@/server/codex-events";
import { ASSISTANT_MESSAGE_MAX_LENGTH, assistantMemoryUpdateSchema, assistantTurnSchema } from "@/server/ai-schemas";
import { parseAssistantToolCall } from "@/server/ai-tools";
import { academicPlanEvidenceCoversProposal, autoReviewResultSchema, buildAutoReviewPrompt, reviewAssistantProposal } from "@/server/ai-auto-review";
import { AI_MODEL_OPTIONS, AI_REASONING_OPTIONS, aiModelSchema, aiReasoningEffortSchema } from "@/lib/ai-preferences";
import { assistantKnowledgeTags } from "@/server/ai-knowledge";
import { assistantUndoAvailability } from "@/server/assistant-undo";
import { explicitDurableMemoryUpdates } from "@/server/ai-memory";
import { asAssistantRecord, assistantQuestionsFromContext, changeDetailsFromContext } from "@/lib/assistant-chat";

describe("Codex feature boundaries", () => {
  it("keeps parsing, review, and runtime output bounded", () => {
    {
    const featureMap = Object.fromEntries(CODEX_FEATURES.map((feature) => [feature.id, feature.usesCodex]));
    const configuredModel = process.env.CODEX_MODEL;
    delete process.env.CODEX_MODEL;
    const status = codexRuntimeStatus();
    if (configuredModel === undefined) delete process.env.CODEX_MODEL;
    else process.env.CODEX_MODEL = configuredModel;

    expect(featureMap.structured_transcripts).toBe(false);
    expect(featureMap.planning_math).toBe(false);
    expect(featureMap.image_transcript_ocr).toBe(true);
    expect(featureMap.global_assistant).toBe(true);
    expect(featureMap.assistant_plan_changes).toBe(true);
    expect(status.features).toEqual(CODEX_FEATURES);
    expect(status.maxConcurrentTurns).toBe(2);
    expect(status.maxWaitingTurns).toBe(4);
    expect(status.model).toBe("gpt-5.6-luna");
    expect(status.reasoningEffort).toBe("low");
    expect(status.accessPolicy).toContain("sent to OpenAI Codex");
    expect(status.retentionPolicy).toContain("No local Codex CLI session history");
    expect(status.capabilities).toEqual(CODEX_RUNTIME_CAPABILITIES);
    }

    {
    const prompt = buildTransparentReviewPrompt("gpa_review", "SNAPSHOT: {\"weighted\":4.2}");

    expect(prompt).toContain("Feature: gpa_review");
    expect(prompt).toContain("Do not execute commands, inspect files, use tools, or access the network.");
    expect(prompt).toContain("Never imply that you changed the student's plan.");
    expect(prompt).toContain("no more than three observations");
    expect(prompt).toContain("SNAPSHOT: {\"weighted\":4.2}");
    }

    {
    const error = new Error(JSON.stringify({
      type: "error",
      status: 400,
      error: {
        type: "invalid_request_error",
        message: "The 'gpt-5.6-luna' model requires a newer version of Codex."
      }
    }));

    expect(codexErrorMessage(error, "Codex failed.")).toBe(
      "This server is still running an older Codex CLI. Restart the app to load the upgraded runtime."
    );
    }

    {
    expect(sanitizeCodexText("Authorization: Bearer secret-token-value")).toBe("Authorization: Bearer [redacted]");
    expect(sanitizeCodexText("key=sk-proj-abcdefghijklmnop")).toBe("key=[redacted]");
    expect(sanitizeCodexValue({ clientSecret: "visible", nested: { refresh_token: "also-visible", safe: "keep" } })).toEqual({
      clientSecret: "[redacted]",
      nested: { refresh_token: "[redacted]", safe: "keep" }
    });
    expect(asAssistantRecord(null)).toEqual({});
    expect(asAssistantRecord(["legacy payload"])).toEqual({});
    expect(assistantQuestionsFromContext(null)).toEqual([]);
    expect(changeDetailsFromContext("legacy payload")).toEqual([]);
    }
  });

  it("validates questions, tools, memory, and models", () => {
    {
    const answer = "Design Lab is the only open requirement. Add one verified 10-credit option, then confirm it with your counselor.";
    expect(assistantTurnSchema.parse({ assistant_message: answer, tool_calls: [] }).assistant_message).toBe(answer);
    expect(() => assistantTurnSchema.parse({ assistant_message: "x".repeat(ASSISTANT_MESSAGE_MAX_LENGTH + 1), tool_calls: [] })).toThrow();
    }

    {
    const parsed = assistantTurnSchema.parse({
      assistant_message: "Choose the school year for this course.",
      questions: [{
        id: "school_year",
        prompt: "When do you plan to take it?",
        options: [{ id: "junior", label: "Grade 11" }, { id: "senior", label: "Grade 12" }],
        allow_custom: true
      }],
      tool_calls: []
    });
    expect(parsed.questions[0]?.options).toHaveLength(2);
    expect(assistantQuestionsWithCombinedOption([{
      id: "priority",
      prompt: "What should the plan prioritize?",
      options: [{ id: "diploma", label: "Finish diploma" }, { id: "gpa", label: "Maximize GPA" }, { id: "degree", label: "Degree overlap" }],
      allow_custom: true
    }])[0]?.options.at(-1)).toEqual({ id: "all_of_the_above", label: "All of the above" });
    expect(assistantQuestionsWithCombinedOption(parsed.questions)[0]?.options).toHaveLength(2);
    }

    {
    expect(parseAssistantToolCall("list_plan_courses", { status: "current" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("update_enrollment_preference", { program_type: "concurrent" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("audit_transcript_data", { include_source_text: true })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_gpa_evidence", { scope: "projected" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("evaluate_gpa_scenario", { target_weighted_gpa: 4, choices: [] })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_enrollment_constraints", {})).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("get_course_schedule_options", { respect_recommended_limit: true })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("resolve_academic_course_batch", {
      requests: [
        { query: "linear algebra", source: "smccd", grade_level: 12, term: null, status: "planned" },
        { query: "calc 2", source: "smccd", grade_level: 11, term: "summer", status: "planned" }
      ],
      fill_remaining_graduation_requirements: true,
      graduation_grade_level: 12
    })).toMatchObject({ mutatesData: false, arguments: { fill_remaining_graduation_requirements: true } });
    expect(parseAssistantToolCall("get_student_data_inventory", {})).toMatchObject({ mutatesData: false });
    expect(() => parseAssistantToolCall("get_academic_framework_progress", {})).toThrow();
    expect(parseAssistantToolCall("get_nearby_education_providers", {})).toMatchObject({ mutatesData: false });
    expect(() => parseAssistantToolCall("save_plan_snapshot", { label: "Before senior changes" })).toThrow();
    expect(parseAssistantToolCall("create_plan_snapshot", { label: "Before senior changes" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("update_student_settings", { plan_start_grade: 11, plan_end_grade: 12 })).toMatchObject({ mutatesData: true });
    expect(requestedPreferredName("Change my preferred name to Jay.")).toBe("Jay");
    expect(parseAssistantToolCall("submit_shared_data_correction", { entity_type: "school", target_table: "schools", target_id: "00000000-0000-4000-8000-000000000003", proposed_payload: { website_url: "https://example.edu" }, evidence_url: "https://example.edu", evidence_summary: "The official school homepage uses this address." })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("correct_transcript_course", { review_item_id: "00000000-0000-4000-8000-000000000002", weighted: true, reason: "The transcript marks this as honors." })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("save_prerequisite_evidence", { target_course_id: "CSM:MATH 200", clearance_type: "placement", authority: "SMCCD placement", evidence_summary: "Placed into MATH 200", source_url: null })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("set_smccd_ge_completion", { college_code: "SKY", requirement: "information_literacy", completed: true })).toMatchObject({ mutatesData: true, arguments: { requirement: "information_literacy" } });
    expect(parseAssistantToolCall("search_california_high_schools", { query: "Design Tech" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("set_current_school", { school_id: crypto.randomUUID() })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("sort_plan_courses", {})).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("update_gpa_scenario", { choices: [{ plan_course_id: crypto.randomUUID(), included: true, expected_grade: "A" }] })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("add_course_schedule", { course_ids: ["00000000-0000-4000-8000-000000000001"], respect_recommended_limit: true })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("add_high_school_course", { course_id: "00000000-0000-4000-8000-000000000001", status: "planned", grade_level: 12, term: "fall" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("set_college_goal", { program_id: "CSM:computer-science-as", notes: "Explore" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("set_college_goals", {
      program_ids: ["CSM:computer-and-information-science-as", "CSM:computer-science-applications-and-development-as"],
      notes: "Combined computer science plan"
    })).toMatchObject({ mutatesData: true });
    expect(() => parseAssistantToolCall("set_college_goals", { program_ids: ["same", "same"] })).toThrow();
    expect(() => parseAssistantToolCall("move_plan_course", { plan_course_id: "not-a-uuid", status: "planned" })).toThrow();
    expect(() => parseAssistantToolCall("unknown_removed_tool", {})).toThrow();
    }

    {
    const update = assistantMemoryUpdateSchema.parse({ operation: "remember", key: "schedule_interests", category: "interest", content: "Interested in computer science and design.", tags: ["schedule", "courses"], importance: 4 });
    expect(update).toMatchObject({ key: "schedule_interests" });
    expect(explicitDurableMemoryUpdates("Remember that I prefer computer science.", [update])).toEqual([update]);
    expect(explicitDurableMemoryUpdates("Generate a rigorous computer science schedule for this plan.", [update])).toEqual([]);
    expect(() => assistantMemoryUpdateSchema.parse({ operation: "remember", key: "gpa", category: "context", content: null, tags: [], importance: 3 })).toThrow();
    }
  });

  it("enforces reviewer, prompt, retrieval, and undo contracts", async () => {
    {
    expect(AI_MODEL_OPTIONS[0]).toMatchObject({ value: "gpt-5.6-luna", recommended: true });
    expect(aiModelSchema.parse("gpt-5.5")).toBe("gpt-5.5");
    expect(() => aiModelSchema.parse("arbitrary-model")).toThrow();
    expect(AI_REASONING_OPTIONS.map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(aiReasoningEffortSchema.parse("high")).toBe("high");
    expect(() => aiReasoningEffortSchema.parse("unbounded")).toThrow();
    }

    {
    const prompt = buildAutoReviewPrompt({
      userMessage: "Use concurrent enrollment",
      toolName: "update_enrollment_preference",
      arguments: { program_type: "concurrent" },
      explanation: "Apply the requested enrollment type."
    });
    expect(prompt).toContain("separate safety reviewer");
    expect(prompt).toContain("Approve when the student's message explicitly and unambiguously requests this exact change");
    expect(prompt).toContain("An explicit removal, grade edit, or move to Done may be approved");
    expect(prompt).toContain("an explicit request to generate, suggest, or build a schedule may approve");
    expect(prompt).toContain("unless the student explicitly requested a clear-and-rebuild and replace_existing is true");
    expect(prompt).toContain('"program_type":"concurrent"');
    expect(autoReviewResultSchema.parse({ decision: "approve", risk: "low", summary: "The request and proposal match." })).toMatchObject({ decision: "approve", risk: "low" });
    expect(autoReviewResultSchema.parse({ decision: "deny", risk: "high", summary: "The proposal is broader than requested." })).toMatchObject({ decision: "deny", risk: "high" });
    expect(() => autoReviewResultSchema.parse({ decision: "manual", risk: "medium", summary: "Ask the student." })).toThrow();
    await expect(reviewAssistantProposal({
      userMessage: "Add all of these graduation and college courses.",
      toolName: "add_academic_courses",
      arguments: { entries: [], respect_recommended_limit: false },
      explanation: "The server resolved the exact batch.",
      model: "gpt-5.6-luna",
      verifiedBatchResolution: true
    })).resolves.toMatchObject({ decision: "approve", risk: "medium" });
    const degreePlanArguments = {
      entries: [
        { source: "selected_school", course_id: "hs-english", status: "planned", grade_level: 12, term: "full_year" },
        { source: "smccd", course_id: "CSM:COMM 150", status: "planned", grade_level: 11, term: "summer" },
        { source: "smccd", course_id: "CSM:COMM 170", status: "planned", grade_level: 12, term: "fall" }
      ],
      respect_recommended_limit: true
    };
    expect(academicPlanEvidenceCoversProposal({
      arguments: degreePlanArguments,
      academicContext: { data: { graduation: [{ status: "missing", required_credits: 40, projected_credits: 30, eligible_course_options: [{ course_id: "hs-english", credits: 10 }] }] } },
      degreeProgress: { data: {
        totals: { remaining_degree_applicable_units: 6 },
        requirements: [
          { status: "partial", remaining_units: 3, eligible_course_options: [{ course_id: "CSM:COMM 150", units: 3 }] },
          { status: "partial", remaining_units: 3, eligible_course_options: [{ course_id: "CSM:COMM 170", units: 3 }] }
        ],
        local_degree_pattern: { ge_areas: [{ status: "completed" }], separate_graduation_requirements: [{ status: "planned" }] }
      } },
      enrollmentConstraints: { data: { respect_recommended_limit: true } }
    })).toBe(true);
    await expect(reviewAssistantProposal({
      userMessage: "Build and apply the rest of my diploma and associate-degree schedule.",
      toolName: "add_academic_courses",
      arguments: degreePlanArguments,
      explanation: "Apply the evidence-complete diploma and degree plan.",
      model: "gpt-5.6-luna",
      verifiedAcademicPlanResolution: true
    })).resolves.toMatchObject({ decision: "approve", risk: "medium" });
    await expect(reviewAssistantProposal({
      userMessage: "Create one plan that completes both listed computer science degrees.",
      toolName: "set_college_goals",
      arguments: { program_ids: ["CSM:computer-and-information-science-as", "CSM:computer-science-applications-and-development-as"] },
      explanation: "Bookmark the complete explicitly selected degree set.",
      model: "gpt-5.6-luna"
    })).resolves.toMatchObject({ decision: "approve", risk: "low", method: "deterministic" });
    await expect(reviewAssistantProposal({
      userMessage: "Clear my schedule for 12th. Find a new schedule that maximizes GPA within the unit limit.",
      toolName: "add_course_schedule",
      arguments: { replace_existing: true, replace_grade_levels: [12], start_grade: 12, include_college_courses: true },
      explanation: "Apply the complete validated grade-12 rebuild.",
      model: "gpt-5.6-luna"
    })).resolves.toMatchObject({ decision: "approve", risk: "medium" });
    }

    {
    const prompt = assistantConversationPrompt({
      history: [{
        role: "tool",
        content: "10 courses were removed from the active plan.",
        actionContext: { toolCallId: "00000000-0000-4000-8000-000000000010", toolName: "remove_plan_courses", data: { removed_count: 10 }, undoAvailable: true, undoneAt: null }
      }],
      userMessage: "Add a math course",
      images: [{ type: "local_image", path: "/private/tmp/schedule.png" }],
      imageNames: ["schedule.png"],
      model: "gpt-5.6-luna",
      knowledge: [{
        id: "schedule-generation-evidence",
        title: "Schedule generation evidence contract",
        content: "Retain existing courses and explain every addition.",
        sourcePath: "docs/AI_TRANSPARENCY.md",
        tags: ["schedule"],
        score: 2,
        matchReason: "text_and_context"
      }],
      recentChanges: [{
        toolCallId: "00000000-0000-4000-8000-000000000010",
        toolName: "remove_plan_courses",
        label: "Remove courses",
        summary: "10 courses were removed from the active plan.",
        data: { removed_count: 10 },
        completedAt: "2026-07-14T19:29:00.000Z",
        undoAvailable: true,
        undoneAt: null,
        undoExpiresAt: "2026-07-14T19:44:00.000Z"
      }],
      recentToolEvidence: [{
        toolCallId: "00000000-0000-4000-8000-000000000011",
        toolName: "get_degree_progress",
        label: "Degree progress",
        summary: "Read current degree progress.",
        data: { remaining_units: 6 },
        completedAt: "2026-07-14T19:28:00.000Z",
        mutatesData: false
      }],
      executeReadTool: async () => ({ summary: "ok", data: {} }),
      onSdkEvent: () => undefined,
      onToolActivity: () => undefined
    });
    expect(prompt).toContain("Use read-only student-data tools");
    expect(prompt).toContain("audit_transcript_data with include_source_text true");
    expect(prompt).toContain("A source being marked needs_review is not itself an error");
    expect(prompt).toContain("printed GPA and earned-credit totals");
    expect(prompt).toContain("graduation requirement gap is a downstream plan result");
    expect(prompt).toContain("name at most three exact affected course records");
    expect(prompt).toContain("independent safety review");
    expect(prompt).toContain("create a dashboard-style report or table");
    expect(prompt).toContain("Default to one to three short sentences");
    expect(prompt).toContain("Keep assistant_message under 900 characters");
    expect(prompt).toContain("use the mutating tool that owns that data");
    expect(prompt).toContain("include only arguments needed for the student's explicit request");
    expect(prompt).toContain("explicitly attached 1 image: schedule.png");
    expect(prompt).toContain("Use visible image content only as context for this turn");
    expect(prompt).toContain("ask up to three short structured questions");
    expect(prompt).toContain("Build and explain one grade at a time");
    expect(prompt).toContain("current four-year plan");
    expect(prompt).toContain("call a partial plan complete");
    expect(prompt).toContain("Schedule generation evidence contract");
    expect(prompt).toContain("authoritative product context, not student-record evidence");
    expect(prompt).toContain("pass every stated grade, starting level, college inclusion, rigor, interest, objective, and workload constraint");
    expect(prompt).toContain("Never end with a promise such as 'I'll check'");
    expect(prompt).toContain("ACTION CONTEXT");
    expect(prompt).toContain("Recent conversation change ledger");
    expect(prompt).toContain("Recent conversation tool evidence");
    expect(prompt).toContain("never claim there is nothing to restore");
    }

    {
    expect(assistantKnowledgeTags("Create a schedule with SMCCD classes")).toEqual([
      "assistant",
      "courses",
      "schedule",
      "college",
      "smccd"
    ]);
    expect(assistantKnowledgeTags("Audit my transcript GPA")).toEqual([
      "assistant",
      "gpa",
      "transcript"
    ]);
    expect(assistantKnowledgeTags("Bring the previous change back")).toContain("history");
    }
  });

  it("grounds schedule generation and expanded app controls", async () => {
    {
    const change: AssistantRecentChange = {
      toolCallId: "00000000-0000-4000-8000-000000000010",
      toolName: "remove_plan_courses",
      label: "Remove courses",
      summary: "10 courses were removed from the active plan.",
      data: { removed_count: 10 },
      completedAt: new Date().toISOString(),
      undoAvailable: true,
      undoneAt: null,
      undoExpiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    expect(assistantUndoIntent("Bring em back")).toBe(true);
    expect(selectAssistantUndoTarget("Bring em back", [change])).toEqual(change);
    const activities: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const result = await runAssistantChat({
      history: [],
      userMessage: "Bring em back",
      model: "gpt-5.6-luna",
      recentChanges: [change],
      executeReadTool: async () => { throw new Error("The current plan must not be queried for an undo."); },
      onSdkEvent: () => undefined,
      onToolActivity: (activity) => { activities.push({ name: activity.name, arguments: activity.arguments }); }
    });
    expect(activities).toEqual([{ name: "undo_change", arguments: { tool_call_id: change.toolCallId } }]);
    expect(result.proposals[0]?.name).toBe("undo_change");
    expect(assistantUndoAvailability({ undo: { kind: "delete_rows", table: "plan_courses", ids: [crypto.randomUUID()], summary: "Removed" }, undo_expires_at: new Date(Date.now() + 60_000).toISOString() }).available).toBe(true);
    expect(assistantUndoAvailability({ undo: { kind: "delete_rows", table: "plan_courses", ids: [crypto.randomUUID()], summary: "Removed" }, undo_expires_at: new Date(Date.now() - 60_000).toISOString() }).available).toBe(true);
    expect(assistantUndoAvailability({ undo: { kind: "delete_rows", table: "plan_courses", ids: [crypto.randomUUID()], summary: "Removed" }, undo_expires_at: new Date(Date.now() + 60_000).toISOString(), undone_at: new Date().toISOString() }).available).toBe(false);
    }

    {
    const result = {
      existing_course_count: 50,
      courses: [{
        course_id: crypto.randomUUID(),
        name: "English 4 / English 4 Honors",
        grade_level: 12,
        term: "full_year",
        rationale: "10 verified English credits"
      }],
      graduation_coverage: {
        requirement_count: 8,
        all_requirements_covered_after: true,
        remaining_gaps: []
      },
      source_readiness: { evidence_ready: true },
      constraint_validation: { satisfied: true, failures: [] }
    };
    const preview = schedulePreview(result);
    expect(preview).toContain("current four-year plan already has 50 courses");
    expect(preview).toContain("keep all of them and add 1");
    expect(preview).toContain("10 verified English credits");
    expect(preview).toContain("all 8 tracked graduation areas");
    expect(preview).toContain("Only one new course is proposed because the other 50 courses are already in your current plan.");
    expect(preview).not.toContain("saved plan");
    expect(scheduleResultIsComplete(result)).toBe(true);
    expect(scheduleResultIsComplete({
      ...result,
      graduation_coverage: { ...result.graduation_coverage, all_requirements_covered_after: false, remaining_gaps: [{ requirement: "Social Science" }] }
    })).toBe(false);
    expect(scheduleResultIsComplete({
      ...result,
      graduation_coverage: { requirement_count: 0, all_requirements_covered_after: true, remaining_gaps: [] }
    })).toBe(false);
    expect(schedulePreview({
      existing_course_count: 0,
      courses: [],
      source_readiness: { evidence_ready: false, selected_school: "Carlmont High" },
      constraint_validation: { satisfied: true, failures: [] },
      graduation_coverage: { requirement_count: 0, all_requirements_covered_after: false, remaining_gaps: [] }
    })).toContain("No other school's sequence will be substituted");
    }

    {
    expect(assistantTurnSchema.parse({ assistant_message: "I prepared the update.", tool_calls: [{
      name: "update_enrollment_preference",
      arguments_json: '{"program_type":"concurrent"}',
      explanation: "Use the SMCCD concurrent-enrollment policy."
    }] }).tool_calls[0]?.name).toBe("update_enrollment_preference");
    expect(assistantTurnSchema.parse({ assistant_message: "I checked the saved schedule.", tool_calls: [{
      name: "evaluate_gpa_scenario",
      arguments_json: '{"target_weighted_gpa":4.5,"choices":[]}',
      explanation: "Evaluate the saved schedule."
    }] }).tool_calls[0]?.name).toBe("evaluate_gpa_scenario");
    }

    {
    expect(requiredAssistantEvidenceRead("Double check my transcript and parsed data for errors")).toEqual({
      name: "audit_transcript_data",
      arguments: { include_source_text: true }
    });
    expect(requiredAssistantEvidenceRead("What is a transcript?")).toBeNull();
    }
  });

  it("requires evidence and exact compound operations", () => {
    {
    expect(requiredAssistantEvidenceRead("Suggest a schedule for me.")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true, rigor: "balanced", include_college_courses: true, objectives: ["complete_diploma"] }
    });
    expect(requiredAssistantEvidenceRead("Generate a four-year course plan for me")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true, rigor: "balanced", include_college_courses: true, objectives: ["complete_diploma"] }
    });
    expect(requiredAssistantEvidenceRead("Create a full plan for me")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true, rigor: "balanced", include_college_courses: true, objectives: ["complete_diploma"] }
    });
    expect(requiredAssistantEvidenceRead("Here are my answers:\n- **What grade are you starting in?** 9th grade\n- **What should the plan prioritize?** All of the above")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: true,
        objectives: ["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"],
        start_grade: 9
      }
    });
    expect(requiredAssistantEvidenceRead("Create a rigorous schedule focused on computer science with no more than six classes per term")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true, rigor: "advanced", include_college_courses: true, max_courses_per_term: 6, objectives: ["complete_diploma"] }
    });
    expect(requiredAssistantEvidenceRead("Create a full plan to finish both bookmarked degrees with no more than 11 college units in any term")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true, rigor: "balanced", include_college_courses: true, objectives: ["complete_diploma", "maximize_degree_overlap"] }
    });
    expect(requiredAssistantEvidenceRead("Generate a full 4 year schedule for me. I'm starting math at precalc grade 9, want as high GPA as possible, and really good course rigor. No concurrent classes.")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: false,
        exclude_college_courses_explicitly: true,
        starting_math_course: "precalc",
        start_grade: 9,
        objectives: ["complete_diploma", "maximize_weighted_gpa"]
      }
    });
    expect(requiredAssistantEvidenceRead("Generate a full 4 year schedule. I'm starting math at precalc and world language at Spanish 2 in grade 9, want the highest GPA, and no concurrent classes.")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: false,
        exclude_college_courses_explicitly: true,
        starting_math_course: "precalc",
        starting_language_course: "spanish 2",
        start_grade: 9,
        objectives: ["complete_diploma", "maximize_weighted_gpa"]
      }
    });
    expect(requiredAssistantEvidenceRead("Clear my whole schedule. Generate a new one, math starting at pre-calc, intended major in computer science, and maximize GPA with reasonable limitations and course rigor.")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: true,
        replace_existing: true,
        max_courses_per_term: 6,
        starting_math_course: "pre-calc",
        interests: ["computer science"],
        objectives: ["complete_diploma", "maximize_weighted_gpa", "align_major"]
      }
    });
    const gradeTwelveRebuild = "Clear my schedule for 12th. Find a new schedule that will net me the highest GPA while still graduating and within concurrent enrollment unit limits.";
    expect(parseAcademicClearIntent(gradeTwelveRebuild)).toBeNull();
    expect(parseAssistantScheduleIntent(gradeTwelveRebuild)).toMatchObject({ replaceExisting: true, replaceGradeLevels: [12], startGrade: 12 });
    expect(parseAssistantScheduleIntent("Clear my whole schedule. Generate a new one with pre-calc in grade 9.")).toMatchObject({
      replaceExisting: true,
      replaceGradeLevels: [],
      startGrade: 9,
      startingMathCourse: "pre-calc"
    });
    expect(requiredAssistantEvidenceRead(gradeTwelveRebuild)).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: true,
        replace_existing: true,
        replace_grade_levels: [12],
        objectives: ["complete_diploma", "maximize_weighted_gpa"],
        start_grade: 12
      }
    });
    expect(requiredAssistantEvidenceRead("Create a full schedule starting from 10th grade for the highest GPA and most degrees in my major")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "advanced",
        include_college_courses: true,
        objectives: ["complete_diploma", "maximize_weighted_gpa", "maximize_degree_overlap", "align_major"],
        start_grade: 10
      }
    });
    const compoundRequest = "Add the three classes needed for high school graduation in 12th. From college, add linear algebra, calc 3, physics with calculus 1, 2, and 3. Put in 11th grade summer calc 2, intercultural communication, eng c1000, nosql databases.";
    const compoundArguments = parseCompoundAcademicCourseRequest(compoundRequest);
    expect(compoundArguments).toMatchObject({
      fill_remaining_graduation_requirements: true,
      graduation_grade_level: 12,
      requests: [
        { query: "calc 2", source: "smccd", grade_level: 11, term: "summer" },
        { query: "intercultural communication", source: "smccd", grade_level: 11, term: "summer" },
        { query: "eng c1000", source: "smccd", grade_level: 11, term: "summer" },
        { query: "nosql databases", source: "smccd", grade_level: 11, term: "summer" },
        { query: "linear algebra", source: "smccd", term: null },
        { query: "calc 3", source: "smccd", term: null },
        { query: "physics with calculus 1", source: "smccd", term: null },
        { query: "physics with calculus 2", source: "smccd", term: null },
        { query: "physics with calculus 3", source: "smccd", term: null }
      ]
    });
    expect(requiredAssistantEvidenceRead(compoundRequest)).toEqual({ name: "resolve_academic_course_batch", arguments: compoundArguments });
    expect(requiredAssistantEvidenceRead("Here are my answers:\n- **Keep college coursework within the 11-unit per-term district planning limit?** Yes (Recommended)")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: true }
    });
    expect(requiredAssistantEvidenceRead("Here are my answers:\n- **Keep college coursework within the 11-unit per-term district planning limit?** No")).toEqual({
      name: "get_course_schedule_options",
      arguments: { respect_recommended_limit: false }
    });
    expect(requiredAssistantEvidenceRead("Suggest a study schedule for finals")).toBeNull();
    expect(parseScheduleAnswer("Here are my answers:\n- **Add this suggested schedule to your plan?** Yes (Recommended)")).toEqual({ kind: "add_schedule", accepted: true });
    expect(parseScheduleAnswer("Here are my answers:\n- **Add this suggested schedule to your plan?** No")).toEqual({ kind: "add_schedule", accepted: false });
    expect(parseScheduleAnswer("Here are my answers:\n- **Add these proposed courses to your current four-year plan?** Yes (Recommended)")).toEqual({ kind: "add_schedule", accepted: true });
    expect(scheduleProposalAction("Suggest a schedule for me.")).toEqual({ kind: "propose", respectRecommendedLimit: true });
    expect(scheduleProposalAction("Here are my answers:\n- **Add this suggested schedule to your plan?** No")).toEqual({ kind: "decline" });
    expect(scheduleProposalAction("Here are my answers:\n- **Keep college coursework within the district limit?** No")).toEqual({ kind: "propose", respectRecommendedLimit: false });
    expect(requestedUiTheme("Switch the app to dark mode")).toBe("dark");
    expect(requestedUiTheme("Use the light theme")).toBe("light");
    expect(requestedStudentSettings("Set my current grade to 10, graduation year to 2029, and planning window from grade 10 through grade 12.")).toEqual({ grade_level: 10, graduation_year: 2029, plan_start_grade: 10, plan_end_grade: 12 });
    expect(parseExactCourseAddition("Add Carlmont Biology to grade 9 as an in-progress full-year course.")).toEqual({ query: "Carlmont Biology", gradeLevel: 9, status: "current", term: "full_year", source: "high_school" });
    expect(parseDegreeGoalIntent("Bookmark the Computer Science Applications and Development AS degree at College of San Mateo as my college goal.")).toEqual({ query: "Computer Science Applications and Development", college: "CSM", awardType: "AS" });
    expect(parseAcademicClearIntent("Clear my whole schedule, every degree bookmark, and all saved GPA assumptions.")).toEqual({ courses: true, degree_bookmarks: true, gpa_scenario: true });
    expect(parseAcademicClearIntent("Clear my schedule for 12th.")).toBeNull();
    expect(parseCollegeDistrictSelection("Change my community-college district to Foothill-De Anza Community College District.")).toBe("Foothill-De Anza Community College District");
    expect(parseSchoolSelection("Switch my selected high school to Design Tech High School.")).toBe("Design Tech High School");
    expect(parseEnrollmentPreference("Use concurrent enrollment and respect the district's recommended unit limit.")).toEqual({ program_type: "concurrent", respect_recommended_limit: true });
    expect(parseBulkGpaIntent("Set every current and planned course in my GPA calculator to an expected A and keep each one included.")).toEqual({ expectedGrade: "A", included: true });
    expect(requestedCourseSort("Sort my entire course board into the app's standard order.")).toBe(true);
    }

    {
    expect(requiredAssistantEvidenceRead("Clear my whole schedule and all degree bookmarks")).toEqual({
      name: "get_academic_context",
      arguments: { include_transcript_review: false }
    });
    expect(parseAssistantToolCall("clear_academic_plan", { courses: true, degree_bookmarks: true, gpa_scenario: false })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("get_academic_context", { include_transcript_review: true })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("add_academic_courses", {
      entries: [{ source: "smccd", course_id: "SKY-MATH-251", status: "planned", grade_level: 11, term: "fall" }],
      respect_recommended_limit: true
    })).toMatchObject({ mutatesData: true });
    expect(requiredAssistantEvidenceRead("Remove my computer science degree bookmark")).toBeNull();
    expect(requiredAssistantEvidenceRead("Create a schedule without deleting my degree bookmarks")).toEqual({
      name: "get_course_schedule_options",
      arguments: {
        respect_recommended_limit: true,
        rigor: "balanced",
        include_college_courses: true,
        objectives: ["complete_diploma"]
      }
    });
    }

    {
    expect(assistantMessagePromisesFutureWork("I’ll check the schedule options first, then tailor the recommendation.")).toBe(true);
    expect(assistantMessagePromisesFutureWork("Grade 12 has three open course options.")).toBe(false);
    }

    {
    expect(requiredAssistantEvidenceRead("Remove all my in progress classes.")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "current" }
    });
    expect(requiredAssistantEvidenceRead("Delete every planned course")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "planned" }
    });
    expect(requiredAssistantEvidenceRead("Mark all my in progress classes complete")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "current" }
    });
    expect(requiredAssistantEvidenceRead("Move every planned course to in progress")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "planned" }
    });
    expect(requiredAssistantEvidenceRead("Move all courses to planned")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all" }
    });
    expect(requiredAssistantEvidenceRead("Clear my schedule for fall 2026")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all", term: "fall", include_full_year: true, school_year: "2026-2027" }
    });
    expect(requiredAssistantEvidenceRead("Empty my spring 2027 schedule")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all", term: "spring", include_full_year: true, school_year: "2026-2027" }
    });
    expect(requiredAssistantEvidenceRead("Wipe the grade 11 plan")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all", grade_level: 11 }
    });
    expect(requiredAssistantEvidenceRead("Clear my schedule for 12th")).toEqual({
      name: "list_plan_courses",
      arguments: { status: "all", grade_level: 12 }
    });
    expect(requiredAssistantEvidenceRead("Remove all classes except Economics")).toBeNull();
    expect(requiredAssistantEvidenceRead("Move all classes but keep Government current")).toBeNull();
    expect(requiredAssistantEvidenceRead("What are all my current classes?")).toBeNull();
    expect(parseAssistantToolCall("remove_plan_courses", { plan_course_ids: [crypto.randomUUID(), crypto.randomUUID()] })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("move_plan_courses", { plan_course_ids: [crypto.randomUUID(), crypto.randomUUID()], status: "completed" })).toMatchObject({ mutatesData: true });
    expect(parseAssistantToolCall("search_smccd_programs", { query: "computer science", college: "CSM", award_type: "AS" })).toMatchObject({ mutatesData: false });
    expect(parseAssistantToolCall("undo_change", { tool_call_id: crypto.randomUUID() })).toMatchObject({ mutatesData: true });
    }
  });
});
