/**
 * Canonical sensitive-value mask (aligned with Collector policyredact.MaskMatch):
 * keep first len/4 + last len/4 characters, replace the middle with asterisks.
 */
export declare function maskQuarterEnds(text: string): string;
export declare function maskMatch(text: string, redactType: string): string;
