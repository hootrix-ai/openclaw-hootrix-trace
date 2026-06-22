import { describe, expect, test } from "vitest";
import {
  applyRegisteredMediaPlaceholders,
  normalizeMediaRefPlaceholders,
  registerMediaRef,
  resetMediaPlaceholderRegistry,
} from "./attachment-placeholder-registry.js";
import { sanitizeStringForHootrix } from "./payload-sanitizer.js";

describe("attachment placeholder registry", () => {
  test("replaces registered media refs during sanitize", () => {
    resetMediaPlaceholderRegistry();
    registerMediaRef("media:/inbound/abc.jpg", {
      placeholder: "[media-ref:deadbeef01234567:abc.jpg]",
      contentHash: "deadbeef0123456789deadbeef0123456789deadbeef0123456789deadbeef01",
      fileName: "abc.jpg",
      fileSize: 10,
    });
    const out = sanitizeStringForHootrix("see media:/inbound/abc.jpg please");
    expect(out).toBe("see [media-ref:deadbeef01234567:abc.jpg] please");
    resetMediaPlaceholderRegistry();
  });

  test("prefers longer media-prefixed source keys", () => {
    resetMediaPlaceholderRegistry();
    registerMediaRef("/inbound/abc.jpg", {
      placeholder: "[media-ref:deadbeef01234567:abc.jpg]",
      contentHash: "deadbeef0123456789deadbeef0123456789deadbeef0123456789deadbeef01",
      fileName: "abc.jpg",
      fileSize: 10,
    });
    const out = applyRegisteredMediaPlaceholders("tool media:/inbound/abc.jpg");
    expect(out).toBe("tool [media-ref:deadbeef01234567:abc.jpg]");
    resetMediaPlaceholderRegistry();
  });

  test("normalizes media-prefixed placeholder wrappers", () => {
    expect(
      normalizeMediaRefPlaceholders(
        "image=media:/[media-ref:abc123456789abcd:photo.jpg]",
      ),
    ).toBe("image=[media-ref:abc123456789abcd:photo.jpg]");
  });
});
