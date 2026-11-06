import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BGM_DIR = path.join(__dirname, "assets", "bgm");

export type BgmPreset = {
  id: string;
  name: string;
  filename: string;
  tags: string[];
  description: string;
  durationSec: number;
};

export const BGM_PRESETS: BgmPreset[] = [
  {
    id: "forest_whistle",
    name: "微风竹林 · 笛韵筝鸣",
    filename: "forest_whistle.mp3",
    tags: ["森林", "竹笛", "轻快", "微风", "温馨", "弦乐", "竹林", "阳光", "笛", "笛子", "古筝", "国风", "仙侠"],
    description: "清新典雅的竹笛长吟与真声古筝流水琶音，专为竹林探险、自然漫步及小动物日常量身打造。",
    durationSec: 22,
  },
  {
    id: "playful_comic",
    name: "萌趣日常 · 欢快木琴与拨弦",
    filename: "playful_comic.mp3",
    tags: ["轻松", "逗趣", "搞怪", "幽默", "跳跃", "木琴", "打闹", "追逐", "喜剧", "滑稽", "萌", "可爱", "活泼"],
    description: "清脆利落的原木木琴与弹性跳跃拨弦低音，充满滑稽灵动感，适合调皮搞怪与追逐打闹。",
    durationSec: 18,
  },
  {
    id: "warm_gentle",
    name: "温暖治愈 · 晨光微漾钢琴",
    filename: "warm_gentle.mp3",
    tags: ["温暖", "治愈", "钢琴", "晨光", "舒缓", "宁静", "抒情", "柔和", "感动", "回忆", "对话", "陪伴"],
    description: "温润大钢琴分解和弦与柔和弦乐铺底，适合温馨交流、静谧晨光与情感羁绊沉淀。",
    durationSec: 20,
  },
  {
    id: "suspense_tension",
    name: "悬疑紧迫 · 危机低吟脉冲",
    filename: "suspense_tension.mp3",
    tags: ["悬疑", "危机", "紧张", "惊险", "危险", "暗藏", "伏笔", "对峙", "潜行", "神秘", "压抑"],
    description: "低沉大提琴持续低音与低频心跳脉冲，穿插神秘金属钟声，营造危机四伏与暗流涌动。",
    durationSec: 18,
  },
  {
    id: "epic_spark",
    name: "星火浩瀚 · 史诗科幻管弦",
    filename: "epic_spark.mp3",
    tags: ["星火", "史诗", "浩瀚", "科幻", "壮丽", "冒险", "战斗", "高潮", "宇宙", "信标", "壮阔", "未来"],
    description: "宏大壮丽的管弦和弦与疾走律动推进，展现浩瀚星空与命运抗争的史诗气魄。",
    durationSec: 20,
  },
  {
    id: "fairytale_dream",
    name: "纯真童话 · 梦幻八音盒与竖琴",
    filename: "fairytale_dream.mp3",
    tags: ["童话", "梦幻", "八音盒", "竖琴", "纯真", "梦境", "奇幻", "甜美", "魔法", "回忆", "摇篮"],
    description: "晶莹剔透的八音盒清亮音符伴随竖琴琶音，营造纯真纯澈的梦境童话氛围。",
    durationSec: 18,
  },
];

/**
 * 根据分镜中的 music 描述文字，智能匹配最契合的 BGM 预设。
 */
export function matchBgmPreset(musicText?: string): BgmPreset {
  const text = (musicText || "").trim().toLowerCase();
  if (!text) {
    return BGM_PRESETS[0]!; // 默认推荐微风森林竹笛
  }

  // 1. 显式 ID 或文件名匹配
  const byId = BGM_PRESETS.find((p) => p.id === text || p.filename === text);
  if (byId) return byId;

  // 2. 标签命中计分
  let best = BGM_PRESETS[0]!;
  let maxScore = 0;
  for (const p of BGM_PRESETS) {
    let score = 0;
    for (const tag of p.tags) {
      if (text.includes(tag.toLowerCase())) {
        score += 2;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      best = p;
    }
  }

  return best;
}

/**
 * 获取 BGM 预设的本地文件路径
 */
export function getBgmFilePath(presetIdOrFilename: string, projectId?: string): string | null {
  const clean = presetIdOrFilename.trim().replace(/^.*[\\/]/, "");
  if (projectId) {
    const dataDir = path.resolve(process.env.DATA_DIR || "./data");
    const projPath = path.join(dataDir, "files", "projects", projectId, "bgm", clean);
    if (fs.existsSync(projPath)) {
      return projPath;
    }
  }
  const p = BGM_PRESETS.find((x) => x.id === clean || x.filename === clean);
  const targetName = p ? p.filename : clean;
  const fullPath = path.join(BGM_DIR, targetName);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return null;
}

/**
 * 为分镜综合解析背景音乐路径与元信息（支持项目自定义上传与全局主题预设）
 */
export function resolveBgmPathForShot(musicText?: string, projectId?: string): { path: string | null; name: string; url: string } {
  const clean = (musicText || "").trim();
  if (projectId && clean) {
    const filename = clean.replace(/^.*[\\/]/, "");
    const dataDir = path.resolve(process.env.DATA_DIR || "./data");
    const projPath = path.join(dataDir, "files", "projects", projectId, "bgm", filename);
    if (fs.existsSync(projPath)) {
      return {
        path: projPath,
        name: `自定义 · ${filename}`,
        url: `/api/files/projects/${projectId}/bgm/${filename}`,
      };
    }
  }

  const matched = matchBgmPreset(musicText);
  const full = path.join(BGM_DIR, matched.filename);
  return {
    path: fs.existsSync(full) ? full : null,
    name: matched.name,
    url: `/api/files/bgm/${matched.filename}`,
  };
}

/**
 * 保存项目自定义上传的 BGM 音频文件
 */
export function saveProjectBgmFile(projectId: string, filename: string, buffer: Buffer): { filename: string; url: string } {
  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  const projDir = path.join(dataDir, "files", "projects", projectId, "bgm");
  if (!fs.existsSync(projDir)) {
    fs.mkdirSync(projDir, { recursive: true });
  }
  const safeName = filename.replace(/[^\w\u4e00-\u9fa5.-]/g, "_");
  const finalPath = path.join(projDir, safeName);
  fs.writeFileSync(finalPath, buffer);
  return {
    filename: safeName,
    url: `/api/files/projects/${projectId}/bgm/${safeName}`,
  };
}

/**
 * 列出项目已上传的自定义 BGM 音频
 */
export function listProjectBgms(projectId: string): Array<{ name: string; filename: string; url: string }> {
  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  const projDir = path.join(dataDir, "files", "projects", projectId, "bgm");
  if (!fs.existsSync(projDir)) return [];
  const files = fs.readdirSync(projDir);
  return files
    .filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f))
    .map((f) => ({
      name: f,
      filename: f,
      url: `/api/files/projects/${projectId}/bgm/${f}`,
    }));
}

