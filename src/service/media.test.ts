import { describe, expect, test, afterEach } from "vitest";
import {
  collectMediaPathsFromString,
  collectMediaPathsFromUnknown,
  normalizeLocalMediaPath,
  setOpenClawStateDir,
} from "./media.js";

describe("media path extraction", () => {
  afterEach(() => {
    setOpenClawStateDir(undefined);
  });

  test("resolves OpenClaw managed inbound media paths against stateDir", () => {
    setOpenClawStateDir("/var/openclaw");
    expect(normalizeLocalMediaPath("/inbound/1cc8b08d-e71a-4a73-8096-8071461201bc.jpg")).toBe(
      "/var/openclaw/media/inbound/1cc8b08d-e71a-4a73-8096-8071461201bc.jpg",
    );
  });

  test("collects OpenClaw inbound media references from media attached blocks", () => {
    setOpenClawStateDir("/var/openclaw");
    const target = new Set<string>();
    collectMediaPathsFromString(
      "[media attached: media:/inbound/1cc8b08d-e71a-4a73-8096-8071461201bc.jpg (image/jpeg)]",
      target,
    );
    expect([...target]).toEqual([
      "/var/openclaw/media/inbound/1cc8b08d-e71a-4a73-8096-8071461201bc.jpg",
    ]);
  });

  test("does not collect direct local path values without an explicit marker", () => {
    const target = new Set<string>();
    collectMediaPathsFromString("/tmp/image.png", target);
    expect(target.size).toBe(0);
  });

  test("collects media: local path references", () => {
    const target = new Set<string>();
    collectMediaPathsFromString("preview media:/tmp/image.png", target);
    expect([...target]).toEqual(["/tmp/image.png"]);
  });

  test("collects file:// local path references", () => {
    const target = new Set<string>();
    collectMediaPathsFromString("open file:///tmp/image.png", target);
    expect([...target]).toEqual(["/tmp/image.png"]);
  });

  test("collects markdown local media links", () => {
    const target = new Set<string>();
    collectMediaPathsFromString("![preview](/tmp/image.png)", target);
    expect([...target]).toEqual(["/tmp/image.png"]);
  });

  test("does not collect incidental local paths in plain text", () => {
    const target = new Set<string>();
    collectMediaPathsFromString("debug: attempted /tmp/image.png from prior run", target);
    expect(target.size).toBe(0);
  });

  test("collects media attached block references", () => {
    const target = new Set<string>();
    collectMediaPathsFromString(
      "[media attached: media:/tmp/inbound.jpeg (image/jpeg)]",
      target,
    );
    expect([...target]).toEqual(["/tmp/inbound.jpeg"]);
  });

  test("collects local media paths from nested objects", () => {
    const target = new Set<string>();
    collectMediaPathsFromUnknown(
      {
        images: [
          { src: "file:///tmp/image.png" },
          { ref: "media:/tmp/other.jpg" },
        ],
      },
      target,
    );
    expect([...target].sort()).toEqual(["/tmp/image.png", "/tmp/other.jpg"]);
  });

  test("collects media field values from tool params", () => {
    const target = new Set<string>();
    collectMediaPathsFromUnknown({ image: "media:/tmp/tool-image.png" }, target);
    expect([...target]).toEqual(["/tmp/tool-image.png"]);
  });
});
