import sharp from "sharp";

import type { RuntimeImageFeatures } from "./runtime-image-types";

export type CropVariant = "center" | "top";

export async function computeNodeImageFeatures(
  buffer: Buffer,
  variant: CropVariant = "center",
): Promise<RuntimeImageFeatures> {
  const position = variant === "top" ? "north" : "centre";
  const colorImage = sharp(buffer).ensureAlpha();
  const grayImage = sharp(buffer).ensureAlpha();

  const colorRaw = await colorImage
    .resize(9, 8, {
      fit: "cover",
      position,
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const grayRaw = await grayImage
    .resize(9, 8, {
      fit: "cover",
      position,
      kernel: "lanczos3",
    })
    .grayscale()
    .raw()
    .toBuffer();

  const modelRaw = await sharp(buffer)
    .ensureAlpha()
    .resize(32, 32, {
      fit: "cover",
      position,
      kernel: "lanczos3",
    })
    .grayscale()
    .raw()
    .toBuffer();

  return {
    hash: computeDhashFromGray(grayRaw),
    averageColor: computeAverageColor(colorRaw),
    modelFeatures: Array.from(modelRaw, (value) => value / 255),
  };
}

function computeAverageColor(buffer: Buffer): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  const pixels = buffer.length / 3;
  for (let offset = 0; offset < buffer.length; offset += 3) {
    red += buffer[offset];
    green += buffer[offset + 1];
    blue += buffer[offset + 2];
  }
  return [
    Math.round(red / pixels),
    Math.round(green / pixels),
    Math.round(blue / pixels),
  ];
}

function computeDhashFromGray(buffer: Buffer): string {
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const left = buffer[row * 9 + column];
      const right = buffer[row * 9 + column + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

function bitsToHex(bits: string): string {
  const bytes: string[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    const byte = Number.parseInt(bits.slice(index, index + 8), 2);
    bytes.push(byte.toString(16).padStart(2, "0"));
  }
  return bytes.join("");
}
