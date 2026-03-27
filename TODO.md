# TODO

## In Progress (uncommitted)

- [x] Replace unbounded Map cache with LRU cache (max 1000)
- [x] Tune rescan interval (1s → 5s) for lower CPU usage
- [x] Deduplicate normalization functions into `shared/storage.ts`
- [x] Change silver card threshold from 0 likes → <10 likes
- [x] Add `parseCount()` for K/M abbreviated like counts
- [x] Deepen box-shadow on gold cards, tone down dark-mode silver
- [x] Remove debug `console.log` calls from DM sound handlers
- [x] Move `LRUCache` class out of `content.ts` into `shared/lru-cache.ts`
- [x] Remove `getStoredMode()` from popup (redundant)
- [x] Add `lastDetectionScore` to `MatchedAccount` type
- [x] Per-account detection confidence display in Accounts tab
- [x] Badge icon showing milady posts liked this session
- [x] Fix popup font legibility (darker text, bolder stat labels)
- [x] Remove visible popup border and border-radius
- [x] Remove popup metallic sheen overlays that washed out text
- [ ] Commit and push (21 commits ahead of remote)

## Release

- [ ] Push to remote
- [ ] Cut v0.2.5 release with uncommitted changes
- [ ] Update screenshots in README if visuals changed significantly
- [ ] Submit to Chrome Web Store (currently GitHub Releases only)

## Model / ML

- [ ] Retrain classifier with newly collected avatar exports
- [ ] Evaluate false positive rate on current model
- [ ] Add confidence threshold tuning to popup settings
- [ ] Explore larger model (MobileNetV3-Large) for accuracy gains

## Features

- [ ] DM sound effects: react emoji, receive react, send message (active DM window only)
- [ ] Sound on hover over GC conversations in list

## Performance

- [ ] Debounce MutationObserver callbacks during rapid scrolling
- [ ] Lazy-load ONNX model (defer until first avatar seen)
- [ ] Web Worker pool for parallel inference on multiple avatars

## Testing

- [ ] Unit tests for LRU cache
- [ ] Unit tests for `parseCount()` / `hasLowLikes()`
- [ ] Unit tests for normalization functions in `storage.ts`
- [ ] E2E test with Playwright on a mock X/Twitter page

## Tech Debt

- [ ] Fix pre-existing TS errors (NodeListOf iterator, Element vs HTMLElement casts)
