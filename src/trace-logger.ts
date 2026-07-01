import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { HOOTRIX_PLUGIN_ID } from "./constants.js";
const DEBUG_LOG_FILE = "/tmp/hootrix-debug.json";

export interface TraceLoggerConfig {
  debug: boolean;
  logger?: {
    info?: (message: string) => void;
  };
}

export class TraceLogger {
  private config: TraceLoggerConfig;

  constructor(config: TraceLoggerConfig) {
    this.config = config;
  }

  /**
   * Unified trace debug logging function
   * Writes to /tmp/hootrix-debug.ndjson and optionally to console/logger
   */
  traceDbg(phase: string, data: Record<string, unknown>): void {
    const logEntry = {
      ts: Date.now(),
      plugin: HOOTRIX_PLUGIN_ID,
      phase,
      ...data
    };

    // Always write to file for debugging
    this.writeToFile(logEntry);

    // Only log to console if debug is enabled
    if (!this.config.debug) {
      return;
    }

    const msg = `[${HOOTRIX_PLUGIN_ID}] ${phase} ${JSON.stringify(data)}`;
    if (this.config.logger?.info) {
      this.config.logger.info(msg);
    } else {
      console.warn(msg);
    }
  }

  private writeToFile(logEntry: Record<string, unknown>): void {
    try {
      mkdirSync(path.dirname(DEBUG_LOG_FILE), { recursive: true });
      appendFileSync(DEBUG_LOG_FILE, `${JSON.stringify(logEntry)}\n`);
    } catch {
      /* ignore file write errors */
    }
  }

  /**
   * Update the logger configuration
   */
  updateConfig(config: Partial<TraceLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a singleton trace logger instance
 */
let traceLoggerInstance: TraceLogger | null = null;

export function createTraceLogger(config: TraceLoggerConfig): TraceLogger {
  traceLoggerInstance = new TraceLogger(config);
  if (config.logger?.info) {
    config.logger.info(`[${HOOTRIX_PLUGIN_ID}] TraceLogger initialized, log file: ${DEBUG_LOG_FILE}`);
  }
  return traceLoggerInstance;
}

export function getTraceLogger(): TraceLogger | null {
  return traceLoggerInstance;
}

/**
 * Convenience function for direct traceDbg calls
 */
export function traceDbg(phase: string, data: Record<string, unknown>): void {
  traceLoggerInstance?.traceDbg(phase, data);
}
