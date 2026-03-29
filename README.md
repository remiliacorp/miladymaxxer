# Miladymaxxer

*milady*

![Timeline](assets/screenshot-timeline-1.png)

Chrome extension for X/Twitter. Runs a bundled ONNX classifier (MobileNetV3-Small) on avatars as you scroll. Milady posts get color-coded and elevated. Fully local — no server calls, no telemetry.

## Features

**Catch mechanic**
- Like a milady post to "catch" that account and start earning XP
- Inverse quadratic leveling: Level = floor(sqrt(posts liked))
- Each milady you catch has its own level and XP progress
- Catch sound on first like, level-up sound + animation on progression
- Manual milady list: add any account via inline +/- button
- 14-day XP cutoff — only recent posts count

**Player XP**
- Your own level progression (3x slower than milady levels)
- Displayed next to the milady logo in the sidebar
- Level-up triggers Chrome notification
- Allow-listed accounts give 25% player XP to prevent gaming
- Extension badge shows your current level

**Tiered card system**
- Silver — uncaught miladys (Lv.0)
- Mint green — caught, under 75 post likes
- Gold — 75+ post likes
- Diamond — 250+ post likes (animated shimmer + light streak)
- Liked/unliked states enrich card color within each tier
- Card theme setting: Full / Green+Silver only / Silver only / Off

**Profile badges**
- Inline level badge on milady profiles (after @handle)
- Grey badge if you don't follow them, green if you do
- Tooltip with detailed stats (posts seen, liked, catch date, detection score)

**Engagement nudges**
- Faded pink like button with subtle fill on milady posts
- Downvote button hidden on milady posts
- Retweet detection for engagement tracking

**Sound system**
- Generative polyphonic interaction sounds across the site
- Catch chime (E5-A5-E6), level-up arpeggio (C5-E5-G5-C6+E6)
- Media hover pips, click feedback, DM sounds
- Toggle on/off in popup settings

**Popup**
- Accounts tab: caught miladys with level pills, display name + @handle layout
- Uncaught miladys in compact grey list
- Collection stats: X caught / Y seen with catch rate
- Sort by level or recent catch
- "?" tooltip explaining the leveling system
- Stats: posts scanned, match rate, model matches
- Card theme and level badge toggles
- Avatar dataset export

**Thread detection**
- Reply chain detection on timeline (border-based)
- Edge fading on thread view (/status/) replies
- Tight margins between adjacent milady cards in threads
- Square corners on connected cards in thread view

**Other**
- Works in timelines, threads, profiles, "Who to follow", notifications
- Debug mode with green (match) / red (miss) overlays and scores
- Data persists across extension updates via chrome.storage
- All detection runs on-device via ONNX Runtime Web Worker

## Install

No Chrome Web Store release. Install from source:

1. Download latest `miladymaxxer-vX.Y.Z-unpacked.zip` from Releases
2. Unzip somewhere permanent
3. `chrome://extensions` -> Developer mode -> Load unpacked -> select folder

## Development

```bash
pnpm install      # deps
pnpm run build    # build
pnpm run dev      # watch
pnpm test         # tests
```

## Architecture

```
src/
  content.ts       # orchestrator — scan loop, catch/XP logic, profile badges
  styles.ts        # injected CSS — tiered cards, dark mode, animations
  sounds.ts        # Web Audio API — polyphonic sound system
  effects.ts       # DOM effects — card tiers, level badges, like detection
  detection.ts     # ONNX inference and avatar classification
  selectors.ts     # centralized DOM selector constants
  popup.tsx         # extension popup UI (Solid.js)
  background.ts    # service worker — badge updates, notifications
  shared/
    types.ts       # TypeScript interfaces
    levels.ts      # level/XP computation (milady + player)
    storage.ts     # chrome.storage persistence + normalization
    constants.ts   # defaults and model config
```

Model artifacts in `public/models/` and `public/generated/`.
