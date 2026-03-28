import { DEFAULT_SETTINGS, DEFAULT_STATS } from "./shared/constants";
import { normalizeProfileImageUrl } from "./shared/image-core";
import {
  loadCollectedAvatars,
  loadMatchedAccounts,
  loadSettings,
  loadStats,
  normalizeCollectedAvatars,
  normalizeHandle,
  normalizeMatchedAccounts,
  normalizeStats,
  normalizeWhitelistHandles,
  saveCollectedAvatars,
  saveMatchedAccounts,
  saveStats,
} from "./shared/storage";
import type {
  CollectedAvatarMap,
  DetectionResult,
  DetectionStats,
  ExtensionSettings,
  MatchedAccountMap,
} from "./shared/types";

import { detectAvatar } from "./detection";
import { applyMode, clearEffects, revealed } from "./effects";
import type { EffectsContext } from "./effects";
import {
  TWEET,
  NOTIFICATION,
  USER_CELL,
  TWEET_USER_AVATAR,
  TWEET_USER_AVATAR_LINK,
  USER_NAME,
  PROFILE_IMAGE,
  QUOTE_TWEET,
  STATUS_LINK,
  NOTIFICATION_AVATAR_CONTAINER,
  PROFILE_USER_NAME,
  PROFILE_AVATAR,
  PROFILE_HEADER_ITEMS,
  PROFILE_CONTAINER_FALLBACK,
  PRIMARY_COLUMN,
  HOME_LINK,
  LOGO_REPLACEMENT_CLASS,
} from "./selectors";
import {
  setSoundSettings,
  attachSoundEvents,
  attachPostButtonSound,
  attachDMSounds,
  attachGlobalMediaHoverSounds,
  observeIncomingMessages,
} from "./sounds";
import { injectStyles } from "./styles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESCAN_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const processed = new WeakMap<HTMLElement, string>();
const processedNotifications = new WeakMap<HTMLElement, string>();

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let scanScheduled = false;
let delayedScanTimer: number | null = null;
let stats: DetectionStats | null = null;
let matchedAccounts: MatchedAccountMap | null = null;
let collectedAvatars: CollectedAvatarMap | null = null;
let localStateWriteScheduled = false;

// ---------------------------------------------------------------------------
// Effects context — wires effects module to our shared state
// ---------------------------------------------------------------------------

function effectsCtx(): EffectsContext {
  return {
    settings,
    processed,
    onTweetVisible: attachSoundEvents,
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void boot();

async function boot(): Promise<void> {
  injectStyles();
  [settings, stats, matchedAccounts, collectedAvatars] = await Promise.all([
    loadSettings(),
    loadStats(),
    loadMatchedAccounts(),
    loadCollectedAvatars(),
  ]);
  setSoundSettings(settings);
  observeStorage();
  let mutationDebounceTimer: number | null = null;
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer !== null) {
      window.clearTimeout(mutationDebounceTimer);
    }
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      scheduleProcessVisibleTweets();
      scheduleDelayedProcessVisibleTweets();
      attachPostButtonSound();
      attachDMSounds();
      attachGlobalMediaHoverSounds();
      replaceXLogo();
      observeIncomingMessages();
    }, 150);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("scroll", scheduleDelayedProcessVisibleTweets, { passive: true });
  window.setInterval(() => {
    scheduleProcessVisibleTweets();
  }, RESCAN_INTERVAL_MS);
  scheduleProcessVisibleTweets();
  scheduleDelayedProcessVisibleTweets();
  attachPostButtonSound();
  attachDMSounds();
  attachGlobalMediaHoverSounds();
  replaceXLogo();
  observeIncomingMessages();
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function scheduleProcessVisibleTweets(): void {
  if (scanScheduled) {
    return;
  }
  scanScheduled = true;
  queueMicrotask(async () => {
    scanScheduled = false;
    await processVisibleTweets();
  });
}

