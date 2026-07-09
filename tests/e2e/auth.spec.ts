import { expect, test } from "@playwright/test";

test("renders the d.tech authentication experience", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Pilot Princess | d.tech planning");
  await expect(page.getByRole("heading", { name: "See the whole route before choosing the next class." })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("placeholder", "you@example.com");
  await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByText("2025-26", { exact: true })).toBeVisible();
});

test("allows account creation with any valid email address", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create account" }).click();

  await expect(page.getByText("Create an account with any valid email address.")).toBeVisible();
  await page.getByLabel("Preferred name").fill("Student");
  await page.getByLabel("Email").fill("student@example.com");
  await page.getByLabel("Password").fill("valid-password");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
});

test("offers account recovery and rejects an expired reset link", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Forgot password?" }).click();

  await expect(page.getByRole("region", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email reset link" })).toBeVisible();

  await page.goto("/reset-password");
  await expect(page).toHaveTitle("Reset password | Pilot Princess");
  await expect(page.getByText("This reset link is invalid or has expired.", { exact: false })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("link", { name: "Request another link" })).toBeVisible();
});

test("keeps the authentication flow usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "See the whole route before choosing the next class." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open workspace" })).toBeVisible();
});
