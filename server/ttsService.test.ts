import { describe, it, expect } from "vitest";
import { cleanDialogueText, getPythonPath, extractSpeakerFromDialogue, resolveVoiceForShot } from "./ttsService.js";

describe("cleanDialogueText", () => {
  it("removes stage directions in parentheses and brackets", () => {
    expect(cleanDialogueText("（叹气）今天真累啊。")).toBe("今天真累啊。");
    expect(cleanDialogueText("(低声自语) 难道真的是他？")).toBe("难道真的是他？");
    expect(cleanDialogueText("【轻笑】你还真信了。")).toBe("你还真信了。");
    expect(cleanDialogueText("[大喊] 所有人趴下！")).toBe("所有人趴下！");
  });

  it("extracts quoted speech and strips character name prefixes", () => {
    expect(cleanDialogueText("林晚：“今天的天气真不错！”")).toBe("今天的天气真不错！");
    expect(cleanDialogueText("林晚: “准备出发。”")).toBe("准备出发。");
    expect(cleanDialogueText("旁白：夜幕降临，城市渐渐安静下来。")).toBe("夜幕降临，城市渐渐安静下来。");
    expect(cleanDialogueText("李队: 别轻举妄动。")).toBe("别轻举妄动。");
  });

  it("handles mixed role, quotes and inline stage directions", () => {
    expect(cleanDialogueText("团团（摇晃着耳朵）：“肚子好饿呀……”")).toBe("肚子好饿呀……");
    expect(cleanDialogueText("团团（兴奋地跳起来）: “我们成功了！”（欢呼）")).toBe("我们成功了！");
  });

  it("handles fallback when text only has plain statement", () => {
    expect(cleanDialogueText("这就是星火引擎的力量。")).toBe("这就是星火引擎的力量。");
  });

  it("returns empty string for empty input", () => {
    expect(cleanDialogueText("")).toBe("");
    expect(cleanDialogueText("   ")).toBe("");
  });
});

describe("getPythonPath", () => {
  it("finds a usable python executable", () => {
    const pythonPath = getPythonPath();
    expect(pythonPath).toBeTruthy();
    expect(typeof pythonPath).toBe("string");
  });
});

describe("BAILIAN_TTS_MODEL_PRESETS", () => {
  it("includes Sambert and CosyVoice presets", async () => {
    const { BAILIAN_TTS_MODEL_PRESETS } = await import("./bailianPresets.js");
    expect(BAILIAN_TTS_MODEL_PRESETS.length).toBeGreaterThan(0);
    const sambertDefault = BAILIAN_TTS_MODEL_PRESETS.find((p) => p.id === "sambert-zhixiao-v1");
    expect(sambertDefault).toBeDefined();
    expect(sambertDefault?.model).toBe("sambert-zhixiao-v1");
  });
});

describe("extractSpeakerFromDialogue", () => {
  it("extracts speaker from role prefixes and brackets", () => {
    expect(extractSpeakerFromDialogue("团团：“呀！好大一颗红草莓！”")).toBe("团团");
    expect(extractSpeakerFromDialogue("滚滚：“唔……今天天上，不仅掉竹叶……”")).toBe("滚滚");
    expect(extractSpeakerFromDialogue("（旁白）绿莹莹的微风森林里……")).toBe("旁白");
    expect(extractSpeakerFromDialogue("【解说】夜幕降临，繁星点点。")).toBe("解说");
    expect(extractSpeakerFromDialogue("旁白：这是新的篇章。")).toBe("旁白");
    expect(extractSpeakerFromDialogue("团团（摇晃着耳朵）：“肚子好饿呀……”")).toBe("团团");
    expect(extractSpeakerFromDialogue("普通陈述句没有说话人。")).toBeNull();
  });
});

describe("resolveVoiceForShot", () => {
  const dummyProject = {
    assets: [
      { id: "1", type: "character", name: "团团", prompt: "可爱软萌的小白兔女孩子", aliases: ["小兔子", "小毛球"] },
      { id: "2", type: "character", name: "滚滚", prompt: "体型圆滚滚、性格稳重慢吞吞的大熊猫少年", aliases: ["大熊猫", "胖达"] },
    ],
  };

  it("assigns lively female voice to 团团 and gentle male voice to 滚滚", () => {
    const tuantuanVoice = resolveVoiceForShot(dummyProject, { dialogue: "团团：“呀！好大一颗红草莓！”" });
    expect(tuantuanVoice.speaker).toBe("团团");
    expect(tuantuanVoice.model).toBe("cosyvoice-v2:longxiaochun_v2");

    const gungunVoice = resolveVoiceForShot(dummyProject, { dialogue: "滚滚：“唔……今天天上怎么还掉棉花糖呀？”" });
    expect(gungunVoice.speaker).toBe("滚滚");
    expect(gungunVoice.model).toBe("cosyvoice-v2:longshuo_v2");
  });

  it("assigns narrator voice to 旁白", () => {
    const narratorVoice = resolveVoiceForShot(dummyProject, { dialogue: "（旁白）从那一天起，森林里多了一对好伙伴。" });
    expect(narratorVoice.speaker).toBe("旁白");
    expect(narratorVoice.model).toBe("cosyvoice-v2:longwan_v2");
  });

  it("respects explicit asset voice override", () => {
    const projectWithCustomVoice = {
      assets: [
        { id: "2", type: "character", name: "滚滚", voice: "sambert-zhiming-v1" },
      ],
    };
    const voice = resolveVoiceForShot(projectWithCustomVoice, { dialogue: "滚滚：“吃口竹子吧。”" });
    expect(voice.model).toBe("sambert-zhiming-v1");
  });

  it("respects explicit shot voice override", () => {
    const voice = resolveVoiceForShot(dummyProject, { dialogue: "团团：“你好。”", voice: "sambert-zhiya-v1" });
    expect(voice.model).toBe("sambert-zhiya-v1");
  });
});

describe("matchBgmPreset", () => {
  it("matches forest whistle for bamboo flute keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("轻快温馨的竹笛与弦乐");
    expect(bgm.id).toBe("forest_whistle");
  });

  it("matches playful comic for funny/marimba keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("轻松逗趣的搞怪木琴与跳跃节奏");
    expect(bgm.id).toBe("playful_comic");
  });

  it("matches warm gentle for piano healing keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("温暖治愈的柔和钢琴");
    expect(bgm.id).toBe("warm_gentle");
  });

  it("matches suspense tension for danger/crisis keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("危机四伏的紧张悬疑背景乐");
    expect(bgm.id).toBe("suspense_tension");
  });

  it("matches epic spark for sci-fi/epic keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("浩瀚星河的史诗科幻交响曲");
    expect(bgm.id).toBe("epic_spark");
  });

  it("matches fairytale dream for fairytale/music box keywords", async () => {
    const { matchBgmPreset } = await import("./bgmService.js");
    const bgm = matchBgmPreset("纯真甜美的梦幻八音盒与竖琴");
    expect(bgm.id).toBe("fairytale_dream");
  });

  it("resolves BGM path and metadata accurately", async () => {
    const { resolveBgmPathForShot } = await import("./bgmService.js");
    const resolved = resolveBgmPathForShot("微风竹林");
    expect(resolved.name).toContain("竹林");
    expect(resolved.url).toContain("forest_whistle.mp3");
  });
});
