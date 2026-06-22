/**
 * Policy regex pattern normalization.
 */
/**
 * Strategy regex: only trim, consistent with Collector / plugin internal `new RegExp(source, "g")` semantics.
 */
export declare function normalizePolicyPatternForMatching(pattern: string): string;
/** @returns Split for use with `new RegExp(source, flags)`; flags fixed to `g`. */
export declare function normalizePolicyPatternForJsRegExp(pattern: string): {
    source: string;
    flags: string;
};
