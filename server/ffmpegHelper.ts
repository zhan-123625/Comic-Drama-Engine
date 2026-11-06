import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger.js";

const require = createRequire(import.meta.url);

let cachedFfmpegPath: string | null = null;

/**
 * 寻找可正常执行的 ffmpeg 二进制路径。
 * 在 Windows 环境下，若项目所在路径包含中文或特殊字符，ffmpeg-static 可能会报 DLL 初始化错误 (0xC0000142)。
 * 此时自动检测并安全缓存至系统临时目录 (ASCII 纯净路径) 中运行。
 */
export async function getFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) {
    return cachedFfmpegPath;
  }

  // 1. 优先读取环境变量
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return process.env.FFMPEG_PATH;
  }

  // 2. 检测默认 ffmpeg-static 二进制
  let defaultStaticPath: string | null;
  try {
    defaultStaticPath = require("ffmpeg-static");
  } catch {
    defaultStaticPath = null;
  }

  const testBinary = (binPath: string): Promise<boolean> => {
    return new Promise((resolve) => {
      execFile(binPath, ["-version"], { timeout: 5000 }, (err: unknown) => {
        resolve(!err);
      });
    });
  };

  if (defaultStaticPath && fs.existsSync(defaultStaticPath)) {
    const works = await testBinary(defaultStaticPath);
    if (works) {
      cachedFfmpegPath = defaultStaticPath;
      return defaultStaticPath;
    }
    logger.warn("ffmpeg-static 原生路径执行失败，尝试安全复制到系统临时目录", { path: defaultStaticPath });
  }

  // 3. 复制到系统临时目录安全路径
  const safeTempPath = path.join(os.tmpdir(), "comic-drama-engine-ffmpeg.exe");
  try {
    // 优先从已安装的 python imageio_ffmpeg 路径或 defaultStaticPath 复制
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const pythonImageioPath = path.join(
      localAppData,
      "Programs",
      "Python",
      "Python310",
      "lib",
      "site-packages",
      "imageio_ffmpeg",
      "binaries",
      "ffmpeg-win-x86_64-v9.0.2.exe",
    );
    const sourcePath =
      fs.existsSync(pythonImageioPath)
        ? pythonImageioPath
        : defaultStaticPath && fs.existsSync(defaultStaticPath)
          ? defaultStaticPath
          : null;

    if (sourcePath) {
      if (!fs.existsSync(safeTempPath) || fs.statSync(safeTempPath).size !== fs.statSync(sourcePath).size) {
        fs.copyFileSync(sourcePath, safeTempPath);
      }
      const works = await testBinary(safeTempPath);
      if (works) {
        cachedFfmpegPath = safeTempPath;
        return safeTempPath;
      }
    }
  } catch (e) {
    logger.warn("复制 ffmpeg 到临时目录失败", { error: e instanceof Error ? e.message : String(e) });
  }

  // 回退：返回 defaultStaticPath 或 "ffmpeg"
  cachedFfmpegPath = defaultStaticPath || "ffmpeg";
  return cachedFfmpegPath;
}

/**
 * 运行 ffmpeg 命令
 */
