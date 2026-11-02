import type { ArtStylePreset, MenuItem, MenuKey, SideTabItem } from "./types";

/** 与当前视频生成模型一致：单镜时长仅整秒 */
export const SHOT_DURATION_SEC_MIN = 1;
export const SHOT_DURATION_SEC_MAX = 15;

export const projectOnlyMenus: MenuKey[] = [
  "overview",
  "source",
  "pipeline",
  "script",
  "storyboard",
  "video",
  "jobs",
  "assets",
  "assetLibrary",
  "timeline",
];

// 一级菜单：只包含“设置”。项目列表独立展示，不属于菜单项。
export const menus: MenuItem[] = [{ key: "settings", label: "设置", hint: "模型配置与项目创建" }];

export const projectMenus: MenuItem[] = [
  { key: "overview", label: "总览", hint: "项目状态" },
  { key: "source", label: "原文", hint: "小说原文编辑" },
  { key: "pipeline", label: "管线", hint: "原文→视频全链路" },
  { key: "script", label: "剧本", hint: "剧本文本编辑" },
  { key: "storyboard", label: "分镜", hint: "镜头与参考图" },
  { key: "video", label: "视频", hint: "成片与任务状态（入队与提示词在分镜页）" },
  { key: "jobs", label: "任务", hint: "视频生成队列" },
  { key: "assets", label: "资产", hint: "场景与物品素材" },
  { key: "assetLibrary", label: "资产库", hint: "跨项目可复用资产" },
  { key: "timeline", label: "时间线", hint: "视频镜头时间线" },
];

export const sideTabs: SideTabItem[] = [
  { key: "projects", label: "项目列表", hint: "选择项目进入工作流" },
  { key: "settings", label: "设置", hint: "模型与运行参数" },
];

export const projectTypePresets = [
  "言情",
  "悬疑",
  "都市",
  "玄幻",
  "科幻",
  "古风",
  "校园",
  "职场",
  "喜剧",
  "惊悚",
] as const;

export const artStylePresets: ArtStylePreset[] = [
  {
    key: "anime-cel",
    label: "二次元动漫（赛璐璐）",
    prompt: "二次元动漫风，赛璐璐上色，干净线稿，色彩明快，光影清晰，表情夸张但不过度，画面无字幕无水印",
  },
  {
    key: "anime-soft",
    label: "日系清新（柔光）",
    prompt: "日系清新插画风，柔和光线，淡雅配色，细腻质感，背景简洁，画面无字幕无水印",
  },
  {
    key: "cinematic",
    label: "电影感写实",
    prompt: "电影感写实，镜头感强，真实光影，浅景深，胶片颗粒，色调统一，画面无字幕无水印",
  },
  { key: "ink", label: "水墨国风", prompt: "水墨国风，留白，笔触明显，墨色层次，意境氛围，画面无字幕无水印" },
];
