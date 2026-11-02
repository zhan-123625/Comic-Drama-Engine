import { describe, it, expect } from "vitest";
import { normalizeHtmlishToPlainText } from "./textNormalize";

describe("normalizeHtmlishToPlainText", () => {
  it("纯文本应原样返回（去首尾空白）", () => {
    expect(normalizeHtmlishToPlainText("  hello world  ")).toBe("hello world");
  });

  it("null/undefined 应返回空字符串", () => {
    expect(normalizeHtmlishToPlainText(null as unknown as string)).toBe("");
    expect(normalizeHtmlishToPlainText(undefined as unknown as string)).toBe("");
  });

  it("HTML <br> 标签应转为换行", () => {
    expect(normalizeHtmlishToPlainText("第一行<br>第二行")).toBe("第一行\n第二行");
    expect(normalizeHtmlishToPlainText("a<br/>b<br />c")).toBe("a\nb\nc");
  });

  it("转义 &lt;br&gt; 应转为换行", () => {
    expect(normalizeHtmlishToPlainText("第一行&lt;br&gt;第二行")).toBe("第一行\n第二行");
  });

  it("常见 HTML 实体应正确解码", () => {
    // 分开测试各实体，避免 jsdom 对字符串字面量的干扰
    expect(normalizeHtmlishToPlainText("a&amp;b")).toBe("a&b");
    expect(normalizeHtmlishToPlainText("a&lt;b")).toBe("a<b");
    expect(normalizeHtmlishToPlainText("a&gt;b")).toBe("a>b");
    expect(normalizeHtmlishToPlainText("a&nbsp;b")).toBe("a b");
    expect(normalizeHtmlishToPlainText("&#39;hello&#39;")).toBe("'hello'");
    expect(normalizeHtmlishToPlainText("&quot;hi&quot;")).toBe('"hi"');
  });

  it("数字字符引用 &#NNN; 和 &#xHH; 应正确解码", () => {
    expect(normalizeHtmlishToPlainText("&#65;")).toBe("A");
    expect(normalizeHtmlishToPlainText("&#x41;")).toBe("A");
    // &#160; → nbsp → 空格
    expect(normalizeHtmlishToPlainText("a&#160;b")).toBe("a b");
  });

  it("<p> 标签应转为换行，并去除其他 HTML 标签", () => {
    // <p>→\n, </p>→\n, 连续换行会被压缩但两个 \n 保留
    expect(normalizeHtmlishToPlainText("<p>段落一</p><p>段落二</p>")).toBe("段落一\n\n段落二");
    expect(normalizeHtmlishToPlainText("<b>粗体</b>")).toBe("粗体");
  });

  it("连续 3 个以上换行应压缩为 2 个", () => {
    expect(normalizeHtmlishToPlainText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
