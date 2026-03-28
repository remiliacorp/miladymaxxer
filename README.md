# Miladymaxxer

*milady*

![Timeline](assets/screenshot-timeline-1.png)

Chrome extension for X/Twitter. Runs a bundled ONNX classifier on avatars as you scroll. Milady posts get highlighted. Fully local — no server calls, no telemetry.

## Features

**Tiered metallic cards**
- Silver under 10 likes
- Gold above 10 likes
- Diamond above 100 likes
- Smooth animated transition between tiers on like
- Hover float animation
- Dark mode and light mode optimized

**Engagement nudges**
- Faded pink like button on milady posts
- Downvote button hidden on milady posts
- Dotted underline on miladys you don't follow
- Gold "Follow back" / silver "Follow" buttons
- Badge counter for milady posts liked this session

**Sound**
- Generative polyphonic interaction sounds across the site
- Detection chimes, media hover pips, click feedback
- DM send, incoming message, conversation sounds
- Toggle on/off in popup

**Popup**
- Session stats: posts scanned, match rate, last detection
- Navigate to seen milady profiles from session
- Per-account exemptions
- Avatar dataset export for offline labeling

**Other**
- All censorship filters removed from banteg's original "milady-shrinkifier", making use of same milady detection model
- Works in timelines, threads, profiles, "Who to follow", notifications, DMs
- Debug mode with detection scores

## Screenshots

| Timeline | Timeline (cont.) | Follow Button |
|----------|-------------------|---------------|
| ![Timeline](assets/screenshot-timeline-1.png) | ![Timeline 2](assets/screenshot-timeline-2.png) | ![Follow Button](assets/screenshot-follow-button.png) |

## Install

No Chrome Web Store release. Install from source:

1. Download latest `miladymaxxer-vX.Y.Z-unpacked.zip` from Releases
2. Unzip somewhere permanent
3. `chrome://extensions` → Developer mode → Load unpacked → select folder

## Development

```bash
pnpm install      # deps
pnpm run build    # build
pnpm run dev      # watch
pnpm test         # tests
```

See `DEVELOPMENT.md` for model training and debugging workflows.

## Architecture

```
src/
  content.ts     # orchestrator — scroll observer, detection loop, stats
  styles.ts      # injected CSS — cards, dark mode, hover, transitions
  sounds.ts      # Web Audio API — polyphonic sound system
  detection.ts   # ONNX inference and avatar classification
  effects.ts     # DOM effects — tiered cards, fade-ins, badges
  selectors.ts   # centralized DOM selector constants
  popup.tsx      # extension popup UI (Solid.js)
```

Model artifacts in `public/models/` and `public/generated/`. Training data in `cache/` (gitignored).
