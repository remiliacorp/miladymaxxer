import { DEFAULT_SETTINGS } from "./constants";
import type { ExtensionSettings } from "./types";

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

function isMode(value: unknown): value is ExtensionSettings["mode"] {
  return value === "off" || value === "hide" || value === "scale" || value === "fade";
}
