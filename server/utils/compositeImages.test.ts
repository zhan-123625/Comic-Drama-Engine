import { describe, it, expect } from "vitest";
import { compositeReferenceImages } from "./compositeImages.js";

describe("compositeReferenceImages", () => {
  it("returns undefined for empty input", async () => {
    const res = await compositeReferenceImages([]);
    expect(res).toBeUndefined();
  });

  it("handles single data url item", async () => {
    const tiny =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const res = await compositeReferenceImages([tiny]);
    expect(res).toBe(tiny);
  });

  it("composites multiple data urls into a single png base64", async () => {
    const tiny1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const tiny2 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res = await compositeReferenceImages([tiny1, tiny2]);
    expect(res).toBeDefined();
    expect(res?.startsWith("data:image/png;base64,")).toBe(true);
  });
});
