import http from "node:http";
import https from "node:https";
/** Fetch spec: these status codes must use a null response body. */
const NULL_BODY_STATUS_CODES = new Set([204, 205, 304]);
function isTruthyEnv(value) {
    const v = value?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
}
function isTlsError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const parts = [error.message];
    const cause = error.cause;
    if (cause instanceof Error) {
        parts.push(cause.message);
    }
    else if (cause != null) {
        parts.push(String(cause));
    }
    const combined = parts.join(" ").toLowerCase();
    return (combined.includes("certificate") ||
        combined.includes("self signed") ||
        combined.includes("unable to verify") ||
        combined.includes("cert_"));
}
function normalizeStatusCode(statusCode) {
    if (statusCode == null || statusCode < 200 || statusCode > 599) {
        return 502;
    }
    return statusCode;
}
/**
 * Build a Fetch Response from raw HTTP data.
 * Never throws — callers rely on this inside async I/O callbacks.
 */
function buildFetchResponse(statusCode, bodyText, responseHeaders) {
    const status = normalizeStatusCode(statusCode);
    const body = NULL_BODY_STATUS_CODES.has(status) ? null : bodyText;
    return new Response(body, { status, headers: responseHeaders });
}
function buildErrorResponse(error, url) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
        error: "collector_fetch_failed",
        message,
        url,
    }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
    });
}
function nodeHttpFetch(url, init) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch (error) {
            reject(error);
            return;
        }
        const lib = parsed.protocol === "https:" ? https : http;
        const headers = init.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : init.headers;
        const req = lib.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method: init.method ?? "GET",
            headers,
            ...(parsed.protocol === "https:"
                ? { rejectUnauthorized: init.rejectUnauthorized !== false }
                : {}),
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("error", (error) => {
                reject(error);
            });
            res.on("end", () => {
                try {
                    const body = Buffer.concat(chunks).toString("utf8");
                    const responseHeaders = new Headers();
                    for (const [key, value] of Object.entries(res.headers)) {
                        if (value == null)
                            continue;
                        if (Array.isArray(value)) {
                            for (const item of value)
                                responseHeaders.append(key, item);
                        }
                        else {
                            responseHeaders.set(key, value);
                        }
                    }
                    resolve(buildFetchResponse(res.statusCode, body, responseHeaders));
                }
                catch (error) {
                    reject(error);
                }
            });
        });
        req.on("error", reject);
        if (init.signal) {
            if (init.signal.aborted) {
                req.destroy();
                reject(new DOMException("Aborted", "AbortError"));
                return;
            }
            init.signal.addEventListener("abort", () => {
                req.destroy();
                reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
        }
        const body = init.body;
        if (body != null) {
            if (typeof body === "string") {
                req.write(body);
            }
            else {
                reject(new Error("Unsupported request body type for collector fetch"));
                return;
            }
        }
        req.end();
    });
}
/**
 * HTTPS fetch for trace-collector and related Hootrix APIs.
 * Retries once without TLS verification on certificate errors (e.g. staging self-signed certs).
 * Set HOOTRIX_TLS_INSECURE=1 to always skip verification.
 *
 * Network and response-construction failures are converted to HTTP 502 responses so
 * background trace export never crashes the OpenClaw host process.
 */
export async function collectorFetch(input, init) {
    const url = String(input);
    const forceInsecure = isTruthyEnv(process.env.HOOTRIX_TLS_INSECURE);
    try {
        if (forceInsecure && url.startsWith("https://")) {
            return await nodeHttpFetch(url, { ...init, rejectUnauthorized: false });
        }
        try {
            return await fetch(url, init);
        }
        catch (error) {
            if (url.startsWith("https://") && isTlsError(error)) {
                return await nodeHttpFetch(url, { ...init, rejectUnauthorized: false });
            }
            throw error;
        }
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
        }
        return buildErrorResponse(error, url);
    }
}
