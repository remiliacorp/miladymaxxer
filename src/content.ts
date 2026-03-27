import {
  CLASSIFIER_MODEL_METADATA_URL,
  CLASSIFIER_MODEL_URL,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  LEGACY_MODEL_METADATA_URL,
  LEGACY_MODEL_URL,
} from "./shared/constants";
import {
  loadCorsImage,
  computeBrowserImageFeatures,
} from "./shared/browser-image";
import {
  normalizeProfileImageUrl,
} from "./shared/image-core";
import { parseCount } from "./shared/parse-count";
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
  readNumber,
  saveCollectedAvatars,
  saveMatchedAccounts,
  saveStats,
  uniqueStrings,
} from "./shared/storage";
import { LRUCache } from "./shared/lru-cache";
import type {
  CollectedAvatarMap,
  DetectionStats,
  DetectionResult,
  ExtensionSettings,
  MatchedAccountMap,
  ModelMetadata,
  WorkerRequest,
  WorkerResponse,
} from "./shared/types";

const STYLE_ID = "miladymaxxer-style";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const NOTIFICATION_SELECTOR = 'article[data-testid="notification"]';
const USER_CELL_SELECTOR = '[data-testid="UserCell"], [data-testid="user-cell"]';
const RESCAN_INTERVAL_MS = 5000;
const CACHE_MAX_SIZE = 1000;

const cache = new LRUCache<string, Promise<DetectionResult>>(CACHE_MAX_SIZE);
const processed = new WeakMap<HTMLElement, string>();
const processedNotifications = new WeakMap<HTMLElement, string>();
const placeholders = new WeakMap<HTMLElement, HTMLDivElement>();
const revealed = new WeakMap<HTMLElement, string>();

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let modelMetadataPromise: Promise<ResolvedModel> | null = null;
let workerPromise: Promise<Worker> | null = null;
let pendingWorker = new Map<string, { resolve: (score: number) => void; reject: (error: Error) => void }>();
let scanScheduled = false;
let delayedScanTimer: number | null = null;
let stats: DetectionStats | null = null;
let matchedAccounts: MatchedAccountMap | null = null;
let collectedAvatars: CollectedAvatarMap | null = null;
let localStateWriteScheduled = false;
let miladyLikesThisSession = 0;
const countedLikes = new WeakSet<HTMLElement>();
let audioContext: AudioContext | null = null;
const soundsAttached = new WeakSet<HTMLElement>();

// Polyphonic sound system using Web Audio API
// AudioContext is created lazily on first sound (which is always triggered by user gesture)
function getAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      // Audio not supported
      return null;
    }
  }
  // Resume is safe here because getAudioContext is only called from playTone,
  // which is only called from user-triggered event handlers
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume: number = 0.08,
  attack: number = 0.01,
  decay: number = 0.1,
): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return; // Audio not yet unlocked

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    // ADSR envelope for pleasant sound
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + attack);
    gainNode.gain.linearRampToValueAtTime(volume * 0.7, ctx.currentTime + attack + decay);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Audio not available, fail silently
  }
}

function playChord(frequencies: number[], duration: number, volume: number = 0.05): void {
  for (const freq of frequencies) {
    playTone(freq, duration, "sine", volume);
  }
}

// Sound presets
function playHoverSound(isMilady: boolean): void {
  if (!settings.soundEnabled) return;
  if (isMilady) {
    // Sparkly high chime for milady
    playTone(1200, 0.12, "sine", 0.06);
    setTimeout(() => playTone(1500, 0.1, "sine", 0.04), 30);
  } else {
    // Subtle soft tone for non-milady
    playTone(400, 0.08, "sine", 0.03);
  }
}

function playClickSound(isMilady: boolean): void {
  if (!settings.soundEnabled) return;
  if (isMilady) {
    // Satisfying gold coin / chime sound
    playChord([523.25, 659.25, 783.99], 0.2, 0.05); // C5, E5, G5 major chord
    setTimeout(() => playTone(1046.5, 0.15, "sine", 0.04), 50); // C6 sparkle
  } else {
    // Simple click
    playTone(300, 0.06, "triangle", 0.04);
  }
}

function playSendSound(): void {
  if (!settings.soundEnabled) return;
  // Ascending triumphant chime - like sending a message into the world
  playTone(523.25, 0.15, "sine", 0.07); // C5
  setTimeout(() => playTone(659.25, 0.15, "sine", 0.07), 60); // E5
  setTimeout(() => playTone(783.99, 0.15, "sine", 0.07), 120); // G5
  setTimeout(() => playTone(1046.5, 0.25, "sine", 0.08), 180); // C6 - hold longer
  setTimeout(() => playChord([1318.5, 1568], 0.2, 0.04), 250); // E6 + G6 sparkle
}

function playMessageBlip(): void {
  if (!settings.soundEnabled) return;
  playTone(880, 0.08, "sine", 0.06); // A5 short blip
  setTimeout(() => playTone(1100, 0.06, "sine", 0.04), 50); // Higher follow-up
}

function playMediaHoverSound(isMilady: boolean): void {
  if (!settings.soundEnabled) return;
  if (isMilady) {
    // Soft shimmer for milady media
    playTone(800, 0.1, "sine", 0.04);
    setTimeout(() => playTone(1000, 0.08, "sine", 0.03), 40);
  } else {
    // Very subtle for non-milady
    playTone(300, 0.06, "sine", 0.02);
  }
}

function attachSoundEvents(tweet: HTMLElement): void {
  if (soundsAttached.has(tweet)) return;
  soundsAttached.add(tweet);

  const isMilady = () => tweet.dataset.miladymaxxerEffect === "milady";

  tweet.addEventListener("mouseenter", () => {
    if (settings.mode !== "off") {
      playHoverSound(isMilady());
    }
  }, { passive: true });

  tweet.addEventListener("click", (e) => {
    if (settings.mode !== "off") {
      const target = e.target as HTMLElement;
      // Only play on interactive elements
      if (target.closest("a, button, [role='button'], [data-testid]")) {
        playClickSound(isMilady());
      }
    }
  }, { passive: true });

  // Media hover sounds
  const mediaElements = tweet.querySelectorAll<HTMLElement>(
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="card.wrapper"]'
  );
  for (const media of Array.from(mediaElements)) {
    if (soundsAttached.has(media)) continue;
    soundsAttached.add(media);
    media.addEventListener("mouseenter", () => {
      if (settings.mode !== "off") {
        playMediaHoverSound(isMilady());
      }
    }, { passive: true });
  }
}

// Reaction sound - short sparkle
function playReactionSound(): void {
  if (!settings.soundEnabled) return;
  playTone(1400, 0.08, "sine", 0.05);
  setTimeout(() => playTone(1800, 0.06, "sine", 0.03), 40);
}

function attachPostButtonSound(): void {
  if (settings.mode === "off") return;

  // Regular tweet buttons
  const postButtons = document.querySelectorAll<HTMLElement>(
    '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
  );

  for (const button of Array.from(postButtons)) {
    if (soundsAttached.has(button)) continue;
    soundsAttached.add(button);

    button.addEventListener("click", () => {
      if (settings.mode !== "off") {
        playSendSound();
      }
    }, { passive: true });
  }
}

// Global DM sound handlers - set up once
let dmListenersAttached = false;