function scheduleDelayedProcessVisibleTweets(): void {
  if (delayedScanTimer !== null) {
    window.clearTimeout(delayedScanTimer);
  }
  delayedScanTimer = window.setTimeout(() => {
    delayedScanTimer = null;
    scheduleProcessVisibleTweets();
  }, 350);
}

async function processVisibleTweets(): Promise<void> {
  const tweets = Array.from(document.querySelectorAll<HTMLElement>(TWEET));
  const notifications = Array.from(document.querySelectorAll<HTMLElement>(NOTIFICATION));
  const userCells = Array.from(document.querySelectorAll<HTMLElement>(USER_CELL));
  await Promise.allSettled([
    ...tweets.map((tweet) => processTweet(tweet)),
    ...notifications.map((notification) => processNotificationGroup(notification)),
    ...userCells.map((cell) => processUserCell(cell)),
    processProfilePage(),
  ]);
}

// ---------------------------------------------------------------------------
// Tweet processing
// ---------------------------------------------------------------------------

async function processTweet(tweet: HTMLElement): Promise<void> {
  try {
    const avatar = findAvatar(tweet);
    const author = findAuthor(tweet);
    if (!avatar) {
      tweet.dataset.miladymaxxerState = "miss";
      delete tweet.dataset.miladymaxxerDebug;
      applyMode(effectsCtx(), tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    if (!avatar.currentSrc && !avatar.src) {
      tweet.dataset.miladymaxxerState = "miss";
      delete tweet.dataset.miladymaxxerDebug;
      applyMode(effectsCtx(), tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    const normalizedUrl = normalizeProfileImageUrl(avatar.currentSrc || avatar.src);
    if (revealed.get(tweet) && revealed.get(tweet) !== normalizedUrl) {
      revealed.delete(tweet);
    }

    if (processed.get(tweet) === normalizedUrl && tweet.dataset.miladymaxxerState) {
      applyMode(effectsCtx(), tweet, normalizedUrl);
      return;
    }

    processed.set(tweet, normalizedUrl);

    if (author && settings.whitelistHandles.includes(author.handle)) {
      recordCollectedAvatar({
        normalizedUrl,
        originalUrl: avatar.currentSrc || avatar.src,
        author,
        whitelisted: true,
        exampleTweetUrl: findTweetUrl(tweet),
        exampleNotificationUrl: null,
        sourceSurface: "tweet",
      });
      revealed.delete(tweet);
      clearEffects(tweet);
      delete tweet.dataset.miladymaxxer;
      delete tweet.dataset.miladymaxxerState;
      return;
    }

    tweet.dataset.miladymaxxerState = "miss";
    tweet.dataset.miladymaxxerDebug = "\u2026";
    applyMode(effectsCtx(), tweet, normalizedUrl);
    incrementStat("tweetsScanned");
    const result = await detectAvatar(avatar, normalizedUrl, {
      onCacheHit: () => incrementStat("cacheHits"),
      onAvatarChecked: () => incrementStat("avatarsChecked"),
      onError: () => incrementStat("errors"),
    });
    if (result.debugLabel) {
      tweet.dataset.miladymaxxerDebug = result.debugLabel;
    } else {
      delete tweet.dataset.miladymaxxerDebug;
    }
    recordCollectedAvatar({
      normalizedUrl,
      originalUrl: avatar.currentSrc || avatar.src,
      author,
      whitelisted: false,
      exampleTweetUrl: findTweetUrl(tweet),
      exampleNotificationUrl: null,
      sourceSurface: "tweet",
      result,
    });
    if (result.matched) {
      tweet.dataset.miladymaxxer = result.source ?? "match";
      tweet.dataset.miladymaxxerState = "match";
      incrementMatchStats(result);
      if (author) {
        recordMatchedAccount(author.handle, author.displayName, result.score);
      }
      applyMode(effectsCtx(), tweet, normalizedUrl);
      return;
    }

    revealed.delete(tweet);
    clearEffects(tweet);
    delete tweet.dataset.miladymaxxer;
    tweet.dataset.miladymaxxerState = "miss";
    if (result.debugLabel) {
      tweet.dataset.miladymaxxerDebug = result.debugLabel;
    }
    applyMode(effectsCtx(), tweet, normalizedUrl);
  } catch (error) {
    console.error("Milady post processing failed", error);
    clearEffects(tweet);
    delete tweet.dataset.miladymaxxer;
    tweet.dataset.miladymaxxerState = "miss";
    tweet.dataset.miladymaxxerDebug = "err";
    applyMode(effectsCtx(), tweet);
  }

  processQuoteTweet(tweet);
}

// ---------------------------------------------------------------------------
// Quote tweets
// ---------------------------------------------------------------------------

const processedQuoteTweets = new WeakMap<HTMLElement, string>();

async function processQuoteTweet(tweet: HTMLElement): Promise<void> {
  const quoteTweet = tweet.querySelector<HTMLElement>(QUOTE_TWEET);
  if (!quoteTweet) return;

  const quoteAvatar = quoteTweet.querySelector<HTMLImageElement>(PROFILE_IMAGE);
  if (!quoteAvatar?.src) {
    quoteTweet.dataset.miladymaxxerQuote = "other";
    return;
  }

  const normalizedUrl = normalizeProfileImageUrl(quoteAvatar.currentSrc || quoteAvatar.src);

  if (processedQuoteTweets.get(quoteTweet) === normalizedUrl) return;
  processedQuoteTweets.set(quoteTweet, normalizedUrl);

  try {
    const result = await detectAvatar(quoteAvatar, normalizedUrl, {
      onCacheHit: () => incrementStat("cacheHits"),
      onAvatarChecked: () => incrementStat("avatarsChecked"),
      onError: () => incrementStat("errors"),
    });
    quoteTweet.dataset.miladymaxxerQuote = result.matched ? "milady" : "other";
  } catch {
    quoteTweet.dataset.miladymaxxerQuote = "other";
  }
}

// ---------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------

async function processProfilePage(): Promise<void> {
  if (settings.mode === "off") return;

  const profileHeader = document.querySelector<HTMLElement>(PROFILE_USER_NAME);
  if (!profileHeader) return;

  const avatar = document.querySelector<HTMLImageElement>(PROFILE_AVATAR);
  if (!avatar?.src) return;

  const normalizedUrl = normalizeProfileImageUrl(avatar.src);

  const userProfileContainer = profileHeader.closest(PROFILE_HEADER_ITEMS)?.parentElement?.parentElement ||
                                profileHeader.closest(PROFILE_CONTAINER_FALLBACK);
  if (!userProfileContainer) return;

  if (processed.get(userProfileContainer as HTMLElement) === normalizedUrl) return;
  processed.set(userProfileContainer as HTMLElement, normalizedUrl);

  try {
    const result = await detectAvatar(avatar, normalizedUrl, {
      onCacheHit: () => incrementStat("cacheHits"),
      onAvatarChecked: () => incrementStat("avatarsChecked"),
      onError: () => incrementStat("errors"),
    });
    const primaryColumn = document.querySelector<HTMLElement>(PRIMARY_COLUMN);
    if (primaryColumn) {
      if (result.matched) {
        primaryColumn.dataset.miladymaxxerProfile = "milady";
      } else {
        delete primaryColumn.dataset.miladymaxxerProfile;
      }
    }
  } catch {
    const primaryColumn = document.querySelector<HTMLElement>(PRIMARY_COLUMN);
    if (primaryColumn) {
      delete primaryColumn.dataset.miladymaxxerProfile;
    }
  }
}

// ---------------------------------------------------------------------------
// User cells
// ---------------------------------------------------------------------------

async function processUserCell(cell: HTMLElement): Promise<void> {
  if (settings.mode === "off") return;

  const avatar = cell.querySelector<HTMLImageElement>(PROFILE_IMAGE);
  if (!avatar?.src) return;

  const normalizedUrl = normalizeProfileImageUrl(avatar.src);

  if (processed.get(cell) === normalizedUrl) return;
  processed.set(cell, normalizedUrl);

  try {
    const result = await detectAvatar(avatar, normalizedUrl, {
      onCacheHit: () => incrementStat("cacheHits"),
      onAvatarChecked: () => incrementStat("avatarsChecked"),
      onError: () => incrementStat("errors"),
    });
    if (result.matched) {
      cell.dataset.miladymaxxerEffect = "milady";
    } else {
      delete cell.dataset.miladymaxxerEffect;
    }
  } catch {
    delete cell.dataset.miladymaxxerEffect;
  }
}

// ---------------------------------------------------------------------------
// Notification groups
// ---------------------------------------------------------------------------

async function processNotificationGroup(notification: HTMLElement): Promise<void> {
  const avatarEntries = collectNotificationAvatarEntries(notification);
  if (avatarEntries.length === 0) return;

  const signature = avatarEntries
    .map((entry) => `${entry.handle}:${entry.normalizedUrl}`)
    .sort()
    .join("|");
  if (processedNotifications.get(notification) === signature) return;
  processedNotifications.set(notification, signature);

  for (const entry of avatarEntries) {
    recordCollectedAvatar({
      normalizedUrl: entry.normalizedUrl,
      originalUrl: entry.originalUrl,
      author: { handle: entry.handle, displayName: null },
      whitelisted: settings.whitelistHandles.includes(entry.handle),
      exampleTweetUrl: null,
      exampleNotificationUrl: window.location.href,
      sourceSurface: "notification-group",
    });
  }
}

// ---------------------------------------------------------------------------
// Logo replacement
// ---------------------------------------------------------------------------

function replaceXLogo(): void {
  try {
    const logoUrl = chrome.runtime.getURL("milady-logo.png");
    const homeLink = document.querySelector<HTMLAnchorElement>(HOME_LINK);
    if (homeLink && !homeLink.querySelector(`.${LOGO_REPLACEMENT_CLASS}`)) {
      Array.from(homeLink.children).forEach(child => {
        (child as HTMLElement).style.display = "none";
      });
      const img = document.createElement("img");
      img.src = logoUrl;
      img.className = LOGO_REPLACEMENT_CLASS;
      img.style.cssText = `
        width: 30px;
        height: 30px;
        object-fit: contain;
        image-rendering: pixelated;
        filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.4));
        border-radius: 6px;
        transform: translate(10px, 10px);
      `;
      homeLink.appendChild(img);
    }
  } catch {
    // Extension context invalidated
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function findAvatar(tweet: HTMLElement): HTMLImageElement | null {
  const avatarContainer = tweet.querySelector<HTMLElement>(TWEET_USER_AVATAR);
  if (avatarContainer) {
    const images = Array.from(avatarContainer.querySelectorAll<HTMLImageElement>(PROFILE_IMAGE));
    if (images.length > 0) {
      // Prefer the image inside an <a> link (the actual avatar, not badge overlays)
      const linked = images.filter(img => img.closest("a"));
      const candidates = linked.length > 0 ? linked : images;
      // Pick the largest by URL dimensions or natural size
      return candidates.reduce((best, img) => {
        const bestSize = getImageSize(best);
        const imgSize = getImageSize(img);
        return imgSize > bestSize ? img : best;
      });
    }
  }
  return tweet.querySelector<HTMLImageElement>(PROFILE_IMAGE);
}

function getImageSize(img: HTMLImageElement): number {
  // Try natural dimensions first
  const natural = (img.naturalWidth || 0) * (img.naturalHeight || 0);
  if (natural > 0) return natural;
  // Try URL size hint (e.g. /profile_images/.../photo_48x48.jpg)
  const urlMatch = img.src.match(/(\d+)x(\d+)/);
  if (urlMatch) return parseInt(urlMatch[1], 10) * parseInt(urlMatch[2], 10);
  // Fall back to rendered size
  return (img.width || 0) * (img.height || 0);
}

function findAuthor(tweet: HTMLElement): { handle: string; displayName: string | null } | null {
  const avatarLink = tweet.querySelector<HTMLAnchorElement>(TWEET_USER_AVATAR_LINK);
  const handle = normalizeHandle(avatarLink?.getAttribute("href"));
  if (!handle) return null;

  const userName = tweet.querySelector<HTMLElement>(USER_NAME);
  return {
    handle,
    displayName: userName ? extractDisplayName(userName) : null,
  };
}

function extractDisplayName(userName: HTMLElement): string | null {
  for (const span of Array.from(userName.querySelectorAll("span"))) {
    const text = span.textContent?.trim();
    if (!text || text.startsWith("@") || text === "\u00b7") continue;
    return text;
  }
  return null;
}

function collectNotificationAvatarEntries(notification: HTMLElement): Array<{
  handle: string;
  normalizedUrl: string;
  originalUrl: string;
}> {
  const results = new Map<string, { handle: string; normalizedUrl: string; originalUrl: string }>();

  for (const container of Array.from(notification.querySelectorAll<HTMLElement>(NOTIFICATION_AVATAR_CONTAINER))) {
    const testId = container.dataset.testid ?? "";
    const handle = normalizeHandle(testId.replace(/^UserAvatar-Container-/, ""));
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(PROFILE_IMAGE));
    const image = images.length > 0
      ? images.reduce((largest, img) => {
          const largestSize = (largest.naturalWidth || largest.width || 0) * (largest.naturalHeight || largest.height || 0);
          const imgSize = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
          return imgSize > largestSize ? img : largest;
        })
      : null;
    const source = image?.currentSrc || image?.src;
    if (!handle || !source) continue;

    const normalizedUrl = normalizeProfileImageUrl(source);
    results.set(`${handle}:${normalizedUrl}`, { handle, normalizedUrl, originalUrl: source });
  }

  return Array.from(results.values());
}

function findTweetUrl(tweet: HTMLElement): string | null {
  const link = tweet.querySelector<HTMLAnchorElement>(STATUS_LINK);
  return toAbsoluteUrl(link?.getAttribute("href"));
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stats & data persistence
// ---------------------------------------------------------------------------

function incrementMatchStats(result: DetectionResult): void {
  incrementStat("postsMatched");
  if (result.source === "onnx") {
    incrementStat("modelMatches");
  }
  if (!stats) return;
  stats.lastMatchAt = new Date().toISOString();
  scheduleLocalStateWrite();
}

function incrementStat(key: keyof Omit<DetectionStats, "lastMatchAt">): void {
  if (!stats) return;
  stats[key] += 1;
  scheduleLocalStateWrite();
}

function recordMatchedAccount(handle: string, displayName: string | null, score: number | null): void {
  if (!matchedAccounts) return;

  const existing = matchedAccounts[handle];
  matchedAccounts[handle] = {
    handle,
    displayName: displayName ?? existing?.displayName ?? null,
    postsMatched: (existing?.postsMatched ?? 0) + 1,
    lastMatchedAt: new Date().toISOString(),
    lastDetectionScore: score ?? existing?.lastDetectionScore ?? null,
  };
  scheduleLocalStateWrite();
}

function recordCollectedAvatar(input: {
  normalizedUrl: string;
  originalUrl: string;
  author: { handle: string; displayName: string | null } | null;
  whitelisted: boolean;
  exampleTweetUrl: string | null;
  exampleNotificationUrl: string | null;
  sourceSurface: string;
  result?: DetectionResult;
}): void {
  if (!collectedAvatars) return;

  const existing = collectedAvatars[input.normalizedUrl];
  const now = new Date().toISOString();
  collectedAvatars[input.normalizedUrl] = {
    normalizedUrl: input.normalizedUrl,
    originalUrl: input.originalUrl || existing?.originalUrl || input.normalizedUrl,
    handles: mergeUniqueStrings(existing?.handles, input.author?.handle ?? null, true),
    displayNames: mergeUniqueStrings(existing?.displayNames, input.author?.displayName ?? null, false),
    sourceSurfaces: mergeUniqueStrings(existing?.sourceSurfaces, input.sourceSurface, false),
    seenCount: (existing?.seenCount ?? 0) + 1,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    exampleProfileUrl:
      existing?.exampleProfileUrl ?? (input.author ? toAbsoluteUrl(`/${input.author.handle}`) : null),
    exampleNotificationUrl: existing?.exampleNotificationUrl ?? input.exampleNotificationUrl,
    exampleTweetUrl: existing?.exampleTweetUrl ?? input.exampleTweetUrl,
    heuristicMatch:
      typeof input.result?.matched === "boolean" ? input.result.matched : existing?.heuristicMatch ?? null,
    heuristicSource: input.result?.source ?? existing?.heuristicSource ?? null,
    heuristicScore:
      typeof input.result?.score === "number" ? input.result.score : existing?.heuristicScore ?? null,
    heuristicTokenId:
      typeof input.result?.tokenId === "number" ? input.result.tokenId : existing?.heuristicTokenId ?? null,
    whitelisted: input.whitelisted || existing?.whitelisted === true,
  };
  scheduleLocalStateWrite();
}

function scheduleLocalStateWrite(): void {
  if (localStateWriteScheduled || !stats || !matchedAccounts || !collectedAvatars) return;
  localStateWriteScheduled = true;
  window.setTimeout(async () => {
    localStateWriteScheduled = false;
    if (!stats || !matchedAccounts || !collectedAvatars) return;
    await Promise.all([
      saveStats(stats),
      saveMatchedAccounts(matchedAccounts),
      saveCollectedAvatars(collectedAvatars),
    ]);
  }, 250);
}

function mergeUniqueStrings(
  existing: string[] | undefined,
  incoming: string | null,
  normalizeHandles: boolean,
): string[] {
  const values = new Set(existing ?? []);
  const normalized = incoming
    ? (normalizeHandles ? normalizeHandle(incoming) : incoming.trim())
    : "";
  if (normalized) {
    values.add(normalized);
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

// ---------------------------------------------------------------------------
// Storage observation
// ---------------------------------------------------------------------------

function isFilterMode(value: unknown): value is ExtensionSettings["mode"] {
  return value === "off" || value === "milady" || value === "debug";
}

function observeStorage(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.mode || changes.whitelistHandles || changes.soundEnabled)) {
      const nextMode = changes.mode?.newValue;
      const nextSoundEnabled = changes.soundEnabled?.newValue;
      settings = {
        mode: isFilterMode(nextMode) ? nextMode : settings.mode,
        whitelistHandles: normalizeWhitelistHandles(
          changes.whitelistHandles?.newValue ?? settings.whitelistHandles,
        ),
        soundEnabled: typeof nextSoundEnabled === "boolean" ? nextSoundEnabled : settings.soundEnabled,
      };
      setSoundSettings(settings);
      scheduleProcessVisibleTweets();
    }

    if (area === "local" && changes.stats) {
      stats = normalizeStats(changes.stats.newValue);
    }

    if (area === "local" && changes.matchedAccounts) {
      matchedAccounts = normalizeMatchedAccounts(changes.matchedAccounts.newValue);
    }

    if (area === "local" && changes.collectedAvatars) {
      collectedAvatars = normalizeCollectedAvatars(changes.collectedAvatars.newValue);
    }
  });
}
