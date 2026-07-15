import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(supabaseUrl && supabaseAnonKey);

let supabase: SupabaseClient;
let email = "";
let password = "";

async function openFreshOnboarding(page: Page) {
  email = `pilot-school-parity-${randomUUID()}@example.com`;
  password = `Pp-${randomUUID()}!9a`;
  supabase = createClient(supabaseUrl!, supabaseAnonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { preferred_name: "School QA" } } });
  if (error || !data.session) throw error ?? new Error("The school parity account could not be created.");

  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: false }).fill(password);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Tell us where you are now" })).toBeVisible();
}

async function chooseSchoolAndFinish(page: Page, schoolName: string) {
  await page.getByLabel("Search California high schools").fill(schoolName);
  await page.getByRole("option").filter({ hasText: schoolName }).first().click();
  await expect(page.getByLabel("Community-college district")).toBeVisible();
  await expect(page.getByLabel("Community-college district")).not.toHaveValue("");
  await page.getByLabel("Preferred name").fill("School QA");
  await page.getByLabel("Age").fill("16");
  await page.getByLabel("Current grade").selectOption("10");
  await page.getByLabel("Expected graduation year").fill("2028");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Good to see you, School QA" })).toBeVisible({ timeout: 20_000 });
}

test.describe("statewide school parity", () => {
  test.skip(!configured, "Set the public Supabase variables to run ephemeral statewide school parity flows.");

  test.afterEach(async () => {
    if (supabase) await supabase.rpc("delete_current_user_account");
  });

  test("defaults d.tech to SMCCD and persists a changed district", async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByLabel("Search California high schools").fill("Design Tech High School");
    const dtechResult = page.getByRole("option").filter({ hasText: "Design Tech High School" }).first();
    await expect(dtechResult.locator('img[src*="dtech-wordmark"]').first()).toBeVisible();
    await dtechResult.click();
    await expect(page.getByLabel("Community-college district")).toHaveValue("ccc-district-san-mateo-county-community-college-district");
    await expect(page.getByLabel("Community-college district").locator("option:checked")).toContainText("recommended");
    await page.getByLabel("Preferred name").fill("School QA");
    await page.getByLabel("Age").fill("16");
    await page.getByLabel("Current grade").selectOption("10");
    await page.getByLabel("Expected graduation year").fill("2028");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { name: "Good to see you, School QA" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const districtSelect = page.getByLabel("Community-college district");
    const originalDistrict = "ccc-district-san-mateo-county-community-college-district";
    await expect(districtSelect).toHaveValue(originalDistrict);
    const alternativeDistrict = await districtSelect.locator('option[value^="ccc-district-"]').evaluateAll((options, original) =>
      options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== original) ?? "",
    originalDistrict);
    expect(alternativeDistrict).not.toBe("");
    await districtSelect.selectOption(alternativeDistrict);
    await page.getByRole("button", { name: "Save district" }).click();
    await expect(page.getByText("District saved", { exact: true })).toBeVisible();
    const { data, error } = await supabase.from("student_college_district_preferences").select("district_code,selection_method").single();
    expect(error).toBeNull();
    expect(data).toEqual({ district_code: alternativeDistrict, selection_method: "student" });
    const workspace = await supabase.rpc("get_workspace_bootstrap");
    expect(workspace.error).toBeNull();
    expect(workspace.data.college_district_preference.district_code).toBe(alternativeDistrict);
    expect(workspace.data.college_district.district_code).toBe(alternativeDistrict);
    expect(workspace.data.enrollment_preference).toBeNull();
    const pilotWorkspace = await supabase.rpc("get_assistant_workspace_bootstrap");
    expect(pilotWorkspace.error).toBeNull();
    expect(pilotWorkspace.data.college_district_preference.district_code).toBe(alternativeDistrict);
  });

  test("keeps a non-d.tech charter isolated while retaining district and icon behavior", async ({ page }) => {
    await openFreshOnboarding(page);
    await chooseSchoolAndFinish(page, "AIMS College Prep High");
    await expect(page.locator(".school-chip")).toHaveAttribute("title", /AIMS College Prep High/);
    await expect(page.locator(".school-chip .institution-identity-mark")).toHaveCount(1);
    await page.getByRole("button", { name: "Graduation", exact: true }).click();
    await expect(page.locator("p").filter({ hasText: "Official AIMS College Prep High rules." })).toBeVisible();
    await expect(page.getByRole("button", { name: /AIMS Core Electives 40 credits/ })).toBeVisible();
    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await page.getByRole("button", { name: "Add courses" }).click();
    await expect(page.getByText("Advanced Environmental Science Honors", { exact: true })).toHaveCount(0);
  });
});
