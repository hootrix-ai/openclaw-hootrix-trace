import { describe, expect, test } from "vitest";
import {
  classificationMetadata,
  resolveTraceClassification,
} from "./trace-classification.js";

describe("resolveTraceClassification", () => {
  test("classifies subagent thread keys", () => {
    const c = resolveTraceClassification({
      sessionKey: "agent:main:subagent:abc-123",
    });
    expect(c.traceType).toBe("subagent");
    expect(c.capabilities.independentTrace).toBe(true);
    expect(c.capabilities.bridgeSpanOnHost).toBe(true);
  });

  test("classifies async announce runs", () => {
    const c = resolveTraceClassification({
      sessionKey: "agent:main:feishu:direct:user",
      runId: "announce:follow-up-1",
    });
    expect(c.traceType).toBe("async_command");
    expect(c.runKind).toBe("async_followup");
    expect(c.capabilities.allowFinalizeReuse).toBe(false);
  });

  test("classifies subagent announce on host thread as external/subagent_announce", () => {
    const c = resolveTraceClassification({
      sessionKey: "agent:main:feishu:direct:user",
      runId:
        "announce:v1:agent:main:subagent:eeb1b54d-4660-44e5-8533-e3227ba0769c:c92aefff-afbe-4c70-b4a2-a7e4dea3c3e4",
      trigger: "user",
    });
    expect(c.traceType).toBe("external");
    expect(c.runKind).toBe("subagent_announce");
    expect(c.capabilities.allowFinalizeReuse).toBe(true);
  });

  test("classifies system compaction prompts", () => {
    const c = resolveTraceClassification({
      sessionKey: "agent:main:feishu:direct:user",
      prompt: "Pre-compaction memory flush.",
    });
    expect(c.traceType).toBe("system");
    expect(c.capabilities.hideInUiByDefault).toBe(true);
  });

  test("defaults to external", () => {
    const c = resolveTraceClassification({
      sessionKey: "agent:main:feishu:direct:user",
    });
    expect(c.traceType).toBe("external");
    expect(c.capabilities.allowFinalizeReuse).toBe(true);
  });

  test("classificationMetadata dual-writes trace_type and run_kind", () => {
    const meta = classificationMetadata(
      resolveTraceClassification({
        sessionKey: "agent:main:subagent:x",
      }),
    );
    expect(meta).toEqual({ trace_type: "subagent", run_kind: "subagent" });
  });
});
