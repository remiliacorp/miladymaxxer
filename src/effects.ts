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
  delete tweet.dataset.miladymaxxerDiamond;
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

function getLikeCount(tweet: HTMLElement): number {
  // Check both like (not yet liked) and unlike (already liked) buttons
  const button = tweet.querySelector<HTMLElement>(LIKE_BUTTON) ||
                 tweet.querySelector<HTMLElement>(UNLIKE_BUTTON);
  if (!button) return -1;

  // Parse from aria-label (e.g., "123 Likes. Like" or "5 Likes. Unlike")
  const ariaLabel = button.getAttribute("aria-label") || "";
  const ariaMatch = ariaLabel.match(/^([\d,.]+)\s/);
  if (ariaMatch) {
    return parseCount(ariaMatch[1].replace(/,/g, ""));
  }

  // No number prefix means 0 likes
  if (/^(Like|Unlike|Likes)/.test(ariaLabel)) return 0;

  // Fallback: visible text count
  const countSpan = button.querySelector(LIKE_COUNT);
  if (!countSpan) return 0;

  const countText = countSpan.textContent?.trim();
  return countText ? parseCount(countText) : 0;
}

export function hasLowLikes(tweet: HTMLElement): boolean {
  const count = getLikeCount(tweet);
  return count >= 0 && count < 10;
}

export function hasHighLikes(tweet: HTMLElement): boolean {
  return getLikeCount(tweet) >= 100;
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
        // Check for 100+ likes - diamond tier
        if (hasHighLikes(tweet)) {
          tweet.dataset.miladymaxxerDiamond = "true";
        } else {
          delete tweet.dataset.miladymaxxerDiamond;
        }
        // Check for <10 likes - tint silver to encourage engagement
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
    case "miladypro":
      // Enhance milady posts, show non-milady posts normally
      clearPlaceholder(tweet);
      tweet.style.display = "";
      if (isMatch) {
        tweet.dataset.miladymaxxerEffect = "milady";
        delete tweet.dataset.miladyFadeIn;
        // Check for 100+ likes - diamond tier
        if (hasHighLikes(tweet)) {
          tweet.dataset.miladymaxxerDiamond = "true";
        } else {
          delete tweet.dataset.miladymaxxerDiamond;
        }
        // Check for <10 likes - tint silver to encourage engagement
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
