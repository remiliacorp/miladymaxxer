import {
  CLASSIFIER_MODEL_METADATA_URL,
  CLASSIFIER_MODEL_URL,
  DEFAULT_SETTINGS,
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
import {
  loadCollectedAvatars,
  loadMatchedAccounts,
  loadSettings,
  loadStats,
  saveCollectedAvatars,
  saveMatchedAccounts,
  saveStats,
} from "./shared/storage";
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

const STYLE_ID = "milady-shrinkifier-style";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const NOTIFICATION_SELECTOR = 'article[data-testid="notification"]';
const RESCAN_INTERVAL_MS = 1000;
const cache = new Map<string, Promise<DetectionResult>>();
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
let audioContext: AudioContext | null = null;
const soundsAttached = new WeakSet<HTMLElement>();

// Polyphonic sound system using Web Audio API
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
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
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

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
  // Ascending triumphant chime - like sending a message into the world
  playTone(523.25, 0.15, "sine", 0.07); // C5
  setTimeout(() => playTone(659.25, 0.15, "sine", 0.07), 60); // E5
  setTimeout(() => playTone(783.99, 0.15, "sine", 0.07), 120); // G5
  setTimeout(() => playTone(1046.5, 0.25, "sine", 0.08), 180); // C6 - hold longer
  setTimeout(() => playChord([1318.5, 1568], 0.2, 0.04), 250); // E6 + G6 sparkle
}

function playMessageBlip(): void {
  playTone(880, 0.08, "sine", 0.06); // A5 short blip
  setTimeout(() => playTone(1100, 0.06, "sine", 0.04), 50); // Higher follow-up
}

function attachSoundEvents(tweet: HTMLElement): void {
  if (soundsAttached.has(tweet)) return;
  soundsAttached.add(tweet);

  const isMilady = () => tweet.dataset.miladyShrinkifierEffect === "milady";

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
}

// Attach send sound to Post buttons
function attachPostButtonSound(): void {
  const postButtons = document.querySelectorAll<HTMLElement>(
    '[data-testid="tweetButton"], [data-testid="tweetButtonInline"], [data-testid="dmComposerSendButton"]'
  );

  for (const button of postButtons) {
    if (soundsAttached.has(button)) continue;
    soundsAttached.add(button);

    button.addEventListener("click", () => {
      playSendSound();
    }, { passive: true });
  }
}

// Observe incoming messages in DMs/GCs
let lastMessageCount = 0;

function observeIncomingMessages(): void {
  const conversationContainer = document.querySelector(
    '[data-testid="DmActivityViewport"], [data-testid="DMDrawer"], [aria-label*="Direct message"]'
  );

  if (!conversationContainer) {
    lastMessageCount = 0;
    return;
  }

  const messages = conversationContainer.querySelectorAll(
    '[data-testid="messageEntry"], [data-testid="tweetText"], [data-testid="dmComposerTextInput"]'
  );

  const currentCount = messages.length;

  if (currentCount > lastMessageCount && lastMessageCount > 0 && document.hasFocus()) {
    playMessageBlip();
  }

  lastMessageCount = currentCount;
}

// Replace "What's happening?" placeholder text
function replacePlaceholderText(): void {
  const placeholderElements = document.querySelectorAll<HTMLElement>(
    '[data-testid="tweetTextarea_0_label"], .public-DraftEditorPlaceholder-inner, [data-text="true"]'
  );

  for (const el of placeholderElements) {
    if (el.textContent?.includes("What") || el.textContent?.includes("happening")) {
      el.textContent = "milady";
    }
  }

  const textareas = document.querySelectorAll<HTMLElement>(
    '[placeholder*="What"], [aria-label*="What"]'
  );

  for (const el of textareas) {
    if (el.getAttribute("placeholder")?.includes("What")) {
      el.setAttribute("placeholder", "milady");
    }
    if (el.getAttribute("aria-label")?.includes("What")) {
      el.setAttribute("aria-label", "milady");
    }
  }
}

