export type FilterMode = "off" | "milady" | "debug";

export interface ExtensionSettings {
  mode: FilterMode;
  whitelistHandles: string[];
  soundEnabled: boolean;
}

export interface DetectionStats {
  tweetsScanned: number;
  avatarsChecked: number;
  cacheHits: number;
  postsMatched: number;
  modelMatches: number;
  errors: number;
  lastMatchAt: string | null;
}

export interface MatchedAccount {
  handle: string;
  displayName: string | null;
  postsMatched: number;
  lastMatchedAt: string | null;
  lastDetectionScore: number | null;
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
  heuristicSource: "onnx" | null;
  heuristicScore: number | null;
  heuristicTokenId: number | null;
  whitelisted: boolean;
}

export type CollectedAvatarMap = Record<string, CollectedAvatar>;

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

export interface DetectionResult {
  matched: boolean;
  source: "onnx" | null;
  score: number | null;
  tokenId: number | null;
  debugLabel?: string | null;
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
