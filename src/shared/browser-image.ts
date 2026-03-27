import type { RuntimeImageFeatures } from "./runtime-image-types";

export async function loadCorsImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`Avatar image failed to load: ${url}`)), {
      once: true,
    });
  });
  image.src = url;
  await loaded;
  return image;
}

export async function computeBrowserImageFeatures(image: HTMLImageElement): Promise<RuntimeImageFeatures> {
  const hashCanvas = document.createElement("canvas");
  hashCanvas.width = 9;
  hashCanvas.height = 8;
  const hashContext = hashCanvas.getContext("2d", { willReadFrequently: true });
  if (!hashContext) {
    throw new Error("Unable to create 2D context");
  }
  hashContext.drawImage(image, 0, 0, 9, 8);
  const hashPixels = hashContext.getImageData(0, 0, 9, 8).data;

  const featureCanvas = document.createElement("canvas");
  featureCanvas.width = 32;
  featureCanvas.height = 32;
  const featureContext = featureCanvas.getContext("2d", { willReadFrequently: true });
  if (!featureContext) {
    throw new Error("Unable to create feature context");
  }
  featureContext.drawImage(image, 0, 0, 32, 32);
  const modelPixels = featureContext.getImageData(0, 0, 32, 32).data;

  return {
    hash: computeDhashFromRgba(hashPixels, 9, 8),
    averageColor: computeAverageColorFromRgba(hashPixels),
    modelFeatures: computeModelFeatures(modelPixels),
  };
}

function computeAverageColorFromRgba(buffer: Uint8ClampedArray): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  const pixels = buffer.length / 4;
  for (let offset = 0; offset < buffer.length; offset += 4) {
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

function computeDhashFromRgba(buffer: Uint8ClampedArray, width: number, height: number): string {
  let bits = "";
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const left = rgbaToGray(buffer, row * width + column);
      const right = rgbaToGray(buffer, row * width + column + 1);
      bits += left > right ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

function rgbaToGray(buffer: Uint8ClampedArray, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  return Math.round(buffer[offset] * 0.299 + buffer[offset + 1] * 0.587 + buffer[offset + 2] * 0.114);
}

function computeModelFeatures(buffer: Uint8ClampedArray): number[] {
  const features: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const gray = Math.round(buffer[offset] * 0.299 + buffer[offset + 1] * 0.587 + buffer[offset + 2] * 0.114);
    features.push(gray / 255);
  }
  return features;
}

function bitsToHex(bits: string): string {
  const bytes: string[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    const byte = Number.parseInt(bits.slice(index, index + 8), 2);
    bytes.push(byte.toString(16).padStart(2, "0"));
  }
  return bytes.join("");
}
