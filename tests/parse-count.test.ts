import { describe, expect, it } from "vitest";

import { parseCount } from "../src/shared/parse-count";

describe("parseCount", () => {
  it("parses plain integers", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount("5")).toBe(5);
    expect(parseCount("100")).toBe(100);
  });

  it("parses K suffix (thousands)", () => {
    expect(parseCount("1K")).toBe(1000);
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("15.7K")).toBe(15700);
  });

  it("parses lowercase k suffix", () => {
    expect(parseCount("1k")).toBe(1000);
    expect(parseCount("2.5k")).toBe(2500);
  });

  it("parses M suffix (millions)", () => {
    expect(parseCount("1M")).toBe(1000000);
    expect(parseCount("2.5M")).toBe(2500000);
  });

  it("parses lowercase m suffix", () => {
    expect(parseCount("1m")).toBe(1000000);
    expect(parseCount("3.1m")).toBe(3100000);
  });

  it("returns 0 for empty string", () => {
    expect(parseCount("")).toBe(0);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseCount("abc")).toBe(0);
  });
});
