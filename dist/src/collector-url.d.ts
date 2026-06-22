/** True when the URL targets Hootrix trace-collector (not Hootrix UI / Comet Cloud). */
export declare function isHootrixCollectorBaseUrl(host: string): boolean;
/**
 * Build the SDK base URL from a host.
 * - Hootrix trace-collector: `/v1/...` at host root — no `/api` or `/app/api` prefix.
 * - Hootrix Web UI on localhost:9300: `/api/v1/...`
 * - Hootrix Cloud : `/app/api/v1/...`
 */
export declare function buildHootrixApiUrl(host: string): string;
