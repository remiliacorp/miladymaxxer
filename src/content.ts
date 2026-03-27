import {
  COLOR_DISTANCE_THRESHOLD,
  DEFAULT_SETTINGS,
  HASH_MATCH_THRESHOLD,
  HASH_ONNX_THRESHOLD,
  HASH_URL,
  MODEL_METADATA_URL,
  MODEL_URL,
} from "./shared/constants";
import {
  loadCorsImage,
  computeBrowserImageFeatures,
} from "./shared/browser-image";
import {
  colorDistance,
  findBestCandidate,
  normalizeProfileImageUrl,
} from "./shared/image-core";
import { loadSettings } from "./shared/storage";
import type {
  DetectionResult,
  ExtensionSettings,
  HashDatabase,
  ModelMetadata,
  WorkerResponse,
} from "./shared/types";

const STYLE_ID = "milady-shrinkifier-style";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const cache = new Map<string, Promise<DetectionResult>>();
const processed = new WeakMap<HTMLElement, string>();
const placeholders = new WeakMap<HTMLElement, HTMLDivElement>();

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let hashDatabasePromise: Promise<HashDatabase> | null = null;
let modelMetadataPromise: Promise<ModelMetadata> | null = null;
let workerPromise: Promise<Worker> | null = null;
let pendingWorker = new Map<string, (score: number) => void>();
let scanScheduled = false;

void boot();

async function boot(): Promise<void> {
  injectStyles();
  settings = await loadSettings();
  observeStorage();
  const observer = new MutationObserver(() => {
    scheduleProcessVisibleTweets();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  scheduleProcessVisibleTweets();
}

async function processVisibleTweets(): Promise<void> {
  const tweets = Array.from(document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  await Promise.allSettled(tweets.map((tweet) => processTweet(tweet)));
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

async function processTweet(tweet: HTMLElement): Promise<void> {
  const avatar = findAvatar(tweet);
  if (!avatar) {
    clearEffects(tweet);
    return;
  }

  const normalizedUrl = normalizeProfileImageUrl(avatar.currentSrc || avatar.src);
  if (processed.get(tweet) === normalizedUrl) {
    applyMode(tweet);
    return;
  }

  processed.set(tweet, normalizedUrl);
  const result = await detectAvatar(avatar, normalizedUrl);
  if (result.matched) {
    tweet.dataset.miladyShrinkifier = result.source ?? "match";
    applyMode(tweet);
    return;
  }

  clearEffects(tweet);
  delete tweet.dataset.miladyShrinkifier;
}

async function detectAvatar(image: HTMLImageElement, normalizedUrl: string): Promise<DetectionResult> {
  const cached = cache.get(normalizedUrl);
  if (cached) {
    return cached;
  }

  const task = detectAvatarUncached(image, normalizedUrl);
  cache.set(normalizedUrl, task);
  return task;
}

async function detectAvatarUncached(image: HTMLImageElement, normalizedUrl: string): Promise<DetectionResult> {
  const database = await loadHashDatabase();
  const runtimeImage = await loadCorsImage(normalizedUrl);
  const features = await computeBrowserImageFeatures(runtimeImage);
  const candidate = findBestCandidate(features.hash, features.averageColor, database.hashes);
  const distance = candidate.distance;
  const averageColorDistance = colorDistance(features.averageColor, candidate.entry.averageColor);

  if (distance <= HASH_MATCH_THRESHOLD && averageColorDistance <= COLOR_DISTANCE_THRESHOLD) {
    return {
      matched: true,
      source: "phash",
      score: distance,
      tokenId: candidate.entry.tokenId,
    };
  }

  if (distance > HASH_ONNX_THRESHOLD) {
    return {
      matched: false,
      source: null,
      score: distance,
      tokenId: null,
    };
  }

  const score = await scoreWithOnnx(features.modelFeatures, normalizedUrl);
  const metadata = await loadModelMetadata();
  return {
    matched: score >= metadata.threshold,
    source: score >= metadata.threshold ? "onnx" : null,
    score,
    tokenId: score >= metadata.threshold ? candidate.entry.tokenId : null,
  };
}

function findAvatar(tweet: HTMLElement): HTMLImageElement | null {
  return tweet.querySelector<HTMLImageElement>('img[src*="profile_images"]');
}

function applyMode(tweet: HTMLElement): void {
  clearVisualClasses(tweet);

  switch (settings.mode) {
    case "hide":
      applyHiddenState(tweet);
      return;
    case "scale":
      clearPlaceholder(tweet);
      tweet.classList.add("milady-shrinkifier-scale");
      tweet.style.display = "";
      return;
    case "fade":
      clearPlaceholder(tweet);
      tweet.classList.add("milady-shrinkifier-fade");
      tweet.style.display = "";
      return;
    case "off":
    default:
      clearPlaceholder(tweet);
      tweet.style.display = "";
  }
}

function clearEffects(tweet: HTMLElement): void {
  clearVisualClasses(tweet);
  clearPlaceholder(tweet);
  tweet.style.display = "";
}

function clearVisualClasses(tweet: HTMLElement): void {
  tweet.classList.remove("milady-shrinkifier-scale", "milady-shrinkifier-fade");
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
    .milady-shrinkifier-scale {
      zoom: 0.5;
      transform-origin: top left;
    }

    .milady-shrinkifier-fade {
      opacity: 0.5;
    }

    .milady-shrinkifier-placeholder {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      margin: 8px 0;
      border: 1px solid rgba(83, 100, 113, 0.4);
      border-radius: 16px;
      background: rgba(21, 32, 43, 0.8);
      color: rgb(231, 233, 234);
      font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
    }

    .milady-shrinkifier-placeholder button {
      border: 0;
      border-radius: 999px;
      padding: 8px 12px;
      background: rgb(239, 243, 244);
      color: rgb(15, 20, 25);
      font: inherit;
      cursor: pointer;
    }
  `;
  document.head.append(style);
}

function observeStorage(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.mode) {
      return;
    }
    settings = {
      mode: isFilterMode(changes.mode.newValue) ? changes.mode.newValue : DEFAULT_SETTINGS.mode,
    };
    scheduleProcessVisibleTweets();
  });
}

async function loadHashDatabase(): Promise<HashDatabase> {
  if (!hashDatabasePromise) {
    hashDatabasePromise = fetch(chrome.runtime.getURL(HASH_URL)).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load hashes: ${response.status}`);
      }
      return response.json() as Promise<HashDatabase>;
    });
  }
  return hashDatabasePromise;
}

