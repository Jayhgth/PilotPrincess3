import { expect, test } from "@playwright/test";

test("renders the d.tech authentication experience", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Pilot Princess | d.tech planning");
  await expect(page.getByRole("heading", { name: "See the whole route before choosing the next class." })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("d.tech email")).toHaveAttribute("placeholder", "student@dtechhs.org");
  await expect(page.getByText("2025-26", { exact: true })).toBeVisible();
});

test("keeps the authentication flow usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "See the whole route before choosing the next class." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open workspace" })).toBeVisible();
});
