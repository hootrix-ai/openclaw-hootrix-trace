export interface TraceLoggerConfig {
    debug: boolean;
    logger?: {
        info?: (message: string) => void;
    };
}
export declare class TraceLogger {
    private config;
    constructor(config: TraceLoggerConfig);
    /**
     * Unified trace debug logging function
     * Writes to /tmp/crabagent-debug.ndjson and optionally to console/logger
     */
    traceDbg(phase: string, data: Record<string, unknown>): void;
    private writeToFile;
    /**
     * Update the logger configuration
     */
    updateConfig(config: Partial<TraceLoggerConfig>): void;
}
export declare function createTraceLogger(config: TraceLoggerConfig): TraceLogger;
export declare function getTraceLogger(): TraceLogger | null;
/**
 * Convenience function for direct traceDbg calls
 */
export declare function traceDbg(phase: string, data: Record<string, unknown>): void;
