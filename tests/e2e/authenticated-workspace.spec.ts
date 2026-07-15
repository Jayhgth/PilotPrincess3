import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

const qaEmail = process.env.QA_EMAIL;
const qaPassword = process.env.QA_PASSWORD;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
let activeEmail = qaEmail ?? "";
let activePassword = qaPassword ?? "";
let ephemeralSupabase: SupabaseClient | null = null;
const transcriptPath = fileURLToPath(new URL("../fixtures/transcript-basic.txt", import.meta.url));

async function signInToOnboarding(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(activeEmail);
  await page.getByLabel("Password", { exact: false }).fill(activePassword);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { name: "Tell us where you are now" })).toBeVisible();
}

async function fillStudentStep(page: Page, schoolName = "Design Tech High School") {
  await page.getByLabel("Search California high schools").fill(schoolName);
  await page.getByRole("option").filter({ hasText: schoolName }).first().click();
  await page.getByLabel("Preferred name").fill("Codex QA");
  await page.getByLabel("Age").fill("17");
  await page.getByLabel("Current grade").selectOption("11");
  await page.getByLabel("Expected graduation year").fill("2027");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Pilot Assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function dragCard(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("The drag source is not visible.");
  const sourceCenter = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(sourceCenter.x + 12, sourceCenter.y + 12, { steps: 4 });
  await expect(target).toHaveClass(/drag-available/);
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("The drag destination is not visible.");
  const targetCenter = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 16 });
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
}

test.describe("authenticated student workspace", () => {
  test.skip(!supabaseConfigured, "Set the public Supabase variables to run authenticated flows.");

  test.beforeEach(async ({ request }) => {
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    if (!qaEmail || !qaPassword) {
      activeEmail = `pilot-workspace-e2e-${randomUUID()}@example.com`;
      activePassword = `Pp-${randomUUID()}!9a`;
      const signup = await supabase.auth.signUp({ email: activeEmail, password: activePassword, options: { data: { preferred_name: "Codex QA" } } });
      if (signup.error || !signup.data.session) throw signup.error ?? new Error("The ephemeral workspace account could not be created.");
      ephemeralSupabase = supabase;
      return;
    }
    activeEmail = qaEmail;
    activePassword = qaPassword;
    const { data, error } = await supabase.auth.signInWithPassword({ email: activeEmail, password: activePassword });
    if (error || !data.session) throw error ?? new Error("The QA account could not sign in.");

    const response = await request.post("/api/admin/reset", {
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        origin: "http://127.0.0.1:4388"
      }
    });
    expect(response.ok(), await response.text()).toBe(true);
    await supabase.auth.signOut({ scope: "local" });
  });

  test.afterEach(async () => {
    if (ephemeralSupabase) {
      await ephemeralSupabase.rpc("delete_current_user_account");
      ephemeralSupabase = null;
    }
  });

  test("completes onboarding, imports a transcript, and reaches the course plan", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await signInToOnboarding(page);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Use light theme" }).click();

    await fillStudentStep(page);

    await expect(page.getByRole("heading", { name: "Add completed classes" })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(transcriptPath);
    await page.getByRole("button", { name: "Read transcript" }).click();

    await expect(page.getByText("2 GPA courses found", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Intersession pass/fail courses", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Import selected and finish" }).click();

    await expect(page.getByRole("heading", { name: "Good to see you, Codex QA" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await expect(page.getByText("English 3 / English 3 Honors", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("CIS 127 HTML5 and CSS", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Internship/TA", { exact: true }).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("adds, moves, evaluates, persists, and removes an editable course", async ({ page }) => {
    await signInToOnboarding(page);
    await fillStudentStep(page);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { name: "Good to see you, Codex QA" })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await page.getByRole("button", { name: "Add courses" }).click();
    await page.getByLabel("Search courses").fill("Advanced Environmental Science Honors");
    await page.getByRole("button", { name: /Advanced Environmental Science Honors/ }).first().click();
    await page.getByRole("button", { name: "Add to plan" }).click();
    await expect(page.getByRole("status")).toContainText("Advanced Environmental Science Honors added");

    await page.getByRole("tab", { name: "My plan" }).click();
    const moveCard = page.getByLabel(/Move Advanced Environmental Science Honors/);
    await expect(moveCard).toBeVisible();
    await dragCard(page, moveCard, page.getByRole("tab", { name: /^Grade 12/ }));
    await expect(page.getByRole("tab", { name: /^Grade 12/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel(/Move Advanced Environmental Science Honors/)).toBeVisible();
    await expect(page.locator(".toast")).toContainText("moved to Grade 12");
    await dragCard(page, page.getByLabel(/Move Advanced Environmental Science Honors/), page.getByRole("tab", { name: /^Grade 11/ }));
    await expect(page.getByRole("tab", { name: /^Grade 11/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".toast")).toContainText("moved to Grade 11");

    await page.getByRole("button", { name: "GPA planner", exact: true }).click();
    const gradeSelect = page.getByLabel("Expected grade for Advanced Environmental Science Honors");
    await gradeSelect.selectOption("B");
    await expect(gradeSelect).toHaveValue("B");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "GPA planner", exact: true }).click();
    await expect(page.getByLabel("Expected grade for Advanced Environmental Science Honors")).toHaveValue("B");

    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await page.getByRole("button", { name: "Remove Advanced Environmental Science Honors" }).click();
    await page.getByRole("button", { name: "Confirm removal of Advanced Environmental Science Honors" }).click();
    await expect(page.getByText("Advanced Environmental Science Honors", { exact: true })).toHaveCount(0);
  });

  test("selects another California public school without leaking the d.tech catalog", async ({ page }) => {
    await signInToOnboarding(page);
    await fillStudentStep(page, "AIMS College Prep High");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { name: "Good to see you, Codex QA" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".school-chip")).toHaveAttribute("title", /AIMS College Prep High/);
    await expect(page.getByText("Verify school catalog", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Graduation", exact: true }).click();
    await expect(page.getByText("Official diploma requirements are not available yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "California minimum", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "UC A–G", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await page.getByRole("button", { name: "Add courses" }).click();
    await expect(page.getByRole("list", { name: "Course catalog results" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^AP Biology / })).toBeVisible();
    await expect(page.getByText("Advanced Environmental Science Honors", { exact: true })).toHaveCount(0);
  });
});
