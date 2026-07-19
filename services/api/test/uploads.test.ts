import { describe, expect, it } from "vitest";
import { getUploadKind } from "../src/lib/uploads.js";

describe("upload media types", () => {
  it.each(["audio/mp4", "audio/m4a", "audio/x-m4a"])("accepts M4A audio reported as %s", (mimetype) => {
    expect(getUploadKind(mimetype)).toBe("audio");
  });
});