// Replace X logo with custom milady logo
function replaceXLogo(): void {
  const logoUrl = chrome.runtime.getURL("milady-logo.png");

  const logoLinks = document.querySelectorAll<HTMLElement>(
    'a[href="/home"] svg, [data-testid="xLogo"], [aria-label="X"] svg, h1 a[href="/home"] svg'
  );

  for (const svg of logoLinks) {
    const container = svg.closest("a, div");
    if (!container || container.querySelector(".milady-logo-replacement")) continue;

    svg.style.display = "none";

    const img = document.createElement("img");
    img.src = logoUrl;
    img.className = "milady-logo-replacement";
    img.style.cssText = `
      width: 32px;
      height: 32px;
      object-fit: contain;
      image-rendering: pixelated;
      filter: drop-shadow(0 0 8px rgba(212, 175, 55, 0.4));
    `;

    container.appendChild(img);
  }

  const splashLogo = document.querySelector<SVGElement>('#placeholder > svg');
  if (splashLogo && !document.querySelector(".milady-splash-logo")) {
    const img = document.createElement("img");
    img.src = logoUrl;
    img.className = "milady-splash-logo";
    img.style.cssText = `
      width: 64px;
      height: 64px;
      object-fit: contain;
      image-rendering: pixelated;
    `;
    splashLogo.replaceWith(img);
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
    replacePlaceholderText();
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
  replacePlaceholderText();
  replaceXLogo();
  observeIncomingMessages();
}

async function processVisibleTweets(): Promise<void> {
  const tweets = Array.from(document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  const notifications = Array.from(document.querySelectorAll<HTMLElement>(NOTIFICATION_SELECTOR));
  await Promise.allSettled([
    ...tweets.map((tweet) => processTweet(tweet)),
    ...notifications.map((notification) => processNotificationGroup(notification)),
  ]);
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
      tweet.dataset.miladyShrinkifierState = "miss";
      delete tweet.dataset.miladyShrinkifierDebug;
      applyMode(tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    if (!avatar.currentSrc && !avatar.src) {
      tweet.dataset.miladyShrinkifierState = "miss";
      delete tweet.dataset.miladyShrinkifierDebug;
      applyMode(tweet);
      scheduleDelayedProcessVisibleTweets();
      return;
    }

    const normalizedUrl = normalizeProfileImageUrl(avatar.currentSrc || avatar.src);
    if (revealed.get(tweet) && revealed.get(tweet) !== normalizedUrl) {
      revealed.delete(tweet);
    }

    if (processed.get(tweet) === normalizedUrl && tweet.dataset.miladyShrinkifierState) {
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
      delete tweet.dataset.miladyShrinkifier;
      delete tweet.dataset.miladyShrinkifierState;
      return;
    }

    tweet.dataset.miladyShrinkifierState = "miss";
    tweet.dataset.miladyShrinkifierDebug = "…";
    applyMode(tweet, normalizedUrl);
    incrementStat("tweetsScanned");
    const result = await detectAvatar(avatar, normalizedUrl);
    if (result.debugLabel) {
      tweet.dataset.miladyShrinkifierDebug = result.debugLabel;
    } else {
      delete tweet.dataset.miladyShrinkifierDebug;
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
      tweet.dataset.miladyShrinkifier = result.source ?? "match";
      tweet.dataset.miladyShrinkifierState = "match";
      incrementMatchStats(result);
      if (author) {
        recordMatchedAccount(author.handle, author.displayName);
      }
      applyMode(tweet, normalizedUrl);
      return;
    }

    revealed.delete(tweet);
    clearEffects(tweet);
    delete tweet.dataset.miladyShrinkifier;
    tweet.dataset.miladyShrinkifierState = "miss";
    if (result.debugLabel) {
      tweet.dataset.miladyShrinkifierDebug = result.debugLabel;
    }
    applyMode(tweet, normalizedUrl);
  } catch (error) {
    console.error("Milady post processing failed", error);
    clearEffects(tweet);
    delete tweet.dataset.miladyShrinkifier;
    tweet.dataset.miladyShrinkifierState = "miss";
    tweet.dataset.miladyShrinkifierDebug = "err";
    applyMode(tweet);
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
  return (
    tweet.querySelector<HTMLImageElement>('[data-testid="Tweet-User-Avatar"] img[src*="profile_images"]') ??
    tweet.querySelector<HTMLImageElement>('img[src*="profile_images"]')
  );
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

function applyMode(tweet: HTMLElement, normalizedUrl?: string): void {
  attachSoundEvents(tweet);
  clearVisualState(tweet);
  const isMatch = tweet.dataset.miladyShrinkifierState === "match";

  switch (settings.mode) {
    case "milady":
      // Enhance milady posts, diminish non-milady posts
      clearPlaceholder(tweet);
      tweet.style.display = "";
      if (isMatch) {
        tweet.dataset.miladyShrinkifierEffect = "milady";
        return;
      }
      tweet.dataset.miladyShrinkifierEffect = "diminish";
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
  delete tweet.dataset.miladyShrinkifierDebug;
  clearPlaceholder(tweet);
  tweet.style.display = "";
}

function clearVisualState(tweet: HTMLElement): void {
  delete tweet.dataset.miladyShrinkifierEffect;
}

function applyDebugState(tweet: HTMLElement): void {
  if (tweet.dataset.miladyShrinkifierState === "match") {
    tweet.dataset.miladyShrinkifierEffect = "debug-match";
    return;
  }

  tweet.dataset.miladyShrinkifierEffect = "debug-miss";
}

function applyHiddenState(tweet: HTMLElement): void {
  let placeholder = placeholders.get(tweet);
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.className = "milady-shrinkifier-placeholder";
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
    [data-milady-shrinkifier-effect="diminish"] {
      margin-top: -4px !important;
      margin-bottom: -4px !important;
      padding-top: 8px !important;
      padding-bottom: 8px !important;
      transform: scale(0.98) !important;
      transform-origin: center center !important;
    }

    /* Fade the tweet text and user info */
    [data-milady-shrinkifier-effect="diminish"] [data-testid="tweetText"],
    [data-milady-shrinkifier-effect="diminish"] [data-testid="User-Name"] {
      opacity: 0.5 !important;
    }

    /* Fade images and media */
    [data-milady-shrinkifier-effect="diminish"] [data-testid="tweetPhoto"],
    [data-milady-shrinkifier-effect="diminish"] [data-testid="videoPlayer"],
    [data-milady-shrinkifier-effect="diminish"] [data-testid="card.wrapper"],
    [data-milady-shrinkifier-effect="diminish"] [data-testid="card.layoutLarge.media"],
    [data-milady-shrinkifier-effect="diminish"] [aria-label*="Image"],
    [data-milady-shrinkifier-effect="diminish"] img:not([src*="profile_images"]):not([src*="emoji"]) {
      opacity: 0.5 !important;
      transition: opacity 0.15s ease !important;
    }

    /* Restore full opacity on hover */
    [data-milady-shrinkifier-effect="diminish"] [data-testid="tweetPhoto"]:hover,
    [data-milady-shrinkifier-effect="diminish"] [data-testid="videoPlayer"]:hover,
    [data-milady-shrinkifier-effect="diminish"] [data-testid="card.wrapper"]:hover,
    [data-milady-shrinkifier-effect="diminish"] [data-testid="card.layoutLarge.media"]:hover,
    [data-milady-shrinkifier-effect="diminish"] [aria-label*="Image"]:hover,
    [data-milady-shrinkifier-effect="diminish"] img:not([src*="profile_images"]):not([src*="emoji"]):hover {
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

    /* MILADY effect - gold floating card */
    [data-milady-shrinkifier-effect="milady"] {
      position: relative !important;
      z-index: 1 !important;
      border-radius: 12px !important;
      margin: 8px 8px !important;
      border: 1px solid rgba(212, 175, 55, 0.3) !important;
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.06),
        0 4px 12px rgba(212, 175, 55, 0.1),
        inset 0 1px 0 rgba(255, 215, 0, 0.1) !important;
    }

    /* Connected milady tweets - merge adjacent cards */
    [data-milady-shrinkifier-effect="milady"] + [data-milady-shrinkifier-effect="milady"],
    [data-milady-shrinkifier-effect="milady"] + [data-milady-shrinkifier-effect="diminish"] + [data-milady-shrinkifier-effect="milady"] {
      margin-top: -7px !important;
      border-top-left-radius: 0 !important;
      border-top-right-radius: 0 !important;
      border-top: none !important;
    }

    [data-milady-shrinkifier-effect="milady"]:has(+ [data-milady-shrinkifier-effect="milady"]) {
      border-bottom-left-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      margin-bottom: 0 !important;
    }

    /* Gold metallic sheen overlay */
    [data-milady-shrinkifier-effect="milady"]::before {
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

    /* Shimmer effect overlay */
    [data-milady-shrinkifier-effect="milady"]::after {
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
      z-index: 2 !important;
    }

    /* Light mode - gold sheen */
    html[style*="background-color: rgb(255, 255, 255)"] [data-milady-shrinkifier-effect="milady"]::before,
    body[style*="background-color: rgb(255, 255, 255)"] [data-milady-shrinkifier-effect="milady"]::before {
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
    [data-milady-shrinkifier-effect="milady"] {
      background: linear-gradient(180deg, rgba(255, 252, 240, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
    }

    /* Dark mode fallback - gold glow */
    @media (prefers-color-scheme: dark) {
      [data-milady-shrinkifier-effect="milady"] {
        background: rgba(28, 30, 34, 1) !important;
        border-color: rgba(212, 175, 55, 0.3) !important;
        box-shadow:
          0 0 1px rgba(255, 215, 0, 0.4),
          0 0 10px rgba(212, 175, 55, 0.15),
          0 0 24px rgba(255, 215, 0, 0.08),
          inset 0 1px 0 rgba(255, 215, 0, 0.12) !important;
      }
    }

    /* Twitter Light mode - gold accents */
    html[style*="background-color: rgb(255, 255, 255)"] [data-milady-shrinkifier-effect="milady"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-milady-shrinkifier-effect="milady"] {
      background: linear-gradient(180deg, rgba(255, 251, 235, 1) 0%, rgba(255, 255, 255, 1) 100%) !important;
      border-color: rgba(212, 175, 55, 0.3) !important;
      box-shadow:
        0 2px 4px rgba(184, 134, 11, 0.08),
        0 4px 12px rgba(212, 175, 55, 0.12),
        inset 0 1px 0 rgba(255, 223, 100, 0.3) !important;
    }

    /* Twitter Dim mode (dark blue) - gold glow */
    html[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"],
    body[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"] {
      background: rgba(28, 42, 56, 1) !important;
      border-color: rgba(212, 175, 55, 0.7) !important;
      box-shadow:
        0 0 2px rgba(255, 215, 0, 0.6),
        0 0 12px rgba(212, 175, 55, 0.35),
        0 0 24px rgba(255, 215, 0, 0.15),
        inset 0 1px 0 rgba(255, 215, 0, 0.25) !important;
    }

    /* Twitter Dark mode (black) - gold glow */
    html[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"] {
      background: rgba(20, 22, 26, 1) !important;
      border-color: rgba(212, 175, 55, 0.8) !important;
      box-shadow:
        0 0 2px rgba(255, 215, 0, 0.7),
        0 0 14px rgba(212, 175, 55, 0.4),
        0 0 28px rgba(255, 215, 0, 0.18),
        inset 0 1px 0 rgba(255, 215, 0, 0.3) !important;
    }

    /* Gold metallic sheen - dim mode */
    html[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"]::before,
    body[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(255, 215, 0, 0.12) 0%,
          rgba(212, 175, 55, 0.04) 25%,
          rgba(255, 255, 255, 0) 50%,
          rgba(212, 175, 55, 0.03) 75%,
          rgba(255, 215, 0, 0.1) 100%
        ) !important;
    }

    /* Gold metallic sheen - dark mode */
    html[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"]::before,
    body[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(255, 215, 0, 0.15) 0%,
          rgba(212, 175, 55, 0.05) 25%,
          rgba(255, 255, 255, 0) 50%,
          rgba(212, 175, 55, 0.04) 75%,
          rgba(255, 215, 0, 0.12) 100%
        ) !important;
    }

    /* HDR effect on Milady avatars */
    [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"] img,
    [data-milady-shrinkifier-effect="milady"] img[src*="profile_images"] {
      filter:
        contrast(1.08)
        saturate(1.25)
        brightness(1.05) !important;
      image-rendering: high-quality !important;
    }

    /* Gold glow behind the avatar */
    [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 6px rgba(212, 175, 55, 0.3)) !important;
    }

    /* Stronger gold glow in dark modes */
    @media (prefers-color-scheme: dark) {
      [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"] {
        filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.35)) !important;
      }
    }

    html[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"],
    html[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"],
    body[style*="background-color: rgb(21, 32, 43)"] [data-milady-shrinkifier-effect="milady"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 12px rgba(255, 215, 0, 0.4)) !important;
    }

    [data-milady-shrinkifier-effect="debug-match"] {
      position: relative !important;
    }

    [data-milady-shrinkifier-effect="debug-miss"] {
      position: relative !important;
    }

    [data-milady-shrinkifier-effect="debug-match"]::after,
    [data-milady-shrinkifier-effect="debug-miss"]::after {
      content: "";
      position: absolute;
      inset: 0;
      border: 2px solid transparent;
      border-radius: 0 !important;
      pointer-events: none;
      z-index: 2147483647;
    }

    [data-milady-shrinkifier-effect="debug-match"]::before,
    [data-milady-shrinkifier-effect="debug-miss"]::before {
      content: attr(data-milady-shrinkifier-debug);
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

    [data-milady-shrinkifier-effect="debug-match"]::after {
      border-color: rgba(231, 76, 60, 0.95);
    }

    [data-milady-shrinkifier-effect="debug-miss"]::after {
      border-color: rgba(46, 204, 113, 0.75);
    }

    .milady-shrinkifier-placeholder {
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

    .milady-shrinkifier-placeholder button {
      border: 0;
      padding: 0;
      background: transparent;
      color: rgb(29, 155, 240);
      font: inherit;
      cursor: pointer;
    }

    .milady-shrinkifier-placeholder button:hover {
      text-decoration: underline;
    }
  `;
  document.head.append(style);
}

function observeStorage(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.mode || changes.whitelistHandles)) {
      const nextMode = changes.mode?.newValue;
      settings = {
        mode: isFilterMode(nextMode) ? nextMode : settings.mode,
        whitelistHandles: normalizeWhitelistHandles(
          changes.whitelistHandles?.newValue ?? settings.whitelistHandles,
        ),
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

function recordMatchedAccount(handle: string, displayName: string | null): void {
  if (!matchedAccounts) {
    return;
  }

  const existing = matchedAccounts[handle];
  matchedAccounts[handle] = {
    handle,
    displayName: displayName ?? existing?.displayName ?? null,
    postsMatched: (existing?.postsMatched ?? 0) + 1,
    lastMatchedAt: new Date().toISOString(),
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

function normalizeWhitelistHandles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SETTINGS.whitelistHandles;
  }

  return Array.from(
    new Set(
      value
        .filter((handle): handle is string => typeof handle === "string")
        .map((handle) => normalizeHandle(handle))
        .filter((handle) => handle.length > 0),
    ),
  );
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

    const candidate = entry as Record<string, unknown>;
    const handle = normalizeHandle(
      typeof candidate.handle === "string" && candidate.handle.length > 0 ? candidate.handle : key,
    );
    if (!handle) {
      continue;
    }

    normalized[handle] = {
      handle,
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

    const candidate = entry as Record<string, unknown>;
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
        .map((entry) => normalizeHandles ? normalizeHandle(entry) : entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
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

function normalizeHandle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^\/+/, "").replace(/^@+/, "").toLowerCase();
}

function formatProbabilityDebugLabel(score: number, threshold: number): string {
  return `p${score.toFixed(3)} t${threshold.toFixed(3)}`;
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
    const image = container.querySelector<HTMLImageElement>('img[src*="profile_images"]');
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
