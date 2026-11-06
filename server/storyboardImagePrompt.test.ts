import { describe, it, expect } from "vitest";
import { extractFirstKeyframeHeuristicFromPlain, parseStoryboardContentLayers } from "./storyboardContentVisual.js";
import {
  buildStoryboardImageGenerationPrompt,
  cleanAssetPromptForStoryboard,
  formatShotVisualLines,
  resolveStoryboardImageVisualBase,
} from "./storyboardImagePrompt.js";
import type { Project, StoryboardShot } from "./types.js";

describe("storyboardContentVisual layers parsing", () => {
  it("parses bold markdown layers", () => {
    const raw = "**首帧**：小明站在窗前。**镜内动态与神态**：小明转过身来。**尾帧**：小明走出房间。";
    const layers = parseStoryboardContentLayers(raw);
    expect(layers.firstFrame).toBe("小明站在窗前。");
    expect(layers.dynamicAndExpression).toBe("小明转过身来。");
    expect(layers.lastFrame).toBe("小明走出房间。");
  });

  it("parses plain Chinese colon layers without markdown asterisks", () => {
    const raw =
      "首帧：团团鼻尖贴近一片嫩叶，藤编小包垂在身侧。镜内动态与神态：团团鼻尖轻嗅，长耳朵微微抖动。尾帧：团团咬下嫩叶。";
    const layers = parseStoryboardContentLayers(raw);
    expect(layers.firstFrame).toBe("团团鼻尖贴近一片嫩叶，藤编小包垂在身侧。");
    expect(layers.dynamicAndExpression).toBe("团团鼻尖轻嗅，长耳朵微微抖动。");
    expect(layers.lastFrame).toBe("团团咬下嫩叶。");
  });

  it("parses bracketed layers", () => {
    const raw = "【首帧】：阳光照进书房。【镜内动态】：翻开书页。【尾帧】：合上书本。";
    const layers = parseStoryboardContentLayers(raw);
    expect(layers.firstFrame).toBe("阳光照进书房。");
    expect(layers.dynamicAndExpression).toBe("翻开书页。");
    expect(layers.lastFrame).toBe("合上书本。");
  });

  it("does not prematurely truncate multi-sentence static visual descriptions when no sequential markers exist", () => {
    const raw = "阳光穿过森林的缝隙，洒下斑驳的金光。团团警惕地躲在一丛高大的野花后，手里紧抱着藤编小包。";
    const keyframe = extractFirstKeyframeHeuristicFromPlain(raw);
    expect(keyframe).toContain("团团警惕地躲在一丛高大的野花后");
    expect(keyframe).toContain("手里紧抱着藤编小包");
  });

  it("truncates at sequential narrative marker when time moves forward", () => {
    const raw = "阳光穿过树叶洒在地面上，然后团团忽然蹦跳着拨开灌木丛。";
    const keyframe = extractFirstKeyframeHeuristicFromPlain(raw);
    expect(keyframe).toBe("阳光穿过树叶洒在地面上");
  });
});

