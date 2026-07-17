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

async function dragCardToLane(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("The drag source is not visible.");
  const sourceCenter = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(sourceCenter.x + 12, sourceCenter.y + 12, { steps: 4 });
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("The drag destination is not visible.");
  const targetCenter = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 32 };
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

    if (ephemeralSupabase) {
      const [snapshot, admin] = await Promise.all([
        ephemeralSupabase.rpc("get_workspace_snapshot_v1"),
        ephemeralSupabase.rpc("is_app_admin")
      ]);
      expect(snapshot.error).toBeNull();
      expect((snapshot.data as { settings?: unknown; plan?: unknown; active_version?: unknown }).settings).toBeTruthy();
      expect((snapshot.data as { plan?: unknown }).plan).toBeTruthy();
      expect((snapshot.data as { active_version?: unknown }).active_version).toBeTruthy();
      expect(admin.data).toBe(false);
    }
    await signInToOnboarding(page);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Use light theme" }).click();

    await fillStudentStep(page);

    await expect(page.getByRole("heading", { name: "Add completed classes" })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(transcriptPath);

    await expect(page.getByText("Courses found", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("5 of 5 selected", { exact: true })).toBeVisible();
    await expect(page.getByText("Intersession pass/fail courses", { exact: true })).toBeVisible();
    await expect(page.getByText("Custom course", { exact: true })).toHaveCount(0);
    await expect(page.locator(".transcript-pass-review")).not.toHaveAttribute("open", "");
    await page.getByRole("button", { name: "Import selected and finish" }).click();

    await expect(page.getByRole("heading", { name: "Good to see you, Codex QA" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Courses", exact: true }).click();
    await expect(page.getByText("English 3 Honors", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Advanced Statistics Honors", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("D.Lab: Innovation Diploma Honors", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("CIS 127 HTML5 and CSS", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Internship/TA", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Use light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settingsDialog = page.getByRole("dialog");
    await settingsDialog.getByRole("button", { name: "Support", exact: true }).click();
    await settingsDialog.getByLabel("Type").selectOption("bug");
    await settingsDialog.getByLabel("Subject").fill("Course card does not refresh");
    await settingsDialog.getByRole("textbox", { name: "Message", exact: true }).fill("The course card keeps the previous status after I save a change.");
    await settingsDialog.getByRole("button", { name: "Send message" }).click();
    await expect(settingsDialog.getByRole("status")).toContainText("Message sent");
    await expect(settingsDialog.getByRole("heading", { name: "Course card does not refresh" })).toBeVisible();
    if (ephemeralSupabase) {
      const submittedRequest = await ephemeralSupabase.from("support_requests").select("id,status").eq("subject", "Course card does not refresh").single();
      expect(submittedRequest.data?.status).toBe("open");
      const forbiddenUpdate = await ephemeralSupabase.from("support_requests").update({ status: "resolved", admin_response: "Not allowed" }).eq("id", submittedRequest.data!.id).select("id");
      expect(forbiddenUpdate.data).toEqual([]);
    }
    await settingsDialog.getByRole("button", { name: "Close settings" }).click();

    const pilotSupabase = ephemeralSupabase ?? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    if (!ephemeralSupabase) {
      const signIn = await pilotSupabase.auth.signInWithPassword({ email: activeEmail, password: activePassword });
      if (signIn.error) throw signIn.error;
    }
    const user = await pilotSupabase.auth.getUser();
    const enabled = await pilotSupabase.from("student_settings").update({
      ai_enabled: true,
      ai_connection_approved_at: new Date().toISOString(),
      ai_setup_tested_at: new Date().toISOString()
    }).eq("id", user.data.user!.id);
    if (enabled.error) throw enabled.error;
    await page.reload();
    await page.getByRole("button", { name: "Open Pilot", exact: true }).click();
    const pilot = page.getByRole("dialog", { name: "Pilot Assistant" });
    await expect(pilot).toBeVisible();
    await page.keyboard.press("Control+b");
    await expect(pilot).toBeHidden();
    await page.keyboard.press("Control+b");
    await expect(pilot).toBeVisible();
    await expect(page.getByText("Pilot could not open", { exact: false })).toHaveCount(0);
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
    await expect(page.getByLabel("School year")).toBeEnabled();
    await page.getByLabel("School year").selectOption("12");
    await expect(page.getByLabel("School year")).toHaveValue("12");
    await page.getByLabel("School year").selectOption("11");
    await expect(page.getByLabel("Term")).toBeEnabled();
    await page.getByRole("button", { name: "Add to plan" }).click();
    await expect(page.getByRole("status")).toContainText("Advanced Environmental Science Honors added");

    await page.getByRole("tab", { name: "College catalog" }).click();
    await page.getByText("Course missing from the catalog?").click();
    await page.getByLabel("Exact course code and title").fill("TEST 199 Student-provided seminar");
    await page.getByLabel("College units").fill("3");
    await page.getByLabel("Proposed high school credits").fill("5");
    await page.getByLabel("School year").selectOption("12");
    await page.getByLabel("Term").selectOption("spring");
    await page.getByRole("button", { name: "Add manual course" }).click();
    await expect(page.locator(".smccd-notice")).toContainText("Manual college course added");

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

    await page.getByRole("tab", { name: /^Grade 12/ }).click();
    const manualCard = page.getByLabel(/Move TEST 199 Student-provided seminar/);
    await expect(manualCard).toBeVisible();
    await dragCard(page, manualCard, page.getByRole("tab", { name: /^Grade 11/ }));
    await expect(page.locator(".toast")).toContainText("moved to Grade 11, Spring");
    const fallLane = page.locator(".course-term-lane").filter({ has: page.getByRole("heading", { name: "Fall", exact: true }) });
    await dragCardToLane(page, page.getByLabel(/Move TEST 199 Student-provided seminar/), fallLane);
    await expect(page.locator(".toast")).toContainText("moved to Grade 11, Fall");

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

});
