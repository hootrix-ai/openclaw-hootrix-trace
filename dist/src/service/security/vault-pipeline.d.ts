import type { ExtendedRedactionRule, SanitizeOutcome, RedactionAuditFinding, PolicyScanField } from "./types.js";
/** Merge audit findings by policy_id, summing match_count. */
export declare function mergeAuditFindings(base: RedactionAuditFinding[], incoming: RedactionAuditFinding[]): RedactionAuditFinding[];
/** Scan plain text for audit_only rules targeting the given field. */
export declare function scanAuditOnlyFindings(text: string, rules: ExtendedRedactionRule[], regexById: Map<string, RegExp>, scanField: PolicyScanField): RedactionAuditFinding[];
export declare function compileRules(rules: ExtendedRedactionRule[]): Map<string, RegExp>;
/**
 * Process a single text segment according to rules: observe only counts; enforce replaces.
 */
export declare function processTextSegment(text: string, rules: ExtendedRedactionRule[], regexById: Map<string, RegExp>, auditScanField?: PolicyScanField): {
    text: string;
    shadowHits: number;
    replacements: number;
    block: boolean;
    auditFindings: RedactionAuditFinding[];
};
export declare function deepSanitizeStrings(input: unknown, rules: ExtendedRedactionRule[], precompiledRegexById?: Map<string, RegExp>, options?: {
    auditScanField?: PolicyScanField;
}): SanitizeOutcome;
