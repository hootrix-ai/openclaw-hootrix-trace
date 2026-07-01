import type { Span, Trace } from "hootrix";
export type CollectorExportConfig = {
    baseUrl: string;
    apiKey: string;
    workspaceName: string;
};
export declare function serializeTraceForBatch(data: Record<string, unknown>, overrides?: Record<string, unknown>): Record<string, unknown>;
export declare function serializeSpanForBatch(data: Record<string, unknown>, overrides?: Record<string, unknown>): Record<string, unknown>;
/** UI reads trace.input.prompt; omit history/systemPrompt to stay under collector body limits. */
export declare function buildSlimDirectExportInput(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
/** Completion patches only need terminal fields; full tool output can exceed collector limits. */
export declare function buildMinimalSpanCompletionPatch(patch: Record<string, unknown>): Record<string, unknown>;
export declare function directBootstrapTraceAndSpan(params: {
    config: CollectorExportConfig;
    trace: Trace;
    llmSpan?: Span | null;
    threadId: string;
    input?: Record<string, unknown>;
    tags?: string[];
}): Promise<{
    ok: boolean;
    status: number;
    traceId?: string;
    spanId?: string;
}>;
export declare function directPatchTrace(params: {
    config: CollectorExportConfig;
    traceId: string;
    patch: Record<string, unknown>;
}): Promise<{
    ok: boolean;
    status: number;
}>;
export declare function directBootstrapSpan(params: {
    config: CollectorExportConfig;
    span: Span;
    traceId?: string;
}): Promise<{
    ok: boolean;
    status: number;
}>;
export declare function directPatchSpan(params: {
    config: CollectorExportConfig;
    spanId: string;
    patch: Record<string, unknown>;
}): Promise<{
    ok: boolean;
    status: number;
}>;
