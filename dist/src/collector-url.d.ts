/** True when the URL targets Hootrix trace-collector (not Opik UI / Comet Cloud). */
export declare function isHootrixCollectorBaseUrl(host: string): boolean;
/**
 * Build the SDK base URL from a host.
 * - Hootrix trace-collector: `/v1/...` at host root — no `/api` or `/opik/api` prefix.
 * - Opik UI on localhost:5173: `/api/v1/...`
 * - Opik Cloud / self-hosted: `/opik/api/v1/...`
 */
export declare function buildOpikApiUrl(host: string): string;
