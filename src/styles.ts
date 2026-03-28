const STYLE_ID = "miladymaxxer-style";

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Diminish effect - subtle shrink, no margin changes to prevent layout shift */
    [data-miladymaxxer-effect="diminish"] {
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

    @keyframes milady-catch-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(212, 175, 55, 0.6);
      }
      50% {
        box-shadow: 0 0 20px 4px rgba(212, 175, 55, 0.4);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(212, 175, 55, 0);
      }
    }

    @keyframes milady-levelup-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.7);
      }
      40% {
        box-shadow: 0 0 24px 6px rgba(255, 215, 0, 0.5);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(255, 215, 0, 0);
      }
    }

    [data-miladymaxxer-catch-anim="catch"] {
      animation: milady-catch-pulse 0.5s ease-out !important;
    }

    [data-miladymaxxer-catch-anim="levelup"] {
      animation: milady-levelup-pulse 0.6s ease-out !important;
    }

    .miladymaxxer-add-btn {
      display: inline !important;
      padding: 0 !important;
      margin-left: 6px !important;
      border: none !important;
      background: transparent !important;
      color: rgb(113, 118, 123) !important;
      font: inherit !important;
      font-weight: 400 !important;
      cursor: pointer !important;
      opacity: 0.3 !important;
      transition: color 0.15s ease, opacity 0.15s ease !important;
      vertical-align: baseline !important;
    }

    article:hover .miladymaxxer-add-btn {
      opacity: 0.6 !important;
    }

    .miladymaxxer-add-btn:hover {
      opacity: 1 !important;
      color: #d4af37 !important;
    }

    .miladymaxxer-add-btn[data-milady-list-state="remove"]:hover {
      color: rgb(244, 33, 46) !important;
    }

    .miladymaxxer-level-inline {
      color: rgb(113, 118, 123) !important;
      font: inherit !important;
      white-space: nowrap !important;
      margin-left: 4px !important;
      display: inline !important;
      position: relative !important;
      top: -1px !important;
    }

    /* MILADY effect - gold floating card with depth */
    [data-miladymaxxer-effect="milady"] {
      position: relative !important;
      z-index: 1 !important;
      border-radius: 12px !important;
      margin: 4px 0 !important;
      border: 1px solid rgba(212, 175, 55, 0.4) !important;
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.1),
        0 8px 24px rgba(212, 175, 55, 0.2),
        inset 0 1px 0 rgba(255, 215, 0, 0.15) !important;
      transition: transform 0.3s ease, box-shadow 0.3s ease, background 0.4s ease, border-color 0.4s ease !important;
    }

    /* Subtle centered float on hover */
    [data-miladymaxxer-effect="milady"]:hover {
      transform: translateY(-1px) scale(1.003) !important;
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.12),
        0 8px 24px rgba(212, 175, 55, 0.28),
        inset 0 1px 0 rgba(255, 215, 0, 0.15) !important;
    }

    /* Connected milady tweets - merge adjacent cards */
    [data-miladymaxxer-effect="milady"] + [data-miladymaxxer-effect="milady"],
    [data-miladymaxxer-effect="milady"] + [data-miladymaxxer-effect="diminish"] + [data-miladymaxxer-effect="milady"] {
      border-top-left-radius: 0 !important;
      border-top-right-radius: 0 !important;
      border-top: none !important;
    }

    [data-miladymaxxer-effect="milady"]:has(+ [data-miladymaxxer-effect="milady"]) {
      border-bottom-left-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
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

    /* Dark mode - rich silver card */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-no-likes="true"] {
      background: linear-gradient(180deg, rgb(24, 26, 36) 0%, rgb(17, 19, 27) 100%) !important;
      border: 1px solid rgba(110, 115, 140, 0.3) !important;
      box-shadow:
        0 4px 14px rgba(110, 115, 140, 0.06),
        inset 0 1px 0 rgba(150, 155, 175, 0.1) !important;
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

    /* Light mode liked - ~30% richer than base */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"] {
      background: linear-gradient(180deg, rgba(255, 243, 200, 1) 0%, rgba(255, 250, 230, 1) 100%) !important;
      border-color: rgba(200, 160, 50, 0.45) !important;
      box-shadow:
        0 2px 6px rgba(184, 134, 11, 0.12),
        0 4px 16px rgba(212, 175, 55, 0.18),
        inset 0 1px 0 rgba(255, 223, 100, 0.4) !important;
    }

    /* Dark mode liked - subtly richer than base */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-liked="true"] {
      background: linear-gradient(180deg, rgb(48, 40, 16) 0%, rgb(36, 30, 12) 100%) !important;
      border-color: rgba(190, 155, 55, 0.45) !important;
      box-shadow:
        0 4px 16px rgba(150, 120, 42, 0.08),
        inset 0 1px 0 rgba(220, 180, 70, 0.16) !important;
    }

    /* Diamond tier - 100+ likes */
    @keyframes milady-diamond-shimmer {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    @keyframes milady-diamond-streak {
      0% { transform: translateX(-100%) skewX(-15deg); opacity: 0; }
      3% { opacity: 1; }
      25% { opacity: 1; }
      30% { transform: translateX(300%) skewX(-15deg); opacity: 0; }
      100% { transform: translateX(300%) skewX(-15deg); opacity: 0; }
    }

    /* Diamond light mode */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"],
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"] {
      background: linear-gradient(135deg, #eef2ff 0%, #dce4ff 20%, #f4f6ff 40%, #d8e2ff 60%, #edf1ff 80%, #dce4ff 100%) !important;
      background-size: 300% 300% !important;
      animation: milady-diamond-shimmer 4s ease infinite !important;
      border: 1.5px solid rgba(130, 160, 230, 0.5) !important;
      box-shadow:
        0 4px 16px rgba(80, 120, 200, 0.2),
        0 8px 32px rgba(100, 140, 220, 0.15),
        0 0 20px rgba(130, 170, 255, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.95),
        inset 0 -2px 4px rgba(130, 160, 230, 0.08) !important;
    }

    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::before,
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::before {
      background: linear-gradient(
        135deg,
        rgba(180, 200, 255, 0.4) 0%,
        rgba(220, 230, 255, 0.2) 30%,
        rgba(255, 255, 255, 0.6) 50%,
        rgba(200, 215, 255, 0.2) 70%,
        rgba(180, 200, 255, 0.35) 100%
      ) !important;
      animation: milady-diamond-sparkle 3s ease-in-out infinite !important;
    }

    /* Diamond light streak (::after) */
    html[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::after,
    body[style*="background-color: rgb(255, 255, 255)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::after {
      content: "" !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-radius: inherit !important;
      pointer-events: none !important;
      z-index: 1 !important;
      background: linear-gradient(
        105deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0) 35%,
        rgba(200, 220, 255, 0.25) 45%,
        rgba(255, 255, 255, 0.4) 50%,
        rgba(200, 220, 255, 0.25) 55%,
        rgba(255, 255, 255, 0) 65%,
        rgba(255, 255, 255, 0) 100%
      ) !important;
      animation: milady-diamond-streak 8s ease-in-out infinite !important;
    }

    /* Diamond dark mode */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"] {
      background: linear-gradient(135deg, rgb(15, 20, 42) 0%, rgb(22, 30, 55) 20%, rgb(18, 24, 48) 40%, rgb(25, 34, 60) 60%, rgb(15, 20, 42) 80%, rgb(22, 30, 55) 100%) !important;
      background-size: 300% 300% !important;
      animation: milady-diamond-shimmer 4s ease infinite !important;
      border: 1.5px solid rgba(100, 140, 220, 0.45) !important;
      box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.6),
        0 8px 32px rgba(60, 100, 200, 0.15),
        0 0 24px rgba(80, 130, 240, 0.08),
        inset 0 1px 0 rgba(130, 170, 240, 0.2),
        inset 0 -2px 4px rgba(0, 0, 0, 0.4) !important;
    }

    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::before,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::before {
      background: linear-gradient(
        135deg,
        rgba(80, 120, 200, 0.12) 0%,
        rgba(60, 100, 180, 0.05) 30%,
        rgba(140, 170, 240, 0.15) 50%,
        rgba(60, 100, 180, 0.05) 70%,
        rgba(80, 120, 200, 0.1) 100%
      ) !important;
      animation: milady-diamond-sparkle 3s ease-in-out infinite !important;
    }

    /* Diamond dark mode light streak */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::after,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]::after {
      content: "" !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-radius: inherit !important;
      pointer-events: none !important;
      z-index: 1 !important;
      background: linear-gradient(
        105deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0) 35%,
        rgba(120, 160, 240, 0.1) 45%,
        rgba(180, 210, 255, 0.18) 50%,
        rgba(120, 160, 240, 0.1) 55%,
        rgba(255, 255, 255, 0) 65%,
        rgba(255, 255, 255, 0) 100%
      ) !important;
      animation: milady-diamond-streak 8s ease-in-out infinite !important;
    }

    /* Diamond avatar glow */
    [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"] [data-testid="Tweet-User-Avatar"] {
      filter: drop-shadow(0 0 10px rgba(100, 150, 255, 0.4)) drop-shadow(0 0 20px rgba(120, 160, 240, 0.15)) !important;
    }

    /* Diamond border shimmer on hover */
    [data-miladymaxxer-effect="milady"][data-miladymaxxer-diamond="true"]:hover {
      box-shadow:
        0 6px 20px rgba(80, 120, 200, 0.25),
        0 12px 40px rgba(100, 140, 220, 0.15),
        0 0 30px rgba(130, 170, 255, 0.12) !important;
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
      background: linear-gradient(180deg, rgb(28, 23, 10) 0%, rgb(20, 16, 7) 100%) !important;
      border-color: rgba(160, 130, 45, 0.35) !important;
      box-shadow:
        0 4px 14px rgba(140, 112, 40, 0.06),
        inset 0 1px 0 rgba(180, 145, 55, 0.1) !important;
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
      background: rgb(24, 20, 9) !important;
      border-color: rgba(150, 120, 42, 0.3) !important;
      box-shadow:
        0 2px 8px rgba(130, 105, 35, 0.08),
        inset 0 1px 0 rgba(180, 145, 55, 0.08) !important;
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

    /* Dark mode fallback */
    @media (prefers-color-scheme: dark) {
      [data-miladymaxxer-effect="milady"] {
        background: linear-gradient(180deg, rgb(28, 23, 10) 0%, rgb(20, 16, 7) 100%) !important;
        border: 1px solid rgba(212, 175, 55, 0.4) !important;
        margin: 4px 4px !important;
        box-shadow:
          0 0 16px rgba(212, 175, 55, 0.25),
          0 4px 24px rgba(212, 175, 55, 0.2),
          inset 0 1px 0 rgba(255, 215, 0, 0.15) !important;
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


    /* Twitter Dark mode (black) - gold card */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"],
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"] {
      background: linear-gradient(180deg, rgb(28, 23, 10) 0%, rgb(20, 16, 7) 100%) !important;
      border: 1px solid rgba(212, 175, 55, 0.4) !important;
      margin: 4px 4px !important;
      box-shadow:
        0 0 16px rgba(212, 175, 55, 0.25),
        0 4px 24px rgba(212, 175, 55, 0.2),
        inset 0 1px 0 rgba(255, 215, 0, 0.15) !important;
    }


    /* Gold metallic sheen - dark mode */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::before,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::before {
      background:
        linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.08) 0%,
          rgba(180, 140, 50, 0.04) 25%,
          rgba(255, 255, 255, 0) 45%,
          rgba(160, 120, 40, 0.03) 70%,
          rgba(212, 175, 55, 0.06) 100%
        ) !important;
    }

    /* Shimmer sweep - dark mode */
    html[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::after,
    body[style*="background-color: rgb(0, 0, 0)"] [data-miladymaxxer-effect="milady"]::after {
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(212, 175, 55, 0.06) 25%,
        rgba(255, 248, 220, 0.09) 50%,
        rgba(212, 175, 55, 0.06) 75%,
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
