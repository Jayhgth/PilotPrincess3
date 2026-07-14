import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import OnboardingFlow, { applyOnboardingPlanningDefaults } from "@/components/OnboardingFlow";
import type { PlanVersion, School, StudentSettings } from "@/lib/models";

const settings: StudentSettings = {
  id: "student-1",
  school_id: "school-1",
  preferred_name: "Avery",
  age: 16,
  grade_level: 10,
  graduation_year: 2028,
  school_confirmed: true,
  onboarding_complete: false,
  ai_enabled: false,
  ai_model: "gpt-5.6-luna",
  ai_reasoning_effort: "low",
  ai_review_mode: "manual",
  ai_connection_approved_at: null,
  ai_setup_tested_at: null,
  plan_start_grade: 10,
  plan_end_grade: 10,
  tracker_mode: "selected",
  tracked_requirement_areas: ["math"]
};

describe("onboarding flow", () => {
  it("plans through graduation and enables the full diploma tracker without asking", () => {
    const defaults = applyOnboardingPlanningDefaults(settings, 10);

    expect(defaults.plan_start_grade).toBe(10);
    expect(defaults.plan_end_grade).toBe(12);
    expect(defaults.tracker_mode).toBe("full");
    expect(defaults.tracked_requirement_areas).toHaveLength(8);
  });

  it("shows only the profile, assistant, and transcript stages", () => {
    const html = renderToStaticMarkup(createElement(OnboardingFlow, {
      supabase: {} as SupabaseClient,
      session: { user: { id: "student-1" }, access_token: "token" } as Session,
      school: { id: "school-1", name: "Design Tech High School" } as School,
      settings,
      courses: [],
      mappings: [],
      equivalencies: [],
      activeVersion: { id: "version-1", generation_config: {} } as PlanVersion,
      existingPlanCourses: [],
      onComplete: async () => undefined,
      onSignOut: async () => undefined
    }));

    expect(html).toContain("About you");
    expect(html).toContain("Pilot Assistant");
    expect(html).toContain("Transcript");
    expect(html).toContain("Grade 10 to 12");
    expect(html).toContain("3 school years");
    expect(html).toContain("Full diploma tracker");
    expect(html).not.toContain("Plan window");
    expect(html).not.toContain("Requirement tracker");
    expect(html).not.toContain("College enrollment type");
    expect(html).not.toContain("Focused tracker");
  });
});
