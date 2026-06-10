import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { collectorFetch } from "./collector-fetch.js";

const execFileAsync = promisify(execFile);

export type DeviceAuthUser = {
  id: string;
  email?: string;
  display_name?: string;
  locale?: string;
};

export type DeviceAuthBundle = {
  user: DeviceAuthUser;
  workspace_name: string;
  api_key: string;
  api_url: string;
};

export type DeviceAuthSession = {
  session_id: string;
  poll_token: string;
  connect_url: string;
  expires_in: number;
  main_api_url: string;
};

const DEFAULT_MAIN_API_URL = "https://api.hootrix.ai";
const DEFAULT_MAIN_SITE_URL = "https://hootrix.ai";
const LOCAL_MAIN_API_CANDIDATES = ["http://127.0.0.1:9821", "http://localhost:9821"] as const;
const LOCAL_MAIN_SITE_URL = "http://127.0.0.1:9822";
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 180_000;

function isLocalHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return url.includes("127.0.0.1") || url.includes("localhost");
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Main site API root — Cloud configure always targets production unless overridden. */
export function resolveMainApiUrl(): string {
  const raw = process.env.HOOTRIX_MAIN_API_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return DEFAULT_MAIN_API_URL;
}

/** Optional local backend probe for dev (`HOOTRIX_DEVICE_AUTH_PROBE_LOCAL=1`). */
export async function resolveMainApiUrlAsync(fetchImpl: typeof fetch = fetch): Promise<string> {
  const env = process.env.HOOTRIX_MAIN_API_URL?.trim();
  if (env) {
    return env.replace(/\/$/, "");
  }
  if (isTruthyEnv(process.env.HOOTRIX_DEVICE_AUTH_PROBE_LOCAL)) {
    for (const candidate of LOCAL_MAIN_API_CANDIDATES) {
      if (await probeMainApi(candidate, fetchImpl)) {
        return candidate;
      }
    }
  }
  return DEFAULT_MAIN_API_URL;
}

/** Browser connect page base aligned with the API endpoint in use. */
export function resolveMainSiteUrl(mainApiUrl?: string): string {
  const raw = process.env.HOOTRIX_MAIN_SITE_URL?.trim();
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  if (mainApiUrl && isLocalHostUrl(mainApiUrl)) {
    return LOCAL_MAIN_SITE_URL;
  }
  return DEFAULT_MAIN_SITE_URL;
}

export function buildConnectUrl(sessionId: string, mainApiUrl: string, backendConnectUrl?: string): string {
  if (isLocalHostUrl(mainApiUrl)) {
    return `${resolveMainSiteUrl(mainApiUrl)}/connect?session=${encodeURIComponent(sessionId)}`;
  }
  if (backendConnectUrl) {
    return backendConnectUrl;
  }
  return `${resolveMainSiteUrl(mainApiUrl)}/connect?session=${encodeURIComponent(sessionId)}`;
}

async function probeMainApi(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch for device-auth; retries once without TLS verification on certificate errors. */
export const deviceAuthFetch = collectorFetch;

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 160)}`);
  }
}

export async function createDeviceAuthSession(params?: {
  clientId?: string;
  installChannel?: string;
  deployment?: string;
  mainApiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<DeviceAuthSession> {
  const fetchImpl = params?.fetchImpl ?? deviceAuthFetch;
  const apiBase = (params?.mainApiUrl ?? (await resolveMainApiUrlAsync(fetchImpl))).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase}/api/v1/device-auth/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: params?.clientId ?? "openclaw-hootrix-trace",
        install_channel: params?.installChannel ?? "openclaw-configure",
        deployment: params?.deployment ?? "cloud",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach Hootrix API at ${apiBase} (${detail})`);
  }

  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new Error(readErrorMessage(body) ?? `Device auth session failed (${res.status}) at ${apiBase}`);
  }
  const sessionId = asString(body.session_id);
  const pollToken = asString(body.poll_token);
  const connectUrl = asString(body.connect_url);
  if (!sessionId || !pollToken) {
    throw new Error("Device auth session response missing session_id or poll_token");
  }
  return {
    session_id: sessionId,
    poll_token: pollToken,
    connect_url: buildConnectUrl(sessionId, apiBase, connectUrl),
    expires_in: typeof body.expires_in === "number" ? body.expires_in : 300,
    main_api_url: apiBase,
  };
}

