import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { computeNodeImageFeatures } from "../src/shared/node-image";
import type { HashDatabase } from "../src/shared/types";

const TOTAL_TOKENS = 10_000;
const CONCURRENCY = 16;
const IMAGE_DIR = resolve("cache/milady-maker");
const OUTPUT_DIR = resolve("public/generated");
const OUTPUT_PATH = resolve(OUTPUT_DIR, "milady-maker.hashes.json");

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const tokens = Array.from({ length: TOTAL_TOKENS }, (_, index) => index + 1);
  const hashes: HashDatabase["hashes"] = [];

  for (let offset = 0; offset < tokens.length; offset += CONCURRENCY) {
    const slice = tokens.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(slice.map((tokenId) => processToken(tokenId)));
    hashes.push(...results.flat());
    if ((offset + slice.length) % 256 === 0 || offset + slice.length === tokens.length) {
      console.log(`processed ${offset + slice.length}/${tokens.length}`);
    }
  }

  const database: HashDatabase = {
    collection: "milady-maker",
    algorithm: "dhash64-rgbavg-32x32-center-and-top-crop",
    generatedAt: new Date().toISOString(),
    hashes,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(database));
  console.log(`wrote ${OUTPUT_PATH}`);
}

async function processToken(tokenId: number) {
  const imagePath = resolve(IMAGE_DIR, `${tokenId}.png`);
  const buffer = await readFile(imagePath);
  const variants = await Promise.all([
    computeNodeImageFeatures(buffer, "center"),
    computeNodeImageFeatures(buffer, "top"),
  ]);

  return variants.map((features, index) => ({
    tokenId,
    variant: index === 0 ? "center" : "top",
    hash: features.hash,
    averageColor: features.averageColor,
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
