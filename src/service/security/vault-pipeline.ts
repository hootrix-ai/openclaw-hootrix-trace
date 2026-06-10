import type { ExtendedRedactionRule, SanitizeOutcome, RedactionRule, RedactionAuditFinding, PolicyScanField } from "./types.js";
import { sortRulesByPolicyPriority } from "./policy-priority.js";
import { normalizePolicyPatternForJsRegExp } from "./pattern-normalize.js";
import { maskMatch } from "./mask-match.js";

function ruleMatchesTarget(rule: ExtendedRedactionRule, field: PolicyScanField): boolean {
  const targets = rule.targets?.length ? rule.targets : ["prompt", "assistantTexts"];
  return targets.includes(field);
}

function collectRegexMatches(re: RegExp, text: string): Array<{ text: string; start: number; end: number }> {
  const matches: Array<{ text: string; start: number; end: number }> = [];
  re.lastIndex = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) {
      break;
    }
    matches.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    if (m[0] === "") {
      re.lastIndex += 1;
    }
    if (matches.length > 10_000) {
      break;
    }
  }
  re.lastIndex = 0;
  return matches;
}

function buildAuditFinding(
  rule: ExtendedRedactionRule,
  matches: Array<{ text: string; start: number; end: number }>,
  scanField: PolicyScanField,
): RedactionAuditFinding {
  const firstMatch = matches[0];
  const positionKey =
    scanField === "assistantTexts" ? "assistantTexts" : scanField === "tool_params" ? "toolParams" : "prompt";
  const spanField =
    scanField === "assistantTexts" ? "output_json" : scanField === "tool_params" ? "metadata_json" : "input_json";
  return {
    policy_id: rule.id,
    policy_name: rule.name ?? rule.id,
    severity: rule.severity ?? "medium",
    detection_kind: "regex",
    pattern: rule.pattern ?? "",
    match_count: matches.length,
    policy_action:
      String(rule.policyAction ?? "").trim().toLowerCase() ||
      (rule.redactType === "block" ? "data_mask" : "data_mask"),
    redact_type: rule.redactType,
    hit_fields: [scanField],
    span_fields: [spanField],
    position: {
      [positionKey]: {
        match_text: firstMatch.text,
        match_count: matches.length,
        offset: matches.map((m) => [m.start, m.end] as [number, number]),
        mask_text: maskMatch(firstMatch.text, rule.redactType ?? "mask"),
      },
    },
  };
}

/** Merge audit findings by policy_id, summing match_count. */
export function mergeAuditFindings(
  base: RedactionAuditFinding[],
  incoming: RedactionAuditFinding[],
): RedactionAuditFinding[] {
  const byId = new Map<string, RedactionAuditFinding>();
  for (const f of [...base, ...incoming]) {
    const prev = byId.get(f.policy_id);
    if (!prev) {
      byId.set(f.policy_id, { ...f });
      continue;
    }
    prev.match_count += f.match_count;
  }
  return [...byId.values()];
}

/** Scan plain text for audit_only rules targeting the given field. */
export function scanAuditOnlyFindings(
  text: string,
  rules: ExtendedRedactionRule[],
  regexById: Map<string, RegExp>,
  scanField: PolicyScanField,
): RedactionAuditFinding[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const findings: RedactionAuditFinding[] = [];
  for (const rule of sortRulesByPolicyPriority(rules)) {
    if (!rule.enabled) {
      continue;
    }
    const action = String(rule.policyAction ?? "data_mask")
      .trim()
      .toLowerCase();
    if (action !== "audit_only" || !ruleMatchesTarget(rule, scanField)) {
      continue;
    }
    const re = regexById.get(rule.id);
    if (!re) {
      continue;
    }
    try {
      const matches = collectRegexMatches(re, trimmed);
      if (matches.length > 0) {
        findings.push(buildAuditFinding(rule, matches, scanField));
      }
    } catch (err) {
      console.error(`[Crabagent policy] audit scan failed rule=${rule.id} name=${rule.name ?? ""}`, err);
    }
  }
  return findings;
}

export function compileRules(rules: ExtendedRedactionRule[]): Map<string, RegExp> {
  const m = new Map<string, RegExp>();
  for (const r of rules) {
    if (!r.enabled) {
      continue;
    }
    try {
      const { source, flags } = normalizePolicyPatternForJsRegExp(r.pattern);
      m.set(r.id, new RegExp(source, flags));
    } catch (err) {
      const preview = String(r.pattern ?? "").slice(0, 160);
      console.error(`[Crabagent policy] compile failed rule=${r.id} patternPreview=${JSON.stringify(preview)}`, err);
    }
  }
  return m;
}

