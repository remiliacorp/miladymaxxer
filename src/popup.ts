import { DEFAULT_SETTINGS } from "./shared/constants";
import { loadSettings, loadStats, resetStats, saveSettings } from "./shared/storage";
import type { DetectionStats, FilterMode } from "./shared/types";

const styles = document.createElement("style");
styles.textContent = `
  :root {
    color-scheme: dark;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  body {
    margin: 0;
    background: linear-gradient(160deg, #120f17 0%, #23122d 100%);
    color: #f5f3ff;
    min-width: 280px;
  }

  .popup {
    padding: 18px 16px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 18px;
  }

  .lede,
  .footnote {
    margin: 0;
    color: #d8d1e8;
    font-size: 13px;
    line-height: 1.5;
  }

  .mode-form {
    display: grid;
    gap: 10px;
    margin: 16px 0;
  }

  .mode-form label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(216, 209, 232, 0.15);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.04);
  }

  .stats {
    margin: 18px 0 14px;
    padding: 14px 12px;
    border: 1px solid rgba(216, 209, 232, 0.15);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
  }

  .stats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  h2 {
    margin: 0;
    font-size: 13px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #d8d1e8;
  }

  #reset-stats {
    border: 0;
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.12);
    color: #f5f3ff;
    font: inherit;
    cursor: pointer;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
    margin: 0;
  }

  .stats-grid div {
    min-width: 0;
  }

  .stats-grid dt {
    color: #b8b1ca;
    font-size: 11px;
    margin: 0 0 3px;
  }

  .stats-grid dd {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;
document.head.append(styles);

void init();

async function init(): Promise<void> {
  const form = document.getElementById("mode-form");
  const resetButton = document.getElementById("reset-stats");
  if (!(form instanceof HTMLFormElement) || !(resetButton instanceof HTMLButtonElement)) {
    return;
  }

  const [settings, stats] = await Promise.all([loadSettings(), loadStats()]);
  setModeSelection(form, settings.mode);
  renderStats(stats);

  form.addEventListener("change", async () => {
    const mode = getSelectedMode(form);
    await saveSettings({
      mode,
    });
  });

  resetButton.addEventListener("click", async () => {
    await resetStats();
    renderStats(await loadStats());
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.stats) {
      return;
    }
    renderStats(normalizeStats(changes.stats.newValue));
  });
}

function getSelectedMode(form: HTMLFormElement): FilterMode {
  const selected = new FormData(form).get("mode");
  if (
    selected === "hide" ||
    selected === "fade" ||
    selected === "debug" ||
    selected === "off"
  ) {
    return selected;
  }
  return DEFAULT_SETTINGS.mode;
}

function setModeSelection(form: HTMLFormElement, mode: FilterMode): void {
  const input = form.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (input) {
    input.checked = true;
  }
}

function renderStats(stats: DetectionStats): void {
  writeStat("tweetsScanned", formatNumber(stats.tweetsScanned));
  writeStat("avatarsChecked", formatNumber(stats.avatarsChecked));
  writeStat("cacheHits", formatNumber(stats.cacheHits));
  writeStat("postsMatched", formatNumber(stats.postsMatched));
  writeStat("phashMatches", formatNumber(stats.phashMatches));
  writeStat("onnxMatches", formatNumber(stats.onnxMatches));
  writeStat("errors", formatNumber(stats.errors));
  writeStat("lastMatchAt", stats.lastMatchAt ? formatDate(stats.lastMatchAt) : "Never");
}

function writeStat(name: keyof DetectionStats, value: string): void {
  const node = document.querySelector<HTMLElement>(`[data-stat="${name}"]`);
  if (node) {
    node.textContent = value;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

function normalizeStats(value: unknown): DetectionStats {
  if (!value || typeof value !== "object") {
    return emptyStats();
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

function emptyStats(): DetectionStats {
  return {
    tweetsScanned: 0,
    avatarsChecked: 0,
    cacheHits: 0,
    postsMatched: 0,
    phashMatches: 0,
    onnxMatches: 0,
    errors: 0,
    lastMatchAt: null,
  };
}
