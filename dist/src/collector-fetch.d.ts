/**
 * HTTPS fetch for trace-collector and related Hootrix APIs.
 * Retries once without TLS verification on certificate errors (e.g. staging self-signed certs).
 * Set HOOTRIX_TLS_INSECURE=1 to always skip verification.
 *
 * Network and response-construction failures are converted to HTTP 502 responses so
 * background trace export never crashes the OpenClaw host process.
 */
export declare function collectorFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
