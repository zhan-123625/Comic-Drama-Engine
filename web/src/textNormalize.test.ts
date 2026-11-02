import { describe, it, expect } from "vitest";
import { normalizeHtmlishToPlainText } from "./textNormalize";

describe("normalizeHtmlishToPlainText（前端）", () => {
  it("纯文本应原样返回（去首尾空白）", () => {
    expect(normalizeHtmlishToPlainText("  hello  ")).toBe("hello");
  });

  it("null/undefined 应返回空字符串", () => {
    expect(normalizeHtmlishToPlainText(null as unknown as string)).toBe("");
  });

  it("<br> 标签应转为换行", () => {
    expect(normalizeHtmlishToPlainText("a<br>b")).toBe("a\nb");
  });

  it("HTML 实体应正确解码", () => {
    expect(normalizeHtmlishToPlainText("a&amp;b")).toBe("a&b");
    expect(normalizeHtmlishToPlainText("a&lt;b")).toBe("a<b");
    expect(normalizeHtmlishToPlainText("a&gt;b")).toBe("a>b");
  });

  it("<p> 标签应转为换行", () => {
    expect(normalizeHtmlishToPlainText("<p>一</p><p>二</p>")).toBe("一\n\n二");
  });

  it("连续多换行应压缩为双换行", () => {
    expect(normalizeHtmlishToPlainText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
