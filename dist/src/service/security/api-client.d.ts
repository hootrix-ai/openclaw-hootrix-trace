/**
 * Unified API client for collector service.
 * Centralizes all HTTP dependencies to ensure consistent
 * header handling, URL construction, and error management.
 */
import type { RedactionRule } from "./types.js";
export type CollectorConfig = {
    baseUrl: string;
    apiKey: string;
};
export type ApiResponse<T> = {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
};
export type PolicyItem = {
    id?: unknown;
    name?: unknown;
    pattern?: unknown;
    targets_json?: unknown;
    redact_type?: unknown;
    enabled?: unknown;
    severity?: unknown;
    policy_action?: unknown;
};
export type PolicySyncResult = {
    rules: RedactionRule[];
    pulledAtMs: number;
};
/** Collector security policy sync workspace (consistent with plugin-side redaction rule source). */
export declare const POLICY_PULL_WORKSPACE_NAME = "OpenClaw";
export declare const policiesURI = "/v1/policies";
/**
 * GET /v1/policies?workspace_name=OpenClaw&update_pulled=true — Plugin's only policy fetch entrypoint
 * (server-side also updates pulled timestamp).
 */
export declare function fetchPolicies(config: CollectorConfig): Promise<ApiResponse<PolicyItem[]>>;
export declare function sanitizePolicyTargets(targets: string[] | undefined | null): string[];
export declare function sanitizePolicyTargetsForAction(targets: string[] | undefined | null, _policyAction?: string | undefined | null): string[];
export declare function parsePolicies(rawPolicies: PolicyItem[]): RedactionRule[];
