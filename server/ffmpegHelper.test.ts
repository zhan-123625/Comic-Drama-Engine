import { describe, it, expect } from "vitest";
import {
  cleanDialogueTextForSubtitle,
  formatSrtTimestamp,
  generateSrtContent,
} from "./ffmpegHelper.js";

describe("ffmpegHelper subtitle functions", () => {
  describe("cleanDialogueTextForSubtitle", () => {
    it("strips speaker bracket prefix and colons", () => {
      expect(cleanDialogueTextForSubtitle("（旁白）绿莹莹的微风森林里。")).toBe("绿莹莹的微风森林里。");
      expect(cleanDialogueTextForSubtitle("(旁白) 森林深处传来动静。")).toBe("森林深处传来动静。");
      expect(cleanDialogueTextForSubtitle("团团：“快抓住我的手！”")).toBe("快抓住我的手！");
      expect(cleanDialogueTextForSubtitle("滚滚: 别怕，有我呢。")).toBe("别怕，有我呢。");
    });

    it("returns clean text as is when no prefix exists", () => {
      expect(cleanDialogueTextForSubtitle("今天也是阳光明媚的一天。")).toBe("今天也是阳光明媚的一天。");
    });
  });

  describe("formatSrtTimestamp", () => {
    it("formats zero and fractional seconds correctly", () => {
      expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
      expect(formatSrtTimestamp(1.5)).toBe("00:00:01,500");
      expect(formatSrtTimestamp(65.25)).toBe("00:01:05,250");
    });
  });

  describe("generateSrtContent", () => {
    it("generates single subtitle for short dialogue", () => {
      const srt = generateSrtContent("快跑！", 5.0, 1.2);
      expect(srt).toContain("1\n");
      expect(srt).toContain("-->");
      expect(srt).toContain("快跑！");
    });

    it("generates multi-part timed subtitle for long sentences with commas", () => {
      const text = "（旁白）绿莹莹的微风森林里，今天也是阳光融化成金黄色蜂蜜的一天。";
      const srt = generateSrtContent(text, 6.0, 5.0);
      expect(srt).toContain("1\n");
      expect(srt).toContain("2\n");
      expect(srt).toContain("绿莹莹的微风森林里");
      expect(srt).toContain("今天也是阳光融化成金黄色蜂蜜的一天。");
    });

    it("returns empty string for empty text", () => {
      expect(generateSrtContent("", 5.0)).toBe("");
      expect(generateSrtContent("   ", 5.0)).toBe("");
    });
  });
});
