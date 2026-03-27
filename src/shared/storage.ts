import { DEFAULT_SETTINGS, DEFAULT_STATS } from "./constants";
import type { DetectionStats, ExtensionSettings } from "./types";

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get({
    mode: DEFAULT_SETTINGS.mode,
  });
  return {
    mode: isMode(stored.mode) ? stored.mode : DEFAULT_SETTINGS.mode,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export async function loadStats(): Promise<DetectionStats> {
  const stored = await chrome.storage.local.get({
    stats: DEFAULT_STATS,
  });
  return normalizeStats(stored.stats);
}

export async function saveStats(stats: DetectionStats): Promise<void> {
  await chrome.storage.local.set({
    stats,
  });
}

export async function resetStats(): Promise<void> {
  await saveStats(DEFAULT_STATS);
}

function isMode(value: unknown): value is ExtensionSettings["mode"] {
  return value === "off" || value === "hide" || value === "fade" || value === "debug";
}

function normalizeStats(value: unknown): DetectionStats {
  if (!value || typeof value !== "object") {
    return DEFAULT_STATS;
  }

  const candidate = value as Partial<DetectionStats>;
  return {
    tweetsScanned: readNumber(candidate.tweetsScanned),
    avatarsChecked: readNumber(candidate.avatarsChecked),
    cacheHits: readNumber(candidate.cacheHits),
    postsMatched: readNumber(candidate.postsMatched),
    phashMatches: readNumber(candidate.phashMatches),
    onnxMatches: readNumber(candidate.onnxMatches),
    errors: readNumber(candidate.errors),
    lastMatchAt: typeof candidate.lastMatchAt === "string" ? candidate.lastMatchAt : null,
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
