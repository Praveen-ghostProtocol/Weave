import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  // No webServer block existed yet — added so `npx playwright test` can
  // boot the app itself instead of requiring `npm run dev` running in
  // another terminal first. Reuses an already-running dev server (e.g. one
  // left open locally) rather than erroring on a port clash.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
