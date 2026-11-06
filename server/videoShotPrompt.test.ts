import { describe, it, expect } from "vitest";
import {
  composeCinematicVideoPrompt,
  describeCinematicCameraMotion,
  getVideoBasePromptForShot,
} from "./videoShotPrompt.js";
import { enrichStoryboardImageVisualBase } from "./storyboardImagePrompt.js";
import type { StoryboardShot } from "./types.js";

describe("videoShotPrompt cinematic generation", () => {
  const dummyShotWithLayers: StoryboardShot = {
    id: "shot-1",
    index: 1,
    shotNo: "1",
    shotSize: "中景",
    camera: "跟拍横移",
    durationSec: 5,
    content:
      "首帧：阳光透过竹叶洒下金色光斑，团团背着藤编小包站在灌木丛前。镜内动态与神态：团团蹦跳着拨开灌木，长耳朵一甩一甩，鼻尖凑近叶子嗅来嗅去，忽然停住，眼睛发亮。尾帧：团团定格在灌木丛边，眼睛圆睁发亮。",
    dialogue: "(旁白) 绿莹莹的微风森林里，今天也是阳光融化成金色蜂蜜的一天。",
    music: "轻快温馨的竹笛与弦乐",
    sfx: "鸟鸣、竹叶沙沙声",
    prompt: "",
    note: "",
  };

  it("describes camera motion professionally for tracking / zoom / low-angle", () => {
    expect(describeCinematicCameraMotion("跟拍横移", "中景")).toContain("跟拍横移");
    expect(describeCinematicCameraMotion("跟拍横移", "中景")).toContain("景别设定为【中景】");
    expect(describeCinematicCameraMotion("推镜头", "特写")).toContain("推近");
    expect(describeCinematicCameraMotion("仰拍", "特写")).toContain("低机位仰角");
  });

  it("structures video prompt into cinematic sections and strips subtitles, music and meta hints", () => {
    const prompt = getVideoBasePromptForShot(dummyShotWithLayers);

    // 结构验证
    expect(prompt).toContain("【镜头 1 · 运镜与机位调度】");
    expect(prompt).toContain("【首帧起幅状态】");
    expect(prompt).toContain("【镜内动态演变与走位】");
    expect(prompt).toContain("【微表情与神态细节】");
    expect(prompt).toContain("【落幅与终帧收束】");
    expect(prompt).toContain("【视频画质规范】");

    // 首帧与动态细节验证
    expect(prompt).toContain("阳光透过竹叶洒下金色光斑");
    expect(prompt).toContain("团团蹦跳着拨开灌木");
    expect(prompt).toContain("团团定格在灌木丛边");

    // 严禁杂质泄漏验证
    expect(prompt).not.toContain("台词/旁白");
    expect(prompt).not.toContain("绿莹莹的微风森林里");
    expect(prompt).not.toContain("音乐：");
    expect(prompt).not.toContain("轻快温馨的竹笛与弦乐");
    expect(prompt).not.toContain("音效：");
    expect(prompt).not.toContain("【分镜正文结构】若 content 中含");
    expect(prompt).toContain("严禁生成任何对白字幕");
  });

  it("handles plain content without markdown tags gracefully", () => {
    const plainShot: StoryboardShot = {
      id: "shot-2",
      index: 2,
      shotNo: "2",
      shotSize: "全景",
      camera: "俯拍",
      durationSec: 5,
      content: "团团战战兢兢地穿过竹林。它四周张望，随后迈步向前走去。",
      dialogue: "",
      music: "",
      sfx: "",
      prompt: "",
      note: "",
    };
    const prompt = composeCinematicVideoPrompt(plainShot);
    expect(prompt).toContain("【镜头 2 · 运镜与机位调度】");
    expect(prompt).toContain("高机位俯视拍摄");
    expect(prompt).toContain("【首帧起幅状态】");
    expect(prompt).toContain("【落幅与终帧收束】");
  });

  it("respects user custom videoPrompt override when provided", () => {
    const shotWithCustom: StoryboardShot = {
      ...dummyShotWithLayers,
      videoPrompt: "【用户手写运镜】自定义超快镜头穿梭",
    };
    const prompt = getVideoBasePromptForShot(shotWithCustom);
    expect(prompt).toBe("【用户手写运镜】自定义超快镜头穿梭");

    const defaultPrompt = getVideoBasePromptForShot(shotWithCustom, { ignoreVideoPrompt: true });
    expect(defaultPrompt).toContain("【镜头 1 · 运镜与机位调度】");
  });
});

describe("storyboardImagePrompt enrichment", () => {
  it("enriches image prompt with micro-expressions, lighting and depth of field", () => {
    const shot: StoryboardShot = {
      id: "shot-7",
      index: 7,
      shotNo: "7",
      shotSize: "特写",
      camera: "仰拍",
      durationSec: 5,
      content: "团团战战兢兢睁开一条眼缝。",
      dialogue: "",
      music: "",
      sfx: "",
      prompt: "",
      note: "",
    };
    const enriched = enrichStoryboardImageVisualBase(shot);
    expect(enriched).toContain("镜头 7：团团战战兢兢睁开一条眼缝。");
    expect(enriched).toContain("面部微表情传神细腻");
    expect(enriched).toContain("眼眸清澈带有灵动高光");
    expect(enriched).toContain("丁达尔微光点缀");
    expect(enriched).toContain("8k壁纸级细腻画质");
    expect(enriched).toContain("景别：特写");
    expect(enriched).toContain("摄法：仰拍");
  });
});
