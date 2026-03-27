import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const TOTAL_TOKENS = 10_000;
const CONCURRENCY = 16;
const OUTPUT_DIR = resolve("cache/milady-maker");
const HOSTS = ["https://www.miladymaker.net", "https://miladymaker.net"];
const MAX_RETRIES = 4;

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const tokens = Array.from({ length: TOTAL_TOKENS }, (_, index) => index + 1);
  for (let offset = 0; offset < tokens.length; offset += CONCURRENCY) {
    const slice = tokens.slice(offset, offset + CONCURRENCY);
    await Promise.all(slice.map((tokenId) => downloadToken(tokenId)));
    const completed = offset + slice.length;
    if (completed % 240 === 0 || completed === TOTAL_TOKENS) {
      console.log(`downloaded ${completed}/${TOTAL_TOKENS}`);
    }
  }
}

async function downloadToken(tokenId: number): Promise<void> {
  const destination = resolve(OUTPUT_DIR, `${tokenId}.png`);
  if (await fileExists(destination)) {
    return;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    for (const host of HOSTS) {
      const imageUrl = `${host}/milady/${tokenId}.png`;
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(destination, buffer);
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES - 1 && host === HOSTS[HOSTS.length - 1]) {
          throw error;
        }
      }
    }

    await sleep(250 * (attempt + 1));
  }

  throw new Error(`Failed to fetch token ${tokenId} after ${MAX_RETRIES} retries`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
