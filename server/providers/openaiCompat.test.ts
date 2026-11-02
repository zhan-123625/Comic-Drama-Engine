import { describe, expect, it } from "vitest";
import { toDashScopeImageSize } from "./openaiCompat.js";

describe("toDashScopeImageSize", () => {
  it("should map 1536x1024 to 1280*720 for Wanx landscape bounds", () => {
    expect(toDashScopeImageSize("1536x1024")).toBe("1280*720");
    expect(toDashScopeImageSize("1536*1024")).toBe("1280*720");
    expect(toDashScopeImageSize("1920x1080")).toBe("1280*720");
  });

  it("should map 1024x1536 to 720*1280 for Wanx portrait bounds", () => {
    expect(toDashScopeImageSize("1024x1536")).toBe("720*1280");
    expect(toDashScopeImageSize("1024*1536")).toBe("720*1280");
    expect(toDashScopeImageSize("1080x1920")).toBe("720*1280");
  });

  it("should keep dimensions within [512, 1440]", () => {
    expect(toDashScopeImageSize("1024x1024")).toBe("1024*1024");
    expect(toDashScopeImageSize("1280*720")).toBe("1280*720");
    expect(toDashScopeImageSize("720*1280")).toBe("720*1280");
  });

  it("should default undefined or invalid to 1024*1024", () => {
    expect(toDashScopeImageSize(undefined)).toBe("1024*1024");
    expect(toDashScopeImageSize("invalid")).toBe("1024*1024");
  });
});
