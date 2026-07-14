import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import { collegeDistrictCode, groupNearbyCollegeDistricts, officialInstitutionIconUrl } from "@/lib/college-districts";
import { defaultEnrollmentPreference, policyForPreference } from "@/lib/enrollment-policy";
import type { EducationProvider } from "@/lib/models";
import { assistantTurnSchema } from "@/server/ai-schemas";
import { parseAssistantToolCall } from "@/server/ai-tools";

function provider(overrides: Partial<EducationProvider> & Pick<EducationProvider, "id" | "name" | "district_name">, distance_miles: number | null) {
  return {
    id: overrides.id,
    provider_code: overrides.provider_code ?? `ccc-${overrides.id}`,
    provider_type: "community_college" as const,
    district_name: overrides.district_name,
    name: overrides.name,
    website_url: overrides.website_url ?? `https://${overrides.id}.edu`,
    street_address: null,
    city: overrides.city ?? "California",
    state_code: "CA",
    postal_code: null,
    latitude: null,
    longitude: null,
    status: "active" as const,
    source_url: "https://www.cccco.edu/Students/Find-a-College/College-Alphabetical-Listing",
    source_updated_at: null,
    distance_miles
  };
}

describe("statewide school and college-district parity", () => {
  it("creates stable district identities and groups every nearby college without losing a campus", () => {
    const rows = groupNearbyCollegeDistricts([
      provider({ id: "csm", name: "College of San Mateo", district_name: "San Mateo County Community College District" }, 4.2),
      provider({ id: "sky", name: "Skyline College", district_name: "San Mateo County Community College District" }, 11.5),
      provider({ id: "can", name: "Cañada College", district_name: "San Mateo County Community College District" }, 7.1),
      provider({ id: "foothill", name: "Foothill College", district_name: "Foothill-De Anza Community College District" }, 8.6)
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      district_code: "ccc-district-san-mateo-county-community-college-district",
      colleges_count: 3,
      nearest_distance_miles: 4.2,
      is_recommended: true
    });
    expect(rows[0].providers.map((row) => row.name)).toEqual([
      "College of San Mateo",
      "Skyline College",
      "Cañada College"
    ]);
    expect(rows[1].is_recommended).toBe(false);
  });

  it.each([
    ["Los Ríos Community College District", "ccc-district-los-rios-community-college-district"],
    ["San Mateo County Community College District", "ccc-district-san-mateo-county-community-college-district"],
    ["Peralta Community College District", "ccc-district-peralta-community-college-district"]
  ])("normalizes %s into the same key used by the database", (name, expected) => {
    expect(collegeDistrictCode(name)).toBe(expected);
  });

  it("uses official institution website origins for generic marks and rejects unsafe schemes", () => {
    expect(officialInstitutionIconUrl("http://school.example.edu/path?x=1")).toBe("https://school.example.edu/favicon.ico");
    expect(officialInstitutionIconUrl("javascript:alert(1)")).toBeNull();
    const html = renderToStaticMarkup(createElement(InstitutionIdentityMark, {
      name: "Representative California High School",
      websiteUrl: "https://school.example.edu/about"
    }));
    expect(html).toContain("https://school.example.edu/favicon.ico");
    expect(html).toContain("institution-identity-mark");
  });

  it("preserves exact local assets for d.tech and the supported SMCCD colleges", () => {
    const dtech = renderToStaticMarkup(createElement(InstitutionIdentityMark, { name: "Design Tech High School", websiteUrl: "https://designtechhighschool.org" }));
    const skyline = renderToStaticMarkup(createElement(InstitutionIdentityMark, { name: "Skyline College", websiteUrl: "https://skylinecollege.edu", kind: "college" }));
    expect(dtech).toContain("/institutions/dtech-wordmark.png");
    expect(skyline).toContain("/institutions/skyline-color.png");
  });

  it("exposes district selection as a validated Pilot mutation", () => {
    expect(parseAssistantToolCall("set_college_district_preference", {
      district_code: "ccc-district-san-mateo-county-community-college-district"
    })).toMatchObject({ name: "set_college_district_preference", mutatesData: true });
    expect(assistantTurnSchema.parse({
      assistant_message: "I found the requested district.",
      questions: [],
      tool_calls: [{ name: "set_college_district_preference", arguments_json: '{"district_code":"ccc-district-san-mateo-county-community-college-district"}', explanation: "Use the exact nearby district identifier." }],
      memory_updates: []
    }).tool_calls[0].name).toBe("set_college_district_preference");
  });

  it("does not borrow SMCCD limits for a different selected district", () => {
    const preference = defaultEnrollmentPreference("student-1", "ccc-district-peralta-community-college-district");
    expect(preference.provider_code).toBe("ccc-district-peralta-community-college-district");
    expect(policyForPreference([{
      id: "smccd-concurrent-2026",
      provider_code: "SMCCD",
      provider_name: "San Mateo County Community College District",
      program_type: "concurrent",
      term: "any",
      unit_system: "semester",
      recommended_max_units: 11,
      fee_free_max_units: 11.5,
      absolute_max_units: 19,
      approval_required: true,
      source_url: "https://smccd.edu/k-12/faqs.php",
      source_label: "SMCCD FAQ",
      source_year: "2026",
      notes: null,
      confidence: "verified"
    }], preference)).toBeNull();
  });

  it("keeps selection, RLS, nearby ranking, smart defaults, and Pilot bootstrap in the migration contract", () => {
    const migration = readFileSync("supabase/migrations/20260714200000_school_college_district_parity.sql", "utf8");
    for (const contract of [
      "create table public.college_districts",
      "create table public.student_college_district_preferences",
      "create or replace function public.nearby_college_districts",
      "create or replace function public.set_college_district_preference",
      "selection_method in ('student', 'pilot')",
      "users manage own college district preference",
      "'college_district_preference'",
      "'nearby_college_districts'"
    ]) expect(migration).toContain(contract);
  });
});
