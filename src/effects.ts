import { parseCount } from "./shared/parse-count";
import {
  TWEET,
  CELL_INNER_DIV,
  TWEET_USER_AVATAR,
  LIKE_BUTTON,
  LIKE_COUNT,
  UNLIKE_BUTTON,
  UNFOLLOW_BUTTON,
  FOLLOW_BUTTON,
  FOLLOWING_INDICATOR,
  FOLLOWS_YOU_INDICATOR,
  THREAD_CONNECTOR,
} from "./selectors";
import type { ExtensionSettings } from "./shared/types";

// ---------------------------------------------------------------------------
// Context passed in from content.ts so effects can read shared state without
// creating circular dependencies.
// ---------------------------------------------------------------------------

export interface EffectsContext {
  settings: ExtensionSettings;
  processed: WeakMap<HTMLElement, string>;
  onTweetVisible: (tweet: HTMLElement) => void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const placeholders = new WeakMap<HTMLElement, HTMLDivElement>();
export const revealed = new WeakMap<HTMLElement, string>();
let miladyLikesThisSession = 0;
const countedLikes = new WeakSet<HTMLElement>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findPreviousArticle(tweet: HTMLElement): HTMLElement | null {
  const container = tweet.closest(CELL_INNER_DIV);
  if (!container) return null;

  // Check if this tweet is part of a reply thread by looking for the vertical connector line
  // These lines connect replies to their parent and have specific background colors per theme
  const avatarArea = container.querySelector(TWEET_USER_AVATAR)?.parentElement?.parentElement;
  const hasThreadConnector = avatarArea?.querySelector(THREAD_CONNECTOR);

  if (!hasThreadConnector) return null;

  const prevContainer = container.previousElementSibling;
  if (!prevContainer) return null;

  return prevContainer.querySelector<HTMLElement>(TWEET);
}

function applyDebugState(tweet: HTMLElement): void {
  if (tweet.dataset.miladymaxxerState === "match") {
    tweet.dataset.miladymaxxerEffect = "debug-match";
    return;
  }

  tweet.dataset.miladymaxxerEffect = "debug-miss";
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function updateBadge(count: number): void {
  try {
    chrome.runtime.sendMessage({ type: "badge", count });
  } catch {
    // Service worker may not be available
  }
}

export function clearVisualState(tweet: HTMLElement): void {
  delete tweet.dataset.miladymaxxerEffect;
  delete tweet.dataset.miladymaxxerNoLikes;
  delete tweet.dataset.miladymaxxerLiked;
  delete tweet.dataset.miladymaxxerFollowing;
}

export function clearPlaceholder(tweet: HTMLElement): void {
  const placeholder = placeholders.get(tweet);
  if (placeholder) {
    placeholder.remove();
    placeholders.delete(tweet);
  }
}

export function clearEffects(tweet: HTMLElement): void {
  clearVisualState(tweet);
  delete tweet.dataset.miladymaxxerDebug;
  clearPlaceholder(tweet);
  tweet.style.display = "";
}

export function hasLowLikes(tweet: HTMLElement): boolean {
  const likeButton = tweet.querySelector<HTMLElement>(LIKE_BUTTON);
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
  const countSpan = likeButton.querySelector(LIKE_COUNT);
  if (!countSpan) return true; // No count element means 0

  const countText = countSpan.textContent?.trim();
  if (!countText) return true;

  // Parse the count (handles "1.2K" etc)
  const count = parseCount(countText);
  return count < 10;
}

export function hasUserLiked(tweet: HTMLElement): boolean {
  // If unlike button exists, user has liked this post
  return !!tweet.querySelector<HTMLElement>(UNLIKE_BUTTON);
}

export function doesUserFollow(tweet: HTMLElement): boolean {
  // Check for unfollow button - if it exists, user definitely follows them
  const unfollowButton = tweet.querySelector<HTMLElement>(UNFOLLOW_BUTTON);
  if (unfollowButton) {
    return true;
  }

  // Check for "Following" in any button aria-label
  const followingButton = tweet.querySelector<HTMLElement>(FOLLOWING_INDICATOR);
  if (followingButton) {
    return true;
  }

  // Check for Follow button with specific aria-label pattern
  const followButton = tweet.querySelector<HTMLElement>(FOLLOW_BUTTON);
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
  const followsYou = tweet.querySelector(FOLLOWS_YOU_INDICATOR);
  if (followsYou) {
    return false;
  }

  // Default: assume NOT following to show the underline indicator
  return false;
}

export function applyHiddenState(ctx: EffectsContext, tweet: HTMLElement): void {
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
      const normalizedUrl = ctx.processed.get(tweet);
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

export function applyMode(ctx: EffectsContext, tweet: HTMLElement, normalizedUrl?: string): void {
  ctx.onTweetVisible(tweet);
  clearVisualState(tweet);
  const isMatch = tweet.dataset.miladymaxxerState === "match";

  switch (ctx.settings.mode) {
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
          if (countedLikes.has(tweet)) {
            countedLikes.delete(tweet);
            miladyLikesThisSession = Math.max(0, miladyLikesThisSession - 1);
            updateBadge(miladyLikesThisSession);
          }
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
