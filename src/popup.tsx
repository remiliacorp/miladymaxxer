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
  { id: "stats", label: "Stats" },
  { id: "filter", label: "Filter" },
  { id: "accounts", label: "Accounts" },
  { id: "dataset", label: "Data" },
];

const MODE_OPTIONS: Array<{ value: FilterMode; label: string; note: string }> = [
  { value: "off", label: "Off", note: "Do nothing. Show everything." },
  { value: "milady", label: "MILADY", note: "Elevate milady. Diminish the rest." },
  { value: "debug", label: "Debug", note: "Show detection markers and scores." },
];

const styles = `
  :root {
    color-scheme: dark;
    --bg-0: #0a0a0c;
    --bg-1: #12111a;
    --bg-2: #1a1820;
    --line: rgba(212, 175, 55, 0.15);
    --line-strong: rgba(212, 175, 55, 0.25);
    --text: #f7f1e8;
    --text-soft: rgba(247, 241, 232, 0.72);
    --text-faint: rgba(247, 241, 232, 0.52);
    --accent: #d4af37;
    --accent-bright: #ffd700;
    --accent-soft: rgba(212, 175, 55, 0.2);
    --good: #d4af37;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    background: var(--bg-0);
    color: var(--text);
    font-family: "Avenir Next", "Segoe UI", sans-serif;
  }

  /* Custom scrollbar - gold metallic */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: rgba(212, 175, 55, 0.05);
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(212, 175, 55, 0.4) 0%, rgba(184, 134, 11, 0.4) 100%);
    border-radius: 4px;
    border: 1px solid rgba(255, 215, 0, 0.2);
  }

  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(212, 175, 55, 0.6) 0%, rgba(184, 134, 11, 0.6) 100%);
  }

  button,
  input {
    font: inherit;
  }

  @keyframes gold-shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .popup {
    position: relative;
    width: 320px;
    height: 460px;
    display: flex;
    flex-direction: column;
    padding: 18px 16px 14px;
    background:
      radial-gradient(200px 150px at top left, rgba(255, 215, 0, 0.08), transparent 60%),
      radial-gradient(180px 180px at bottom right, rgba(212, 175, 55, 0.06), transparent 50%),
      linear-gradient(180deg, var(--bg-1) 0px, var(--bg-0) 320px);
    background-repeat: no-repeat;
    border: 1px solid rgba(212, 175, 55, 0.2);
    box-shadow:
      0 0 1px rgba(255, 215, 0, 0.3),
      0 0 20px rgba(212, 175, 55, 0.1),
      inset 0 1px 0 rgba(255, 215, 0, 0.1);
  }

  .popup::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.5), transparent);
  }

  .header {
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 680;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #ffd700 0%, #d4af37 50%, #b8860b 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-shadow: 0 0 30px rgba(212, 175, 55, 0.3);
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
    background: linear-gradient(90deg, var(--accent), var(--accent-bright));
    box-shadow: 0 0 8px rgba(212, 175, 55, 0.5);
  }

  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-top: 14px;
    scrollbar-width: thin;
    scrollbar-color: rgba(212, 175, 55, 0.4) rgba(212, 175, 55, 0.05);
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

  .panel-actions-bottom {
    display: flex;
    justify-content: flex-end;
    margin-top: auto;
    padding-top: 20px;
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
    position: relative;
    display: block;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border: 1px solid rgba(247, 241, 232, 0.34);
    border-radius: 999px;
    flex: 0 0 18px;
  }

  .mode-dot::after {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: 999px;
    background: transparent;
  }

  .mode-row[data-active="true"] .mode-dot {
    border-color: var(--accent);
    box-shadow: 0 0 8px rgba(212, 175, 55, 0.4);
  }

  .mode-row[data-active="true"] .mode-dot::after {
    background: linear-gradient(135deg, var(--accent-bright), var(--accent));
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

  .account-search {
    width: 100%;
    margin: 0 0 14px;
    border: 1px solid rgba(212, 175, 55, 0.2);
    border-radius: 8px;
    background: rgba(212, 175, 55, 0.05);
    color: var(--text);
    padding: 9px 11px;
    outline: none;
    transition: all 0.15s ease;
  }

  .account-search::placeholder {
    color: var(--text-faint);
  }

  .account-search:focus {
    border-color: rgba(212, 175, 55, 0.5);
    background: rgba(212, 175, 55, 0.08);
    box-shadow: 0 0 12px rgba(212, 175, 55, 0.15);
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
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 8px;
    border: 0;
    border-radius: 8px;
    margin-bottom: 4px;
    background: rgba(212, 175, 55, 0.03);
    border: 1px solid rgba(212, 175, 55, 0.1);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .account-row:hover {
    background: rgba(212, 175, 55, 0.08);
    border-color: rgba(212, 175, 55, 0.25);
    box-shadow: 0 0 12px rgba(212, 175, 55, 0.1);
  }

  .account-row[data-whitelisted="true"] {
    background: rgba(212, 175, 55, 0.06);
    border-color: rgba(212, 175, 55, 0.2);
  }

  .account-row[data-whitelisted="true"] .account-handle,
  .account-row[data-whitelisted="true"] .account-note {
    color: var(--good);
  }

  .account-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid rgba(212, 175, 55, 0.3);
    box-shadow: 0 0 8px rgba(212, 175, 55, 0.2);
    flex-shrink: 0;
  }

  .account-avatar-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(184, 134, 11, 0.2) 100%);
    border: 2px solid rgba(212, 175, 55, 0.3);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--accent);
  }

  .account-info {
    flex: 1;
    min-width: 0;
  }

  .account-handle {
    margin: 0 0 2px;
    font-size: 14px;
    font-weight: 620;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-note {
    margin: 0;
    color: var(--text-faint);
    font-size: 11px;
  }

  .account-link {
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(212, 175, 55, 0.1);
    border: 1px solid rgba(212, 175, 55, 0.2);
    color: var(--accent);
    font-size: 10px;
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .account-link:hover {
    background: rgba(212, 175, 55, 0.2);
    border-color: rgba(212, 175, 55, 0.4);
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
  const [accountSearch, setAccountSearch] = createSignal("");
  const [settings, setSettings] = createSignal(DEFAULT_SETTINGS);
  const [stats, setStats] = createSignal<DetectionStats>(emptyStats());
  const [matchedAccounts, setMatchedAccounts] = createSignal<MatchedAccountMap>({});
  const [collectedAvatars, setCollectedAvatars] = createSignal<CollectedAvatarMap>({});

  const sortedAccounts = createMemo(() => Object.values(matchedAccounts()).sort(compareAccounts));
  const accountSearchTerm = createMemo(() => accountSearch().trim().toLowerCase());
  const matchesAccountSearch = (account: MatchedAccount) => {
    const query = accountSearchTerm();
    if (!query) {
      return true;
    }
    return (
      account.handle.toLowerCase().includes(query) ||
      (account.displayName?.toLowerCase().includes(query) ?? false)
    );
  };
  const whitelistedAccounts = createMemo(() =>
    sortedAccounts().filter(
      (account) => settings().whitelistHandles.includes(account.handle) && matchesAccountSearch(account),
    ),
  );
  const filteredAccounts = createMemo(() =>
    sortedAccounts().filter(
      (account) => !settings().whitelistHandles.includes(account.handle) && matchesAccountSearch(account),
    ),
  );
  const matchRateLabel = createMemo(() => {
    const seen = stats().tweetsScanned;
    if (seen <= 0) {
      return "0%";
    }
    const rate = (stats().postsMatched / seen) * 100;
    return `${rate.toFixed(rate >= 10 ? 1 : 2)}%`;
  });
  const totalAvatarSightings = createMemo(() =>
    Object.values(collectedAvatars()).reduce((total, avatar) => total + avatar.seenCount, 0),
  );
  const lastHitLabel = createMemo(() => {
    const value = stats().lastMatchAt;
    return value ? formatDate(value) : "Never";
  });

  // Get avatar URL for a handle from collected avatars
  const getAvatarUrl = (handle: string): string | null => {
    const avatars = collectedAvatars();
    for (const avatar of Object.values(avatars)) {
      if (avatar.handles.includes(handle.toLowerCase())) {
        return avatar.originalUrl;
      }
    }
    return null;
  };

  // Open Twitter profile in new tab
  const openProfile = (handle: string, event: MouseEvent) => {
    event.stopPropagation();
    window.open(`https://twitter.com/${handle}`, "_blank");
  };

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
          <h1>Miladymaxxer</h1>
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
                <h2 class="panel-title">Mode</h2>
                <p class="section-note">What happens when a match is found.</p>
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
            <dl class="stats-grid">
              <div><dt>Seen</dt><dd>{formatNumber(stats().tweetsScanned)}</dd></div>
              <div><dt>Matched</dt><dd>{formatNumber(stats().postsMatched)}</dd></div>
              <div><dt>Rate</dt><dd>{matchRateLabel()}</dd></div>
              <div><dt>Exempt</dt><dd>{formatNumber(whitelistedAccounts().length)}</dd></div>
              <div><dt>Errors</dt><dd>{formatNumber(stats().errors)}</dd></div>
              <div><dt>Last match</dt><dd>{lastHitLabel()}</dd></div>
            </dl>
            <div class="panel-actions-bottom">
              <button type="button" class="action-button" onClick={() => void handleResetStats()}>
                Reset
              </button>
            </div>
          </section>
        </Show>

        <Show when={tab() === "accounts"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Caught</h2>
                <p class="section-note">Tap to exempt or un-exempt.</p>
              </div>
            </div>
            <input
              class="account-search"
              type="search"
              value={accountSearch()}
              onInput={(event) => setAccountSearch(event.currentTarget.value)}
              placeholder="Search handles"
              spellcheck={false}
            />
            <Show
              when={sortedAccounts().length > 0}
              fallback={<p class="empty">Nothing caught yet.</p>}
            >
              <Show
                when={whitelistedAccounts().length > 0 || filteredAccounts().length > 0}
                fallback={<p class="empty">No matching accounts.</p>}
              >
                <>
                  <Show when={whitelistedAccounts().length > 0}>
                    <div class="account-group">
                      <p class="account-group-title">Exempt</p>
                      <div class="account-list">
                        <For each={whitelistedAccounts()}>
                          {(account) => {
                            const avatarUrl = getAvatarUrl(account.handle);
                            return (
                              <div
                                class="account-row"
                                data-whitelisted="true"
                                title={`@${account.handle} is exempt`}
                              >
                                <Show
                                  when={avatarUrl}
                                  fallback={<div class="account-avatar-placeholder">✦</div>}
                                >
                                  <img
                                    src={avatarUrl!}
                                    alt=""
                                    class="account-avatar"
                                    onClick={(e) => openProfile(account.handle, e)}
                                    style="cursor: pointer"
                                  />
                                </Show>
                                <div class="account-info" onClick={() => void toggleWhitelist(account.handle)} style="cursor: pointer">
                                  <p class="account-handle">@{account.handle}</p>
                                  <p class="account-note">{formatNumber(account.postsMatched)} hits, exempt</p>
                                </div>
                                <a
                                  class="account-link"
                                  href={`https://twitter.com/${account.handle}`}
                                  target="_blank"
                                  rel="noopener"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View
                                </a>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={filteredAccounts().length > 0}>
                    <div class="account-group">
                      <p class="account-group-title">Caught</p>
                      <div class="account-list">
                        <For each={filteredAccounts()}>
                          {(account) => {
                            const avatarUrl = getAvatarUrl(account.handle);
                            return (
                              <div
                                class="account-row"
                                data-whitelisted="false"
                                title={`Exempt @${account.handle}`}
                              >
                                <Show
                                  when={avatarUrl}
                                  fallback={<div class="account-avatar-placeholder">✦</div>}
                                >
                                  <img
                                    src={avatarUrl!}
                                    alt=""
                                    class="account-avatar"
                                    onClick={(e) => openProfile(account.handle, e)}
                                    style="cursor: pointer"
                                  />
                                </Show>
                                <div class="account-info" onClick={() => void toggleWhitelist(account.handle)} style="cursor: pointer">
                                  <p class="account-handle">@{account.handle}</p>
                                  <p class="account-note">{formatNumber(account.postsMatched)} hits</p>
                                </div>
                                <a
                                  class="account-link"
                                  href={`https://twitter.com/${account.handle}`}
                                  target="_blank"
                                  rel="noopener"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View
                                </a>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>
                </>
              </Show>
            </Show>
          </section>
        </Show>

        <Show when={tab() === "dataset"}>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Dataset</h2>
                <p class="section-note">Export avatar data for labeling.</p>
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
  if (value === "milady" || value === "debug" || value === "off") {
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
        candidate.heuristicSource === "onnx" ? candidate.heuristicSource : null,
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
