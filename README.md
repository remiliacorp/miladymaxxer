# Milady Shrinkifier

Chrome extension that detects X/Twitter posts from accounts using a Milady Maker avatar and either hides, shrinks, or fades the whole post.

## Local workflow

1. Install JS deps: `pnpm install`
2. Install Python deps for the ONNX asset builder: `uv sync`
3. Download the Milady Maker corpus into the ignored cache folder:
   `pnpm run download:images`
   Faster resume-friendly option: `pnpm run download:images:aria2`
4. Generate the local hash index and ONNX prototype model: `pnpm run prepare:assets`
5. Build the extension: `pnpm run build`
6. Load `dist/` as an unpacked extension in Chrome

## Notes

- Downloaded source images live under `cache/milady-maker/` and are ignored by Git.
- Generated runtime assets land in `public/generated/` and `public/models/`.
- The extension currently targets Milady Maker only, but the data pipeline is structured so more collections can be added later.
