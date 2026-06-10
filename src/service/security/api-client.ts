/**
 * Unified API client for collector service.
 * Centralizes all HTTP dependencies to ensure consistent
 * header handling, URL construction, and error management.
 */

import { collectorFetch } from "../../collector-fetch.js";
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

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Collector security policy sync workspace (consistent with plugin-side redaction rule source). */
export const POLICY_PULL_WORKSPACE_NAME = "OpenClaw";
export const policiesURI = "/v1/policies";

/**
 * GET /v1/policies?workspace_name=OpenClaw&update_pulled=true — Plugin's only policy fetch entrypoint
 * (server-side also updates pulled timestamp).
 */
export async function fetchPolicies(config: CollectorConfig): Promise<ApiResponse<PolicyItem[]>> {
  const url = `${normalizeBaseUrl(config.baseUrl)}${policiesURI}?workspace_name=${encodeURIComponent(
    POLICY_PULL_WORKSPACE_NAME,
  )}&update_pulled=true`;

  try {
    const res = await collectorFetch(url, {
      headers: buildHeaders(config.apiKey),
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${await res.text()}`,
      };
    }

    const data = (await res.json()) as PolicyItem[];
    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse raw policy items into RedactionRule objects.
 */
const ALLOWED_POLICY_TARGETS = new Set(["prompt", "assistantTexts", "tool_params"]);

export function sanitizePolicyTargets(targets: string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of targets ?? []) {
    const t = String(raw ?? "").trim();
    if (!t || !ALLOWED_POLICY_TARGETS.has(t) || out.includes(t)) {
      continue;
    }
    out.push(t);
  }
  return out.length > 0 ? out : ["prompt", "assistantTexts"];
}

export function sanitizePolicyTargetsForAction(
  targets: string[] | undefined | null,
  _policyAction?: string | undefined | null,
): string[] {
  return sanitizePolicyTargets(targets);
}

export function parsePolicies(rawPolicies: PolicyItem[]): RedactionRule[] {
  const rules: RedactionRule[] = [];

  for (const p of rawPolicies) {
    let targets: string[] = [];
    try {
      const raw = p.targets_json;
      targets =
        typeof raw === "string" && raw.trim()
          ? (JSON.parse(raw) as string[])
          : Array.isArray(raw)
            ? (raw as string[])
            : [];
    } catch {
      targets = [];
    }
    targets = sanitizePolicyTargetsForAction(targets, typeof p.policy_action === "string" ? p.policy_action : undefined);

    const id = String(p.id ?? "");
    const pattern = String(p.pattern ?? "");
    if (!id || !pattern) {
      continue;
    }

    const rt = p.redact_type;
    const redactType = rt === "mask" || rt === "hash" || rt === "block" ? rt : "mask";

    // More permissive enabled parsing: support 1, "1", true, "true"
    const enabledRaw = p.enabled;
    const enabled = enabledRaw === 1 || enabledRaw === true || enabledRaw === "1" || enabledRaw === "true";

    rules.push({
      id,
      name: String(p.name ?? id),
      pattern,
      redactType,
      targets,
      enabled,
      severity: typeof p.severity === "string" ? p.severity : undefined,
      policyAction: typeof p.policy_action === "string" ? p.policy_action : undefined,
    });
  }

  return rules;
}
