import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: "npx vite --config tests/e2e/vite.config.mts",
      url: "http://localhost:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
