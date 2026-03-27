import { describe, expect, it } from "vitest";

import { colorDistance, hammingDistance, normalizeProfileImageUrl } from "../src/shared/image-core";

describe("normalizeProfileImageUrl", () => {
  it("upgrades Twitter avatar sizes to 400x400", () => {
    expect(
      normalizeProfileImageUrl("https://pbs.twimg.com/profile_images/123/example_normal.jpg?foo=bar"),
    ).toBe("https://pbs.twimg.com/profile_images/123/example_400x400.jpg");
  });
});

describe("hammingDistance", () => {
  it("counts differing bits for equal-length hex strings", () => {
    expect(hammingDistance("00ff", "00f0")).toBe(4);
  });
});

describe("colorDistance", () => {
  it("sums per-channel differences", () => {
    expect(colorDistance([10, 20, 30], [13, 15, 40])).toBe(18);
  });
});
