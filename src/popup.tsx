import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";

import { DEFAULT_SETTINGS } from "./shared/constants";
import {
  loadCollectedAvatars,
  loadMatchedAccounts,
  loadSettings,
  loadStats,
  resetCollectedAvatars,
  resetMatchedAccounts,
  resetStats,
  saveSettings,
} from "./shared/storage";
import type {
  CollectedAvatar,
  CollectedAvatarMap,
  DetectionStats,
  FilterMode,
  MatchedAccount,
  MatchedAccountMap,
} from "./shared/types";

type TabId = "filter" | "stats" | "accounts" | "dataset";

const TAB_LABELS: Array<{ id: TabId; label: string }> = [
  { id: "filter", label: "Config" },
  { id: "stats", label: "Stats" },
  { id: "accounts", label: "Accounts" },
  { id: "dataset", label: "Dataset" },
];

const MODE_OPTIONS: Array<{ value: FilterMode; label: string; note: string }> = [
  { value: "off", label: "Off", note: "Do nothing." },
  { value: "hide", label: "Hide", note: "Collapse matched posts into a reveal row." },
  { value: "fade", label: "Fade", note: "Reduce matched posts to 50% opacity." },
  { value: "debug", label: "Debug", note: "Show borders and detector score badges." },
];

const styles = `
  :root {
    color-scheme: dark;
    --bg-0: #0b0a0f;
    --bg-1: #15121b;
    --bg-2: #1d1924;
    --line: rgba(247, 241, 232, 0.1);
    --line-strong: rgba(247, 241, 232, 0.16);
    --text: #f7f1e8;
    --text-soft: rgba(247, 241, 232, 0.72);
    --text-faint: rgba(247, 241, 232, 0.52);
    --accent: #ff6d4a;
    --accent-soft: rgba(255, 109, 74, 0.16);
    --good: #7fd29d;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    background:
      radial-gradient(circle at top right, rgba(255, 109, 74, 0.18), transparent 34%),
      linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
    color: var(--text);
    font-family: "Avenir Next", "Segoe UI", sans-serif;
  }

  button,
  input {
    font: inherit;
  }

  .popup {
    padding: 18px 16px 14px;
  }

  .header {
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 680;
    letter-spacing: -0.02em;
  }

  .lede,
  .footnote,
  .section-note,
  .empty {
    margin: 0;
    color: var(--text-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 0 0 14px;
    padding-bottom: 1px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    position: relative;
    border: 0;
    background: transparent;
    color: var(--text-soft);
    padding: 0 0 10px;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms ease;
  }

  .tab[data-active="true"] {
    color: var(--text);
  }

  .tab::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: transparent;
  }

  .tab[data-active="true"]::after {
    background: var(--accent);
  }

  .panel {
    min-height: 292px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .panel-title {
    margin: 0 0 4px;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .action-button {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--text-soft);
    cursor: pointer;
  }

  .action-button:disabled {
    color: rgba(247, 241, 232, 0.3);
    cursor: default;
  }

  .mode-list {
    display: grid;
    gap: 0;
  }

  .mode-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 11px 0;
    border: 0;
    border-bottom: 1px solid rgba(247, 241, 232, 0.08);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .mode-dot {
    width: 12px;
    height: 12px;
    margin-top: 4px;
    border: 1px solid rgba(247, 241, 232, 0.34);
    border-radius: 999px;
    flex: 0 0 auto;
  }

  .mode-row[data-active="true"] .mode-dot {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: 0 0 0 3px rgba(255, 109, 74, 0.16);
  }

  .mode-label {
    margin: 0 0 3px;
    font-size: 14px;
    font-weight: 620;
  }

  .mode-note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
    line-height: 1.45;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 16px;
    margin: 0;
  }

  .stats-grid div {
    min-width: 0;
  }

  .stats-grid dt {
    margin: 0 0 3px;
    color: var(--text-faint);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .stats-grid dd {
    margin: 0;
    font-size: 16px;
    font-weight: 640;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-list {
    display: grid;
  }

  .account-group + .account-group {
    margin-top: 16px;
  }

  .account-group-title {
    margin: 0 0 6px;
    color: var(--text-faint);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .account-row {
    display: block;
    width: 100%;
    padding: 10px 0;
    border: 0;
    border-bottom: 1px solid rgba(247, 241, 232, 0.08);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .account-row[data-whitelisted="true"] .account-handle,
  .account-row[data-whitelisted="true"] .account-note {
    color: var(--good);
  }

  .account-handle {
    margin: 0 0 3px;
    font-size: 14px;
    font-weight: 620;
  }

  .account-note {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  .dataset-summary {
    margin-bottom: 14px;
  }

  .footnote {
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
`;

