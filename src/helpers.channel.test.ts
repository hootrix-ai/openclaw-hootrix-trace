import { describe, expect, test } from "vitest";
import {
  channelMetadataFields,
  inferChannelProviderFromThreadKey,
  isChannelInstanceId,
  resolveChannelId,
  resolveChannelName,
} from "./service/helpers.js";

describe("channel metadata helpers", () => {
  test("isChannelInstanceId detects Feishu peer ids", () => {
    expect(isChannelInstanceId("ou_abc")).toBe(true);
    expect(isChannelInstanceId("oc_group1")).toBe(true);
    expect(isChannelInstanceId("feishu")).toBe(false);
    expect(isChannelInstanceId("discord")).toBe(false);
  });

  test("inferChannelProviderFromThreadKey reads provider segment", () => {
    expect(inferChannelProviderFromThreadKey("agent:main:feishu:direct:ou_xyz")).toBe("feishu");
    expect(inferChannelProviderFromThreadKey("agent:daily:telegram:group:g1")).toBe("telegram");
  });

  test("resolveChannelName prefers explicit name and messageProvider over instance channelId", () => {
    expect(
      resolveChannelName(
        { channelId: "ou_peer", messageProvider: "feishu" },
        "agent:main:feishu:direct:ou_peer",
      ),
    ).toBe("feishu");
    expect(resolveChannelName({ channelName: "飞书 Bot" }, "agent:main:feishu:x")).toBe("飞书 Bot");
    expect(
      resolveChannelName({ channelId: "ou_only" }, "agent:main:feishu:direct:ou_only"),
    ).toBe("feishu");
  });

  test("resolveChannelId returns only explicit channelId", () => {
    expect(resolveChannelId({ messageProvider: "telegram" })).toBeUndefined();
    expect(resolveChannelId({ channelId: "ou_x" })).toBe("ou_x");
  });

  test("resolveChannelName tolerates undefined ctx when sessionKey is set", () => {
    expect(
      resolveChannelName(undefined, "agent:main:feishu:direct:ou_eecc9ad31e88208a0d51153aeb535f6f"),
    ).toBe("feishu");
  });

  test("channelMetadataFields separates display name and instance id", () => {
    expect(
      channelMetadataFields({
        channelId: "ou_peer",
        channelName: "feishu",
      }),
    ).toEqual({
      channelName: "feishu",
      channelId: "ou_peer",
    });
    expect(
      channelMetadataFields({
        channelId: "discord",
        channelName: "discord",
      }),
    ).toEqual({
      channelName: "discord",
      channelId: "discord",
      channel: "discord",
    });
  });
});
