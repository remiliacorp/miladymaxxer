export type FilterMode = "off" | "hide" | "scale" | "fade";

export interface ExtensionSettings {
  mode: FilterMode;
}

export interface HashEntry {
  tokenId: number;
  variant: string;
  hash: string;
  averageColor: [number, number, number];
}

export interface HashDatabase {
  collection: string;
  algorithm: string;
  generatedAt: string;
  hashes: HashEntry[];
}

export interface ModelMetadata {
  collection: string;
  generatedAt: string;
  inputLength: number;
  threshold: number;
}

export interface CandidateScore {
  distance: number;
  entry: HashEntry;
}

export interface DetectionResult {
  matched: boolean;
  source: "phash" | "onnx" | null;
  score: number | null;
  tokenId: number | null;
}

export interface WorkerRequest {
  id: string;
  features: number[];
}

export interface WorkerResponse {
  id: string;
  score: number;
}
