import { describe, expect, it } from "vitest";
import {
  buildMinimalSpanCompletionPatch,
  buildSlimDirectExportInput,
  serializeSpanForBatch,
  serializeTraceForBatch,
} from "./direct-collector-export.js";

describe("direct-collector-export", () => {
  it("serializes trace fields to snake_case batch payload", () => {
    const payload = serializeTraceForBatch(
      {
        id: "trace-1",
        startTime: new Date("2026-07-01T02:44:31.000Z"),
        source: "sdk",
        name: "model · feishu",
        projectName: "openclaw",
        threadId: "agent:demo:feishu:group:abc",
        input: { prompt: "hello" },
        metadata: { created_from: "openclaw" },
      },
      { tags: ["openclaw"] },
    );

    expect(payload).toMatchObject({
      id: "trace-1",
      start_time: "2026-07-01T02:44:31.000Z",
      project_name: "openclaw",
      thread_id: "agent:demo:feishu:group:abc",
      input: { prompt: "hello" },
      tags: ["openclaw"],
    });
  });

  it("serializes span fields to snake_case batch payload", () => {
    const payload = serializeSpanForBatch({
      id: "span-1",
      startTime: new Date("2026-07-01T02:44:31.100Z"),
      source: "sdk",
      name: "minimax",
      type: "llm",
      projectName: "openclaw",
      traceId: "trace-1",
      input: { prompt: "hello" },
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(payload).toMatchObject({
      id: "span-1",
      start_time: "2026-07-01T02:44:31.100Z",
      type: "llm",
      trace_id: "trace-1",
      project_name: "openclaw",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
  });

  it("slims direct export input to prompt plus history count", () => {
    const slim = buildSlimDirectExportInput({
      prompt: "hello",
      systemPrompt: "x".repeat(50_000),
      historyMessages: [{ role: "user", content: "a" }],
      imagesCount: 0,
    });
    expect(slim).toEqual({
      prompt: "hello",
      imagesCount: 0,
      historyMessageCount: 1,
    });
  });

  it("builds minimal span completion patch without heavy fields", () => {
    const minimal = buildMinimalSpanCompletionPatch({
      traceId: "trace-1",
      type: "tool",
      name: "feishu_app_scopes",
      endTime: new Date("2026-07-01T04:07:00.000Z"),
      output: { scopes: ["x".repeat(100_000)] },
      metadata: { agentId: "demo" },
    });
    expect(minimal).toEqual({
      traceId: "trace-1",
      type: "tool",
      name: "feishu_app_scopes",
      endTime: new Date("2026-07-01T04:07:00.000Z"),
    });
    expect(JSON.stringify(minimal).length).toBeLessThan(200);
  });
});