describe("storyboardImagePrompt formatting and injection", () => {
  const dummyProject: Project = {
    id: "proj-1",
    name: "测试项目",
    sourceText: "",
    outline: "",
    script: "",
    assets: [],
    storyboards: [],
    videoJobs: [],
    pipelineLog: [],
    pipelineStatus: "idle",
    storyboardImageSize: "1024x1024",
    artStyle: "古风水墨",
    genreType: "仙侠",
    videoAspect: "16:9",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };

  const dummyShot: StoryboardShot = {
    id: "shot-1",
    index: 1,
    shotNo: "1",
    shotSize: "特写",
    camera: "低角度推近",
    durationSec: 4,
    content: "首帧：团团鼻尖贴近嫩叶。镜内动态与神态：轻嗅叶片。尾帧：咬下叶片。",
    dialogue: "",
    music: "",
    sfx: "",
    prompt: "",
    note: "",
  };

  it("extracts clean first frame visual without leaking video dynamics into image prompt", () => {
    const visual = resolveStoryboardImageVisualBase(dummyShot);
    expect(visual).toContain("镜头 1：团团鼻尖贴近嫩叶。");
    expect(visual).toContain("景别：特写");
    expect(visual).toContain("摄法：低角度推近");
    expect(visual).not.toContain("轻嗅叶片");
    expect(visual).not.toContain("首帧：");
  });

  it("does not duplicate 镜头 prefix when visual already has it", () => {
    const res = formatShotVisualLines(dummyShot, "镜头 1：特写画面");
    expect(res.split("镜头 1：").length - 1).toBe(1);
  });

  it("extracts default base visual ignoring custom imagePrompt when ignoreImagePrompt is true", () => {
    const shotWithCustom: StoryboardShot = {
      ...dummyShot,
      imagePrompt: "完全被用户覆盖的手动提示词",
    };
    const overridden = resolveStoryboardImageVisualBase(shotWithCustom);
    expect(overridden).toContain("完全被用户覆盖的手动提示词");

    const defaultVisual = resolveStoryboardImageVisualBase(shotWithCustom, undefined, { ignoreImagePrompt: true });
    expect(defaultVisual).toContain("镜头 1：团团鼻尖贴近嫩叶。");
    expect(defaultVisual).not.toContain("完全被用户覆盖的手动提示词");
  });

  it("injects user custom prompt from shot.prompt into 【分镜补充提示词】", () => {
    const shotWithPrompt: StoryboardShot = {
      ...dummyShot,
      prompt: "超高清，8k壁纸，微距景深虚化，逆光光影",
    };
    const full = buildStoryboardImageGenerationPrompt(dummyProject, shotWithPrompt);
    expect(full).toContain("【分镜补充提示词】\n超高清，8k壁纸，微距景深虚化，逆光光影");
    expect(full).toContain("【画面主体与瞬间】");
    expect(full).toContain("【项目统一画风】古风水墨");
  });

  it("does not inject duplicate prompt block if shot.prompt is identical to shot.content", () => {
    const shotWithSame: StoryboardShot = {
      ...dummyShot,
      prompt: dummyShot.content,
    };
    const full = buildStoryboardImageGenerationPrompt(dummyProject, shotWithSame);
    expect(full).not.toContain("【分镜补充提示词】");
  });

  it("prioritizes imagePromptOverride from modal", () => {
    const full = buildStoryboardImageGenerationPrompt(dummyProject, dummyShot, {
      imagePromptOverride: "用户在弹窗中修改的即时画面描述",
    });
    expect(full).toContain("用户在弹窗中修改的即时画面描述");
  });

  it("cleans turnaround and isolated prop meta-prompts from asset definitions", () => {
    const rawChar =
      "角色设定参考图：同一画面中呈现正面、侧面、背面三视图（turnaround 设定表），中性站立、全身可见，比例一致；背景为简洁纯色、无具体剧情场景，光线均匀柔和。角色为一只圆润娇小的白色小兔子，毛发雪白蓬松、毛尖柔软。";
    const cleanedChar = cleanAssetPromptForStoryboard(rawChar);
    expect(cleanedChar).not.toContain("三视图");
    expect(cleanedChar).not.toContain("turnaround");
    expect(cleanedChar).not.toContain("背景为简洁纯色");
    expect(cleanedChar).toContain("一只圆润娇小的白色小兔子，毛发雪白蓬松");

    const rawProp =
      "单品道具参考图：只表现该物品本身，背景须为纯透明或纯白/纯灰无环境（便于抠图与合成），除必要接触阴影外不要地面、台面、室内外交界等场景元素。一只小巧的浅棕色藤编小挎包。";
    const cleanedProp = cleanAssetPromptForStoryboard(rawProp);
    expect(cleanedProp).not.toContain("单品道具参考图");
    expect(cleanedProp).not.toContain("纯透明或纯白");
    expect(cleanedProp).toContain("一只小巧的浅棕色藤编小挎包");
  });

  it("does not leak video reference duration into still image prompt", () => {
    const visual = formatShotVisualLines(dummyShot, "阳光洒在灌木丛前");
    expect(visual).not.toContain("参考时长");
    expect(visual).not.toContain("4s");
  });

  it("supports manual videoExtraAssetIds in asset consistency block and orderedAssetsForStoryboardVisual", () => {
    const propAsset = {
      id: "prop-bag-1",
      index: 1,
      type: "prop" as const,
      name: "藤编小包",
      prompt: "一只小巧的藤编小挎包，细藤条编织。",
      imageUrl: "/api/files/test/prop.png",
    };
    const projWithAssets: Project = {
      ...dummyProject,
      assets: [propAsset],
    };
    const shotWithExtra: StoryboardShot = {
      ...dummyShot,
      content: "阳光洒下，微风吹过竹林。", // content does NOT mention "藤编小包"
      videoExtraAssetIds: ["prop-bag-1"],
    };
    const full = buildStoryboardImageGenerationPrompt(projWithAssets, shotWithExtra);
    expect(full).toContain("藤编小包");
    expect(full).toContain("细藤条编织");
    expect(full).toContain("【参考图视觉锚定（最高准则）】");
    expect(full).toContain("（视觉严格以所附参考图为准）");
  });
});