async function loadModelMetadata(): Promise<ModelMetadata> {
  if (!modelMetadataPromise) {
    modelMetadataPromise = fetch(chrome.runtime.getURL(MODEL_METADATA_URL)).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load model metadata: ${response.status}`);
      }
      return response.json() as Promise<ModelMetadata>;
    });
  }
  return modelMetadataPromise;
}

async function getWorker(): Promise<Worker> {
  if (workerPromise) {
    return workerPromise;
  }

  workerPromise = Promise.resolve().then(() => {
    const worker = new Worker(chrome.runtime.getURL("worker.js"), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const resolver = pendingWorker.get(event.data.id);
      if (!resolver) {
        return;
      }
      pendingWorker.delete(event.data.id);
      resolver(event.data.score);
    });
    worker.postMessage({
      modelUrl: chrome.runtime.getURL(MODEL_URL),
    });
    return worker;
  });

  return workerPromise;
}

async function scoreWithOnnx(features: number[], seed: string): Promise<number> {
  const worker = await getWorker();
  return new Promise<number>((resolve) => {
    const id = `${seed}:${crypto.randomUUID()}`;
    pendingWorker.set(id, resolve);
    worker.postMessage({
      id,
      features,
    });
  });
}

function isFilterMode(value: unknown): value is ExtensionSettings["mode"] {
  return value === "off" || value === "hide" || value === "scale" || value === "fade";
}