function App() {
  const [tab, setTab] = createSignal<TabId>("stats");
  const [settings, setSettings] = createSignal(DEFAULT_SETTINGS);
  const [stats, setStats] = createSignal<DetectionStats>(emptyStats());
  const [matchedAccounts, setMatchedAccounts] = createSignal<MatchedAccountMap>({});
  const [collectedAvatars, setCollectedAvatars] = createSignal<CollectedAvatarMap>({});

  const sortedAccounts = createMemo(() => Object.values(matchedAccounts()).sort(compareAccounts));
  const whitelistedAccounts = createMemo(() =>
    sortedAccounts().filter((account) => settings().whitelistHandles.includes(account.handle)),
  );
  const filteredAccounts = createMemo(() =>
    sortedAccounts().filter((account) => !settings().whitelistHandles.includes(account.handle)),
  );
  const matchRateLabel = createMemo(() => {
    const checked = stats().avatarsChecked;
    if (checked <= 0) {
      return "0%";
    }
    const rate = (stats().postsMatched / checked) * 100;
    return `${rate.toFixed(rate >= 10 ? 1 : 2)}%`;
  });
  const totalAvatarSightings = createMemo(() =>
    Object.values(collectedAvatars()).reduce((total, avatar) => total + avatar.seenCount, 0),
  );
  const lastHitLabel = createMemo(() => {
    const value = stats().lastMatchAt;
    return value ? formatDate(value) : "Never";
  });

  onMount(async () => {
    const [nextSettings, nextStats, nextMatchedAccounts, nextCollectedAvatars] = await Promise.all([
      loadSettings(),
      loadStats(),
      loadMatchedAccounts(),
      loadCollectedAvatars(),
    ]);
    setSettings(nextSettings);
    setStats(nextStats);
    setMatchedAccounts(nextMatchedAccounts);
    setCollectedAvatars(nextCollectedAvatars);

    const handleStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area === "sync") {
        if (changes.mode) {
          setSettings((current) => ({ ...current, mode: getStoredMode(changes.mode.newValue) }));
        }
        if (changes.whitelistHandles) {
          setSettings((current) => ({
            ...current,
            whitelistHandles: normalizeWhitelistHandles(changes.whitelistHandles.newValue),
          }));
        }
      }

      if (area === "local") {
        if (changes.stats) {
          setStats(normalizeStats(changes.stats.newValue));
        }
        if (changes.matchedAccounts) {
          setMatchedAccounts(normalizeMatchedAccounts(changes.matchedAccounts.newValue));
        }
        if (changes.collectedAvatars) {
          setCollectedAvatars(normalizeCollectedAvatars(changes.collectedAvatars.newValue));
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    onCleanup(() => chrome.storage.onChanged.removeListener(handleStorageChange));
  });

  const setMode = async (mode: FilterMode) => {
    const next = { ...settings(), mode };
    setSettings(next);
    await saveSettings(next);
  };

  const toggleWhitelist = async (handle: string) => {
    const current = settings().whitelistHandles;
    const nextWhitelist = current.includes(handle)
      ? current.filter((entry) => entry !== handle)
      : [...current, handle].sort((left, right) => left.localeCompare(right));
    const next = { ...settings(), whitelistHandles: nextWhitelist };
    setSettings(next);
    await saveSettings(next);
  };

  const handleResetStats = async () => {
    await Promise.all([resetStats(), resetMatchedAccounts()]);
    const [nextStats, nextMatchedAccounts] = await Promise.all([loadStats(), loadMatchedAccounts()]);
    setStats(nextStats);
    setMatchedAccounts(nextMatchedAccounts);
  };

  const handleResetAvatars = async () => {
    await resetCollectedAvatars();
    setCollectedAvatars(await loadCollectedAvatars());
  };

  const handleExportAvatars = () => {
    exportCollectedAvatars(collectedAvatars(), settings().whitelistHandles);
  };

  return (
    <>
      <style>{styles}</style>
      <main class="popup">
        <header class="header">
          <h1>Milady Shrinkifier</h1>
        </header>

        <nav class="tabs" aria-label="Popup sections">
          <For each={TAB_LABELS}>
            {(item) => (
              <button
                type="button"
                class="tab"
                data-active={String(tab() === item.id)}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>

        <Show when={tab() === "filter"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Filter Mode</h2>
                <p class="section-note">Pick how matched posts should render in the feed.</p>
              </div>
            </div>
            <div class="mode-list">
              <For each={MODE_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class="mode-row"
                    data-active={String(settings().mode === option.value)}
                    onClick={() => void setMode(option.value)}
                  >
                    <span class="mode-dot" />
                    <div>
                      <p class="mode-label">{option.label}</p>
                      <p class="mode-note">{option.note}</p>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={tab() === "stats"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Session Stats</h2>
                <p class="section-note">Live counts from the active browsing session.</p>
              </div>
              <div class="actions">
                <button type="button" class="action-button" onClick={() => void handleResetStats()}>
                  Reset
                </button>
              </div>
            </div>
            <dl class="stats-grid">
              <div><dt>Posts matched</dt><dd>{formatNumber(stats().postsMatched)}</dd></div>
              <div><dt>Match rate</dt><dd>{matchRateLabel()}</dd></div>
              <div><dt>Whitelisted</dt><dd>{formatNumber(whitelistedAccounts().length)}</dd></div>
              <div><dt>Errors</dt><dd>{formatNumber(stats().errors)}</dd></div>
              <div><dt>Last hit</dt><dd>{lastHitLabel()}</dd></div>
            </dl>
          </section>
        </Show>

        <Show when={tab() === "accounts"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Matched Accounts</h2>
                <p class="section-note">Click a handle to move it in or out of the whitelist.</p>
              </div>
            </div>
            <Show
              when={sortedAccounts().length > 0}
              fallback={<p class="empty">No matched accounts yet.</p>}
            >
              <>
                <Show when={whitelistedAccounts().length > 0}>
                  <div class="account-group">
                    <p class="account-group-title">Whitelist</p>
                    <div class="account-list">
                      <For each={whitelistedAccounts()}>
                        {(account) => (
                          <button
                            type="button"
                            class="account-row"
                            data-whitelisted="true"
                            onClick={() => void toggleWhitelist(account.handle)}
                            title={`@${account.handle} bypasses the filter`}
                          >
                            <p class="account-handle">@{account.handle}</p>
                            <p class="account-note">{formatNumber(account.postsMatched)} matched posts, bypassed</p>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={filteredAccounts().length > 0}>
                  <div class="account-group">
                    <p class="account-group-title">Detected</p>
                    <div class="account-list">
                      <For each={filteredAccounts()}>
                        {(account) => (
                          <button
                            type="button"
                            class="account-row"
                            data-whitelisted="false"
                            onClick={() => void toggleWhitelist(account.handle)}
                            title={`Click to let @${account.handle} bypass the filter`}
                          >
                            <p class="account-handle">@{account.handle}</p>
                            <p class="account-note">{formatNumber(account.postsMatched)} matched posts</p>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </>
            </Show>
          </section>
        </Show>

        <Show when={tab() === "dataset"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Collected Avatars</h2>
                <p class="section-note">Export normalized avatar URLs and metadata for offline labeling.</p>
              </div>
              <div class="actions">
                <button
                  type="button"
                  class="action-button"
                  onClick={handleExportAvatars}
                  disabled={Object.keys(collectedAvatars()).length === 0}
                >
                  Export
                </button>
                <button
                  type="button"
                  class="action-button"
                  onClick={() => void handleResetAvatars()}
                  disabled={Object.keys(collectedAvatars()).length === 0}
                >
                  Reset
                </button>
              </div>
            </div>
            <div class="dataset-summary">
              <dl class="stats-grid">
                <div><dt>Unique avatars</dt><dd>{formatNumber(Object.keys(collectedAvatars()).length)}</dd></div>
                <div><dt>Total sightings</dt><dd>{formatNumber(totalAvatarSightings())}</dd></div>
              </dl>
            </div>
            <p class="footnote">Collected entries are local-only until you export them.</p>
          </section>
        </Show>
      </main>
    </>
  );
}

render(() => <App />, document.getElementById("app")!);

function getStoredMode(value: unknown): FilterMode {
  if (value === "hide" || value === "fade" || value === "debug" || value === "off") {
    return value;
  }
  return DEFAULT_SETTINGS.mode;
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
    modelMatches: readNumber((candidate as Record<string, unknown>).modelMatches)
      || readNumber((candidate as Record<string, unknown>).onnxMatches),
    errors: readNumber(candidate.errors),
    lastMatchAt: typeof candidate.lastMatchAt === "string" ? candidate.lastMatchAt : null,
  };
}

function normalizeWhitelistHandles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((handle): handle is string => typeof handle === "string")
        .map((handle) => handle.trim().replace(/^@+/, "").toLowerCase())
        .filter((handle) => handle.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeMatchedAccounts(value: unknown): MatchedAccountMap {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: MatchedAccountMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<MatchedAccount>;
    const handle = typeof candidate.handle === "string" && candidate.handle.length > 0
      ? candidate.handle
      : key;
    const normalizedHandle = handle.trim().replace(/^@+/, "").toLowerCase();
    if (!normalizedHandle) {
      continue;
    }
    normalized[normalizedHandle] = {
      handle: normalizedHandle,
      displayName: typeof candidate.displayName === "string" ? candidate.displayName : null,
      postsMatched: readNumber(candidate.postsMatched),
      lastMatchedAt: typeof candidate.lastMatchedAt === "string" ? candidate.lastMatchedAt : null,
    };
  }
  return normalized;
}

function normalizeCollectedAvatars(value: unknown): CollectedAvatarMap {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: CollectedAvatarMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Partial<CollectedAvatar>;
    const normalizedUrl =
      typeof candidate.normalizedUrl === "string" && candidate.normalizedUrl.length > 0
        ? candidate.normalizedUrl
        : key;
    if (!normalizedUrl) {
      continue;
    }

    normalized[normalizedUrl] = {
      normalizedUrl,
      originalUrl:
        typeof candidate.originalUrl === "string" && candidate.originalUrl.length > 0
          ? candidate.originalUrl
          : normalizedUrl,
      handles: normalizeStringArray(candidate.handles, true),
      displayNames: normalizeStringArray(candidate.displayNames, false),
      sourceSurfaces: normalizeStringArray(candidate.sourceSurfaces, false),
      seenCount: readNumber(candidate.seenCount),
      firstSeenAt:
        typeof candidate.firstSeenAt === "string" ? candidate.firstSeenAt : new Date(0).toISOString(),
      lastSeenAt:
        typeof candidate.lastSeenAt === "string" ? candidate.lastSeenAt : new Date(0).toISOString(),
      exampleProfileUrl:
        typeof candidate.exampleProfileUrl === "string" ? candidate.exampleProfileUrl : null,
      exampleNotificationUrl:
        typeof candidate.exampleNotificationUrl === "string" ? candidate.exampleNotificationUrl : null,
      exampleTweetUrl: typeof candidate.exampleTweetUrl === "string" ? candidate.exampleTweetUrl : null,
      heuristicMatch:
        typeof candidate.heuristicMatch === "boolean" ? candidate.heuristicMatch : null,
      heuristicSource:
        candidate.heuristicSource === "phash" || candidate.heuristicSource === "onnx"
          ? candidate.heuristicSource
          : null,
      heuristicScore:
        typeof candidate.heuristicScore === "number" && Number.isFinite(candidate.heuristicScore)
          ? candidate.heuristicScore
          : null,
      heuristicTokenId:
        typeof candidate.heuristicTokenId === "number" && Number.isFinite(candidate.heuristicTokenId)
          ? candidate.heuristicTokenId
          : null,
      whitelisted: candidate.whitelisted === true,
    };
  }

  return normalized;
}

function normalizeStringArray(value: unknown, normalizeHandles: boolean): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeHandles ? entry.trim().replace(/^@+/, "").toLowerCase() : entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
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
    modelMatches: 0,
    errors: 0,
    lastMatchAt: null,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }
  return formatRelativeTime(date);
}

function formatRelativeTime(date: Date): string {
  const deltaMs = date.getTime() - Date.now();
  const absMs = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 60 * 1000 / 60 },
    { unit: "minute", ms: 60 * 1000 },
    { unit: "second", ms: 1000 },
  ];

  for (const { unit, ms } of units) {
    if (absMs >= ms || unit === "second") {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }

  return "just now";
}

function compareAccounts(left: MatchedAccount, right: MatchedAccount): number {
  if (right.postsMatched !== left.postsMatched) {
    return right.postsMatched - left.postsMatched;
  }
  return left.handle.localeCompare(right.handle);
}

function exportCollectedAvatars(collectedAvatars: CollectedAvatarMap, whitelistHandles: string[]): void {
  const avatars = Object.values(collectedAvatars).sort(compareCollectedAvatars);
  if (avatars.length === 0) {
    return;
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    avatarCount: avatars.length,
    totalSightings: avatars.reduce((total, avatar) => total + avatar.seenCount, 0),
    whitelistHandles,
    avatars,
  };

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `milady-shrinkifier-avatars-${timestampForFilename(new Date())}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function compareCollectedAvatars(left: CollectedAvatar, right: CollectedAvatar): number {
  if (right.seenCount !== left.seenCount) {
    return right.seenCount - left.seenCount;
  }
  return left.normalizedUrl.localeCompare(right.normalizedUrl);
}

function timestampForFilename(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}
