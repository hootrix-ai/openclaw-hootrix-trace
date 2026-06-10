import { HOOTRIX_COLLECTOR_HOST } from "./constants.js";

/** Direct collector listen ports (local/cloud :9823; pprof :9534). */
const HOOTRIX_COLLECTOR_PORTS = [9823, 9534];
const HOOTRIX_COLLECTOR_HOSTNAME = new URL(HOOTRIX_COLLECTOR_HOST).hostname.toLowerCase();

/** True when the URL targets Hootrix trace-collector (not Hootrix UI / Comet Cloud). */
export function isHootrixCollectorBaseUrl(host: string): boolean {
  const normalized = host.endsWith("/") ? host.slice(0, -1) : host;
  try {
    const u = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (HOOTRIX_COLLECTOR_PORTS.includes(Number(port))) {
      return true;
    }
    const h = u.hostname.toLowerCase();
    if (h === HOOTRIX_COLLECTOR_HOSTNAME || h.endsWith(`.${HOOTRIX_COLLECTOR_HOSTNAME}`)) {
      return true;
    }
    if (h.startsWith("trace.") && (h.endsWith(".hootrix.ai") || h.endsWith(".hootrix.com"))) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Build the SDK base URL from a host.
 * - Hootrix trace-collector: `/v1/...` at host root — no `/api` or `/app/api` prefix.
 * - Hootrix Web UI on localhost:9300: `/api/v1/...`
 * - Hootrix Cloud : `/app/api/v1/...`
 */
export function buildHootrixApiUrl(host: string): string {
  const normalized = host.endsWith("/") ? host.slice(0, -1) : host;
  if (isHootrixCollectorBaseUrl(normalized)) {
    return `${normalized}/`;
  }
  const isLocal = normalized.includes("localhost") || normalized.includes("127.0.0.1");
  return `${normalized}${isLocal ? "/api" : "/app/api"}`;
}
