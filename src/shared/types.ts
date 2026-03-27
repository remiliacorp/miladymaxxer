export type FilterMode = "off" | "hide" | "fade" | "debug";

export interface ExtensionSettings {
  mode: FilterMode;
  whitelistHandles: string[];
}

export interface DetectionStats {
  tweetsScanned: number;
  avatarsChecked: number;
  cacheHits: number;
  postsMatched: number;
  phashMatches: number;
  onnxMatches: number;
  errors: number;
  lastMatchAt: string | null;
}

export interface MatchedAccount {
  handle: string;
  displayName: string | null;
  postsMatched: number;
  lastMatchedAt: string | null;
}

export type MatchedAccountMap = Record<string, MatchedAccount>;

export interface CollectedAvatar {
  normalizedUrl: string;
  originalUrl: string;
  handles: string[];
  displayNames: string[];
  sourceSurfaces: string[];
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  exampleProfileUrl: string | null;
  exampleNotificationUrl: string | null;
  exampleTweetUrl: string | null;
  heuristicMatch: boolean | null;
  heuristicSource: "phash" | "onnx" | null;
  heuristicScore: number | null;
  heuristicTokenId: number | null;
  whitelisted: boolean;
}

export type CollectedAvatarMap = Record<string, CollectedAvatar>;

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
  skippedTokenIds?: number[];
}

export interface ModelMetadata {
  architecture?: string;
  classNames?: string[];
  inputSize?: number;
  channels?: number;
  mean?: [number, number, number];
  std?: [number, number, number];
  positiveIndex?: number;
  collection?: string;
  generatedAt: string;
  threshold: number;
  inputLength?: number;
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
  features?: number[];
  tensor?: number[];
  shape?: [number, number, number, number];
}

export interface WorkerResponse {
  id: string;
  score?: number;
  error?: string;
}
