/** HTTP 监听端口 */
export const PORT = Number(process.env.MY_APP_PORT || 3710);

/** HTTP 请求体上限（原文/剧本可能较长，默认放宽）。示例：MY_APP_BODY_LIMIT=20mb */
export const BODY_LIMIT = (process.env.MY_APP_BODY_LIMIT || "20mb").trim();

/** 长文本字段上限（script/outline 等），可按机器能力调大。 */
export const LONG_TEXT_MAX = Math.max(100_000, Number(process.env.MY_APP_LONG_TEXT_MAX || 5_000_000) || 5_000_000);

/** 原文通常最长，单独放宽，避免导入长小说时频繁触顶。 */
export const SOURCE_TEXT_MAX = Math.max(
  LONG_TEXT_MAX,
  Number(process.env.MY_APP_SOURCE_TEXT_MAX || 12_000_000) || 12_000_000,
);
