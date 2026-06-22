import { sortRulesByPolicyPriority } from "./policy-priority.js";
import { normalizePolicyPatternForJsRegExp } from "./pattern-normalize.js";
import { maskMatch } from "./mask-match.js";
export class Redactor {
    rules = [];
    regexCache = new Map();
    constructor(rules = []) {
        this.updateRules(rules);
    }
    updateRules(rules) {
        this.rules = sortRulesByPolicyPriority(rules.filter((r) => r.enabled));
        this.regexCache.clear();
        for (const rule of this.rules) {
            try {
                const { source, flags } = normalizePolicyPatternForJsRegExp(rule.pattern);
                this.regexCache.set(rule.id, new RegExp(source, flags));
            }
            catch (err) {
                console.error(`[Redactor] Invalid pattern for rule ${rule.id}: ${rule.pattern}`, err);
            }
        }
    }
    /**
     * Recursively traverse and redact specified fields in an object.
     * If field name is in targets, or field value is a string containing sensitive info (optional policy).
     */
    redactObject(obj) {
        if (!obj || typeof obj !== "object")
            return obj;
        if (Array.isArray(obj)) {
            return obj.map((item) => this.redactObject(item));
        }
        const newObj = { ...obj };
        for (const key in newObj) {
            const value = newObj[key];
            // 1. If value is a string, try global redaction for all rules (not limited to specific key)
            if (typeof value === "string") {
                newObj[key] = this.redactString(value);
            }
            // 2. If value is object/array, process recursively
            else if (typeof value === "object") {
                newObj[key] = this.redactObject(value);
            }
        }
        return newObj;
    }
    redactString(text) {
        let result = text;
        for (const rule of this.rules) {
            const action = String(rule.policyAction ?? (rule.redactType === "block" ? "data_mask" : "data_mask"))
                .trim()
                .toLowerCase();
            if (action === "audit_only" || action === "data_mask" || action === "abort_run") {
                continue;
            }
            const regex = this.regexCache.get(rule.id);
            if (!regex)
                continue;
            try {
                result = result.replace(regex, (match) => {
                    switch (rule.redactType) {
                        case "mask":
                            return maskMatch(match, "mask");
                        case "hash":
                            return maskMatch(match, "hash");
                        case "block":
                            return maskMatch(match, "block");
                        default:
                            return match;
                    }
                });
            }
            catch (err) {
                console.error(`[Redactor] match/replace failed rule=${rule.id} name=${rule.name ?? ""}`, err);
            }
            finally {
                try {
                    regex.lastIndex = 0;
                }
                catch {
                    /* ignore */
                }
            }
        }
        return result;
    }
    scanObject(obj) {
        if (!obj || typeof obj !== "object") {
            return { findings: [], hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
        }
        let text = "";
        try {
            text = JSON.stringify(obj);
        }
        catch {
            text = "";
        }
        if (!text) {
            return { findings: [], hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
        }
        const findings = [];
        for (const rule of this.rules) {
            const regex = this.regexCache.get(rule.id);
            if (!regex) {
                continue;
            }
            const matches = [];
            try {
                regex.lastIndex = 0;
                for (;;) {
                    const m = regex.exec(text);
                    if (!m) {
                        break;
                    }
                    matches.push({ text: m[0], start: m.index, end: m.index + m[0].length });
                    if (m[0] === "") {
                        regex.lastIndex += 1;
                    }
                    if (matches.length > 10_000) {
                        break;
                    }
                }
            }
            catch (err) {
                console.error(`[Redactor] scan exec failed rule=${rule.id} name=${rule.name ?? ""}`, err);
            }
            finally {
                try {
                    regex.lastIndex = 0;
                }
                catch {
                    /* ignore */
                }
            }
            if (matches.length <= 0) {
                continue;
            }
            const action = (rule.policyAction ?? "data_mask").toLowerCase();
            // Create location info for the first match (representative location)
            const firstMatch = matches[0];
            findings.push({
                policy_id: rule.id,
                policy_name: rule.name ?? rule.id,
                match_count: matches.length,
                policy_action: action,
                redact_type: rule.redactType,
                severity: rule.severity || "medium",
                detection_kind: "regex",
                pattern: rule.pattern || "",
                position: {
                    prompt: {
                        match_text: firstMatch.text,
                        match_count: matches.length,
                        offset: [[firstMatch.start, firstMatch.end]],
                        mask_text: maskMatch(firstMatch.text, rule.redactType ?? "mask"),
                    },
                },
            });
        }
        if (findings.length === 0) {
            return { findings, hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
        }
        const hit_count = findings.reduce((s, f) => s + f.match_count, 0);
        let observeHit = false;
        let maskOrMatch = false;
        let runBlocked = false;
        for (const f of findings) {
            const action = (f.policy_action ?? "data_mask").toLowerCase();
            if (action === "audit_only") {
                observeHit = true;
                continue;
            }
            if (action === "abort_run" || action === "input_guard") {
                maskOrMatch = true;
                if (f.run_aborted) {
                    runBlocked = true;
                }
                continue;
            }
            maskOrMatch = true;
        }
        const intercepted = runBlocked ? 1 : 0;
        const observe_only = observeHit && !maskOrMatch && intercepted === 0 ? 1 : 0;
        const mode = runBlocked ? "enforce" : maskOrMatch ? "matched" : "observe";
        const interception = {
            version: 1,
            intercepted: runBlocked,
            mode,
            hit_count,
            tags: [...new Set(findings.map((f) => f.policy_name))],
            policy_ids: [...new Set(findings.map((f) => f.policy_id))],
        };
        return { findings, hit_count, intercepted, observe_only, interception };
    }
}
