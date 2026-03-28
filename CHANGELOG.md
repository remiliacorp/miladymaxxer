# Changelog

## [0.3.0] - 2026-03-27

First public release. On-device milady avatar detection for X/Twitter using a bundled ONNX classifier. Fully local — no server calls, no telemetry.

### Detection
- MobileNetV3-Small ONNX classifier runs in a Web Worker
- LRU cache (1000 entries) for avatar detection results
- Works across timelines, threads, profiles, "Who to follow", notifications, quote tweets
- Debug mode with per-post confidence scores

### Visual Effects
- **Diamond tier** (100+ likes) — icy blue crystalline card with animated light streak
- **Gold tier** (10+ likes) — warm metallic card with depth shadows
- **Silver tier** (<10 likes) — cool silver card to encourage engagement
- **Liked boost** — richer gold when you've liked a milady post
- Faded pink like button on milady posts (brightens on hover)
- Downvote button hidden on milady posts
- Dotted underline on miladys you don't follow
- Gold "Follow back" / silver "Follow" buttons
- Milady logo replaces X logo in sidebar
- Dark mode and light mode optimized

### Sound System
- Generative polyphonic sounds via Web Audio API
- Tweet hover chimes, click feedback, media hover pips
- DM sounds: send thup, incoming message pip, conversation hover
- Eager AudioContext unlock on first user gesture
- Toggle on/off in popup settings

### Popup
- Session stats: posts scanned, match rate, last detection
- Matched accounts list with detection confidence scores
- Per-account exemptions
- Avatar dataset export for offline labeling
- Green miladymaker.net-inspired theme

### Extension Badge
- Gold counter on extension icon showing milady posts liked this session
- Decrements on unlike

### Architecture
- Content script split into focused modules: content.ts (orchestrator), styles.ts, sounds.ts, detection.ts, effects.ts, selectors.ts
- All DOM selectors centralized in selectors.ts for easy maintenance
- Shared utilities: LRU cache, parseCount, storage normalization
- 63 unit tests across 4 test files
- E2E test infrastructure with Playwright
- Background service worker for badge updates
