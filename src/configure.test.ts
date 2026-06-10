import { Command } from "commander";
import { describe, expect, test, vi } from "vitest";
import {
  buildOpikApiUrl,
  getOpikPluginEntry,
  getApiKeyHelpText,
  setOpikPluginEntry,
  showOpikStatus,
} from "./configure.js";
import { registerOpikCli } from "./cli.js";

describe("configure helpers", () => {
  test("buildOpikApiUrl for Hootrix collector omits /api prefix", () => {
    expect(buildOpikApiUrl("http://127.0.0.1:9823")).toBe("http://127.0.0.1:9823/");
    expect(buildOpikApiUrl("http://localhost:9823/")).toBe("http://localhost:9823/");
    expect(buildOpikApiUrl("https://trace.hootrix.ai")).toBe("https://trace.hootrix.ai/");
    expect(buildOpikApiUrl("https://test.trace.hootrix.ai/")).toBe("https://test.trace.hootrix.ai/");
  });

  test("buildOpikApiUrl for Opik UI localhost keeps /api prefix", () => {
    expect(buildOpikApiUrl("http://localhost:5173")).toBe("http://localhost:5173/api");
  });

  test("setOpikPluginEntry writes plugins.entries.openclaw-hootrix-trace", () => {
    const next = setOpikPluginEntry(
      {} as any,
      {
        enabled: true,
        apiKey: "test-key",
        apiUrl: "https://opik.example.com",
        projectName: "test-project",
        workspaceName: "test-workspace",
        tags: ["tag-a", "tag-b"],
      },
      true,
    ) as any;

    expect(next.plugins.entries["openclaw-hootrix-trace"].enabled).toBe(true);
    expect(next.plugins.entries["openclaw-hootrix-trace"].config).toEqual({
      enabled: true,
      apiKey: "test-key",
      apiUrl: "https://opik.example.com",
      projectName: "test-project",
      workspaceName: "test-workspace",
      tags: ["tag-a", "tag-b"],
    });
  });

  test("getOpikPluginEntry reads canonical plugin-scoped config", () => {
    const parsed = getOpikPluginEntry({
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
      "You can find your Opik API key here:\nhttps://www.comet.com/account-settings/apiKeys",
      "No Hootrix Cloud account yet? Sign up for a free account:\nhttps://www.hootrix.ai/signup?from=llm&source=openclaw",
    ]);
  });

  test("getApiKeyHelpText omits cloud signup guidance for self-hosted", () => {
    expect(getApiKeyHelpText("self-hosted", "https://opik.example.com/")).toEqual([
      "You can find your Opik API key here:\nhttps://opik.example.com/account-settings/apiKeys",
    ]);
  });
});

describe("opik status command", () => {
  test("reads plugin entry and masks api key", async () => {
    const readConfig = () =>
      ({
        plugins: {
          entries: {
            "openclaw-hootrix-trace": {
              enabled: true,
              config: {
                enabled: true,
                apiUrl: "https://opik.example.com",
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
    showOpikStatus({
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

    registerOpikCli({
      program,
      readConfig: () =>
        ({
          plugins: {
            entries: {
              "openclaw-hootrix-trace": {
                enabled: true,
                config: {
                  enabled: true,
                  apiUrl: "https://opik.example.com",
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
