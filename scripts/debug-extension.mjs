import { cp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const extensionPath = path.resolve("dist");
const args = process.argv.slice(2);
const chromeUserDataRoot = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome",
);
const bundledUserDataDir = path.resolve(".playwright-chrome-profile");

function getFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

const systemProfileLabel = args.includes("--system-profile-default")
  ? "Default"
  : getFlagValue("--system-profile-name");
const seedProfileLabel = getFlagValue("--seed-from-system-profile-name");

async function loadChromeProfileMap() {
  const localStatePath = path.join(chromeUserDataRoot, "Local State");
  const localState = JSON.parse(await readFile(localStatePath, "utf8"));
  const infoCache = localState.profile?.info_cache ?? {};
  const profileMap = new Map();

  for (const [directoryName, info] of Object.entries(infoCache)) {
    profileMap.set(directoryName, directoryName);

    if (typeof info?.name === "string" && info.name.length > 0) {
      profileMap.set(info.name, directoryName);
    }
  }

  return profileMap;
}

async function resolveChromeProfileDirectory(label) {
  const profileMap = await loadChromeProfileMap();
  return profileMap.get(label) ?? label;
}

async function seedBundledProfileFromChrome(label) {
  const sourceDirectoryName = await resolveChromeProfileDirectory(label);
  const sourceProfileDir = path.join(chromeUserDataRoot, sourceDirectoryName);
  const targetProfileDir = path.join(bundledUserDataDir, "Default");
  const pathsToCopy = [
    "Cookies",
    "Cookies-journal",
    "Local Storage",
    "Session Storage",
    "IndexedDB",
    "SharedStorage",
    "SharedStorage-wal",
    "Storage",
    "Service Worker",
    "WebStorage",
    "Network Persistent State",
    "Preferences",
    "Secure Preferences",
    "Sessions",
    "TransportSecurity",
    "Trust Tokens",
    "Trust Tokens-journal",
  ];

  await rm(targetProfileDir, { recursive: true, force: true });
  await mkdir(targetProfileDir, { recursive: true });

  for (const relativePath of pathsToCopy) {
    const sourcePath = path.join(sourceProfileDir, relativePath);
    const targetPath = path.join(targetProfileDir, relativePath);

    try {
      await cp(sourcePath, targetPath, { recursive: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return sourceDirectoryName;
}

const usingSystemProfile = systemProfileLabel !== null;
const userDataDir = usingSystemProfile ? chromeUserDataRoot : bundledUserDataDir;

if (!usingSystemProfile) {
  await mkdir(userDataDir, { recursive: true });
}

let seededFromProfileDirectory = null;

if (seedProfileLabel) {
  seededFromProfileDirectory = await seedBundledProfileFromChrome(seedProfileLabel);
}

let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(usingSystemProfile
        ? [`--profile-directory=${await resolveChromeProfileDirectory(systemProfileLabel)}`]
        : []),
    ],
  });
} catch (error) {
  if (
    usingSystemProfile &&
    error instanceof Error &&
    error.message.includes("ProcessSingleton")
  ) {
    console.error(
      `[debug-extension] Chrome profile "${systemProfileLabel}" is locked. Quit all normal Chrome windows first, then rerun this command.`,
    );
  }

  throw error;
}

const page = context.pages()[0] ?? (await context.newPage());

page.on("console", (message) => {
  console.log(`[console:${message.type()}] ${message.text()}`);
});

page.on("pageerror", (error) => {
  console.log(`[pageerror] ${error.message}`);
});

await page.goto("https://x.com/", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});

console.log(`[debug-extension] profile: ${userDataDir}`);
if (usingSystemProfile) {
  console.log(`[debug-extension] using Chrome profile: ${systemProfileLabel}`);
}
if (seededFromProfileDirectory) {
  console.log(
    `[debug-extension] seeded bundled profile from Chrome profile directory: ${seededFromProfileDirectory}`,
  );
}
console.log("[debug-extension] Chrome is open with the unpacked extension loaded.");
console.log("[debug-extension] Log in once, then keep using this same profile for debugging.");

await new Promise((resolve) => {
  let closing = false;

  const close = async () => {
    if (closing) {
      return;
    }

    closing = true;
    await context.close();
    resolve();
  };

  process.on("SIGINT", () => {
    void close();
  });

  process.on("SIGTERM", () => {
    void close();
  });
});
