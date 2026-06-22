/**
 * Policy priority sorting - aligns with Collector `policy-query`:
 * Execution order when multiple policies match: data_mask > audit
 */
export declare function effectivePolicyActionForPriority(policyAction: string | null | undefined, redactType: string | null | undefined): string;
export declare function policyActionPriorityRank(action: string | null | undefined): number;
export declare function compareRedactionRulesByPolicyPriority(a: {
    id: string;
    policyAction?: string;
    redactType?: string;
}, b: {
    id: string;
    policyAction?: string;
    redactType?: string;
}): number;
export declare function sortRulesByPolicyPriority<T extends {
    id: string;
    policyAction?: string;
    redactType?: string;
}>(rules: readonly T[]): T[];
