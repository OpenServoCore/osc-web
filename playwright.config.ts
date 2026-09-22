import { defineConfig, devices } from "@playwright/test";

// Parallel worktrees each take their own dev server: PW_PORT=5183 npm run test:e2e
const port = Number(process.env.PW_PORT ?? 5179);

export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