function attachDMSounds(): void {
  if (dmListenersAttached) return;
  dmListenersAttached = true;

  // Document-level click handler for all DM interactions
  document.addEventListener("click", (e) => {
    if (settings.mode === "off") return;

    const target = e.target as HTMLElement;

    // Find the button that was clicked (might be the target or an ancestor)
    const button = target.closest("button") as HTMLElement | null;

    // Check for send button
    if (button) {
      const testId = button.getAttribute("data-testid") || "";
      const ariaLabel = button.getAttribute("aria-label") || "";

      if (testId.includes("send") || testId.includes("Send") ||
          ariaLabel.includes("Send") || ariaLabel === "Send") {
        playSendSound();
        return;
      }
    }

    // Check for emoji/reaction in popup layers
    const inLayers = target.closest("#layers");
    if (inLayers && button) {
      const ariaLabel = button.getAttribute("aria-label") || "";
      // Check if aria-label is a single emoji or starts with emoji
      if (/^[\p{Emoji}\u200d]+$/u.test(ariaLabel) ||
          /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(ariaLabel)) {
        playReactionSound();
        return;
      }
    }

    // Check for DM conversation click
    const dmConv = target.closest('[data-testid="conversation"]') ||
                   target.closest('[data-testid="cellInnerDiv"]');
    if (dmConv && window.location.pathname.includes("/messages")) {
      playClickSound(false);
    }
  }, { passive: true, capture: true });

  // Document-level keydown for Enter to send
  document.addEventListener("keydown", (e) => {
    if (settings.mode === "off") return;
    if (e.key !== "Enter" || e.shiftKey) return;

    const target = e.target as HTMLElement;

    // Check if in DM composer
    const inDMPage = window.location.pathname.includes("/messages");
    const isTextbox = target.getAttribute("role") === "textbox" || target.isContentEditable;
    const notTweetComposer = !target.closest('[data-testid="tweetTextarea_0"]');

    if (inDMPage && isTextbox && notTweetComposer) {
      playSendSound();
    }
  }, { passive: true, capture: true });

  // Document-level mouseover for DM hover sounds
  document.addEventListener("mouseover", (e) => {
    if (settings.mode === "off") return;

    const target = e.target as HTMLElement;
    const dmConv = target.closest('[data-testid="conversation"]');

    if (dmConv && !soundsAttached.has(dmConv as HTMLElement)) {
      soundsAttached.add(dmConv as HTMLElement);
      playTone(600, 0.06, "sine", 0.03);
    }
  }, { passive: true });
}


// Observe incoming messages and reactions in DMs/GCs
let lastMessageCount = 0;
let lastReactionCount = 0;

function observeIncomingMessages(): void {
  const conversationContainer = document.querySelector(
    '[data-testid="DmActivityViewport"], [data-testid="DMDrawer"], [data-testid="conversation"], [aria-label*="Direct message"], [aria-label*="Conversation"]'
  );

  if (!conversationContainer) {
    lastMessageCount = 0;
    lastReactionCount = 0;
    return;
  }

  // Count messages
  const messages = conversationContainer.querySelectorAll(
    '[data-testid="messageEntry"], [data-testid="cellInnerDiv"] [dir="auto"]'
  );

  const currentCount = messages.length;

  // Count reactions (emoji reactions on messages)
  const reactions = conversationContainer.querySelectorAll(
    '[data-testid="messageReactions"], [aria-label*="reaction"], [aria-label*="Reaction"]'
  );
  const currentReactionCount = reactions.length;

  // Play sound for new messages
  if (currentCount > lastMessageCount && lastMessageCount > 0 && document.hasFocus()) {
    playMessageBlip();
  }

  // Play sound for new reactions
  if (currentReactionCount > lastReactionCount && lastReactionCount > 0 && document.hasFocus()) {
    playReactionSound();
  }

  lastMessageCount = currentCount;
  lastReactionCount = currentReactionCount;
}

