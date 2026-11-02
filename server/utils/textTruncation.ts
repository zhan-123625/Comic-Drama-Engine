/**
 * 智能文本截断工具 - 确保在截断时保持句子的完整性
 * 避免在句子中间截断，这可能会导致LLM理解困难
 */

const SENTENCE_ENDINGS = /[。!！?？\n]/;
const PUNCTUATION = /[。!！?？，,；;：:（(）)[\]【】\n]/;

/**
 * 智能截断文本，保留完整的句子边界
 * @param text 要截断的文本
 * @param maxLength 最大长度（字符数）
 * @returns 截断后的文本
 */
export function truncateToSentenceBoundary(text: string, maxLength: number): string {
  if (!text || maxLength <= 0) return "";
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);

  // 从末尾向前查找最近的句子结尾或安全截断点
  for (let i = truncated.length - 1; i >= Math.max(0, truncated.length - 50); i--) {
    if (SENTENCE_ENDINGS.test(truncated[i])) {
      return truncated.slice(0, i + 1);
    }
  }

  // 如果找不到句子结尾，从末尾向前查找标点符号
  for (let i = truncated.length - 1; i >= Math.max(0, truncated.length - 20); i--) {
    if (PUNCTUATION.test(truncated[i])) {
      return truncated.slice(0, i + 1);
    }
  }

  // 最后的备选方案：在最后一个空格处截断
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  if (lastSpaceIndex > 0) {
    return truncated.slice(0, lastSpaceIndex);
  }

  return truncated;
}

/**
 * 将字符串截断到指定长度，在单词边界处
 * 用于 URL、标识符等不能中断的字段
 * @param text 文本
 * @param maxLength 最大长度
 * @returns 截断后的文本
 */
export function truncateToWordBoundary(text: string, maxLength: number): string {
  if (!text || maxLength <= 0) return "";
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");

  if (lastSpaceIndex > Math.max(0, maxLength * 0.7)) {
    return truncated.slice(0, lastSpaceIndex);
  }

  return truncated;
}

/**
 * 处理多行文本，保持格式但限制长度
 * 用于处理包含换行符的提示词或描述文本
 * @param text 文本
 * @param maxLengthPerLine 每行最大长度
 * @param maxLines 最大行数
 * @returns 格式化后的文本
 */
export function truncateMultilineText(text: string, maxLengthPerLine: number, maxLines: number): string {
  if (!text) return "";

  const lines = text.split("\n");
  const truncatedLines: string[] = [];

  for (const line of lines) {
    if (truncatedLines.length >= maxLines) break;
    truncatedLines.push(truncateToWordBoundary(line, maxLengthPerLine));
  }

  return truncatedLines.join("\n");
}

/**
 * 安全地截断 JSON 字符串，确保 JSON 有效性
 * 用于处理 LLM 响应中可能被截断的 JSON 对象
 * @param text 可能被截断的 JSON 文本
 * @param maxLength 最大长度
 * @returns 截断后的有效 JSON 或原文本
 */
export function safeJsonTruncate(text: string, maxLength: number): string {
  if (!text || maxLength <= 0) return "{}";
  if (text.length <= maxLength) {
    try {
      JSON.parse(text);
      return text;
    } catch {
      return "{}";
    }
  }

  const truncated = text.slice(0, maxLength);

  // 尝试找到最后的完整 JSON 结构
  for (let i = truncated.length - 1; i >= 0; i--) {
    try {
      const candidate = truncated.slice(0, i) + "}".repeat((text.match(/{/g) || []).length);
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 继续尝试
    }
  }

  return "{}";
}

/**
 * 规范化提示词 - 去除多余空白、标准化格式
 * @param prompt 原始提示词
 * @returns 规范化后的提示词
 */
export function normalizePrompt(prompt: string): string {
  if (!prompt) return "";

  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * 合并多个文本片段，确保不超过指定长度
 * @param fragments 文本片段数组
 * @param maxLength 最大总长度
 * @param separator 分隔符（默认为空格）
 * @returns 合并后的文本
 */
export function mergeTextFragments(fragments: string[], maxLength: number, separator: string = " "): string {
  const filtered = fragments.filter((f) => f && f.trim());
  if (filtered.length === 0) return "";

  let result = "";
  for (const fragment of filtered) {
    const candidate = result ? result + separator + fragment : fragment;
    if (candidate.length <= maxLength) {
      result = candidate;
    } else if (result.length > 0) {
      break;
    } else {
      // 如果单个片段超过最大长度，进行智能截断
      return truncateToSentenceBoundary(fragment, maxLength);
    }
  }

  return result;
}
