import { describe, expect, it } from "vitest";
import {
  compileRules,
  mergeAuditFindings,
  scanAuditOnlyFindings,
  deepSanitizeStrings,
} from "./vault-pipeline.js";
import type { ExtendedRedactionRule } from "./types.js";

const emailPattern =
  "(?<!://)(?<![\\w.-]:\\S{0,50})\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\\.(?:[a-zA-Z]{2,})\\b(?!:\\d)";

const emailAuditRule: ExtendedRedactionRule = {
  id: "pol-email",
  name: "email audit",
  pattern: emailPattern,
  redactType: "mask",
  targets: ["prompt"],
  enabled: true,
  policyAction: "audit_only",
};

describe("scanAuditOnlyFindings", () => {
  it("matches qq email in Chinese prompt text", () => {
    const regexById = compileRules([emailAuditRule]);
    const findings = scanAuditOnlyFindings(
      "我的邮箱是 719738049@qq.com",
      [emailAuditRule],
      regexById,
      "prompt",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.policy_id).toBe("pol-email");
    expect(findings[0]?.match_count).toBe(1);
    expect(findings[0]?.position.prompt?.match_text).toBe("719738049@qq.com");
  });

  it("skips rules that do not target the scan field", () => {
    const regexById = compileRules([{ ...emailAuditRule, targets: ["assistantTexts"] }]);
    const findings = scanAuditOnlyFindings(
      "719738049@qq.com",
      [{ ...emailAuditRule, targets: ["assistantTexts"] }],
      regexById,
      "prompt",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("deepSanitizeStrings auditFindings", () => {
  it("collects audit_only findings when auditScanField is prompt", () => {
    const out = deepSanitizeStrings("我的邮箱是 719738049@qq.com", [emailAuditRule], undefined, {
      auditScanField: "prompt",
    });
    expect(out.auditFindings).toHaveLength(1);
    expect(out.replacements).toBe(0);
    expect(out.value).toBe("我的邮箱是 719738049@qq.com");
  });
});

describe("deepSanitizeStrings data_mask", () => {
  it("does not rewrite text at plugin runtime", () => {
    const dataMaskRule: ExtendedRedactionRule = {
      ...emailAuditRule,
      policyAction: "data_mask",
    };
    const out = deepSanitizeStrings("我的邮箱是 719738049@qq.com", [dataMaskRule], undefined);
    expect(out.replacements).toBe(0);
    expect(out.value).toBe("我的邮箱是 719738049@qq.com");
  });
});

describe("mergeAuditFindings", () => {
  it("merges by policy_id and sums match_count", () => {
    const base = [{ ...scanAuditOnlyFindings("a@b.com", [emailAuditRule], compileRules([emailAuditRule]), "prompt")[0]! }];
    const incoming = scanAuditOnlyFindings("c@d.com", [emailAuditRule], compileRules([emailAuditRule]), "prompt");
    const merged = mergeAuditFindings(base, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.match_count).toBe(2);
  });
});
