import { type BrowserContext, chromium, test as base } from "@playwright/test";
import path from "node:path";

// ---------------------------------------------------------------------------
// Fixture that launches Chromium with the extension loaded from dist/.
// Reference: https://playwright.dev/docs/chrome-extensions
// ---------------------------------------------------------------------------

const EXTENSION_PATH = path.resolve(__dirname, "../../dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Recommended flags for extension testing
        "--no-first-run",
        "--disable-gpu",
        "--no-default-browser-check",
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Manifest V3 extensions register a service worker. Wait for it so we
    // can extract the extension ID from its URL.
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent("serviceworker");
    }

    // Service worker URL looks like: chrome-extension://<id>/background.js
    const extensionId = background.url().split("/")[2];
    await use(extensionId);
  },
});

export const expect = test.expect;
