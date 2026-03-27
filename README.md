# Miladymaxxer

*elevate milady. diminish the rest.*

![hero](assets/hero.png)

## What It Does

On-device avatar detection for X/Twitter. A bundled ONNX classifier scans avatars as you scroll and applies visual effects:

- **Milady mode** — Gold shimmer effects, enhanced borders, logo replacement, pink hearts
- **Sound toggle** — Optional audio feedback when miladys are detected
- **Off** — Disable all effects

## Features

- **Gold Follow buttons** — Shimmery gold "Follow back" for miladys who follow you, silver for those who don't
- **Pink hearts** — Faded pink like button on milady posts to encourage engagement
- **User cell detection** — Works in "Who to follow" sections too
- **Dark mode optimized** — Subtle gold effects that look great on dark themes
- **Privacy-first** — Everything runs locally, no server calls, no telemetry

The popup tracks session stats (posts scanned, match rate, last sighting), keeps a list of detected accounts you can exempt individually, and collects avatar data you can export for offline labeling.

## Screenshots

| Timeline | Follow Button |
|----------|---------------|
| ![Timeline](assets/screenshot-timeline-1.png) | ![Follow Button](assets/screenshot-follow-button.png) |

## Install

There is no Chrome Web Store release. Install from GitHub Releases instead:

1. Download the latest `miladymaxxer-vX.Y.Z-unpacked.zip` from Releases.
2. Unzip it somewhere permanent on disk.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the unzipped folder.

## Development

See `DEVELOPMENT.md` for debugging and training workflow commands.

```bash
pnpm install      # Install dependencies
pnpm run build    # Build extension
pnpm run dev      # Watch mode
pnpm test         # Run tests
```

## Notes

- Runtime model artifacts live in `public/models/` and `public/generated/`.
- Training data lives under ignored `cache/`.
- The extension runtime is ONNX-only.
