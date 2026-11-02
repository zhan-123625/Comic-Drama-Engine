/** 从模型输出中抽出 JSON 片段（支持 markdown 代码块及未闭合代码块） */
export function extractJsonPayload(raw: string): string {
  let t = raw.trim();

  // 1. 尝试匹配成对的 ```json ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    return fence[1].trim();
  }

  // 2. 如果存在未闭合的 ```json 前缀，剥离前缀
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").trim();
  }
  // 移除尾部可能散落的 ```
  t = t.replace(/\s*```$/i, "").trim();

  return t;
}

/**
 * 健壮的 JSON 数组解析器：支持清理注释、尾部逗号，以及在截断时自动拯救前面的有效条目
 */
export function parseJsonArrayLenient<T = unknown>(raw: string): T[] | null {
  const extracted = extractJsonPayload(raw);

  // 1. 先尝试直接解析
  try {
    const val = JSON.parse(extracted);
    if (Array.isArray(val)) return val as T[];
  } catch {
    /* 尝试后续修复 */
  }

  // 2. 找到第一个 '[' 的位置
  const firstBracket = extracted.indexOf("[");
  if (firstBracket === -1) return null;

  let candidate = extracted.slice(firstBracket);

  // 3. 移除单行与多行注释，以及末尾多余逗号
  candidate = candidate
    .replace(/\/\/[^\n]*/g, "") // 移除 // 注释
    .replace(/\/\*[\s\S]*?\*\//g, "") // 移除 /* */ 注释
    .replace(/,\s*([\]}])/g, "$1"); // 移除尾随逗号 (trailing commas)

  // 4. 再次尝试直接解析
  try {
    const val = JSON.parse(candidate);
    if (Array.isArray(val)) return val as T[];
  } catch {
    /* 尝试截断修复 */
  }

  // 5. 如果末尾截断了（缺少反括号或在某个对象中间截断）
  // 寻找最后一个完整的对象闭合 '}'
  const lastBrace = candidate.lastIndexOf("}");
  if (lastBrace > 0) {
    const truncatedSub =
      candidate.slice(0, lastBrace + 1).replace(/,\s*$/, "") + // 去掉末尾可能遗留的逗号
      "\n]";
    try {
      const val = JSON.parse(truncatedSub);
      if (Array.isArray(val)) return val as T[];
    } catch {
      /* ignore */
    }
  }

  return null;
}
