export declare const KNOWN_TRACE_TYPES: readonly ["external", "subagent", "async_command", "system"];
export type KnownTraceType = (typeof KNOWN_TRACE_TYPES)[number];
export type TraceClassificationCapabilities = {
    independentTrace: boolean;
    allowFinalizeReuse: boolean;
    bridgeSpanOnHost: boolean;
    hideInUiByDefault: boolean;
};
export type TraceClassification = {
    traceType: string;
    runKind: string;
    traceKind?: string;
    capabilities: TraceClassificationCapabilities;
};
export declare function classificationMetadata(c: TraceClassification): Record<string, string>;
export declare function resolveTraceClassification(params: {
    sessionKey: string;
    runId?: string;
    trigger?: string;
    prompt?: string;
    systemPrompt?: string;
    metadata?: Record<string, unknown>;
}): TraceClassification;
/** @deprecated use resolveTraceClassification */
export declare function resolveTraceKind(params: {
    sessionKey: string;
    runId?: string;
    trigger?: string;
}): KnownTraceType | "external" | "subagent" | "async_command";
/** @deprecated use classificationMetadata */
export declare function traceKindMetadata(kind: string): Record<string, string>;
