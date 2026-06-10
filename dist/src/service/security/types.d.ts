/**
 * Security policy types for data redaction and access control.
 */
export type RedactionType = "mask" | "hash" | "block";
export type PolicyAction = "data_mask" | "audit_only";
export interface RedactionRule {
    id: string;
    name: string;
    pattern: string;
    redactType: RedactionType;
    targets: string[];
    enabled: boolean;
    /** Collector extension: severity level */
    severity?: string;
    /** Policy action (takes precedence over redactType when both present) */
    policyAction?: string;
}
export type ExtendedRedactionRule = RedactionRule & {
    severity?: "low" | "high" | "critical";
    policyAction?: PolicyAction;
};
export type SanitizeOutcome = {
    /** The rewritten object (deep clone) */
    value: unknown;
    /** Whether replacements were applied in enforce mode */
    block: boolean;
    /** Number of replacements in enforce mode */
    replacements: number;
    /** Number of sensitive hits detected in observe mode */
    shadowHits: number;
    /** audit_only policy hits collected when auditScanField is set */
    auditFindings?: RedactionAuditFinding[];
};
export type PolicyScanField = "prompt" | "assistantTexts" | "tool_params";
export type LocationType = "user_prompt" | "model_output" | "tool_input_params";
export type LocationInfo = {
    type: LocationType;
    path: string;
    char_position: {
        start: number;
        end: number;
    };
    line_position?: {
        line: number;
        column: number;
    };
};
export type MatchDetail = {
    match_text: string;
    match_count: number;
    offset: [number, number][];
    mask_text: string;
};
export type PositionMap = {
    prompt?: MatchDetail;
    assistantTexts?: MatchDetail;
    toolParams?: MatchDetail;
    metadata?: MatchDetail;
};
export type RedactionAuditFinding = {
    policy_id: string;
    policy_name: string;
    severity: string;
    detection_kind: string;
    pattern: string;
    match_count: number;
    policy_action: string;
    redact_type: RedactionType;
    position: PositionMap;
    /** Policy scan target (prompt, assistantTexts, toolParams). */
    hit_fields?: string[];
    /** agent_spans storage column (input_json, output_json, metadata_json). */
    span_fields?: string[];
};
export type RedactionAuditInterceptionMeta = {
    version: number;
    intercepted: boolean;
    mode: "enforce" | "observe" | "matched";
    hit_count: number;
    tags: string[];
    policy_ids: string[];
};
export type RedactionAuditSummary = {
    findings: RedactionAuditFinding[];
    hit_count: number;
    intercepted: number;
    observe_only: number;
    interception: RedactionAuditInterceptionMeta | null;
};
