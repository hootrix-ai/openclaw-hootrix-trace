import { describe, expect, it } from "vitest";
import { maskMatch, maskQuarterEnds } from "./mask-match.js";

describe("maskQuarterEnds", () => {
  it("matches collector len/4 algorithm for email", () => {
    const email = "71973803531@qq.com";
    const masked = maskQuarterEnds(email);
    expect(masked).toBe("7197**********.com");
    expect(masked).not.toBe(email);
  });
});

describe("maskMatch", () => {
  it("returns block and hash placeholders", () => {
    expect(maskMatch("secret", "block")).toBe("[REDACTED_BLOCK]");
    expect(maskMatch("secret", "hash")).toMatch(/^\[REDACTED_HASH:[0-9a-f]{12}\]$/);
  });
});
