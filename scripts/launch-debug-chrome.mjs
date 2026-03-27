import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const extensionPath = path.resolve("dist");
const localDebugUserDataDir = path.resolve(".cdp-chrome-profile");
const chromeExecutable =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeUserDataRoot = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome",
);
const remoteDebuggingPort = "9222";

function getFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

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

const systemProfileLabel = getFlagValue("--system-profile-name") ?? "Extension";
const useLocalProfile = args.includes("--local-profile");
const profileDirectory = useLocalProfile
  ? "Default"
  : await resolveChromeProfileDirectory(systemProfileLabel);
const userDataDir = useLocalProfile ? localDebugUserDataDir : chromeUserDataRoot;

const chromeArgs = [
  `--user-data-dir=${userDataDir}`,
  `--profile-directory=${profileDirectory}`,
  `--remote-debugging-port=${remoteDebuggingPort}`,
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  "https://x.com/",
];

const child = spawn(chromeExecutable, chromeArgs, {
  detached: true,
  stdio: "ignore",
});

child.unref();

console.log(
  `[launch-debug-chrome] profile: ${
    useLocalProfile ? "local debug profile" : `${systemProfileLabel} (${profileDirectory})`
  }`,
);
console.log(`[launch-debug-chrome] user data dir: ${userDataDir}`);
console.log(`[launch-debug-chrome] remote debugging: http://127.0.0.1:${remoteDebuggingPort}`);
console.log(
  "[launch-debug-chrome] close all normal Chrome windows first if launch fails due to a profile lock.",
);
