import { describe, expect, test, vi } from "vitest";
import {
  buildConnectUrl,
  createDeviceAuthSession,
  deviceAuthFetch,
  pollDeviceAuthSession,
  resolveMainApiUrl,
  resolveMainApiUrlAsync,
  resolveMainSiteUrl,
  waitForDeviceAuthBundle,
} from "./device-auth.js";

describe("device-auth", () => {
  test("resolveMainApiUrl defaults to production API", () => {
    vi.unstubAllEnvs();
    expect(resolveMainApiUrl()).toBe("https://api.hootrix.ai");
  });

  test("resolveMainApiUrlAsync defaults to production without local probe", async () => {
    vi.unstubAllEnvs();
    await expect(resolveMainApiUrlAsync()).resolves.toBe("https://api.hootrix.ai");
  });

  test("resolveMainApiUrl respects HOOTRIX_MAIN_API_URL", () => {
    vi.stubEnv("HOOTRIX_MAIN_API_URL", "http://127.0.0.1:9821");
    expect(resolveMainApiUrl()).toBe("http://127.0.0.1:9821");
    vi.unstubAllEnvs();
  });

  test("resolveMainSiteUrl uses local frontend for local API", () => {
    expect(resolveMainSiteUrl("http://127.0.0.1:9821")).toBe("http://127.0.0.1:9822");
    expect(resolveMainSiteUrl("https://api.hootrix.ai")).toBe("https://hootrix.ai");
  });

  test("buildConnectUrl keeps backend connect URL for production", () => {
    expect(
      buildConnectUrl(
        "sess-1",
        "https://api.hootrix.ai",
        "https://hootrix.ai/connect?session=sess-1",
      ),
    ).toBe("https://hootrix.ai/connect?session=sess-1");
  });

  test("createDeviceAuthSession parses session payload", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_id: "sess-1",
          poll_token: "poll-abc",
          connect_url: "https://hootrix.ai/connect?session=sess-1",
          expires_in: 300,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    vi.stubEnv("HOOTRIX_MAIN_API_URL", "https://api.hootrix.ai");

    const session = await createDeviceAuthSession({
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(session.session_id).toBe("sess-1");
    expect(session.connect_url).toBe("https://hootrix.ai/connect?session=sess-1");
    expect(session.main_api_url).toBe("https://api.hootrix.ai");
    vi.unstubAllEnvs();
  });

  test("pollDeviceAuthSession returns completed bundle", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          bundle: {
            user: { id: "user-1", display_name: "Ada" },
            workspace_name: "ws-personal",
            api_key: "hootrix_wk_test",
            api_url: "https://trace.hootrix.ai/",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await pollDeviceAuthSession({
      sessionId: "sess-1",
      pollToken: "poll-abc",
      mainApiUrl: "https://api.hootrix.ai",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.bundle.api_key).toBe("hootrix_wk_test");
    }
  });
});
