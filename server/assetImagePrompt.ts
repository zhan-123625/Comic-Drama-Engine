import type { AssetItem } from "./types.js";

/** 与用户描述拼接的分隔标记，便于切换类型时替换约束段 */
export const ASSET_IMAGE_REQUIREMENT_DELIM = "\n\n【资产生图要求】\n";

/** 各类资产生图取向（与 Agent 说明、静默拼接 API 一致） */
const REQUIREMENT_BY_TYPE: Record<AssetItem["type"], string> = {
  character:
    "角色设定参考图：同一画面中呈现正面、侧面、背面三视图（或 turnaround 设定表），中性站立、全身可见，比例一致；背景为简洁纯色、无具体剧情场景，光线均匀柔和，便于作为角色参考与后续一致性比对。",
  scene:
    "场景环境参考图：完整空间与氛围，透视合理、光照统一，可作为分镜/视频的背景与空间依据；避免画面角落出现与场景无关的大幅道具特写。",
  prop: "单品道具参考图：只表现该物品本身，背景须为纯透明或纯白/纯灰无环境（便于抠图与合成），除必要接触阴影外不要地面、台面、室内外交界等场景元素，适合作为参考图叠加到其他画面。",
  costume: "服装造型参考图：突出剪裁、纹样与材质，可使用人台或简洁站姿模特；背景简洁无叙事场景，避免复杂环境抢镜。",
  action_pose: "动作姿态参考图：清晰展示关键姿势与肢体走向，可配合简洁剪影或线稿辅助；背景尽量简洁，突出动态本身。",
  fx: "特效元素参考图：光效、粒子、魔法、爆炸等主体清晰、边缘相对干净，背景尽量简单或透明/暗底单色，便于后期叠加合成。",
};

const TYPE_AGENT_LABEL: Record<AssetItem["type"], string> = {
  character: "character 角色",
  scene: "scene 场景",
  prop: "prop 物品/道具",
  costume: "costume 服装造型",
  action_pose: "action_pose 动作姿态",
  fx: "fx 特效",
};

/**
 * 附在资产 Agent system 提示末尾：要求模型在每条 prompt 内有机写入对应 type 的生图约束（不依赖前端改提示词框）。
 */
export function buildAssetImageConstraintsForAgentSystemPrompt(): string {
  const bullets = (Object.keys(REQUIREMENT_BY_TYPE) as AssetItem["type"][]).map((t) => {
    const label = TYPE_AGENT_LABEL[t];
    const req = REQUIREMENT_BY_TYPE[t];
    return `- ${label}：prompt 须为完整可用的文生图描述，并把下列取向自然融入同一段文字中（不要使用「【资产生图要求】」等单独标题分段）：${req}`;
  });
  return `【每条 prompt 写法】\n${bullets.join("\n")}`;
}

export function stripAssetImageRequirement(prompt: string): string {
  const t = prompt.trimEnd();
  for (const suf of Object.values(REQUIREMENT_BY_TYPE)) {
    const tail = ASSET_IMAGE_REQUIREMENT_DELIM + suf;
    if (t.endsWith(tail)) return t.slice(0, -tail.length).trimEnd();
  }
  return t;
}

/**
 * 仅用于调用生图 API 时拼接（不写回资产的 prompt 字段，避免用户无法在界面中编辑主体描述）。
 * 已存在同一段「【资产生图要求】」约束时会先去重再追加。
 */
export function composeAssetImagePrompt(prompt: string, type: AssetItem["type"]): string {
  const base = stripAssetImageRequirement(prompt);
  const req = REQUIREMENT_BY_TYPE[type];
  const block = ASSET_IMAGE_REQUIREMENT_DELIM + req;
  if (!base) return req;
  return base + block;
}
