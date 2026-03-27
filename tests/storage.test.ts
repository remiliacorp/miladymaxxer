import { describe, expect, it } from "vitest";

import {
  normalizeHandle,
  normalizeMatchedAccounts,
  normalizeStats,
  normalizeWhitelistHandles,
  normalizeCollectedAvatars,
  readNumber,
  uniqueStrings,
} from "../src/shared/storage";

// ---------------------------------------------------------------------------
// normalizeHandle
// ---------------------------------------------------------------------------

describe("normalizeHandle", () => {
  it("strips leading @ signs", () => {
    expect(normalizeHandle("@alice")).toBe("alice");
    expect(normalizeHandle("@@alice")).toBe("alice");
  });

  it("strips leading slashes", () => {
    expect(normalizeHandle("/alice")).toBe("alice");
    expect(normalizeHandle("//alice")).toBe("alice");
  });

  it("lowercases the handle", () => {
    expect(normalizeHandle("Alice")).toBe("alice");
    expect(normalizeHandle("ALICE")).toBe("alice");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHandle("  alice  ")).toBe("alice");
  });

  it("returns empty string for null or undefined", () => {
    expect(normalizeHandle(null)).toBe("");
    expect(normalizeHandle(undefined)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeHandle("")).toBe("");
    expect(normalizeHandle("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// readNumber
// ---------------------------------------------------------------------------

describe("readNumber", () => {
  it("returns the number for valid finite numbers", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
    expect(readNumber(-7.5)).toBe(-7.5);
  });

  it("returns 0 for NaN", () => {
    expect(readNumber(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(readNumber(Infinity)).toBe(0);
    expect(readNumber(-Infinity)).toBe(0);
  });

  it("returns 0 for non-number types", () => {
    expect(readNumber("42")).toBe(0);
    expect(readNumber(null)).toBe(0);
    expect(readNumber(undefined)).toBe(0);
    expect(readNumber(true)).toBe(0);
    expect(readNumber({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeWhitelistHandles
// ---------------------------------------------------------------------------

describe("normalizeWhitelistHandles", () => {
  it("deduplicates handles", () => {
    expect(normalizeWhitelistHandles(["alice", "alice", "bob"])).toEqual(["alice", "bob"]);
  });

  it("sorts handles alphabetically", () => {
    expect(normalizeWhitelistHandles(["charlie", "alice", "bob"])).toEqual(["alice", "bob", "charlie"]);
  });

  it("strips @ from handles", () => {
    expect(normalizeWhitelistHandles(["@alice", "@bob"])).toEqual(["alice", "bob"]);
  });

  it("filters out empty strings", () => {
    expect(normalizeWhitelistHandles(["alice", "", "  ", "@"])).toEqual(["alice"]);
  });

  it("returns default for non-array input", () => {
    expect(normalizeWhitelistHandles(null)).toEqual([]);
    expect(normalizeWhitelistHandles(undefined)).toEqual([]);
    expect(normalizeWhitelistHandles("alice")).toEqual([]);
    expect(normalizeWhitelistHandles(42)).toEqual([]);
    expect(normalizeWhitelistHandles({})).toEqual([]);
  });

  it("lowercases handles and deduplicates after normalization", () => {
    expect(normalizeWhitelistHandles(["Alice", "@alice", "ALICE"])).toEqual(["alice"]);
  });

  it("filters out non-string entries", () => {
    expect(normalizeWhitelistHandles(["alice", 123, null, "bob"])).toEqual(["alice", "bob"]);
  });
});

// ---------------------------------------------------------------------------
// normalizeStats
// ---------------------------------------------------------------------------

describe("normalizeStats", () => {
  it("returns defaults for null/undefined", () => {
    const defaults = {
      tweetsScanned: 0,
      avatarsChecked: 0,
      cacheHits: 0,
      postsMatched: 0,
      modelMatches: 0,
      errors: 0,
      lastMatchAt: null,
    };
    expect(normalizeStats(null)).toEqual(defaults);
    expect(normalizeStats(undefined)).toEqual(defaults);
  });

  it("returns defaults for non-object input", () => {
    expect(normalizeStats("string")).toEqual(expect.objectContaining({ tweetsScanned: 0 }));
    expect(normalizeStats(42)).toEqual(expect.objectContaining({ tweetsScanned: 0 }));
  });

  it("reads valid stats", () => {
    const input = {
      tweetsScanned: 100,
      avatarsChecked: 50,
      cacheHits: 25,
      postsMatched: 10,
      modelMatches: 5,
      errors: 2,
      lastMatchAt: "2026-01-01T00:00:00Z",
    };
    expect(normalizeStats(input)).toEqual(input);
  });

  it("fills missing fields with defaults", () => {
    const result = normalizeStats({ tweetsScanned: 10 });
    expect(result.tweetsScanned).toBe(10);
    expect(result.avatarsChecked).toBe(0);
    expect(result.lastMatchAt).toBeNull();
  });

  it("handles legacy onnxMatches field", () => {
    const input = { onnxMatches: 7 };
    const result = normalizeStats(input);
    expect(result.modelMatches).toBe(7);
  });

  it("prefers modelMatches over onnxMatches when both present", () => {
    const input = { modelMatches: 10, onnxMatches: 5 };
    const result = normalizeStats(input);
    expect(result.modelMatches).toBe(10);
  });

  it("falls back to onnxMatches when modelMatches is 0", () => {
    const input = { modelMatches: 0, onnxMatches: 3 };
    const result = normalizeStats(input);
    expect(result.modelMatches).toBe(3);
  });

  it("coerces invalid lastMatchAt to null", () => {
    expect(normalizeStats({ lastMatchAt: 42 }).lastMatchAt).toBeNull();
    expect(normalizeStats({ lastMatchAt: null }).lastMatchAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeMatchedAccounts
// ---------------------------------------------------------------------------

describe("normalizeMatchedAccounts", () => {
  it("returns empty object for null/undefined", () => {
    expect(normalizeMatchedAccounts(null)).toEqual({});
    expect(normalizeMatchedAccounts(undefined)).toEqual({});
  });

  it("returns empty object for non-object input", () => {
    expect(normalizeMatchedAccounts("string")).toEqual({});
    expect(normalizeMatchedAccounts(42)).toEqual({});
  });

  it("skips non-object entries", () => {
    expect(normalizeMatchedAccounts({ alice: "not-an-object", bob: 42 })).toEqual({});
  });

  it("normalizes handles (lowercase, strip @)", () => {
    const input = {
      "@Alice": { handle: "@Alice", displayName: "Alice", postsMatched: 1, lastMatchedAt: null, lastDetectionScore: null },
    };
    const result = normalizeMatchedAccounts(input);
    expect(result).toHaveProperty("alice");
    expect(result.alice.handle).toBe("alice");
  });

  it("falls back to key when handle field is empty", () => {
    const input = {
      bob: { handle: "", displayName: "Bob", postsMatched: 1, lastMatchedAt: null, lastDetectionScore: null },
    };
    const result = normalizeMatchedAccounts(input);
    expect(result).toHaveProperty("bob");
    expect(result.bob.handle).toBe("bob");
  });

  it("preserves all fields including lastDetectionScore", () => {
    const input = {
      alice: {
        handle: "alice",
        displayName: "Alice W",
        postsMatched: 5,
        lastMatchedAt: "2026-01-01T00:00:00Z",
        lastDetectionScore: 0.95,
      },
    };
    const result = normalizeMatchedAccounts(input);
    expect(result.alice).toEqual({
      handle: "alice",
      displayName: "Alice W",
      postsMatched: 5,
      lastMatchedAt: "2026-01-01T00:00:00Z",
      lastDetectionScore: 0.95,
    });
  });

  it("coerces invalid lastDetectionScore to null", () => {
    const input = {
      alice: { handle: "alice", displayName: null, postsMatched: 0, lastMatchedAt: null, lastDetectionScore: NaN },
    };
    const result = normalizeMatchedAccounts(input);
    expect(result.alice.lastDetectionScore).toBeNull();
  });

  it("coerces non-number lastDetectionScore to null", () => {
    const input = {
      alice: { handle: "alice", displayName: null, postsMatched: 0, lastMatchedAt: null, lastDetectionScore: "high" },
    };
    const result = normalizeMatchedAccounts(input);
    expect(result.alice.lastDetectionScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeCollectedAvatars
// ---------------------------------------------------------------------------

describe("normalizeCollectedAvatars", () => {
  it("returns empty object for null/undefined", () => {
    expect(normalizeCollectedAvatars(null)).toEqual({});
    expect(normalizeCollectedAvatars(undefined)).toEqual({});
  });

  it("returns empty object for non-object input", () => {
    expect(normalizeCollectedAvatars("bad")).toEqual({});
  });

  it("skips non-object entries", () => {
    expect(normalizeCollectedAvatars({ url1: "not-object" })).toEqual({});
  });

  it("normalizes a valid collected avatar entry", () => {
    const input = {
      "https://example.com/img.jpg": {
        normalizedUrl: "https://example.com/img.jpg",
        originalUrl: "https://example.com/img_original.jpg",
        handles: ["Alice", "@bob"],
        displayNames: ["Alice", "Bob"],
        sourceSurfaces: ["timeline"],
        seenCount: 3,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-03-01T00:00:00Z",
        exampleProfileUrl: "https://x.com/alice",
        exampleNotificationUrl: null,
        exampleTweetUrl: null,
        heuristicMatch: true,
        heuristicSource: "onnx",
        heuristicScore: 0.9,
        heuristicTokenId: 42,
        whitelisted: false,
      },
    };
    const result = normalizeCollectedAvatars(input);
    const entry = result["https://example.com/img.jpg"];
    expect(entry).toBeDefined();
    expect(entry.handles).toEqual(["alice", "bob"]);
    expect(entry.seenCount).toBe(3);
    expect(entry.heuristicSource).toBe("onnx");
    expect(entry.whitelisted).toBe(false);
  });

  it("falls back to key when normalizedUrl is missing", () => {
    const input = {
      "https://example.com/img.jpg": {
        originalUrl: "https://example.com/img.jpg",
        handles: [],
        displayNames: [],
        sourceSurfaces: [],
        seenCount: 1,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
      },
    };
    const result = normalizeCollectedAvatars(input);
    expect(result).toHaveProperty("https://example.com/img.jpg");
    expect(result["https://example.com/img.jpg"].normalizedUrl).toBe("https://example.com/img.jpg");
  });

  it("defaults whitelisted to false when not boolean", () => {
    const input = {
      "https://example.com/img.jpg": {
        normalizedUrl: "https://example.com/img.jpg",
        handles: [],
        displayNames: [],
        sourceSurfaces: [],
        seenCount: 0,
      },
    };
    const result = normalizeCollectedAvatars(input);
    expect(result["https://example.com/img.jpg"].whitelisted).toBe(false);
  });

  it("rejects non-onnx heuristicSource values", () => {
    const input = {
      "https://example.com/img.jpg": {
        normalizedUrl: "https://example.com/img.jpg",
        handles: [],
        displayNames: [],
        sourceSurfaces: [],
        seenCount: 0,
        heuristicSource: "custom",
      },
    };
    const result = normalizeCollectedAvatars(input);
    expect(result["https://example.com/img.jpg"].heuristicSource).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// uniqueStrings
// ---------------------------------------------------------------------------

describe("uniqueStrings", () => {
  it("deduplicates values", () => {
    expect(uniqueStrings(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("sorts alphabetically", () => {
    expect(uniqueStrings(["c", "a", "b"])).toEqual(["a", "b", "c"]);
  });

  it("filters out empty strings", () => {
    expect(uniqueStrings(["a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("applies a custom mapper", () => {
    const result = uniqueStrings(["Alice", "BOB", "alice"], (s) => s.toLowerCase());
    expect(result).toEqual(["alice", "bob"]);
  });

  it("trims by default when no mapper is provided", () => {
    expect(uniqueStrings(["  hello  ", "world  "])).toEqual(["hello", "world"]);
  });

  it("returns empty array for non-array input", () => {
    expect(uniqueStrings(null)).toEqual([]);
    expect(uniqueStrings(undefined)).toEqual([]);
    expect(uniqueStrings("string")).toEqual([]);
    expect(uniqueStrings(42)).toEqual([]);
  });

  it("filters out non-string entries in the array", () => {
    expect(uniqueStrings(["a", 1, null, "b"] as unknown[])).toEqual(["a", "b"]);
  });
});
