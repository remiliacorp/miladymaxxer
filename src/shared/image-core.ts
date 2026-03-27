import type { CandidateScore, HashEntry } from "./types";

const POPCOUNT = new Uint8Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  let count = 0;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  POPCOUNT[index] = count;
}

export function normalizeProfileImageUrl(source: string): string {
  const url = new URL(source);
  url.search = "";
  url.pathname = url.pathname.replace(/_(normal|bigger|mini)(\.[a-z0-9]+)$/i, "_400x400$2");
  return url.toString();
}

export function findBestCandidate(hash: string, averageColor: [number, number, number], entries: HashEntry[]): CandidateScore {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestEntry = entries[0];

  for (const entry of entries) {
    const distance = hammingDistance(hash, entry.hash);
    if (distance > bestDistance) {
      continue;
    }

    if (distance === bestDistance) {
      const currentColor = colorDistance(averageColor, entry.averageColor);
      const bestColor = colorDistance(averageColor, bestEntry.averageColor);
      if (currentColor >= bestColor) {
        continue;
      }
    }

    bestDistance = distance;
    bestEntry = entry;
  }

  return {
    distance: bestDistance,
    entry: bestEntry,
  };
}

export function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}

export function hammingDistance(left: string, right: string): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 2) {
    const leftByte = Number.parseInt(left.slice(index, index + 2), 16);
    const rightByte = Number.parseInt(right.slice(index, index + 2), 16);
    total += POPCOUNT[leftByte ^ rightByte];
  }
  return total;
}
