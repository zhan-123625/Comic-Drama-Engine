import { describe, it, expect } from "vitest";
import { alignBodiesToChapters, joinChapterScriptBodies, splitScriptBlocks } from "./scriptBlocks.js";

// ── splitScriptBlocks ──

describe("splitScriptBlocks", () => {
  it("空字符串应返回空数组", () => {
    expect(splitScriptBlocks("")).toEqual([]);
  });

  it("null/undefined 应返回空数组", () => {
    expect(splitScriptBlocks(null as unknown as string)).toEqual([]);
    expect(splitScriptBlocks(undefined as unknown as string)).toEqual([]);
  });

  it("应正确解析 ### 分隔的章节块", () => {
    const script = "### 第一章\n内容一\n\n### 第二章\n内容二";
    const blocks = splitScriptBlocks(script);
    expect(blocks).toEqual([
      { title: "第一章", body: "内容一" },
      { title: "第二章", body: "内容二" },
    ]);
  });
});

// ── alignBodiesToChapters ──

describe("alignBodiesToChapters", () => {
  it("按位置匹配时应正确对齐", () => {
    const script = "### 第一章\n内容一\n### 第二章\n内容二";
    const result = alignBodiesToChapters(script, ["第一章", "第二章"]);
    expect(result).toEqual(["内容一", "内容二"]);
  });

  it("标题不匹配时应按名称查找", () => {
    const script = "### 第二章\n内容二\n### 第一章\n内容一";
    const result = alignBodiesToChapters(script, ["第一章", "第二章"]);
    expect(result).toEqual(["内容一", "内容二"]);
  });

  it("缺少对应章节时应返回空字符串", () => {
    const script = "### 第一章\n内容一";
    const result = alignBodiesToChapters(script, ["第一章", "不存在"]);
    expect(result).toEqual(["内容一", ""]);
  });

  it("空剧本应返回全空字符串数组", () => {
    const result = alignBodiesToChapters("", ["第一章", "第二章"]);
    expect(result).toEqual(["", ""]);
  });

  it("空标题数组应返回空数组", () => {
    const result = alignBodiesToChapters("### 第一章\n内容", []);
    expect(result).toEqual([]);
  });
});

// ── joinChapterScriptBodies ──

describe("joinChapterScriptBodies", () => {
  it("应将标题和正文拼接为标准格式", () => {
    const result = joinChapterScriptBodies(["第一章", "第二章"], ["内容一", "内容二"]);
    expect(result).toBe("### 第一章\n内容一\n\n### 第二章\n内容二");
  });

  it("正文为空时应只输出标题行", () => {
    const result = joinChapterScriptBodies(["第一章"], []);
    expect(result).toBe("### 第一章");
  });

  it("标题为空时应使用默认编号", () => {
    const result = joinChapterScriptBodies(["", ""], ["内容一", "内容二"]);
    expect(result).toBe("### 第1章\n内容一\n\n### 第2章\n内容二");
  });
});
