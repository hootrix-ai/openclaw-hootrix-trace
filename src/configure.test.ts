import { Command } from "commander";
import { describe, expect, test, vi } from "vitest";
import {
  buildHootrixApiUrl,
  getHootrixPluginEntry,
  getApiKeyHelpText,
  setHootrixPluginEntry,
  showHootrixStatus,
  validateHootrixApiKey,
} from "./configure.js";
import { registerHootrixCli } from "./cli.js";
import { HOOTRIX_CLOUD_SIGNUP_URL, HOOTRIX_COLLECTOR_HOST, HOOTRIX_PLUGIN_ID } from "./constants.js";

vi.mock("./collector-fetch.js", () => ({
  collectorFetch: vi.fn(),
}));

import { collectorFetch } from "./collector-fetch.js";

const mockCollectorFetch = vi.mocked(collectorFetch);

describe("configure helpers", () => {
  test("buildHootrixApiUrl for Hootrix collector omits /api prefix", () => {
    expect(buildHootrixApiUrl("http://127.0.0.1:9823")).toBe("http://127.0.0.1:9823/");
    expect(buildHootrixApiUrl("http://localhost:9823/")).toBe("http://localhost:9823/");
    expect(buildHootrixApiUrl("https://trace.hootrix.ai")).toBe("https://trace.hootrix.ai/");
    expect(buildHootrixApiUrl("https://test.trace.hootrix.ai/")).toBe("https://test.trace.hootrix.ai/");
  });

  test("buildHootrixApiUrl for Hootrix UI localhost keeps /api prefix", () => {
    expect(buildHootrixApiUrl("http://localhost:5173")).toBe("http://localhost:5173/api");
  });

  test("setHootrixPluginEntry writes plugins.entries.openclaw-hootrix-trace", () => {
    const next = setHootrixPluginEntry(
      {} as any,
      {
        enabled: true,
        apiKey: "test-key",
        apiUrl: "https://hootrix.example.com",
        projectName: "test-project",
        workspaceName: "test-workspace",
        tags: ["tag-a", "tag-b"],
      },
      true,
    ) as any;

    expect(next.plugins.entries[HOOTRIX_PLUGIN_ID].enabled).toBe(true);
    expect(next.plugins.entries[HOOTRIX_PLUGIN_ID].config).toEqual({
      enabled: true,
      apiKey: "test-key",
      apiUrl: "https://hootrix.example.com",
      projectName: "test-project",
      workspaceName: "test-workspace",
      tags: ["tag-a", "tag-b"],
    });
  });

  test("getHootrixPluginEntry reads canonical plugin-scoped config", () => {
    const parsed = getHootrixPluginEntry({
      plugins: {
        entries: {
          "openclaw-hootrix-trace": {
            enabled: false,
            config: {
              projectName: "project-x",
            },
          },
        },
      },
    } as any);

    expect(parsed.enabled).toBe(false);
    expect(parsed.config.projectName).toBe("project-x");
  });

  test("getApiKeyHelpText includes free signup guidance for cloud", () => {
    expect(getApiKeyHelpText("cloud", "https://www.comet.com/")).toEqual([
      "You can find your Hootrix API key here:\nhttps://www.comet.com/account-settings/apiKeys",
      `No Hootrix Cloud account yet? Sign up for a free account:\n${HOOTRIX_CLOUD_SIGNUP_URL}`,
    ]);
  });

  test("getApiKeyHelpText omits cloud signup guidance for self-hosted", () => {
    expect(getApiKeyHelpText("self-hosted", "https://hootrix.example.com/")).toEqual([
      "You can find your Hootrix API key here:\nhttps://hootrix.example.com/account-settings/apiKeys",
    ]);
  });

  test("validateHootrixApiKey accepts collector ingest auth success", async () => {
    mockCollectorFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validateHootrixApiKey("hootrix_wk_test", HOOTRIX_COLLECTOR_HOST)).resolves.toBeUndefined();
    expect(mockCollectorFetch).toHaveBeenCalledWith(
      "https://trace.hootrix.ai/v1/private/traces/batch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "hootrix_wk_test",
          Authorization: "Bearer hootrix_wk_test",
        }),
      }),
    );
  });

  test("validateHootrixApiKey treats empty-batch 500 as authenticated", async () => {
    mockCollectorFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "InternalError",
          message: { global: "batch traces cannot be empty" },
          status: 500,
          success: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(validateHootrixApiKey("hootrix_wk_test", HOOTRIX_COLLECTOR_HOST)).resolves.toBeUndefined();
  });

  test("validateHootrixApiKey rejects unauthorized collector responses", async () => {
    mockCollectorFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "AuthFail", message: { global: "您未登陆" }, status: 401, success: false }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(validateHootrixApiKey("bad-key", HOOTRIX_COLLECTOR_HOST)).rejects.toThrow(
      "Invalid API key",
    );
  });
});

describe("hootrix status command", () => {
  test("reads plugin entry and masks api key", async () => {
    const readConfig = () =>
      ({
        plugins: {
          entries: {
            "openclaw-hootrix-trace": {
              enabled: true,
              config: {
                enabled: true,
                apiUrl: "https://hootrix.example.com",
                projectName: "demo",
                workspaceName: "default",
                apiKey: "secret-key",
                tags: ["prod"],
              },
            },
          },
        },
      }) as any;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    showHootrixStatus({
      readConfig,
      mutateConfigFile: async () => ({}),
    });
    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("Enabled:    yes");
    expect(output).toContain("API key:    ***");
    expect(output).not.toContain("secret-key");
  });

  test("status command runs through registered CLI action", async () => {
    const program = new Command();
    program.exitOverride();

    registerHootrixCli({
      program,
      readConfig: () =>
        ({
          plugins: {
            entries: {
              "openclaw-hootrix-trace": {
                enabled: true,
                config: {
                  enabled: true,
                  apiUrl: "https://hootrix.example.com",
                  projectName: "demo",
                  workspaceName: "default",
                  apiKey: "secret-key",
                  tags: ["prod"],
                },
              },
            },
          },
        }) as any,
      mutateConfigFile: async () => ({}),
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output = "";
    try {
      await program.parseAsync(["node", "openclaw", "hootrix", "status"]);
      output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      logSpy.mockRestore();
    }

    expect(output).toContain("Enabled:    yes");
    expect(output).toContain("API key:    ***");
    expect(output).not.toContain("secret-key");
  });
});
