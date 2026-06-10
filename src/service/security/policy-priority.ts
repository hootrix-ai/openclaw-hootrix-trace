/**
 * Policy priority sorting - aligns with Collector `policy-query`:
 * Execution order when multiple policies match: data_mask > audit
 */

export function effectivePolicyActionForPriority(
  policyAction: string | null | undefined,
  redactType: string | null | undefined,
): string {
  const pa = String(policyAction ?? "").trim().toLowerCase();
  if (pa) {
    if (pa === "abort_run") {
      return "data_mask";
    }
    return pa;
  }
  const rt = String(redactType ?? "").trim().toLowerCase();
  if (rt === "block") {
    return "data_mask";
  }
  return "data_mask";
}

export function policyActionPriorityRank(action: string | null | undefined): number {
  const a = String(action ?? "data_mask").trim().toLowerCase();
  if (a === "audit_only") {
    return 1;
  }
  return 2;
}

export function compareRedactionRulesByPolicyPriority(
  a: { id: string; policyAction?: string; redactType?: string },
  b: { id: string; policyAction?: string; redactType?: string },
): number {
  const ra = policyActionPriorityRank(effectivePolicyActionForPriority(a.policyAction, a.redactType));
  const rb = policyActionPriorityRank(effectivePolicyActionForPriority(b.policyAction, b.redactType));
  if (rb !== ra) {
    return rb - ra;
  }
  return a.id.localeCompare(b.id);
}

export function sortRulesByPolicyPriority<T extends { id: string; policyAction?: string; redactType?: string }>(
  rules: readonly T[],
): T[] {
  return rules.slice().sort(compareRedactionRulesByPolicyPriority);
}
