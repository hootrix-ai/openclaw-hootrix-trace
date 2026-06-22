/**
 * Policy regex pattern normalization.
 */
/**
 * Strategy regex: only trim, consistent with Collector / plugin internal `new RegExp(source, "g")` semantics.
 */
export function normalizePolicyPatternForMatching(pattern) {
    return String(pattern ?? "").trim();
}
/** @returns Split for use with `new RegExp(source, flags)`; flags fixed to `g`. */
export function normalizePolicyPatternForJsRegExp(pattern) {
    const source = normalizePolicyPatternForMatching(pattern);
    return { source, flags: "g" };
}
