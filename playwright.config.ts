import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4388",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm build && HOST=127.0.0.1 PORT=4388 node dist/server/entry.mjs",
    url: "http://127.0.0.1:4388",
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
