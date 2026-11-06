import type { StoryboardShot } from "./types.js";
import { normalizeHtmlishToPlainText } from "./textNormalize.js";
import { parseStoryboardContentLayers } from "./storyboardContentVisual.js";

/**
 * 依据摄像机摄法与景别，生成电影级摄影机轨迹与调度指导
 */
export function describeCinematicCameraMotion(camera?: string, shotSize?: string): string {
  const cam = normalizeHtmlishToPlainText(camera || "").trim();
  const size = normalizeHtmlishToPlainText(shotSize || "").trim();
  const parts: string[] = [];
  if (size) parts.push(`景别设定为【${size}】`);

  if (cam) {
    if (/推|zoom\s*in|push/i.test(cam)) {
      parts.push("摄影机平稳匀速向前推进，从中景平滑推近至特写，焦点稳稳锁住主体神态与动作核心，镜头平稳无抖动");
    } else if (/拉|zoom\s*out|pull/i.test(cam)) {
      parts.push("摄影机平缓后拉远移，由局部特写徐徐拉开，展现主体与其身处的环境纵深层次");
    } else if (/摇|pan/i.test(cam)) {
      parts.push("摄影机水平平稳摇移，镜头顺畅移动展现环境连贯性与主体视线延伸");
    } else if (/跟|跟拍|track|truck/i.test(cam)) {
      parts.push("摄影机平稳跟拍横移，平滑追踪主体行进动线，构图保持主体在视觉黄金焦点");
    } else if (/仰|low\s*angle/i.test(cam)) {
      parts.push("低机位仰角摄影，强化主体立体感与空间透视张力，镜头轻微跟随主体微动");
    } else if (/俯|high\s*angle|top/i.test(cam)) {
      parts.push("高机位俯视拍摄，清晰展现主体与周围地面、环境的相对空间关系");
    } else if (/特写/i.test(cam)) {
      parts.push("定焦浅景深特写拍摄，主体面部微表情与微观材质细节清晰分明");
    } else {
      parts.push(`摄法为【${cam}】，运镜平滑流畅，动态连贯无突兀跳帧`);
    }
  } else {
    parts.push("摄影机运镜自然平稳，画面稳定连贯");
  }
  return parts.join("；");
}

/**
 * 电影级四段式分镜视频动态提示词生成器：
 * 结构：
 * 1. 【镜头运镜与机位调度】
 * 2. 【首帧起幅状态】
 * 3. 【镜内动态演变与走位】
 * 4. 【微表情与神态细节】
 * 5. 【落幅与终帧收束】
 * 6. 【纯净画面与质感规范】（严禁字幕、对白、水印）
 */
export function composeCinematicVideoPrompt(shot: StoryboardShot): string {
  const content = normalizeHtmlishToPlainText(shot.content || shot.prompt || "").trim();
  const layers = parseStoryboardContentLayers(content);

  const shotNo = normalizeHtmlishToPlainText(shot.shotNo || String(shot.index || 1)).trim();
  const cameraDesc = describeCinematicCameraMotion(shot.camera, shot.shotSize);

  // 首帧起幅
  let firstFrame = layers.firstFrame.trim();
  if (!firstFrame) {
    const parts = content.split(/[。！？\n]/).map((s) => s.trim()).filter(Boolean);
    firstFrame = parts[0] || content || "主体在画面中心处于准备动作的稳定起幅姿态。";
  }
  firstFrame = firstFrame.replace(/^镜头\s*\S+[：:]\s*/, "").replace(/[。！？\s]+$/u, "");

  // 动态演变
  let dynamic = layers.dynamicAndExpression.trim();
  if (!dynamic) {
    const parts = content.split(/[。！？\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 2) {
      dynamic = parts.slice(1, -1).join("；");
    } else if (parts.length === 2) {
      dynamic = parts[1]!;
    } else {
      dynamic = "主体保持自然呼吸与动作起伏，运动流畅舒展，与周围环境产生自然的物理接触与光影互动";
    }
  }
  dynamic = dynamic.replace(/[。！？\s]+$/u, "");

  // 尾帧落幅
  let lastFrame = layers.lastFrame.trim();
  if (!lastFrame) {
    const parts = content.split(/[。！？\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      lastFrame = parts[parts.length - 1]!;
    } else {
      lastFrame = "镜头平稳收束，主体动作自然完成或平稳过渡，画风与光照严格统一";
    }
  }
  lastFrame = lastFrame.replace(/[。！？\s]+$/u, "");

  const sections: string[] = [
    `【镜头 ${shotNo} · 运镜与机位调度】\n${cameraDesc}。`,
    `【首帧起幅状态】\n${firstFrame}。`,
    `【镜内动态演变与走位】\n${dynamic}。主体动作连贯流畅，肢体起伏自然，毛发与服饰随运动产生真实物理风动飘拂，运动规律符合重力惯性。`,
    `【微表情与神态细节】\n面部微表情丰富传神，眼神灵动有光，呼吸起伏自然，动作与情绪起承转合层次分明。`,
    `【落幅与终帧收束】\n${lastFrame}。`,
    `【视频画质规范】\n电影级高帧率丝滑动态，高保真物理运动，无噪点无畸变。严禁生成任何对白字幕、文字条、Logo、水印或UI界面。`,
  ];

  return sections.join("\n\n");
}

/**
 * 视频生成用的「基底」提示词：
 * - 优先用户自定义 videoPrompt
 * - 否则自动生成电影级四段式结构化提示词（运镜/首帧/动态/表情/尾帧），纯净指导动态，剔除台词、音乐等噪音
 */
export function getVideoBasePromptForShot(shot: StoryboardShot, opts?: { ignoreVideoPrompt?: boolean }): string {
  if (!opts?.ignoreVideoPrompt) {
    const custom = shot.videoPrompt?.trim();
    if (custom) return custom;
  }
  return composeCinematicVideoPrompt(shot);
}

/**
 * 智能扩写/丰富视频动态基底提示词
 */
export function enrichStoryboardVideoPromptBase(shot: StoryboardShot, basePrompt?: string): string {
  const custom = normalizeHtmlishToPlainText(basePrompt || "").trim();
  if (custom && custom.includes("【首帧起幅状态】")) {
    return custom;
  }
  return composeCinematicVideoPrompt(shot);
}

