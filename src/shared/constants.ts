import type { ExtensionSettings } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  mode: "off",
};

export const HASH_MATCH_THRESHOLD = 8;
export const HASH_ONNX_THRESHOLD = 18;
export const COLOR_DISTANCE_THRESHOLD = 120;
export const MODEL_INPUT_LENGTH = 32 * 32;
export const HASH_URL = "generated/milady-maker.hashes.json";
export const MODEL_METADATA_URL = "generated/milady-prototype.meta.json";
export const MODEL_URL = "models/milady-prototype.onnx";