function redactWithSingleRule(match: string, rule: RedactionRule): string {
  switch (rule.redactType) {
    case "mask":
      if (match.length <= 2) {
        return "*".repeat(match.length);
      }
      return match[0] + "*".repeat(match.length - 2) + match[match.length - 1];
    case "hash": {
      let hash = 0;
      for (let i = 0; i < match.length; i++) {
        const char = match.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const hashStr = Math.abs(hash).toString(16).padStart(8, "0");
      return `[HASH:${hashStr}]`;
    }
    case "block":
      return "[REDACTED]";
    default:
      return match;
  }
}

function applyReplace(match: string, rule: ExtendedRedactionRule): string {
  const action =
    String(rule.policyAction ?? "").trim().toLowerCase() ||
    (rule.redactType === "block" ? "data_mask" : "data_mask");
  switch (action) {
    case "audit_only":
      return match;
    case "data_mask":
    default:
      return redactWithSingleRule(match, rule);
  }
}

/**
 * Process a single text segment according to rules: observe only counts; enforce replaces.
 */
export function processTextSegment(
  text: string,
  rules: ExtendedRedactionRule[],
  regexById: Map<string, RegExp>,
  auditScanField?: PolicyScanField,
): { text: string; shadowHits: number; replacements: number; block: boolean; auditFindings: RedactionAuditFinding[] } {
  let shadowHits = 0;
  let replacements = 0;
  let block = false;
  let out = text;
  const auditFindings: RedactionAuditFinding[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const re = regexById.get(rule.id);
    if (!re) {
      continue;
    }
    const action =
      String(rule.policyAction ?? "").trim().toLowerCase() ||
      (rule.redactType === "block" ? "data_mask" : "data_mask");
    try {
      if (action === "audit_only") {
        if (auditScanField && ruleMatchesTarget(rule, auditScanField)) {
          const matches = collectRegexMatches(re, out);
          if (matches.length > 0) {
            shadowHits += matches.length;
            auditFindings.push(buildAuditFinding(rule, matches, auditScanField));
          }
        } else {
          const m = out.match(re);
          if (m) {
            shadowHits += m.length;
          }
        }
        continue;
      }
      if (action === "data_mask") {
        // Display-time masking is handled by Collector on read; plugin does not rewrite.
        continue;
      }

      re.lastIndex = 0;
      const newStr = out.replace(re, (match) => {
        replacements += 1;
        return applyReplace(match, rule);
      });
      out = newStr;
    } catch (err) {
      console.error(`[Crabagent policy] match failed rule=${rule.id} name=${rule.name ?? ""}`, err);
    } finally {
      try {
        re.lastIndex = 0;
      } catch {
        /* ignore */
      }
    }
  }

  return { text: out, shadowHits, replacements, block, auditFindings };
}

export function deepSanitizeStrings(
  input: unknown,
  rules: ExtendedRedactionRule[],
  precompiledRegexById?: Map<string, RegExp>,
  options?: { auditScanField?: PolicyScanField },
): SanitizeOutcome {
  const orderedRules = sortRulesByPolicyPriority(rules);
  const regexById = precompiledRegexById ?? compileRules(orderedRules);
  let shadowHits = 0;
  let replacements = 0;
  let block = false;
  let auditFindings: RedactionAuditFinding[] | undefined;
  const auditScanField = options?.auditScanField;

  const walk = (v: unknown): unknown => {
    if (block) {
      return v;
    }
    if (typeof v === "string") {
      const r = processTextSegment(v, orderedRules, regexById, auditScanField);
      shadowHits += r.shadowHits;
      replacements += r.replacements;
      if (r.auditFindings.length > 0) {
        auditFindings = mergeAuditFindings(auditFindings ?? [], r.auditFindings);
      }
      if (r.block) {
        block = true;
      }
      return r.text;
    }
    if (!v || typeof v !== "object") {
      return v;
    }
    if (Array.isArray(v)) {
      return v.map((x) => walk(x));
    }
    const o = v as Record<string, unknown>;
    const next: Record<string, unknown> = { ...o };
    for (const k of Object.keys(next)) {
      next[k] = walk(next[k]);
    }
    return next;
  };

  const value = walk(input);
  return {
    value: block ? input : value,
    block,
    shadowHits,
    replacements,
    ...(auditFindings?.length ? { auditFindings } : {}),
  };
}
