import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",

  // Extension tests launch a full browser — give extra time for cold starts
  timeout: 30_000,

  // Retries can mask flakiness; keep at 0 for local dev, bump in CI
  retries: 0,

  // Only Chromium supports loading unpacked extensions
  projects: [
    {
      name: "chromium",
      use: {
        // Each test file gets its own browser context via the custom fixture,
        // so the base "browserName" here is informational only.
        browserName: "chromium",
      },
    },
  ],

  // Reporter — default is fine for local; change to "dot" or "github" in CI
  reporter: "list",

  // Extension tests cannot run headless (Chrome limitation for MV3 extensions)
  use: {
    headless: false,
    // Increase action timeout for slower machines
    actionTimeout: 10_000,
  },
});
