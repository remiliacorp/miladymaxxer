import { describe, expect, it } from "vitest";

import { LRUCache } from "../src/shared/lru-cache";

describe("LRUCache", () => {
  it("returns the value for a key that was set", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("returns undefined for a cache miss", () => {
    const cache = new LRUCache<string, number>(3);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the oldest entry when the cache is full", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Cache is full; inserting "d" should evict "a" (oldest)
    cache.set("d", 4);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("promotes a recently accessed entry so it survives eviction", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Access "a" to make it most-recently-used
    cache.get("a");
    // Insert "d" — now "b" is the oldest and should be evicted
    cache.set("d", 4);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("has() returns true for existing keys and false for missing ones", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("z")).toBe(false);
  });

  it("has() returns false after a key is evicted", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("overwriting an existing key does not grow the cache", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // Overwrite "a" — cache should still have size 2, and "a" moves to most recent
    cache.set("a", 100);
    // Don't call get() here as it changes LRU order
    // Insert "c" — should evict "b" (oldest after "a" was refreshed)
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(100);
    expect(cache.get("c")).toBe(3);
  });

  it("works correctly with a maxSize of 1", () => {
    const cache = new LRUCache<string, number>(1);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    // Inserting a second key evicts the first
    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    // Overwriting the sole entry keeps it
    cache.set("b", 99);
    expect(cache.get("b")).toBe(99);
  });
});
