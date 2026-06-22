import type { RedactionRule, RedactionAuditSummary } from "./types.js";
export declare class Redactor {
    private rules;
    private regexCache;
    constructor(rules?: RedactionRule[]);
    updateRules(rules: RedactionRule[]): void;
    /**
     * Recursively traverse and redact specified fields in an object.
     * If field name is in targets, or field value is a string containing sensitive info (optional policy).
     */
    redactObject(obj: unknown): unknown;
    redactString(text: string): string;
    scanObject(obj: unknown): RedactionAuditSummary;
}
