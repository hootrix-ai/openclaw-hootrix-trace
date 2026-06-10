/**
 * Canonical sensitive-value mask (aligned with Collector policyredact.MaskMatch):
 * keep first len/4 + last len/4 characters, replace the middle with asterisks.
 */

import { createHash } from "node:crypto";

export function maskQuarterEnds(text: string): string {
  const m = text;
  if (m.length <= 4) {
    return "*".repeat(m.length);
  }
  const prefixLen = Math.floor(m.length / 4);
  const suffixLen = Math.floor(m.length / 4);
  const maskLen = m.length - prefixLen - suffixLen;
  return m.slice(0, prefixLen) + "*".repeat(maskLen) + m.slice(m.length - suffixLen);
}

export function maskMatch(text: string, redactType: string): string {
  const kind = String(redactType ?? "mask").trim().toLowerCase();
  if (kind === "block") {
    return "[REDACTED_BLOCK]";
  }
  if (kind === "hash") {
    const sum = createHash("sha256").update(text).digest("hex").slice(0, 12);
    return `[REDACTED_HASH:${sum}]`;
  }
  if (kind === "mask" || kind === "") {
    return maskQuarterEnds(text);
  }
  return "[REDACTED]";
}
