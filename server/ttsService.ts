import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, unlink, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./db.js";
import { readConfig } from "./config.js";
import { store } from "./store.js";
import { sseSend } from "./sse.js";
import { logger } from "./logger.js";
import { muxVideoAudioAndBgm } from "./ffmpegHelper.js";
import { resolveBgmPathForShot } from "./bgmService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 从台词文本中提取说话人名称（如“团团”、“滚滚”、“旁白”等）。
 */
export function extractSpeakerFromDialogue(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();

  // 1. 括号包裹的旁白/解说前缀：如 （旁白）或 [解说] 或 【独白】
  const bracketMatch = s.match(/^[（(【\[](旁白|解说|独白|背景音|系统音|画外音)[）)】\]]/);
  if (bracketMatch) return bracketMatch[1]!;

  // 2. 带括号动作说明的角色名前缀：如 团团（摇晃着耳朵）：“...” 或 苏晓(冷笑): "..."
  const roleWithBracketMatch = s.match(/^([^：:\n\r（(【\["“”]{1,12})[（(【\[][^）)】\]]*[）)】\]][：:]/);
  if (roleWithBracketMatch) return roleWithBracketMatch[1]!.trim();

  // 3. 标准角色名前缀：如 团团：“...” 或 滚滚: ... 或 旁白：...
  const roleColonMatch = s.match(/^([^：:\n\r（(【\["“”]{1,12})[：:]/);
  if (roleColonMatch) return roleColonMatch[1]!.trim();

  return null;
}

/**
 * 智能解析当前镜头应该采用的配音音色模型与说话人。
 * 优先级：
 * 1. 显式传入的 options.model
 * 2. 分镜镜头上指定的 shot.voice
 * 3. 匹配到的角色资产上设置的 asset.voice
 * 4. 旁白/解说 -> 知婷 (温柔知性叙事女声)
 * 5. 智能性格/性别分配：男声 -> 知厨，女声/软萌 -> 知澖，其他角色轮换分配不同音色，确保绝不撞音
 */
export function resolveVoiceForShot(
  project: { assets?: Array<{ id: string; type: string; name: string; aliases?: string[]; prompt?: string; voice?: string }> },
  shot: { dialogue?: string; content?: string; voice?: string; speaker?: string },
  options?: { model?: string; voice?: string },
): { model: string; voice?: string; speaker: string; characterName?: string } {
  // 1. 显式传入参数
  if (options?.model?.trim()) {
    return {
      model: options.model.trim(),
      voice: options.voice?.trim() || undefined,
      speaker: shot.speaker || "自定义",
    };
  }

  // 2. 镜头级别显式指定
  if (shot.voice?.trim()) {
    return {
      model: shot.voice.trim(),
      speaker: shot.speaker || "镜头指定",
    };
  }

  const rawDialogue = shot.dialogue || "";
  let speaker = shot.speaker?.trim() || extractSpeakerFromDialogue(rawDialogue);

  // 3. 若台词未显式带角色前缀，尝试从分镜画面描述和角色资产中推测
  const charAssets = (project.assets || []).filter((a) => a.type === "character");
  if (!speaker && charAssets.length > 0) {
    const combinedText = `${shot.content || ""} ${rawDialogue}`;
    const matched = charAssets.filter((a) => {
      if (combinedText.includes(a.name)) return true;
      return a.aliases?.some((al) => combinedText.includes(al));
    });
    if (matched.length === 1) {
      speaker = matched[0]!.name;
    }
  }

  // 4. 旁白/解说类角色 -> 龙婉 (温润知性抒情女声，大模型情感语音)
  if (speaker && /旁白|解说|独白|背景音|系统音|画外音/.test(speaker)) {
    return {
      model: "cosyvoice-v2:longwan_v2",
      speaker: speaker || "旁白",
    };
  }

  // 5. 查找匹配的角色资产
  const matchedAsset = speaker
    ? charAssets.find(
        (a) =>
          a.name.toLowerCase() === speaker.toLowerCase() ||
          a.aliases?.some((al) => al.toLowerCase() === speaker.toLowerCase()),
      )
    : undefined;

  // 5.1 角色资产上有用户设置的专属音色
  if (matchedAsset?.voice?.trim()) {
    return {
      model: matchedAsset.voice.trim(),
      speaker: speaker || matchedAsset.name,
      characterName: matchedAsset.name,
    };
  }

  // 5.2 智能自动分配：优先采用阿里百炼 CosyVoice-v2 大模型情感音色，情绪饱满自然生动
  if (matchedAsset || speaker) {
    const textToAnalyze = `${speaker || ""} ${matchedAsset?.name || ""} ${matchedAsset?.prompt || ""} ${(matchedAsset?.aliases || []).join(" ")}`;

    const isMale = /男|大叔|青年|小伙|少年|老汉|公|雄|熊|爹|父|哥|弟|胖达|大熊猫|滚滚|男主|王|李|张/i.test(textToAnalyze);
    const isCuteOrFemale = /女|少女|萝莉|妹|姐|母|雌|兔|猫|团团|小毛球|棉花糖|小怪兽|可爱|甜美|软萌/i.test(textToAnalyze);

    if (isMale && !isCuteOrFemale) {
      // 滚滚 / 调皮男性动物角色：龙硕（阳光风趣）或 杰力豆（卡通幽默）
      const model = /滚滚|胖达|熊猫/.test(textToAnalyze) ? "cosyvoice-v2:longshuo_v2" : "cosyvoice-v2:longshuo_v2";
      return {
        model,
        speaker: speaker || matchedAsset?.name || "滚滚",
        characterName: matchedAsset?.name,
      };
    }
    if (isCuteOrFemale && !isMale) {
      // 团团 / 可爱软萌女角色：龙小春（萌系灵动女童声，大模型情感极富起伏）
      return {
        model: "cosyvoice-v2:longxiaochun_v2",
        speaker: speaker || matchedAsset?.name || "团团",
        characterName: matchedAsset?.name,
      };
    }

    // 无法判断时，根据角色在角色资产列表中的索引分配不同的大模型音色，确保绝不撞音
    if (matchedAsset) {
      const idx = charAssets.indexOf(matchedAsset);
      const voicePalette = [
        "cosyvoice-v2:longxiaochun_v2", // 团团/萝莉女童
        "cosyvoice-v2:longshuo_v2",     // 滚滚/风趣少年
        "cosyvoice-v2:longjielidou_v2", // 卡通搞怪
        "cosyvoice-v2:longmiao_v2",     // 软萌可爱
        "cosyvoice-v2:longwan_v2",      // 温柔知性
        "cosyvoice-v2:longcheng_v2",    // 磁性沉稳
      ];
      const assigned = voicePalette[idx % voicePalette.length]!;
      return {
        model: assigned,
        speaker: speaker || matchedAsset.name,
        characterName: matchedAsset.name,
      };
    }
  }

  // 6. 默认回退（萌系活泼大模型女童声）
  return {
    model: "cosyvoice-v2:longxiaochun_v2",
    speaker: speaker || "默认",
  };
}

/**
 * 清洗分镜台词对白，提取纯净的配音口播文本。
 * - 过滤括号内的舞台动作提示、情绪指示（如 `（叹气）`、`(低头小声)`、`【轻笑】`）
 * - 去除角色名字前缀（如 `林晚：“...”`、`旁白：...`）
 * - 去除外围多余引号，保留真实台词
 */
export function cleanDialogueText(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  let text = raw.trim();

  // 1. 去除两端的括号或方括号说明，如 （叹气） 或 [低语]
  text = text.replace(/（[^）]*）/g, " ");
  text = text.replace(/\([^)]*\)/g, " ");
  text = text.replace(/【[^】]*】/g, " ");
  text = text.replace(/\[[^\]]*\]/g, " ");

  // 2. 检查是否有角色前缀，如 "林晚：“你好啊”" 或 "苏晓: 好的"
  const prefixMatch = text.match(/^[^：:\n\r]{1,15}[：:]\s*([\s\S]+)$/);
  if (prefixMatch && prefixMatch[1]) {
    text = prefixMatch[1].trim();
  }

  // 3. 提取引号中的对白（如果有引号包裹）
  const quoteMatch = text.match(/[“"']([^”"']+)["”']/);
  if (quoteMatch && quoteMatch[1] && quoteMatch[1].trim().length > 0) {
    text = quoteMatch[1].trim();
  }

  // 4. 清理残留的多余标点和首尾空白
  text = text.replace(/["“”'‘’]/g, "").trim();

  // 若清洗后为空，但原文本有内容，则回退为去除括号后的纯文本
  if (!text) {
    text = raw.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "").replace(/["“”'‘’]/g, "").trim();
  }

  return text;
}

let cachedPythonPath: string | null = null;

/**
 * 获取可用的 Python 执行文件路径
 */
export function getPythonPath(): string {
  if (cachedPythonPath && existsSync(cachedPythonPath)) {
    return cachedPythonPath;
  }

  const candidates = [
    process.env.PYTHON_PATH,
    "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python310\\python.exe",
    "python",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c === "python" || existsSync(c)) {
      cachedPythonPath = c;
      return c;
    }
  }

  return "python";
}

export type SynthesizeSpeechParams = {
  text: string;
  model?: string;
  voice?: string;
  apiKey?: string;
  outputPath?: string;
};

/**
 * 调用 DashScope 语音合成并生成 MP3 音频文件
 */
export async function synthesizeSpeech(params: SynthesizeSpeechParams): Promise<string> {
  const cfg = await readConfig();

  const apiKey =
    params.apiKey?.trim() ||
    cfg.tts?.apiKey?.trim() ||
    cfg.text?.apiKey?.trim() ||
    cfg.video?.apiKey?.trim() ||
    process.env.DASHSCOPE_API_KEY ||
    "";

  if (!apiKey) {
    throw new Error("未配置百炼/DashScope API Key，无法调用语音合成");
  }

  const model = params.model?.trim() || cfg.tts?.model?.trim() || "sambert-zhixiao-v1";
  const voice = params.voice?.trim() || cfg.tts?.voice?.trim() || "";

  const scriptPath = path.join(__dirname, "scripts", "tts_dashscope.py");
  const outputPath =
    params.outputPath || path.join(os.tmpdir(), `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

  const pythonBin = getPythonPath();

  const args: string[] = [
    scriptPath,
    "--api-key",
    apiKey,
    "--text",
    params.text,
    "--model",
    model,
    "--output",
    outputPath,
  ];

  if (voice) {
    args.push("--voice", voice);
  }

  return new Promise((resolve, reject) => {
    execFile(pythonBin, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        const errMsg = stderr || stdout || err.message;
        reject(new Error(`语音合成失败: ${errMsg.slice(-600)}`));
      } else {
        resolve(outputPath);
      }
    });
  });
}

/**
 * 为指定镜头生成台词语音并保存至项目文件目录
 */
export async function generateShotAudio(
  projectId: string,
  shotId: string,
  options?: { text?: string; model?: string; voice?: string },
): Promise<{ audioUrl: string; audioPath: string }> {
  const project = await store.get(projectId);
  if (!project) throw new Error("项目不存在");

  const shot = project.storyboards.find((s) => s.id === shotId);
  if (!shot) throw new Error("分镜不存在");

  const rawText = options?.text || shot.dialogue || shot.content || "";
  const cleanedText = cleanDialogueText(rawText);

  if (!cleanedText) {
    throw new Error("当前分镜台词对白为空，无法生成语音");
  }

  const audioDir = path.join(dataDir, "files", "projects", projectId, "audio");
  await mkdir(audioDir, { recursive: true });

  const audioFilename = `${shotId}.mp3`;
  const targetAudioPath = path.join(audioDir, audioFilename);

  const resolved = resolveVoiceForShot(project, shot, options);

  logger.info("synthesizing shot speech", {
    projectId,
    shotId,
    shotIndex: shot.index,
    speaker: resolved.speaker,
    model: resolved.model,
    cleanedText: cleanedText.slice(0, 60),
  });

  await synthesizeSpeech({
    text: cleanedText,
    model: resolved.model,
    voice: resolved.voice,
    outputPath: targetAudioPath,
  });

  const audioUrl = `/api/files/projects/${projectId}/audio/${audioFilename}`;

  // 更新分镜中的音频地址与说话人/音色标识
  project.storyboards = project.storyboards.map((s) =>
    s.id === shotId
      ? {
          ...s,
          audioUrl,
          videoRefAudioUrl: audioUrl,
          speaker: resolved.speaker,
          voice: resolved.model,
        }
      : s,
  );
  await store.save(project);

  sseSend(projectId, {
    type: "log",
    message: `镜头 #${shot.index} [${resolved.speaker}] 台词语音生成完成: "${cleanedText.slice(0, 30)}"`,
  });
  sseSend(projectId, { type: "storyboards", storyboards: project.storyboards });

  return { audioUrl, audioPath: targetAudioPath };
}

/**
 * 尝试将镜头的音频自动混入已生成的视频中
 */
export async function tryMuxAudioIntoVideo(
  projectId: string,
  shotId: string,
  videoUrl: string,
): Promise<{ videoUrl: string; muxed: boolean }> {
  try {
    const project = await store.get(projectId);
    if (!project) return { videoUrl, muxed: false };

    const shot = project.storyboards.find((s) => s.id === shotId);
    if (!shot) return { videoUrl, muxed: false };

    const cfg = await readConfig();
    const autoMux = cfg.tts?.autoMuxVideo !== false; // 默认开启
    if (!autoMux) {
      return { videoUrl, muxed: false };
    }

    // 解析视频本地文件路径
    const m = videoUrl.match(/\/api\/files\/projects\/[^/]+\/videos\/(.+)$/);
    if (!m) {
      // 远程或非法路径，跳过自动混流
      return { videoUrl, muxed: false };
    }
    const videoFilename = m[1]!;
    const videoFilePath = path.join(dataDir, "files", "projects", projectId, "videos", videoFilename);
    if (!existsSync(videoFilePath)) {
      return { videoUrl, muxed: false };
    }

    let audioPath: string | null = null;
    const audioDir = path.join(dataDir, "files", "projects", projectId, "audio");
    const shotAudioCandidate = path.join(audioDir, `${shotId}.mp3`);

    if (existsSync(shotAudioCandidate)) {
      audioPath = shotAudioCandidate;
    } else if (cleanDialogueText(shot.dialogue || "")) {
      // 存在台词但尚未合成音频，自动合成一次
      try {
        const { audioPath: generatedPath } = await generateShotAudio(projectId, shotId);
        audioPath = generatedPath;
      } catch (ttsErr) {
        logger.warn("视频生成后自动合成台词语音失败，保持原静音视频", {
          projectId,
          shotId,
          error: ttsErr instanceof Error ? ttsErr.message : String(ttsErr),
        });
      }
    }

    let bgmPath: string | null = null;
    const resolvedBgm = resolveBgmPathForShot(shot.music, projectId);
    if (resolvedBgm.path && existsSync(resolvedBgm.path)) {
      bgmPath = resolvedBgm.path;
    }

    const hasDialogue = Boolean(shot.dialogue?.trim());
    if ((!audioPath || !existsSync(audioPath)) && !bgmPath && !hasDialogue && !shot.durationSec) {
      return { videoUrl, muxed: false };
    }

    // 关键机制：保留原始未压字幕的 raw.mp4 视频备份，以便反复调整台词或时长时，始终从干净的原始视频重新渲染，避免重复烧录重影
    const rawVideoPath = videoFilePath.replace(/\.mp4$/i, ".raw.mp4");
    if (!existsSync(rawVideoPath)) {
      try {
        await copyFile(videoFilePath, rawVideoPath);
      } catch (copyErr) {
        logger.warn("备份原始无字幕视频失败", { videoFilePath, error: String(copyErr) });
      }
    }
    const inputVideoPath = existsSync(rawVideoPath) ? rawVideoPath : videoFilePath;

    // 执行 ffmpeg 音画多轨合流（台词 + 背景音乐智能闪避混合 + 画面平滑延展 + 电影字幕烧录）
    const tempMuxedPath = path.join(os.tmpdir(), `mux_${Date.now()}_${videoFilename}`);
    await muxVideoAudioAndBgm({
      videoPath: inputVideoPath,
      audioPath: (audioPath && existsSync(audioPath)) ? audioPath : null,
      bgmPath,
      outputPath: tempMuxedPath,
      durationSec: shot.durationSec,
      bgmVolume: 0.22,
      voiceVolume: 1.0,
      subtitleText: shot.dialogue?.trim() || null,
      burnSubtitle: true,
    });

    if (existsSync(tempMuxedPath)) {
      await copyFile(tempMuxedPath, videoFilePath);
      await unlink(tempMuxedPath).catch(() => {});
      logger.info("视频、台词、背景音乐与字幕多轨合流完成", {
        projectId,
        shotId,
        videoFilePath,
        audioPath,
        bgmPath,
        hasDialogue,
        durationSec: shot.durationSec,
      });
      const trackNotes: string[] = [];
      if (audioPath) trackNotes.push("角色对白");
      if (bgmPath) trackNotes.push(`配乐: ${resolvedBgm.name}`);
      if (hasDialogue) trackNotes.push("电影字幕");
      sseSend(projectId, {
        type: "log",
        message: `镜头 #${shot.index} 视频已成功融合音画与字幕（${trackNotes.join(" + ")}）！`,
      });
      return { videoUrl, muxed: true };
    }

    return { videoUrl, muxed: false };
  } catch (e) {
    logger.warn("自动混音失败，保留原始视频", {
      projectId,
      shotId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { videoUrl, muxed: false };
  }
}
