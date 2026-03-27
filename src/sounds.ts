import {
  MEDIA_ELEMENTS,
  INTERACTIVE_ELEMENT,
  POST_BUTTONS,
  TWEET_COMPOSER,
  DM_CONTAINER,
  DM_CONVERSATION_PANEL,
  DM_MESSAGE_LIST,
  DM_MESSAGE,
  DM_COMPOSER,
  DM_COMPOSER_FORM,
  DM_REACTIONS,
  LAYERS,
} from "./selectors";
import type { ExtensionSettings } from "./shared/types";

// Module-level settings reference, updated by content.ts via setSoundSettings()
let settings: ExtensionSettings = { mode: "off", whitelistHandles: [], soundEnabled: false };

export function setSoundSettings(next: ExtensionSettings): void {
  settings = next;
}

let audioContext: AudioContext | null = null;
const soundsAttached = new WeakSet<HTMLElement>();
let dmListenersAttached = false;
let lastMessageCount = 0;
let lastReactionCount = 0;

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

export function attachSoundEvents(tweet: HTMLElement): void {
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
      if (target.closest(INTERACTIVE_ELEMENT)) {
        playClickSound(isMilady());
      }
    }
  }, { passive: true });

  // Media hover sounds
  const mediaElements = tweet.querySelectorAll<HTMLElement>(MEDIA_ELEMENTS);
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

// Global media hover sounds — attaches a subtle pip to ALL media on the page,
// regardless of whether the tweet was processed by the milady detection system.
export function attachGlobalMediaHoverSounds(): void {
  if (settings.mode === "off") return;

  const mediaElements = document.querySelectorAll<HTMLElement>(MEDIA_ELEMENTS);
  for (const media of Array.from(mediaElements)) {
    if (soundsAttached.has(media)) continue;
    soundsAttached.add(media);
    media.addEventListener("mouseenter", () => {
      if (settings.mode !== "off" && settings.soundEnabled) {
        // Very subtle, short pip — quieter and shorter than the milady media hover
        playTone(500, 0.05, "sine", 0.02);
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

export function attachPostButtonSound(): void {
  if (settings.mode === "off") return;

  // Regular tweet buttons
  const postButtons = document.querySelectorAll<HTMLElement>(POST_BUTTONS);

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
export function attachDMSounds(): void {
  if (dmListenersAttached) return;
  dmListenersAttached = true;

  // Document-level click handler for all DM interactions
  document.addEventListener("click", (e) => {
    if (settings.mode === "off") return;

    const target = e.target as HTMLElement;
    const button = target.closest("button") as HTMLElement | null;

    // Check for send button (inside dm-composer-form or by aria-label)
    if (button) {
      const testId = button.getAttribute("data-testid") || "";
      const ariaLabel = button.getAttribute("aria-label") || "";

      // DM send: button inside the composer form, or explicit send labels
      const inComposerForm = button.closest(DM_COMPOSER_FORM);
      if (inComposerForm && (testId.includes("send") || ariaLabel.includes("Send") ||
          button.getAttribute("type") === "submit")) {
        playSendSound();
        return;
      }

      // Also catch any send button by testid/aria-label outside composer
      if (testId.includes("send") || testId.includes("Send") ||
          ariaLabel.includes("Send") || ariaLabel === "Send") {
        playSendSound();
        return;
      }
    }

    // Check for emoji/reaction in popup layers
    const inLayers = target.closest(LAYERS);
    if (inLayers && button) {
      const ariaLabel = button.getAttribute("aria-label") || "";
      if (/^[\p{Emoji}\u200d]+$/u.test(ariaLabel) ||
          /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(ariaLabel)) {
        playReactionSound();
        return;
      }
    }

    // Check for DM conversation panel click
    const dmPanel = target.closest(DM_CONVERSATION_PANEL) || target.closest(DM_CONTAINER);
    if (dmPanel && window.location.pathname.includes("/messages")) {
      playClickSound(false);
    }
  }, { passive: true, capture: true });

  // Document-level keydown for Enter to send in DM composer
  document.addEventListener("keydown", (e) => {
    if (settings.mode === "off") return;
    if (e.key !== "Enter" || e.shiftKey) return;

    const target = e.target as HTMLElement;
    const testId = target.getAttribute("data-testid") || "";

    // Direct match: dm-composer-textarea
    if (testId === "dm-composer-textarea") {
      playSendSound();
      return;
    }

    // Fallback: any textbox inside DM page that isn't the tweet composer
    const inDMPage = window.location.pathname.includes("/messages");
    const isTextbox = target.getAttribute("role") === "textbox" || target.isContentEditable;
    const notTweetComposer = !target.closest(TWEET_COMPOSER);

    if (inDMPage && isTextbox && notTweetComposer) {
      playSendSound();
    }
  }, { passive: true, capture: true });

  // Document-level mouseover for DM conversation hover sounds
  document.addEventListener("mouseover", (e) => {
    if (settings.mode === "off") return;

    const target = e.target as HTMLElement;
    // Hover on conversation panel or any DM message
    const dmElement = target.closest(DM_CONVERSATION_PANEL) ||
                      target.closest(DM_MESSAGE);

    if (dmElement && !soundsAttached.has(dmElement as HTMLElement)) {
      soundsAttached.add(dmElement as HTMLElement);
      playTone(600, 0.06, "sine", 0.03);
    }
  }, { passive: true });
}


// Observe incoming messages and reactions in DMs/GCs
export function observeIncomingMessages(): void {
  // Find the message list in the active conversation
  const messageList = document.querySelector(DM_MESSAGE_LIST) ||
                      document.querySelector(DM_CONVERSATION_PANEL);

  if (!messageList) {
    lastMessageCount = 0;
    lastReactionCount = 0;
    return;
  }

  // Count messages (each message has data-testid="message-{uuid}")
  const messages = messageList.querySelectorAll(DM_MESSAGE);
  const currentCount = messages.length;

  // Count reactions (emoji reactions on messages)
  const reactions = messageList.querySelectorAll(DM_REACTIONS);
  const currentReactionCount = reactions.length;

  // Play sound for new messages (only after initial count is established)
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
