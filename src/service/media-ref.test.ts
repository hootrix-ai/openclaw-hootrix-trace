import { describe, expect, test } from "vitest";
import {
  collectMediaRefsFromUnknown,
  mediaRefDedupeKey,
  parseMediaRefPlaceholder,
} from "./media-ref.js";

describe("media-ref", () => {
  test("parses media-ref placeholder tokens", () => {
    const parsed = parseMediaRefPlaceholder(
      "[media-ref:044029ed75dd7571:2f55bba8-6013-42f5-8369-1a7084de913f.jpg]",
    );
    expect(parsed).toEqual({
      placeholder: "[media-ref:044029ed75dd7571:2f55bba8-6013-42f5-8369-1a7084de913f.jpg]",
      hashPrefix: "044029ed75dd7571",
      fileName: "2f55bba8-6013-42f5-8369-1a7084de913f.jpg",
    });
  });

  test("collects media refs from nested media-prefixed strings", () => {
    const refs = new Set<ReturnType<typeof parseMediaRefPlaceholder>>();
    collectMediaRefsFromUnknown(
      {
        image: "media:/[media-ref:044029ed75dd7571:photo.jpg]",
      },
      refs,
    );
    expect(refs.size).toBe(1);
    expect(mediaRefDedupeKey([...refs][0]!)).toBe("044029ed75dd7571:photo.jpg");
  });
});
