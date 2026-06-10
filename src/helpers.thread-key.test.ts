import { describe, expect, test } from "vitest";
import {
  inferCanonicalThreadKey,
  normalizeAgentThreadKey,
  resolveEffectiveOpikSessionKey,
  resetOpikThreadSessionAliases,
  resolveMainSessionKey,
} from "./service/helpers.js";

describe("inferCanonicalThreadKey", () => {
  test("prefers agent:… from keys when top-level sessionKey is a channel shortcut", () => {
    expect(
      inferCanonicalThreadKey({
        sessionKey: "feishu/oc_abc",
        keys: ["feishu/oc_abc", "agent:main:feishu:direct:ou_xyz"],
      }),
    ).toBe("agent:main:feishu:direct:ou_xyz");
  });

  test("prefers primarySessionKey over keys", () => {
    expect(
      inferCanonicalThreadKey({
        primarySessionKey: "agent:a:feishu:group:g1",
        keys: ["agent:b:feishu:direct:ou_1"],
      }),
    ).toBe("agent:a:feishu:group:g1");
  });

  test("normalizes agent/ to agent:", () => {
    expect(normalizeAgentThreadKey("agent/main:feishu:x")).toBe("agent:main:feishu:x");
  });
});

describe("resolveEffectiveOpikSessionKey", () => {
  test("registers volatile session id and resolves it before alias reset", () => {
    resetOpikThreadSessionAliases();
    const canonical = resolveEffectiveOpikSessionKey(
      {
        sessionId: "run-uuid-1",
        keys: ["agent:main:feishu:direct:ou_z"],
      },
      "run-uuid-1",
    );
    expect(canonical).toBe("agent:main:feishu:direct:ou_z");
    expect(resolveEffectiveOpikSessionKey({ sessionId: "run-uuid-1" }, "run-uuid-1")).toBe(
      "agent:main:feishu:direct:ou_z",
    );
  });
});

describe("resolveMainSessionKey", () => {
  test("returns a canonical agent thread key for main session contexts", () => {
    expect(
      resolveMainSessionKey({ sessionKey: "agent:main:feishu:direct:ou_z" }),
    ).toBe("agent:main:feishu:direct:ou_z");
    expect(
      resolveMainSessionKey({ primarySessionKey: "agent:a:feishu:group:g1" }),
    ).toBe("agent:a:feishu:group:g1");
  });

  test("does not resolve non-main subagent session keys", () => {
    expect(resolveMainSessionKey({ sessionKey: "child-session" })).toBeUndefined();
    expect(resolveMainSessionKey({ sessionId: "run-uuid-1" })).toBeUndefined();
  });
});
