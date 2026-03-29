import { describe, expect, it } from "vitest";

import { getLevel, getLevelProgress } from "../src/shared/levels";

describe("getLevel", () => {
  it("returns 0 for 0 likes", () => {
    expect(getLevel(0)).toBe(0);
  });

  it("returns 1 for 1 like", () => {
    expect(getLevel(1)).toBe(1);
  });

  it("returns 1 for likes below level 2 threshold", () => {
    expect(getLevel(2)).toBe(1);
    expect(getLevel(3)).toBe(1);
  });

  it("returns 2 at exactly 4 likes", () => {
    expect(getLevel(4)).toBe(2);
  });

  it("returns 3 at exactly 9 likes", () => {
    expect(getLevel(9)).toBe(3);
  });

  it("returns correct level at perfect squares", () => {
    expect(getLevel(16)).toBe(4);
    expect(getLevel(25)).toBe(5);
    expect(getLevel(100)).toBe(10);
  });

  it("returns previous level just below a threshold", () => {
    expect(getLevel(8)).toBe(2);
    expect(getLevel(15)).toBe(3);
    expect(getLevel(99)).toBe(9);
  });
});

describe("getLevelProgress", () => {
  it("returns zero progress at level 0", () => {
    const progress = getLevelProgress(0);
    expect(progress).toEqual({ level: 0, current: 0, needed: 1 });
  });

  it("returns 1 progress at level 1 with first like", () => {
    const progress = getLevelProgress(1);
    expect(progress).toEqual({ level: 1, current: 1, needed: 3 });
  });

  it("returns full progress just before level up", () => {
    const progress = getLevelProgress(3);
    expect(progress).toEqual({ level: 1, current: 2, needed: 3 });
  });

  it("returns 1 progress right at a level boundary (postsLiked > 0)", () => {
    const progress = getLevelProgress(4);
    expect(progress).toEqual({ level: 2, current: 1, needed: 5 });
  });

  it("returns mid-level progress", () => {
    const progress = getLevelProgress(6);
    expect(progress).toEqual({ level: 2, current: 2, needed: 5 });
  });

  it("works at higher levels", () => {
    const progress = getLevelProgress(105);
    expect(progress).toEqual({ level: 10, current: 5, needed: 21 });
  });
});
