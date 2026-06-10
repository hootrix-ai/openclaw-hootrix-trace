import { describe, expect, test } from "vitest";
import { coercePluginConfigRoot, parseOpikPluginConfig } from "./types.js";

describe("coercePluginConfigRoot", () => {
  test("unwraps plugins.entries.openclaw-hootrix-trace.config", () => {
    const root = coercePluginConfigRoot({
      plugins: {
        entries: {
          "openclaw-hootrix-trace": {
            enabled: true,
            config: {
              enabled: true,
              apiKey: "secret",
            },
          },
        },
      },
    });
    expect(root.enabled).toBe(true);
    expect(root.apiKey).toBe("secret");
  });
});

describe("parseOpikPluginConfig", () => {
  test("reads full OpenClaw-shaped document", () => {
    const cfg = parseOpikPluginConfig({
      plugins: {
        entries: {
          "openclaw-hootrix-trace": {
            config: {
              enabled: true,
              apiUrl: "http://127.0.0.1:9823",
              apiKey: "k",
            },
          },
        },
      },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiUrl).toBe("http://127.0.0.1:9823/");
    expect(cfg.apiKey).toBe("k");
  });

  test("defaults enabled when apiKey and apiUrl are set", () => {
    const cfg = parseOpikPluginConfig({
      apiKey: "hootrix_wk_test",
      apiUrl: "https://trace.hootrix.ai",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiUrl).toBe("https://trace.hootrix.ai/");
  });

  test("flat plugin config object still parses", () => {
    const cfg = parseOpikPluginConfig({
      enabled: true,
    });
    expect(cfg.enabled).toBe(true);
  });

  test("plugin entry wrapper { config: {...} } (gateway service.start shape)", () => {
    const cfg = parseOpikPluginConfig({
      enabled: true,
      hooks: { allowConversationAccess: true },
      config: {
        enabled: true,
        apiUrl: "http://127.0.0.1:9823",
      },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiUrl).toBe("http://127.0.0.1:9823/");
  });
});
