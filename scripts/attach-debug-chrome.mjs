import { chromium } from "playwright";

const keepOpen = process.argv.includes("--keep-open");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const pages = context?.pages() ?? [];
const serviceWorkers = context?.serviceWorkers() ?? [];

console.log(`[attach-debug-chrome] contexts: ${browser.contexts().length}`);
console.log(`[attach-debug-chrome] pages: ${pages.length}`);
console.log(`[attach-debug-chrome] service workers: ${serviceWorkers.length}`);

for (const [index, page] of pages.entries()) {
  console.log(`[attach-debug-chrome] page ${index + 1}: ${page.url()}`);
}

for (const [index, worker] of serviceWorkers.entries()) {
  console.log(`[attach-debug-chrome] worker ${index + 1}: ${worker.url()}`);
}

if (pages.length === 0 && context) {
  const page = await context.newPage();
  await page.goto("https://x.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  console.log(`[attach-debug-chrome] opened: ${page.url()}`);
}

if (keepOpen) {
  console.log("[attach-debug-chrome] attached; press Ctrl+C to disconnect.");

  await new Promise((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
}

await browser.close();
