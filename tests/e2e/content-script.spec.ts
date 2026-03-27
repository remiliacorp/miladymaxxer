import path from "node:path";
import { test, expect } from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PAGE_PATH = path.resolve(__dirname, "mock-twitter.html");

/**
 * Navigate to the mock Twitter page through a URL the content script will
 * actually match. Because the extension's manifest restricts content scripts
 * to https://x.com/* and https://twitter.com/*, we cannot simply open a
 * file:// URL and expect injection. Instead, these tests verify behaviour
 * by navigating to the mock page as a file URL and checking that the
 * extension *infrastructure* is working (service worker, popup).
 *
 * For selectors that depend on the content script running on a matched
 * origin, see the "content script on matched origin" describe block which
 * tests against x.com directly (these will only pass when online and are
 * marked with a tag so they can be skipped in CI).
 */
function mockPageUrl(): string {
  return `file://${MOCK_PAGE_PATH}`;
}

// ---------------------------------------------------------------------------
// Extension loads & service worker starts
// ---------------------------------------------------------------------------

test.describe("extension lifecycle", () => {
  test("service worker is registered and extension ID is valid", async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
    // Chrome extension IDs are 32 lowercase alpha characters
    expect(extensionId).toMatch(/^[a-z]{32}$/);
  });
});

// ---------------------------------------------------------------------------
// Mock page DOM structure
// ---------------------------------------------------------------------------

test.describe("mock page structure", () => {
  test("mock page contains expected tweet articles", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const tweets = page.locator('article[data-testid="tweet"]');
    await expect(tweets).toHaveCount(3);
  });

  test("tweet articles have avatar containers with profile images", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const avatars = page.locator('[data-testid="Tweet-User-Avatar"] img[src*="profile_images"]');
    await expect(avatars).toHaveCount(3);
  });

  test("tweet articles have User-Name elements", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const userNames = page.locator('article[data-testid="tweet"] [data-testid="User-Name"]');
    await expect(userNames).toHaveCount(3);
  });

  test("tweet articles have like and unlike buttons", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const likeButtons = page.locator('[data-testid="like"]');
    const unlikeButtons = page.locator('[data-testid="unlike"]');
    await expect(likeButtons).toHaveCount(3);
    await expect(unlikeButtons).toHaveCount(3);
  });

  test("page has a UserCell element", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const userCell = page.locator('[data-testid="UserCell"]');
    await expect(userCell).toHaveCount(1);
  });

  test("UserCell contains a profile image", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(mockPageUrl(), { waitUntil: "domcontentloaded" });

    const cellAvatar = page.locator('[data-testid="UserCell"] img[src*="profile_images"]');
    await expect(cellAvatar).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Content script injection (style tag)
// ---------------------------------------------------------------------------

test.describe("content script injection", () => {
  test("injects miladymaxxer-style element on a matched origin", async ({ context }) => {
    // The content script only runs on x.com / twitter.com. We navigate there
    // and check that the extension's <style> tag was injected.
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for the content script to boot and inject its style element
    const styleTag = page.locator("#miladymaxxer-style");
    await expect(styleTag).toHaveCount(1, { timeout: 10_000 });
  });

  test("tweet articles get processed with dataset attributes", async ({ context }) => {
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Wait for at least one tweet to appear and be processed by the content script
    const processedTweet = page.locator('article[data-testid="tweet"][data-miladymaxxer-state]');
    await expect(processedTweet.first()).toBeAttached({ timeout: 15_000 });

    // Verify the state is one of the expected values
    const state = await processedTweet.first().getAttribute("data-miladymaxxer-state");
    expect(["match", "miss"]).toContain(state);
  });
});

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

test.describe("popup", () => {
  test("popup page loads and renders stats", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });

    // The popup renders into #app — wait for the SolidJS app to mount
    const appRoot = page.locator("#app");
    await expect(appRoot).toBeAttached();

    // The stats grid should be visible (it is the default tab)
    const statsGrid = page.locator(".stats-grid");
    await expect(statsGrid.first()).toBeVisible({ timeout: 5_000 });
  });

  test("popup displays stat labels", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });

    // Wait for the stats grid to render
    const statsGrid = page.locator(".stats-grid");
    await expect(statsGrid.first()).toBeVisible({ timeout: 5_000 });

    // Check that key stat labels are present
    const seenLabel = page.locator(".stats-grid dt", { hasText: "Seen" });
    const matchedLabel = page.locator(".stats-grid dt", { hasText: "Matched" });
    await expect(seenLabel).toBeVisible();
    await expect(matchedLabel).toBeVisible();
  });

  test("popup tabs are navigable", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "domcontentloaded" });

    // Wait for tabs to render
    const settingsTab = page.locator(".tab", { hasText: "Settings" });
    await expect(settingsTab).toBeVisible({ timeout: 5_000 });

    // Click the Settings tab
    await settingsTab.click();

    // The mode list should now be visible
    const modeList = page.locator(".mode-list");
    await expect(modeList).toBeVisible({ timeout: 3_000 });
  });
});