export async function runFfmpeg(
  args: string[],
  options?: { timeout?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const binary = await getFfmpegPath();
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: options?.timeout ?? 300_000, cwd: options?.cwd },
      (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          reject(new Error(`ffmpeg 执行失败 (${err.message}):\n${stderr.slice(-600)}`));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

/**
 * 清理台词/旁白文本用于电影字幕展示
 */
export function cleanDialogueTextForSubtitle(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/^[（(【\[][^）)】\]]*[）)】\]]\s*[:：]?\s*/g, "");
  text = text.replace(/^[^:：\n]{1,8}[:：]\s*/, "");
  text = text.replace(/["“”'‘’]/g, "").trim();
  return text;
}

/**
 * 格式化时间戳为 SRT 规范（HH:MM:SS,mmm）
 */
export function formatSrtTimestamp(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

/**
 * 智能生成 SRT 字幕文本，根据句子长度和标点自动断句与时间分配
 */
export function generateSrtContent(
  text: string,
  totalDurationSec: number,
  audioDurationSec?: number | null,
): string {
  const cleaned = cleanDialogueTextForSubtitle(text);
  if (!cleaned) return "";

  const durationSec = Math.max(1.0, totalDurationSec);
  const speechDur =
    audioDurationSec && audioDurationSec > 0
      ? audioDurationSec
      : Math.max(1.5, durationSec - 0.6);

  const startTime = 0.25;
  const endTime = Math.min(durationSec - 0.15, startTime + speechDur + 0.2);
  const totalAvail = Math.max(0.8, endTime - startTime);

  // 标点断句
  const rawParts = cleaned.split(/([，,。！!？?；;\n]+)/).filter(Boolean);
  const clauses: string[] = [];
  for (let i = 0; i < rawParts.length; i += 2) {
    const textPart = rawParts[i]?.trim();
    const punct = rawParts[i + 1]?.trim() || "";
    if (textPart) {
      clauses.push(textPart + (punct === "，" || punct === "," ? "" : punct));
    }
  }

  const validClauses = clauses.filter((c) => c.trim().length > 0);
  if (validClauses.length <= 1 || cleaned.length <= 14) {
    return `1\n${formatSrtTimestamp(startTime)} --> ${formatSrtTimestamp(endTime)}\n${cleaned}\n`;
  }

  const totalChars = validClauses.reduce((sum, c) => sum + c.length, 0);
  let curStart = startTime;
  let srt = "";

  for (let idx = 0; idx < validClauses.length; idx++) {
    const clause = validClauses[idx]!;
    const clauseDur = Math.max(0.6, (clause.length / totalChars) * totalAvail);
    const isLast = idx === validClauses.length - 1;
    const curEnd = isLast ? endTime : Math.min(endTime - 0.2, curStart + clauseDur);
    srt += `${idx + 1}\n${formatSrtTimestamp(curStart)} --> ${formatSrtTimestamp(curEnd)}\n${clause}\n\n`;
    curStart = curEnd + 0.05;
    if (curStart >= endTime) break;
  }

  return srt.trim() + "\n";
}

/**
 * 获取媒体文件的精确时长（秒）
 */
export async function getVideoDuration(filePath: string): Promise<number | null> {
  try {
    const binary = await getFfmpegPath();
    return await new Promise((resolve) => {
      execFile(binary, ["-i", filePath], { timeout: 10_000 }, (_err: Error | null, _stdout: string, stderr: string) => {
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!match) {
          resolve(null);
          return;
        }
        const hours = Number(match[1]);
        const mins = Number(match[2]);
        const secs = Number(match[3]);
        const total = hours * 3600 + mins * 60 + secs;
        resolve(Number.isFinite(total) && total > 0 ? total : null);
      });
    });
  } catch {
    return null;
  }
}

/**
 * 将视频与音频、背景音乐进行多轨合并（Audio Mixing & Muxing）
 * 包含核心能力：
 * 1. 动态画面真实对齐：成片时长严格以视频真实动态画面时长为准，绝不使用尾帧静止定格去凑时长，确保全程动态连贯；
 * 2. 音频多轨智能混音：角色对白清晰有力（默认 100%），背景音乐柔和伴奏（默认 22%），并在片尾自然淡出；
 * 3. 电影级字幕烧录（Burn-in Subtitles）：自动根据台词对白生成高对比度电影字幕（纯白字、纯黑描边、居中底部），智能断句优雅排版；
 * 4. 高性能按需重编码：仅在烧录字幕时采用 libx264 veryfast 编码，其余情况下快速流复制。
 */
export async function muxVideoAudioAndBgm(params: {
  videoPath: string;
  audioPath?: string | null;
  bgmPath?: string | null;
  outputPath: string;
  durationSec?: number;
  bgmVolume?: number;
  voiceVolume?: number;
  subtitleText?: string | null;
  burnSubtitle?: boolean;
}): Promise<void> {
  const {
    videoPath,
    audioPath,
    bgmPath,
    outputPath,
    durationSec,
    subtitleText,
    burnSubtitle,
  } = params;
  const hasVoice = Boolean(audioPath && fs.existsSync(audioPath));
  const hasBgm = Boolean(bgmPath && fs.existsSync(bgmPath));

  const probedVideo = await getVideoDuration(videoPath);
  const probedAudio = hasVoice ? await getVideoDuration(audioPath!) : null;

  // 核心原则：成片时长严格以视频真实动态画面时长为准，绝不做静止尾帧定格！
  const finalDuration = probedVideo && probedVideo > 0 ? probedVideo : (durationSec || 5.0);

  // 字幕处理
  const shouldBurnSubtitle = burnSubtitle !== false && Boolean(subtitleText?.trim());
  let tempSrtPath: string | null = null;
  let srtFilename: string | null = null;

  if (shouldBurnSubtitle) {
    const srtContent = generateSrtContent(subtitleText!, finalDuration, probedAudio);
    if (srtContent.trim()) {
      srtFilename = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.srt`;
      tempSrtPath = path.join(os.tmpdir(), srtFilename);
      await fs.promises.writeFile(tempSrtPath, srtContent, "utf8");
    }
  }

  const vFilters: string[] = [];
  if (tempSrtPath && srtFilename) {
    const subStyle =
      "FontSize=23,FontName=Microsoft YaHei,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2.4,Shadow=1.0,MarginV=35,Alignment=2";
    vFilters.push(`subtitles=${srtFilename}:force_style='${subStyle}'`);
  }

  const hasVideoFilter = vFilters.length > 0;

  // 既无语音也无BGM，且无需字幕烧录，直接快速拷贝
  if (!hasVoice && !hasBgm && !hasVideoFilter) {
    if (videoPath !== outputPath) {
      fs.copyFileSync(videoPath, outputPath);
    }
    return;
  }

  const durationStr = finalDuration.toFixed(2);
  const fadeStart = Math.max(0, finalDuration - 0.8).toFixed(2);
  const voiceVol = (params.voiceVolume ?? 1.0).toFixed(2);
  const bgmVol = (params.bgmVolume ?? 0.22).toFixed(2);

  const args: string[] = ["-y", "-i", videoPath];
  const complexFilters: string[] = [];

  if (hasVideoFilter) {
    complexFilters.push(`[0:v]${vFilters.join(",")}[outv]`);
  }

  let hasCustomAudio = false;
  if (hasVoice && hasBgm) {
    args.push("-i", audioPath!);
    args.push("-stream_loop", "-1", "-i", bgmPath!);
    const aFilter = `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${voiceVol}[voice];[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${bgmVol}[bgm];[voice][bgm]amix=inputs=2:duration=longest:dropout_transition=0,afade=t=out:st=${fadeStart}:d=0.8[outa]`;
    complexFilters.push(aFilter);
    hasCustomAudio = true;
  } else if (hasVoice) {
    args.push("-i", audioPath!);
    const aFilter = `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${voiceVol},afade=t=out:st=${fadeStart}:d=0.3[outa]`;
    complexFilters.push(aFilter);
    hasCustomAudio = true;
  } else if (hasBgm) {
    args.push("-stream_loop", "-1", "-i", bgmPath!);
    const aFilter = `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.30,afade=t=out:st=${fadeStart}:d=0.8[outa]`;
    complexFilters.push(aFilter);
    hasCustomAudio = true;
  }

  if (complexFilters.length > 0) {
    args.push("-filter_complex", complexFilters.join(";"));
  }

  if (hasVideoFilter) {
    args.push("-map", "[outv]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  } else {
    args.push("-map", "0:v", "-c:v", "copy");
  }

  if (hasCustomAudio) {
    args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2");
  } else {
    args.push("-map", "0:a?", "-c:a", "copy");
  }

  args.push("-t", durationStr);
  args.push("-movflags", "+faststart", outputPath);

  try {
    await runFfmpeg(args, { cwd: os.tmpdir() });
  } finally {
    if (tempSrtPath) {
      await fs.promises.unlink(tempSrtPath).catch(() => {});
    }
  }
}

/**
 * 将视频与音频进行合并（兼容原有接口）
 */
export async function muxVideoAndAudio(params: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  durationSec?: number;
}): Promise<void> {
  return muxVideoAudioAndBgm({
    videoPath: params.videoPath,
    audioPath: params.audioPath,
    outputPath: params.outputPath,
    durationSec: params.durationSec,
  });
}