export async function pollDeviceAuthSession(params: {
  sessionId: string;
  pollToken: string;
  mainApiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "pending" } | { status: "completed"; bundle: DeviceAuthBundle }> {
  const fetchImpl = params?.fetchImpl ?? deviceAuthFetch;
  const apiBase = (params?.mainApiUrl ?? resolveMainApiUrl()).replace(/\/$/, "");
  const url = new URL(`${apiBase}/api/v1/device-auth/sessions/${encodeURIComponent(params.sessionId)}`);
  url.searchParams.set("poll_token", params.pollToken);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Device auth poll failed at ${apiBase} (${detail})`);
  }
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new Error(readErrorMessage(body) ?? `Device auth poll failed (${res.status})`);
  }
  const status = asString(body.status);
  if (status === "pending") {
    return { status: "pending" };
  }
  if (status !== "completed") {
    throw new Error(`Unexpected device auth status: ${status ?? "unknown"}`);
  }
  const bundle = parseBundle(body.bundle);
  if (!bundle) {
    throw new Error("Device auth completed without a bundle");
  }
  return { status: "completed", bundle };
}

export async function waitForDeviceAuthBundle(params: {
  session: DeviceAuthSession;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onPoll?: () => void;
}): Promise<DeviceAuthBundle> {
  const deadline = Date.now() + (params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const interval = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fetchImpl = params.fetchImpl ?? deviceAuthFetch;
  while (Date.now() < deadline) {
    params.onPoll?.();
    const result = await pollDeviceAuthSession({
      sessionId: params.session.session_id,
      pollToken: params.session.poll_token,
      mainApiUrl: params.session.main_api_url,
      fetchImpl,
    });
    if (result.status === "completed") {
      return result.bundle;
    }
    await sleep(interval);
  }
  throw new Error("Device authorization timed out");
}

export function openBrowserUrl(url: string): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const platform = process.platform;
  if (platform === "darwin") {
    void execFileAsync("open", [url]).catch(() => undefined);
    return;
  }
  if (platform === "win32") {
    void execFileAsync("cmd", ["/c", "start", "", url]).catch(() => undefined);
    return;
  }
  void execFileAsync("xdg-open", [url]).catch(() => undefined);
}

export async function runCloudDeviceAuth(params?: {
  mainApiUrl?: string;
  openBrowser?: (url: string) => void;
  fetchImpl?: typeof fetch;
  logInfo?: (message: string) => void;
  logWarn?: (message: string) => void;
}): Promise<DeviceAuthBundle | null> {
  const logInfo = params?.logInfo ?? (() => undefined);
  const logWarn = params?.logWarn ?? (() => undefined);
  const openBrowser = params?.openBrowser ?? openBrowserUrl;
  const fetchImpl = params?.fetchImpl ?? deviceAuthFetch;
  const mainApiUrl = params?.mainApiUrl ?? (await resolveMainApiUrlAsync(fetchImpl));
  try {
    const session = await createDeviceAuthSession({
      mainApiUrl,
      fetchImpl,
      deployment: "cloud",
      installChannel: "openclaw-configure",
    });
    logInfo(`Hootrix API: ${session.main_api_url}\nSign in at:\n${session.connect_url}`);
    openBrowser(session.connect_url);
    const bundle = await waitForDeviceAuthBundle({
      session,
      fetchImpl,
    });
    return bundle;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = isLocalHostUrl(mainApiUrl)
      ? "Ensure the main backend, Redis, and frontend are running (./scripts/start-local-stack.sh)."
      : "If TLS errors persist, set HOOTRIX_TLS_INSECURE=1 or install a valid certificate on api.hootrix.ai.";
    logWarn(`Browser sign-in unavailable (${message}). ${hint} Falling back to manual API key entry.`);
    return null;
  }
}

function parseBundle(value: unknown): DeviceAuthBundle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const o = value as Record<string, unknown>;
  const apiKey = asString(o.api_key);
  const apiUrl = asString(o.api_url);
  const workspaceName = asString(o.workspace_name);
  const userRaw = o.user;
  if (!apiKey || !apiUrl || !workspaceName || !userRaw || typeof userRaw !== "object" || Array.isArray(userRaw)) {
    return null;
  }
  const userObj = userRaw as Record<string, unknown>;
  const userId = asString(userObj.id);
  if (!userId) {
    return null;
  }
  return {
    user: {
      id: userId,
      email: asString(userObj.email),
      display_name: asString(userObj.display_name),
      locale: asString(userObj.locale),
    },
    workspace_name: workspaceName,
    api_key: apiKey,
    api_url: apiUrl,
  };
}

function readErrorMessage(body: Record<string, unknown>): string | undefined {
  const err = body.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg.trim()) {
      return msg.trim();
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
