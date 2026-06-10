import { execSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { collectorFetch } from "./collector-fetch.js";

function withSelfSignedHttpsServer(
  handler: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hootrix-fetch-"));
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 1 -subj /CN=localhost`,
    { stdio: "ignore" },
  );

  const server = https.createServer(
    {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    },
    handler,
  );

  return new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected server address"));
        return;
      }
      run(address.port)
        .then(() => {
          server.close((err) => {
            rmSync(dir, { recursive: true, force: true });
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
        .catch((err) => {
          server.close(() => {
            rmSync(dir, { recursive: true, force: true });
            reject(err);
          });
        });
    });
    server.on("error", reject);
  });
}

describe("collector-fetch", () => {
  test("nodeHttpFetch path handles HTTPS 204 without crashing", async () => {
    vi.stubEnv("HOOTRIX_TLS_INSECURE", "1");
    try {
      await withSelfSignedHttpsServer((_req, res) => {
        res.writeHead(204);
        res.end();
      }, async (port) => {
        const res = await collectorFetch(`https://127.0.0.1:${port}/v1/health`, {
          method: "GET",
        });
        expect(res.status).toBe(204);
        await expect(res.text()).resolves.toBe("");
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("collectorFetch handles HTTP 204 from a local server", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected server address");
    }

    try {
      const res = await collectorFetch(`http://127.0.0.1:${address.port}/v1/health`, {
        method: "GET",
      });
      expect(res.status).toBe(204);
      await expect(res.text()).resolves.toBe("");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test("collectorFetch returns 502 response instead of throwing on unreachable host", async () => {
    const res = await collectorFetch("http://127.0.0.1:1/unreachable", {
      method: "GET",
      signal: AbortSignal.timeout(500),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("collector_fetch_failed");
  });

  test("collectorFetch rethrows AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectorFetch("https://trace.hootrix.ai/v1/health", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