// Replace X logo with custom milady logo
function replaceXLogo(): void {
  try {
    const logoUrl = chrome.runtime.getURL("milady-logo.png");

    // Only target the main home link in the sidebar (h1 contains the logo)
    const homeLink = document.querySelector<HTMLAnchorElement>('h1 a[href="/home"]');

    if (homeLink && !homeLink.querySelector(".milady-logo-replacement")) {
      // Hide all existing children (SVGs, divs, etc.)
      Array.from(homeLink.children).forEach(child => {
        (child as HTMLElement).style.display = "none";
      });

      const img = document.createElement("img");
      img.src = logoUrl;
      img.className = "milady-logo-replacement";
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
    // Extension context invalidated, ignore
  }
}

interface ResolvedModel {
  metadata: ModelMetadata;
  modelUrl: string;
  positiveIndex: number;
  kind: "classifier" | "legacy";
}

void boot();

async function boot(): Promise<void> {
  injectStyles();
  [settings, stats, matchedAccounts, collectedAvatars] = await Promise.all([
    loadSettings(),
    loadStats(),
    loadMatchedAccounts(),
    loadCollectedAvatars(),
  ]);
  observeStorage();
  const observer = new MutationObserver(() => {
    scheduleProcessVisibleTweets();
    scheduleDelayedProcessVisibleTweets();
    attachPostButtonSound();
    attachDMSounds();
    replaceXLogo();
    observeIncomingMessages();
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
  replaceXLogo();
  observeIncomingMessages();
}

async function processVisibleTweets(): Promise<void> {
  const tweets = Array.from(document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  const notifications = Array.from(document.querySelectorAll<HTMLElement>(NOTIFICATION_SELECTOR));
  const userCells = Array.from(document.querySelectorAll<HTMLElement>(USER_CELL_SELECTOR));
  await Promise.allSettled([
    ...tweets.map((tweet) => processTweet(tweet)),
    ...notifications.map((notification) => processNotificationGroup(notification)),
    ...userCells.map((cell) => processUserCell(cell)),
    processProfilePage(),
  ]);
}

// Process profile page header
async function processProfilePage(): Promise<void> {
  if (settings.mode === "off") return;

  // Check if we're on a profile page
  const profileHeader = document.querySelector<HTMLElement>('[data-testid="primaryColumn"] [data-testid="UserName"]');
  if (!profileHeader) return;

  // Find the profile avatar
  const avatar = document.querySelector<HTMLImageElement>('[data-testid="primaryColumn"] a[href*="/photo"] img[src*="profile_images"]');
  if (!avatar?.src) return;

  const normalizedUrl = normalizeProfileImageUrl(avatar.src);

  // Find the user description/bio container
  const userProfileContainer = profileHeader.closest('[data-testid="UserProfileHeader_Items"]')?.parentElement?.parentElement ||
                                profileHeader.closest('[data-testid="primaryColumn"] > div > div');

  if (!userProfileContainer) return;

  // Skip if already processed with same avatar
  if (processed.get(userProfileContainer as HTMLElement) === normalizedUrl) return;
  processed.set(userProfileContainer as HTMLElement, normalizedUrl);

  try {
    const result = await detectAvatar(avatar, normalizedUrl);
    // Only mark primaryColumn - CSS will target the right container inside
    const primaryColumn = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
    if (result.matched) {
      if (primaryColumn) {
        primaryColumn.dataset.miladymaxxerProfile = "milady";
      }
    } else {
      if (primaryColumn) {
        delete primaryColumn.dataset.miladymaxxerProfile;
      }
    }
  } catch {
    const primaryColumn = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
    if (primaryColumn) {
      delete primaryColumn.dataset.miladymaxxerProfile;
    }
  }
}

// Process user cells (Who to follow, search results, etc.)
async function processUserCell(cell: HTMLElement): Promise<void> {
  if (settings.mode === "off") return;

  const avatar = cell.querySelector<HTMLImageElement>('img[src*="profile_images"]');
  if (!avatar?.src) return;

  const normalizedUrl = normalizeProfileImageUrl(avatar.src);

  // Skip if already processed with same avatar
  if (processed.get(cell) === normalizedUrl) return;
  processed.set(cell, normalizedUrl);

  try {
    const result = await detectAvatar(avatar, normalizedUrl);
    if (result.matched) {
      cell.dataset.miladymaxxerEffect = "milady";
    } else {
      delete cell.dataset.miladymaxxerEffect;
    }
  } catch {
    delete cell.dataset.miladymaxxerEffect;
  }
}

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

async function processTweet(tweet: HTMLElement): Promise<void> {
  try {
    const avatar = findAvatar(tweet);
    const author = findAuthor(tweet);
    if (!avatar) {
      tweet.dataset.miladymaxxerState = "miss";
      delete tweet.dataset.miladymaxxerDebug;
      applyMode(tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    if (!avatar.currentSrc && !avatar.src) {
      tweet.dataset.miladymaxxerState = "miss";
      delete tweet.dataset.miladymaxxerDebug;
      applyMode(tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    const normalizedUrl = normalizeProfileImageUrl(avatar.currentSrc || avatar.src);
    if (revealed.get(tweet) && revealed.get(tweet) !== normalizedUrl) {
      revealed.delete(tweet);
    }

    if (processed.get(tweet) === normalizedUrl && tweet.dataset.miladymaxxerState) {
      applyMode(tweet, normalizedUrl);
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
    tweet.dataset.miladymaxxerDebug = "…";
    applyMode(tweet, normalizedUrl);
    incrementStat("tweetsScanned");
    const result = await detectAvatar(avatar, normalizedUrl);
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
      applyMode(tweet, normalizedUrl);
      return;
    }

    revealed.delete(tweet);
    clearEffects(tweet);
    delete tweet.dataset.miladymaxxer;
    tweet.dataset.miladymaxxerState = "miss";
    if (result.debugLabel) {
      tweet.dataset.miladymaxxerDebug = result.debugLabel;
    }
    applyMode(tweet, normalizedUrl);
  } catch (error) {
    console.error("Milady post processing failed", error);
    clearEffects(tweet);
    delete tweet.dataset.miladymaxxer;
    tweet.dataset.miladymaxxerState = "miss";
    tweet.dataset.miladymaxxerDebug = "err";
    applyMode(tweet);
  }

  // Also check for quote tweets - if a milady is quoted, style the quote card gold
  processQuoteTweet(tweet);
}

// Track processed quote tweets to avoid re-processing
const processedQuoteTweets = new WeakMap<HTMLElement, string>();

async function processQuoteTweet(tweet: HTMLElement): Promise<void> {
  const quoteTweet = tweet.querySelector<HTMLElement>('[data-testid="quoteTweet"]');
  if (!quoteTweet) return;

  // Find avatar in the quote tweet
  const quoteAvatar = quoteTweet.querySelector<HTMLImageElement>('img[src*="profile_images"]');
  if (!quoteAvatar?.src) {
    quoteTweet.dataset.miladymaxxerQuote = "other";
    return;
  }

  const normalizedUrl = normalizeProfileImageUrl(quoteAvatar.currentSrc || quoteAvatar.src);

  // Skip if already processed with same avatar
  if (processedQuoteTweets.get(quoteTweet) === normalizedUrl) return;
  processedQuoteTweets.set(quoteTweet, normalizedUrl);

  try {
    const result = await detectAvatar(quoteAvatar, normalizedUrl);
    if (result.matched) {
      quoteTweet.dataset.miladymaxxerQuote = "milady";
    } else {
      quoteTweet.dataset.miladymaxxerQuote = "other";
    }
  } catch {
    quoteTweet.dataset.miladymaxxerQuote = "other";
  }
}

async function processNotificationGroup(notification: HTMLElement): Promise<void> {
  const avatarEntries = collectNotificationAvatarEntries(notification);
  if (avatarEntries.length === 0) {
    return;
  }

  const signature = avatarEntries
    .map((entry) => `${entry.handle}:${entry.normalizedUrl}`)
    .sort()
    .join("|");
  if (processedNotifications.get(notification) === signature) {
    return;
  }
  processedNotifications.set(notification, signature);

  for (const entry of avatarEntries) {
    recordCollectedAvatar({
      normalizedUrl: entry.normalizedUrl,
      originalUrl: entry.originalUrl,
      author: {
        handle: entry.handle,
        displayName: null,
      },
      whitelisted: settings.whitelistHandles.includes(entry.handle),
      exampleTweetUrl: null,
      exampleNotificationUrl: window.location.href,
      sourceSurface: "notification-group",
    });
  }
}

async function detectAvatar(image: HTMLImageElement, normalizedUrl: string): Promise<DetectionResult> {
  const cached = cache.get(normalizedUrl);
  if (cached) {
    incrementStat("cacheHits");
    return cached;
  }

  const task = detectAvatarUncached(image, normalizedUrl);
  cache.set(normalizedUrl, task);
  return task;
}

async function detectAvatarUncached(image: HTMLImageElement, normalizedUrl: string): Promise<DetectionResult> {
  incrementStat("avatarsChecked");
  try {
    const runtimeImage = await loadCorsImage(normalizedUrl);
    const variants = await Promise.all([
      computeBrowserImageFeatures(runtimeImage, "center"),
      computeBrowserImageFeatures(runtimeImage, "top"),
    ]);
    const resolvedModel = await loadModelMetadata();
    const score = await scoreWithOnnx(
      resolvedModel,
      variants.map((entry) => entry.modelTensor),
      variants.map((entry) => entry.legacyFeatures),
      normalizedUrl,
    );
    return {
      matched: score >= resolvedModel.metadata.threshold,
      source: score >= resolvedModel.metadata.threshold ? "onnx" : null,
      score,
      tokenId: null,
      debugLabel: formatProbabilityDebugLabel(score, resolvedModel.metadata.threshold),
    };
  } catch (error) {
    console.error("Milady detection failed", error);
    incrementStat("errors");
    return {
      matched: false,
      source: null,
      score: null,
      tokenId: null,
      debugLabel: "err",
    };
  }
}

function findAvatar(tweet: HTMLElement): HTMLImageElement | null {
  // Look for the main avatar image, excluding small badge images
  const avatarContainer = tweet.querySelector<HTMLElement>('[data-testid="Tweet-User-Avatar"]');
  if (avatarContainer) {
    // Get all profile images and pick the largest one (the actual avatar, not badges)
    const images = Array.from(avatarContainer.querySelectorAll<HTMLImageElement>('img[src*="profile_images"]'));
    if (images.length > 0) {
      // Return the largest image (actual avatar is bigger than badge overlays)
      return images.reduce((largest, img) => {
        const largestSize = (largest.naturalWidth || largest.width || 0) * (largest.naturalHeight || largest.height || 0);
        const imgSize = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
        return imgSize > largestSize ? img : largest;
      });
    }
  }
  // Fallback: find any profile image
  return tweet.querySelector<HTMLImageElement>('img[src*="profile_images"]');
}

function findAuthor(tweet: HTMLElement): { handle: string; displayName: string | null } | null {
  const avatarLink = tweet.querySelector<HTMLAnchorElement>(
    '[data-testid="Tweet-User-Avatar"] a[href^="/"]',
  );
  const handle = normalizeHandle(avatarLink?.getAttribute("href"));
  if (!handle) {
    return null;
  }

  const userName = tweet.querySelector<HTMLElement>('[data-testid="User-Name"]');
  return {
    handle,
    displayName: userName ? extractDisplayName(userName) : null,
  };
}

// Find previous article sibling - only in actual reply threads
function findPreviousArticle(tweet: HTMLElement): HTMLElement | null {
  const container = tweet.closest('[data-testid="cellInnerDiv"]');
  if (!container) return null;

  // Check if this tweet is part of a reply thread by looking for the vertical connector line
  // These lines connect replies to their parent and have specific background colors per theme
  const avatarArea = container.querySelector('[data-testid="Tweet-User-Avatar"]')?.parentElement?.parentElement;
  const hasThreadConnector = avatarArea?.querySelector(
    'div[style*="background-color: rgb(207, 217, 222)"], div[style*="background-color: rgb(56, 68, 77)"], div[style*="background-color: rgb(51, 54, 57)"]'
  );

  if (!hasThreadConnector) return null;

  const prevContainer = container.previousElementSibling;
  if (!prevContainer) return null;

  return prevContainer.querySelector<HTMLElement>('article[data-testid="tweet"]');
}

function applyMode(tweet: HTMLElement, normalizedUrl?: string): void {
  attachSoundEvents(tweet);
  clearVisualState(tweet);
  const isMatch = tweet.dataset.miladymaxxerState === "match";

  switch (settings.mode) {
    case "milady":
      // Enhance milady posts, diminish non-milady posts
      clearPlaceholder(tweet);
      tweet.style.display = "";
      if (isMatch) {
        tweet.dataset.miladymaxxerEffect = "milady";
        // Check if previous tweet is non-milady for gradient effect
        const prevArticle = findPreviousArticle(tweet);
        if (prevArticle?.dataset.miladymaxxerEffect === "diminish") {
          tweet.dataset.miladyFadeIn = "true";
        } else {
          delete tweet.dataset.miladyFadeIn;
        }
        // Check for 0 likes - tint silver to encourage engagement
        if (hasLowLikes(tweet)) {
          tweet.dataset.miladymaxxerNoLikes = "true";
        } else {
          delete tweet.dataset.miladymaxxerNoLikes;
        }
        // Check if user has liked - slightly more gold
        if (hasUserLiked(tweet)) {
          tweet.dataset.miladymaxxerLiked = "true";
          if (!countedLikes.has(tweet)) {
            countedLikes.add(tweet);
            miladyLikesThisSession += 1;
            updateBadge(miladyLikesThisSession);
          }
        } else {
          delete tweet.dataset.miladymaxxerLiked;
        }
        // Check if user follows this milady
        if (doesUserFollow(tweet)) {
          tweet.dataset.miladymaxxerFollowing = "true";
        } else {
          delete tweet.dataset.miladymaxxerFollowing;
        }
        return;
      }
      tweet.dataset.miladymaxxerEffect = "diminish";
      delete tweet.dataset.miladyFadeIn;
      delete tweet.dataset.miladymaxxerNoLikes;
      delete tweet.dataset.miladymaxxerLiked;
      return;
    case "debug":
      clearPlaceholder(tweet);
      applyDebugState(tweet);
      tweet.style.display = "";
      return;
    case "off":
    default:
      clearPlaceholder(tweet);
      tweet.style.display = "";
  }
}

function clearEffects(tweet: HTMLElement): void {
  clearVisualState(tweet);
  delete tweet.dataset.miladymaxxerDebug;
  clearPlaceholder(tweet);
  tweet.style.display = "";
}

function clearVisualState(tweet: HTMLElement): void {
  delete tweet.dataset.miladymaxxerEffect;
  delete tweet.dataset.miladymaxxerNoLikes;
  delete tweet.dataset.miladymaxxerLiked;
  delete tweet.dataset.miladymaxxerFollowing;
}

function hasLowLikes(tweet: HTMLElement): boolean {
  const likeButton = tweet.querySelector<HTMLElement>('[data-testid="like"]');
  if (!likeButton) return false;

  // Check aria-label for like count
  const ariaLabel = likeButton.getAttribute("aria-label") || "";
  if (ariaLabel === "Like" || ariaLabel === "Likes") {
    return true; // No count means 0
  }

  // Try to extract number from aria-label (e.g., "5 Likes")
  const ariaMatch = ariaLabel.match(/^(\d+)\s/);
  if (ariaMatch) {
    const count = parseInt(ariaMatch[1], 10);
    return count < 10;
  }

  // Check for visible text count
  const countSpan = likeButton.querySelector('span[data-testid="app-text-transition-container"]');
  if (!countSpan) return true; // No count element means 0

  const countText = countSpan.textContent?.trim();
  if (!countText) return true;

  // Parse the count (handles "1.2K" etc)
  const count = parseCount(countText);
  return count < 10;
}


function hasUserLiked(tweet: HTMLElement): boolean {
  // If unlike button exists, user has liked this post
  return !!tweet.querySelector<HTMLElement>('[data-testid="unlike"]');
}

function doesUserFollow(tweet: HTMLElement): boolean {
  // Check for unfollow button - if it exists, user definitely follows them
  const unfollowButton = tweet.querySelector<HTMLElement>('[data-testid$="-unfollow"]');
  if (unfollowButton) {
    return true;
  }

  // Check for "Following" in any button aria-label
  const followingButton = tweet.querySelector<HTMLElement>('[aria-label*="Following"]');
  if (followingButton) {
    return true;
  }

  // Check for Follow button with specific aria-label pattern
  const followButton = tweet.querySelector<HTMLElement>('[data-testid$="-follow"]');
  if (followButton) {
    const ariaLabel = followButton.getAttribute("aria-label") || "";
    // "Follow @username" means NOT following
    if (ariaLabel.startsWith("Follow @")) {
      return false;
    }
    // "Following @username" means following
    if (ariaLabel.startsWith("Following")) {
      return true;
    }
  }

  // Check if there's a "Follows you" badge - they follow you but you might not follow back
  const followsYou = tweet.querySelector('[data-testid="userFollowIndicator"]');
  if (followsYou) {
    return false;
  }

  // Default: assume NOT following to show the underline indicator
  return false;
}

function applyDebugState(tweet: HTMLElement): void {
  if (tweet.dataset.miladymaxxerState === "match") {
    tweet.dataset.miladymaxxerEffect = "debug-match";
    return;
  }

  tweet.dataset.miladymaxxerEffect = "debug-miss";
}

function applyHiddenState(tweet: HTMLElement): void {
  let placeholder = placeholders.get(tweet);
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.className = "miladymaxxer-placeholder";
    const label = document.createElement("span");
    label.textContent = "Milady post hidden";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show";
    button.addEventListener("click", () => {
      const normalizedUrl = processed.get(tweet);
      if (normalizedUrl) {
        revealed.set(tweet, normalizedUrl);
      }
      tweet.style.display = "";
      placeholder?.remove();
      placeholders.delete(tweet);
    });
    placeholder.append(label, button);
    placeholders.set(tweet, placeholder);
  }

  if (!placeholder.isConnected) {
    tweet.insertAdjacentElement("beforebegin", placeholder);
  }

  tweet.style.display = "none";
}

function clearPlaceholder(tweet: HTMLElement): void {
  const placeholder = placeholders.get(tweet);
  if (placeholder) {
    placeholder.remove();
    placeholders.delete(tweet);
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Diminish effect - tighter margins, only fade content */
    [data-miladymaxxer-effect="diminish"] {
      margin-top: -4px !important;
      margin-bottom: -4px !important;
      padding-top: 8px !important;
      padding-bottom: 8px !important;
      transform: scale(0.98) !important;
      transform-origin: center center !important;
    }

    /* Fade the tweet text and user info */
    [data-miladymaxxer-effect="diminish"] [data-testid="tweetText"],
    [data-miladymaxxer-effect="diminish"] [data-testid="User-Name"] {
      opacity: 0.9 !important;
    }

    /* Fade images and media - 80% opacity */
    [data-miladymaxxer-effect="diminish"] [data-testid="tweetPhoto"],
    [data-miladymaxxer-effect="diminish"] [data-testid="videoPlayer"],
    [data-miladymaxxer-effect="diminish"] [data-testid="card.wrapper"],
    [data-miladymaxxer-effect="diminish"] [data-testid="card.layoutLarge.media"] {
      opacity: 0.8 !important;
      transition: opacity 0.15s ease !important;
    }

    /* Milady posts - ensure full opacity on all content */
    [data-miladymaxxer-effect="milady"] [data-testid="tweetPhoto"],
    [data-miladymaxxer-effect="milady"] [data-testid="videoPlayer"],
    [data-miladymaxxer-effect="milady"] [data-testid="card.wrapper"],
    [data-miladymaxxer-effect="milady"] [data-testid="card.layoutLarge.media"] {
      opacity: 1 !important;
    }

    /* Restore full opacity on hover */
    [data-miladymaxxer-effect="diminish"] [data-testid="tweetPhoto"]:hover,
    [data-miladymaxxer-effect="diminish"] [data-testid="videoPlayer"]:hover,
    [data-miladymaxxer-effect="diminish"] [data-testid="card.wrapper"]:hover,
    [data-miladymaxxer-effect="diminish"] [data-testid="card.layoutLarge.media"]:hover {
      opacity: 1 !important;
    }

    /* Sparkle animation */
    @keyframes milady-sparkle {
      0%, 100% {
        opacity: 0;
        transform: scale(0) rotate(0deg);
      }
      50% {
        opacity: 1;
        transform: scale(1) rotate(180deg);
      }
    }

    @keyframes milady-shimmer {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }

    /* MILADY effect - gold floating card with depth */
    [data-miladymaxxer-effect="milady"] {
      position: relative !important;
      z-index: 1 !important;
      border-radius: 12px !important;
      margin: 8px 4px !important;
      border: 1px solid rgba(212, 175, 55, 0.4) !important;
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.1),
        0 8px 24px rgba(212, 175, 55, 0.2),
        inset 0 1px 0 rgba(255, 215, 0, 0.15) !important;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }

    /* Connected milady tweets - merge adjacent cards */
    [data-miladymaxxer-effect="milady"] + [data-miladymaxxer-effect="milady"],
    [data-miladymaxxer-effect="milady"] + [data-miladymaxxer-effect="diminish"] + [data-miladymaxxer-effect="milady"] {
      margin-top: -7px !important;
      border-top-left-radius: 0 !important;
      border-top-right-radius: 0 !important;
      border-top: none !important;
    }

    [data-miladymaxxer-effect="milady"]:has(+ [data-miladymaxxer-effect="milady"]) {
      border-bottom-left-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      margin-bottom: 0 !important;
    }


    /* Dotted grey underline on display name for miladys you don't follow */
    [data-miladymaxxer-effect="milady"]:not([data-miladymaxxer-following="true"]) [data-testid="User-Name"] a[role="link"]:first-of-type {
      text-decoration: underline dotted !important;
      text-decoration-color: rgba(140, 140, 140, 0.7) !important;
      text-underline-offset: 2px !important;
      text-decoration-thickness: 1.5px !important;
    }

    /* Faded pink heart and count on milady posts to encourage liking */
    [data-miladymaxxer-effect="milady"] [data-testid="like"] svg {
      color: rgba(249, 24, 128, 0.4) !important;
      transition: color 0.2s ease, transform 0.2s ease !important;
    }

    [data-miladymaxxer-effect="milady"] [data-testid="like"] span {
      color: rgba(249, 24, 128, 0.5) !important;
    }

    [data-miladymaxxer-effect="milady"] [data-testid="like"]:hover svg {
      color: rgba(249, 24, 128, 0.7) !important;
      transform: scale(1.1) !important;
    }

    [data-miladymaxxer-effect="milady"] [data-testid="like"]:hover span {
      color: rgba(249, 24, 128, 0.7) !important;
    }

    /* Hide dislike/downvote button on milady posts */
    [data-miladymaxxer-effect="milady"] [data-testid="downvote"],
    [data-miladymaxxer-effect="milady"] [data-testid="dislike"],
    [data-miladymaxxer-effect="milady"] [aria-label*="Downvote"],
    [data-miladymaxxer-effect="milady"] [aria-label*="downvote"],
    [data-miladymaxxer-effect="milady"] [aria-label*="Dislike"],
    [data-miladymaxxer-effect="milady"] [aria-label*="dislike"] {
      display: none !important;
    }

    /* Silver metallic for milady posts with 0 likes */
    [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"] {
      background: linear-gradient(180deg, rgba(245, 245, 248, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
      border-color: rgba(160, 160, 170, 0.4) !important;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.08),
        0 4px 12px rgba(140, 140, 150, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.8) !important;
    }

    [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(200, 200, 210, 0.2) 0%,
          rgba(230, 230, 235, 0.25) 15%,
          rgba(255, 255, 255, 0) 40%,
          rgba(180, 180, 190, 0.1) 65%,
          rgba(220, 220, 230, 0.2) 85%,
          rgba(192, 192, 200, 0.15) 100%
        ) !important;
    }

    [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::after {
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(220, 220, 230, 0.15) 25%,
        rgba(255, 255, 255, 0.25) 50%,
        rgba(220, 220, 230, 0.15) 75%,
        rgba(255, 255, 255, 0) 100%
      ) !important;
    }

    [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 8px rgba(170, 175, 195, 0.5)) !important;
    }

    /* Light mode - explicit override for silver */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"] {
      background: linear-gradient(180deg, rgba(242, 242, 247, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
      border-color: rgba(160, 160, 170, 0.4) !important;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.06),
        0 4px 12px rgba(140, 140, 150, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
    }

    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::before,
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(180, 180, 195, 0.15) 0%,
          rgba(210, 210, 220, 0.2) 15%,
          rgba(255, 255, 255, 0) 40%,
          rgba(170, 170, 185, 0.08) 65%,
          rgba(200, 200, 215, 0.15) 85%,
          rgba(185, 185, 200, 0.1) 100%
        ) !important;
    }

    /* Dark mode - dark silver card */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"] {
      background: rgb(5, 6, 8) !important;
      border: 1.5px solid rgba(170, 175, 190, 0.3) !important;
      box-shadow:
        0 0 1px rgba(180, 185, 200, 0.4),
        0 0 6px rgba(160, 165, 180, 0.08),
        inset 0 1px 0 rgba(200, 205, 220, 0.06) !important;
    }

    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::before,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(180, 185, 210, 0.04) 0%,
          rgba(160, 165, 190, 0.02) 25%,
          rgba(255, 255, 255, 0) 50%,
          rgba(150, 155, 180, 0.02) 75%,
          rgba(170, 175, 200, 0.03) 100%
        ) !important;
    }

    /* Enhanced gold for posts user has liked - 20% more gold */
    [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"] {
      border-color: rgba(212, 175, 55, 0.5) !important;
      box-shadow:
        0 2px 6px rgba(184, 134, 11, 0.12),
        0 4px 18px rgba(212, 175, 55, 0.2),
        inset 0 1px 0 rgba(255, 215, 0, 0.25) !important;
    }

    [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.22) 0%,
          rgba(255, 223, 100, 0.32) 15%,
          rgba(255, 255, 255, 0) 40%,
          rgba(212, 175, 55, 0.12) 65%,
          rgba(255, 215, 0, 0.28) 85%,
          rgba(184, 134, 11, 0.18) 100%
        ) !important;
    }

    /* Light mode liked - subtly deeper gold (~20% richer than base) */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"] {
      background: linear-gradient(180deg, rgba(255, 247, 215, 1) 0%, rgba(255, 253, 240, 1) 100%) !important;
      border-color: rgba(212, 175, 55, 0.4) !important;
      box-shadow:
        0 2px 4px rgba(184, 134, 11, 0.1),
        0 4px 14px rgba(212, 175, 55, 0.15),
        inset 0 1px 0 rgba(255, 223, 100, 0.35) !important;
    }

    /* Dark mode liked - slightly warmer with gold edge */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"] {
      background: rgb(10, 9, 5) !important;
      border-color: rgba(212, 175, 55, 0.45) !important;
      box-shadow:
        0 0 1px rgba(212, 175, 55, 0.6),
        0 0 8px rgba(212, 175, 55, 0.15),
        inset 0 1px 0 rgba(255, 215, 0, 0.08) !important;
    }

    /* Add spacing between milady user cells */
    [data-miladymaxxer-effect="milady"][data-testid="UserCell"],
    [data-miladymaxxer-effect="milady"][data-testid="user-cell"] {
      margin-bottom: 8px !important;
      padding: 8px !important;
      border-radius: 12px !important;
    }

    /* Silver Follow button for miladys (they don't follow you, plain Follow) */
    /* Exclude: Following/unfollow buttons, Follow back buttons */
    [data-miladymaxxer-effect="milady"] [data-testid$="-follow"]:not([data-testid*="unfollow"]):not([aria-label*="back"]):not([aria-label*="Following"]),
    [data-miladymaxxer-effect="milady"] button[aria-label="Follow"]:not([aria-label*="back"]) {
      background: linear-gradient(135deg, #a8a8a8 0%, #d0d0d0 50%, #a8a8a8 100%) !important;
      background-size: 200% 200% !important;
      border: 1px solid rgba(128, 128, 128, 0.5) !important;
      color: #1a1a1a !important;
      font-weight: 700 !important;
      box-shadow:
        0 2px 6px rgba(100, 100, 100, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
      transition: all 0.2s ease !important;
    }

    /* Gold Follow Back button for miladys (they follow you!) */
    [data-miladymaxxer-effect="milady"] [aria-label*="Follow back"],
    [data-miladymaxxer-effect="milady"] button[aria-label*="Follow back"] {
      background: linear-gradient(135deg, #d4af37 0%, #f0c850 50%, #d4af37 100%) !important;
      background-size: 200% 200% !important;
      animation: milady-shimmer 3s ease-in-out infinite !important;
      border: 1px solid rgba(184, 134, 11, 0.5) !important;
      color: #1a1a1a !important;
      font-weight: 700 !important;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3) !important;
      box-shadow:
        0 2px 8px rgba(212, 175, 55, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.4) !important;
      transition: all 0.2s ease !important;
    }

    [data-miladymaxxer-effect="milady"] [aria-label*="Follow back"]:hover,
    [data-miladymaxxer-effect="milady"] button[aria-label*="Follow back"]:hover {
      transform: scale(1.05) !important;
      box-shadow:
        0 4px 16px rgba(212, 175, 55, 0.6),
        inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
    }

    /* Silver button text */
    [data-miladymaxxer-effect="milady"] [data-testid$="-follow"]:not([data-testid*="unfollow"]):not([aria-label*="back"]) span,
    [data-miladymaxxer-effect="milady"] button[aria-label="Follow"] span {
      color: #1a1a1a !important;
    }

    /* Gold button text */
    [data-miladymaxxer-effect="milady"] [aria-label*="Follow back"] span {
      color: #1a1a1a !important;
    }

    /* ===== PROFILE PAGE STYLING ===== */

    /* Gold rim around milady profile avatar */
    [data-miladymaxxer-profile="milady"] a[href*="/photo"] img[src*="profile_images"] {
      border: 3px solid #d4af37 !important;
      box-shadow: 0 0 12px rgba(212, 175, 55, 0.5) !important;
    }

    /* Profile card - light mode */
    [data-miladymaxxer-profile="milady"] > div > div > div:has(a[href$="/header_photo"]) {
      border: 1px solid rgba(212, 175, 55, 0.3) !important;
      border-radius: 12px !important;
      margin: 8px 4px !important;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.06),
        0 4px 12px rgba(212, 175, 55, 0.1),
        inset 0 1px 0 rgba(255, 215, 0, 0.1) !important;
      overflow: hidden !important;
      background: rgba(255, 252, 240, 1) !important;
    }

    /* Force transparent backgrounds on profile children to prevent white seams */
    [data-miladymaxxer-profile="milady"] [data-testid="UserName"],
    [data-miladymaxxer-profile="milady"] [data-testid="UserDescription"],
    [data-miladymaxxer-profile="milady"] [data-testid="UserProfileHeader_Items"],
    [data-miladymaxxer-profile="milady"] [data-testid="UserName"] *,
    [data-miladymaxxer-profile="milady"] [data-testid="UserDescription"] *,
    [data-miladymaxxer-profile="milady"] [data-testid="UserProfileHeader_Items"] * {
      background: transparent !important;
      background-color: transparent !important;
    }

    /* Dark mode profile card */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-profile="milady"] > div > div > div:has(a[href$="/header_photo"]),
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-profile="milady"] > div > div > div:has(a[href$="/header_photo"]) {
      background: rgb(8, 7, 4) !important;
      border-color: rgba(212, 175, 55, 0.35) !important;
      box-shadow:
        0 0 1px rgba(212, 175, 55, 0.5),
        0 0 6px rgba(212, 175, 55, 0.1),
        inset 0 1px 0 rgba(255, 215, 0, 0.06) !important;
    }

    /* Gold Follow back button on profile pages */
    [data-miladymaxxer-profile="milady"] [aria-label*="Follow back"],
    [data-miladymaxxer-profile="milady"] button[aria-label*="Follow back"] {
      background: linear-gradient(135deg, #d4af37 0%, #f0c850 50%, #d4af37 100%) !important;
      background-size: 200% 200% !important;
      animation: milady-shimmer 3s ease-in-out infinite !important;
      border: 1px solid rgba(184, 134, 11, 0.5) !important;
      color: #1a1a1a !important;
      font-weight: 700 !important;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3) !important;
      box-shadow:
        0 2px 8px rgba(212, 175, 55, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.4) !important;
      transition: all 0.2s ease !important;
    }

    [data-miladymaxxer-profile="milady"] [aria-label*="Follow back"]:hover,
    [data-miladymaxxer-profile="milady"] button[aria-label*="Follow back"]:hover {
      transform: scale(1.05) !important;
      box-shadow:
        0 4px 16px rgba(212, 175, 55, 0.6),
        inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
    }

    [data-miladymaxxer-profile="milady"] [aria-label*="Follow back"] span {
      color: #1a1a1a !important;
    }

    /* Silver Follow button on profile pages (they don't follow you) */
    [data-miladymaxxer-profile="milady"] [data-testid$="-follow"]:not([aria-label*="back"]):not([aria-label*="Following"]),
    [data-miladymaxxer-profile="milady"] button[aria-label="Follow"] {
      background: linear-gradient(135deg, #a8a8a8 0%, #d0d0d0 50%, #a8a8a8 100%) !important;
      background-size: 200% 200% !important;
      border: 1px solid rgba(128, 128, 128, 0.5) !important;
      color: #1a1a1a !important;
      font-weight: 700 !important;
      box-shadow:
        0 2px 6px rgba(100, 100, 100, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
      transition: all 0.2s ease !important;
    }

    [data-miladymaxxer-profile="milady"] [data-testid$="-follow"]:not([aria-label*="back"]):not([aria-label*="Following"]):hover,
    [data-miladymaxxer-profile="milady"] button[aria-label="Follow"]:hover {
      transform: scale(1.05) !important;
      box-shadow:
        0 4px 12px rgba(100, 100, 100, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.6) !important;
    }

    /* "You might like" section - add spacing between user cells */
    [data-miladymaxxer-effect="milady"][data-testid="UserCell"],
    [data-miladymaxxer-effect="milady"][data-testid="user-cell"] {
      margin: 4px 4px 8px 4px !important;
      padding: 8px !important;
      border-radius: 12px !important;
    }

    /* ===== END PROFILE PAGE STYLING ===== */

    /* Milady reply after non-milady - seamless top edge */
    [data-milady-fade-in="true"] {
      border-top: none !important;
      border-top-left-radius: 0 !important;
      border-top-right-radius: 0 !important;
      margin-top: -1px !important;
      /* Fade background from transparent at top to full color at 5% */
      background: linear-gradient(to bottom,
        rgba(255, 252, 240, 0) 0%,
        rgba(255, 252, 240, 1) 5%,
        rgba(255, 255, 255, 1) 100%) !important;
    }

    /* Fade the gold overlays at the top too */
    [data-milady-fade-in="true"]::before,
    [data-milady-fade-in="true"]::after {
      -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 5%) !important;
      mask-image: linear-gradient(to bottom, transparent 0%, black 5%) !important;
    }

    /* Reset styling for quoted tweets inside milady posts - give them opaque background */
    [data-miladymaxxer-effect="milady"] [data-testid="quoteTweet"] {
      background: rgb(247, 249, 249) !important;
      border: 1px solid rgb(207, 217, 222) !important;
      border-radius: 16px !important;
      box-shadow: none !important;
      position: relative !important;
      z-index: 3 !important;
      isolation: isolate !important;
    }

    /* Dark mode quote tweets */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] [data-testid="quoteTweet"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] [data-testid="quoteTweet"] {
      background: rgb(22, 24, 28) !important;
      border-color: rgb(51, 54, 57) !important;
    }

    /* ===== MILADY QUOTE TWEETS - Gold styling when a milady is quoted ===== */
    [data-miladymaxxer-quote="milady"] {
      background: linear-gradient(180deg, rgba(255, 240, 190, 0.95) 0%, rgba(255, 250, 235, 0.95) 100%) !important;
      border: 1.5px solid rgba(212, 175, 55, 0.5) !important;
      border-radius: 16px !important;
      box-shadow:
        0 2px 8px rgba(184, 134, 11, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.6) !important;
      position: relative !important;
      overflow: hidden !important;
    }

    /* Gold sheen on milady quote */
    [data-miladymaxxer-quote="milady"]::before {
      content: "" !important;
      position: absolute !important;
      inset: 0 !important;
      background: linear-gradient(
        135deg,
        rgba(255, 248, 220, 0.4) 0%,
        transparent 50%,
        rgba(255, 248, 220, 0.2) 100%
      ) !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }

    /* Dark mode milady quote tweets */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-quote="milady"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-quote="milady"] {
      background: rgb(8, 7, 4) !important;
      border-color: rgba(212, 175, 55, 0.3) !important;
      box-shadow:
        0 0 1px rgba(212, 175, 55, 0.4),
        0 0 4px rgba(212, 175, 55, 0.08),
        inset 0 1px 0 rgba(212, 175, 55, 0.04) !important;
    }

    /* ===== NON-MILADY QUOTE TWEETS - Neutral styling, no gold ===== */
    [data-miladymaxxer-quote="other"] {
      background: rgb(247, 249, 249) !important;
      border: 1px solid rgb(207, 217, 222) !important;
      border-radius: 16px !important;
      box-shadow: none !important;
      position: relative !important;
      z-index: 3 !important;
      isolation: isolate !important;
    }

    /* Dark mode non-milady quote tweets */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-quote="other"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-quote="other"] {
      background: rgb(22, 24, 28) !important;
      border-color: rgb(51, 54, 57) !important;
    }

    /* Card wrappers inside milady posts */
    [data-miladymaxxer-effect="milady"] [data-testid="card.wrapper"] {
      position: relative !important;
      z-index: 3 !important;
    }

    /* Content sits above the overlays */
    [data-miladymaxxer-effect="milady"] > * {
      position: relative !important;
      z-index: 5 !important;
    }

    /* Gold metallic sheen overlay - behind content */
    [data-miladymaxxer-effect="milady"]::before {
      content: "" !important;
      position: absolute !important;
      inset: 0 !important;
      border-radius: 12px !important;
      background:
        linear-gradient(
          135deg,
          rgba(255, 215, 0, 0.15) 0%,
          rgba(212, 175, 55, 0.05) 20%,
          rgba(255, 255, 255, 0) 45%,
          rgba(212, 175, 55, 0.03) 70%,
          rgba(255, 215, 0, 0.12) 100%
        ) !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }

    /* Shimmer effect overlay - behind content */
    [data-miladymaxxer-effect="milady"]::after {
      content: "" !important;
      position: absolute !important;
      inset: 0 !important;
      border-radius: 12px !important;
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 215, 0, 0.08) 25%,
        rgba(255, 255, 255, 0.15) 50%,
        rgba(255, 215, 0, 0.08) 75%,
        rgba(255, 255, 255, 0) 100%
      ) !important;
      background-size: 200% 100% !important;
      animation: milady-shimmer 6s ease-in-out infinite !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }

    /* Light mode - gold sheen */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"]::before,
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.12) 0%,
          rgba(255, 223, 100, 0.2) 15%,
          rgba(255, 255, 255, 0) 40%,
          rgba(212, 175, 55, 0.05) 65%,
          rgba(255, 215, 0, 0.15) 85%,
          rgba(184, 134, 11, 0.08) 100%
        ) !important;
    }

    /* Light mode - warm gold tint */
    [data-miladymaxxer-effect="milady"] {
      background: linear-gradient(180deg, rgba(255, 252, 240, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
    }

    /* Dark mode fallback - gold glow */
    @media (prefers-color-scheme: dark) {
      [data-miladymaxxer-effect="milady"] {
        background: rgb(8, 7, 4) !important;
        border-color: rgba(212, 175, 55, 0.35) !important;
        box-shadow:
          0 0 1px rgba(212, 175, 55, 0.5),
          0 0 6px rgba(212, 175, 55, 0.1),
          inset 0 1px 0 rgba(255, 215, 0, 0.06) !important;
      }
    }

    /* Twitter Light mode - gold accents */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"] {
      background: linear-gradient(180deg, rgba(255, 251, 235, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
      border-color: rgba(212, 175, 55, 0.3) !important;
      box-shadow:
        0 2px 4px rgba(184, 134, 11, 0.08),
        0 4px 12px rgba(212, 175, 55, 0.12),
        inset 0 1px 0 rgba(255, 223, 100, 0.3) !important;
    }


    /* Twitter Dark mode (black) - dark gold card */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] {
      background: rgb(8, 7, 4) !important;
      border: 1.5px solid rgba(212, 175, 55, 0.35) !important;
      box-shadow:
        0 0 1px rgba(212, 175, 55, 0.5),
        0 0 6px rgba(212, 175, 55, 0.1),
        inset 0 1px 0 rgba(255, 215, 0, 0.06) !important;
    }


    /* Gold metallic sheen - dark mode - very subtle */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::before,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.04) 0%,
          rgba(180, 140, 50, 0.02) 25%,
          rgba(255, 255, 255, 0) 45%,
          rgba(160, 120, 40, 0.02) 70%,
          rgba(212, 175, 55, 0.03) 100%
        ) !important;
    }

    /* Shimmer sweep - dark mode - subtle */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::after,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::after {
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(212, 175, 55, 0.04) 25%,
        rgba(255, 248, 220, 0.06) 50%,
        rgba(212, 175, 55, 0.04) 75%,
        rgba(255, 255, 255, 0) 100%
      ) !important;
    }

    /* HDR effect on Milady avatars */
    [data-miladymaxxer-effect="milady"] [data-testid="Tweet-User-Avatar"] img,
    [data-miladymaxxer-effect="milady"] img[src*="profile_images"] {
      filter:
        contrast(1.08)
        saturate(1.25)
        brightness(1.05) !important;
      image-rendering: high-quality !important;
    }

    /* Gold glow behind the avatar */
    [data-miladymaxxer-effect="milady"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.3)) !important;
    }

    /* Subtle gold glow in dark modes */
    @media (prefers-color-scheme: dark) {
      [data-miladymaxxer-effect="milady"] [data-testid="Tweet-User-Avatar"] {
        filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.2)) !important;
      }
    }

    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] [data-testid="Tweet-User-Avatar"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.2)) !important;
    }

    [data-miladymaxxer-effect="debug-match"] {
      position: relative !important;
    }

    [data-miladymaxxer-effect="debug-miss"] {
      position: relative !important;
    }

    [data-miladymaxxer-effect="debug-match"]::after,
    [data-miladymaxxer-effect="debug-miss"]::after {
      content: "";
      position: absolute;
      inset: 0;
      border: 2px solid transparent;
      border-radius: 0 !important;
      pointer-events: none;
      z-index: 2147483647;
    }

    [data-miladymaxxer-effect="debug-match"]::before,
    [data-miladymaxxer-effect="debug-miss"]::before {
      content: attr(data-miladymaxxer-debug);
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 2147483647;
      padding: 2px 6px;
      background: rgba(15, 20, 25, 0.92);
      color: rgb(255, 255, 255);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
      pointer-events: none;
      border-radius: 0;
    }

    [data-miladymaxxer-effect="debug-match"]::after {
      border-color: rgba(231, 76, 60, 0.95);
    }

    [data-miladymaxxer-effect="debug-miss"]::after {
      border-color: rgba(46, 204, 113, 0.75);
    }

    .miladymaxxer-placeholder {
      display: flex;
      align-items: center;
      gap: 12px;
      box-sizing: border-box;
      min-height: 52px;
      padding: 12px 16px;
      margin: 0;
      border-bottom: 1px solid rgb(239, 243, 244);
      background: rgb(255, 255, 255);
      color: rgb(83, 100, 113);
      font-family: TwitterChirp, -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px;
      font-weight: 400;
      line-height: 20px;
    }

    .miladymaxxer-placeholder button {
      border: 0;
      padding: 0;
      background: transparent;
      color: rgb(29, 155, 240);
      font: inherit;
      cursor: pointer;
    }

    .miladymaxxer-placeholder button:hover {
      text-decoration: underline;
    }
  `;
  document.head.append(style);
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

async function loadModelMetadata(): Promise<ResolvedModel> {
  if (!modelMetadataPromise) {
    modelMetadataPromise = resolveModel(
      CLASSIFIER_MODEL_METADATA_URL,
      CLASSIFIER_MODEL_URL,
      "classifier",
      LEGACY_MODEL_METADATA_URL,
      LEGACY_MODEL_URL,
    );
  }
  return modelMetadataPromise;
}

async function resolveModel(
  preferredMetadataUrl: string,
  preferredModelUrl: string,
  preferredKind: ResolvedModel["kind"],
  fallbackMetadataUrl: string,
  fallbackModelUrl: string,
): Promise<ResolvedModel> {
  const preferredResponse = await fetch(chrome.runtime.getURL(preferredMetadataUrl));
  if (preferredResponse.ok) {
    const metadata = await preferredResponse.json() as ModelMetadata;
    return {
      metadata,
      modelUrl: chrome.runtime.getURL(preferredModelUrl),
      positiveIndex: typeof metadata.positiveIndex === "number" ? metadata.positiveIndex : 1,
      kind: preferredKind,
    };
  }

  const fallbackResponse = await fetch(chrome.runtime.getURL(fallbackMetadataUrl));
  if (!fallbackResponse.ok) {
    throw new Error(
      `Failed to load model metadata: preferred ${preferredResponse.status}, fallback ${fallbackResponse.status}`,
    );
  }

  const metadata = await fallbackResponse.json() as ModelMetadata;
  return {
    metadata,
    modelUrl: chrome.runtime.getURL(fallbackModelUrl),
    positiveIndex: typeof metadata.positiveIndex === "number" ? metadata.positiveIndex : 0,
    kind: "legacy",
  };
}

async function getWorker(resolvedModel: ResolvedModel): Promise<Worker> {
  if (workerPromise) {
    return workerPromise;
  }

  workerPromise = Promise.resolve().then(() => {
    const bootstrapUrl = URL.createObjectURL(
      new Blob([`importScripts(${JSON.stringify(chrome.runtime.getURL("worker.js"))});`], {
        type: "text/javascript",
      }),
    );
    const worker = new Worker(bootstrapUrl);
    URL.revokeObjectURL(bootstrapUrl);
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const pending = pendingWorker.get(event.data.id);
      if (!pending) {
        return;
      }
      pendingWorker.delete(event.data.id);
      if (event.data.error) {
        pending.reject(new Error(event.data.error));
        return;
      }
      if (typeof event.data.score !== "number") {
        pending.reject(new Error("Worker returned no score"));
        return;
      }
      pending.resolve(event.data.score);
    });
    worker.postMessage({
      modelUrl: resolvedModel.modelUrl,
      wasmPath: chrome.runtime.getURL("ort/"),
      positiveIndex: resolvedModel.positiveIndex,
    });
    return worker;
  });

  return workerPromise;
}

async function scoreWithOnnx(
  resolvedModel: ResolvedModel,
  tensors: number[][],
  legacyFeatures: number[][],
  seed: string,
): Promise<number> {
  const worker = await getWorker(resolvedModel);
  const scores = await Promise.all(
    (resolvedModel.kind === "classifier" ? tensors : legacyFeatures).map(
      (input, index) =>
        new Promise<number>((resolve, reject) => {
          const id = `${seed}:${index}:${crypto.randomUUID()}`;
          pendingWorker.set(id, { resolve, reject });
          const payload: WorkerRequest =
            resolvedModel.kind === "classifier"
              ? {
                id,
                tensor: input,
                shape: [1, 3, 128, 128],
              }
              : {
                id,
                features: input,
              };
          worker.postMessage(payload);
        }),
    ),
  );
  return Math.max(...scores);
}

function isFilterMode(value: unknown): value is ExtensionSettings["mode"] {
  return value === "off" || value === "milady" || value === "debug";
}

function incrementMatchStats(result: DetectionResult): void {
  incrementStat("postsMatched");
  if (result.source === "onnx") {
    incrementStat("modelMatches");
  }
  if (!stats) {
    return;
  }
  stats.lastMatchAt = new Date().toISOString();
  scheduleLocalStateWrite();
}

function incrementStat(key: keyof Omit<DetectionStats, "lastMatchAt">): void {
  if (!stats) {
    return;
  }
  stats[key] += 1;
  scheduleLocalStateWrite();
}

function recordMatchedAccount(handle: string, displayName: string | null, score: number | null): void {
  if (!matchedAccounts) {
    return;
  }

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
  if (!collectedAvatars) {
    return;
  }

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
  if (localStateWriteScheduled || !stats || !matchedAccounts || !collectedAvatars) {
    return;
  }
  localStateWriteScheduled = true;
  window.setTimeout(async () => {
    localStateWriteScheduled = false;
    if (!stats || !matchedAccounts || !collectedAvatars) {
      return;
    }
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

function formatProbabilityDebugLabel(score: number, threshold: number): string {
  return `p${score.toFixed(3)} t${threshold.toFixed(3)}`;
}

function updateBadge(count: number): void {
  try {
    chrome.runtime.sendMessage({ type: "badge", count });
  } catch {
    // Service worker may not be available
  }
}

function findTweetUrl(tweet: HTMLElement): string | null {
  const link = tweet.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  return toAbsoluteUrl(link?.getAttribute("href"));
}

function collectNotificationAvatarEntries(notification: HTMLElement): Array<{
  handle: string;
  normalizedUrl: string;
  originalUrl: string;
}> {
  const results = new Map<string, { handle: string; normalizedUrl: string; originalUrl: string }>();

  for (const container of Array.from(notification.querySelectorAll<HTMLElement>('[data-testid^="UserAvatar-Container-"]'))) {
    const testId = container.dataset.testid ?? "";
    const handle = normalizeHandle(testId.replace(/^UserAvatar-Container-/, ""));
    // Get all profile images and pick the largest one (skip badge overlays)
    const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[src*="profile_images"]'));
    const image = images.length > 0
      ? images.reduce((largest, img) => {
          const largestSize = (largest.naturalWidth || largest.width || 0) * (largest.naturalHeight || largest.height || 0);
          const imgSize = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
          return imgSize > largestSize ? img : largest;
        })
      : null;
    const source = image?.currentSrc || image?.src;
    if (!handle || !source) {
      continue;
    }

    const normalizedUrl = normalizeProfileImageUrl(source);
    results.set(`${handle}:${normalizedUrl}`, {
      handle,
      normalizedUrl,
      originalUrl: source,
    });
  }

  return Array.from(results.values());
}

function toAbsoluteUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
}

function extractDisplayName(userName: HTMLElement): string | null {
  for (const span of Array.from(userName.querySelectorAll("span"))) {
    const text = span.textContent?.trim();
    if (!text || text.startsWith("@") || text === "·") {
      continue;
    }
    return text;
  }

  return null;
}
