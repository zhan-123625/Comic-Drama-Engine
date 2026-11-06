<script setup lang="ts">
import { computed } from "vue";
import { useConfigStore, AGENT_PROMPT_DEFAULTS } from "../stores/config";
import { useUiStore } from "../stores/ui";
import type { ArkVideoRatio, ArkVideoResolution } from "../types";

const cfg = useConfigStore();
const ui = useUiStore();

const autoSave = computed({
  get: () => Boolean(cfg.cfgDraft.ui?.autoSave),
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    cfg.cfgDraft.ui!.autoSave = v;
  },
});

const simulateDelay = computed({
  get: () => Number(cfg.cfgDraft.ui?.runnerDelayMs ?? 600),
  set: (v: number) => {
    cfg.ensureCfgSections();
    cfg.cfgDraft.ui!.runnerDelayMs = v;
  },
});

const pipelineAllowPartial = computed({
  get: () => Boolean(cfg.cfgDraft.ui?.pipelineAllowPartial),
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    cfg.cfgDraft.ui!.pipelineAllowPartial = v;
  },
});

const videoSmFirstFrame = computed({
  get: () => cfg.cfgDraft.video?.supportedModes?.firstFrame !== false,
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    if (!cfg.cfgDraft.video!.supportedModes) cfg.cfgDraft.video!.supportedModes = {};
    cfg.cfgDraft.video!.supportedModes.firstFrame = v;
  },
});
const videoSmFirstLast = computed({
  get: () => cfg.cfgDraft.video?.supportedModes?.firstLastFrame === true,
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    if (!cfg.cfgDraft.video!.supportedModes) cfg.cfgDraft.video!.supportedModes = {};
    cfg.cfgDraft.video!.supportedModes.firstLastFrame = v;
  },
});
const videoSmMultiRef = computed({
  get: () => cfg.cfgDraft.video?.supportedModes?.multiRef !== false,
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    if (!cfg.cfgDraft.video!.supportedModes) cfg.cfgDraft.video!.supportedModes = {};
    cfg.cfgDraft.video!.supportedModes.multiRef = v;
  },
});
const videoSmOmni = computed({
  get: () => cfg.cfgDraft.video?.supportedModes?.omni === true,
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    if (!cfg.cfgDraft.video!.supportedModes) cfg.cfgDraft.video!.supportedModes = {};
    cfg.cfgDraft.video!.supportedModes.omni = v;
  },
});
const videoSmTextOnly = computed({
  get: () => cfg.cfgDraft.video?.supportedModes?.textOnly === true,
  set: (v: boolean) => {
    cfg.ensureCfgSections();
    if (!cfg.cfgDraft.video!.supportedModes) cfg.cfgDraft.video!.supportedModes = {};
    cfg.cfgDraft.video!.supportedModes.textOnly = v;
  },
});

const settingsVideoPresetDetail = computed(() => {
  const v = cfg.cfgDraft.video;
  if (!v?.model?.trim()) return "";
  const list = cfg.volcPresets?.video;
  const hit =
    list?.find((p) => p.id === v.volcVideoPresetId) ??
    list?.find((p) => p.model.toLowerCase() === v.model.trim().toLowerCase());
  if (!hit) return "";
  return `${hit.modesLabel}${hit.appNote ? `。${hit.appNote}` : ""}`;
});

function onVideoArkRatioSelect(ev: Event) {
  const v = (ev.target as HTMLSelectElement).value.trim();
  cfg.ensureCfgSections();
  const ar: ArkVideoRatio[] = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"];
  cfg.cfgDraft.video!.arkRatio = v && ar.includes(v as ArkVideoRatio) ? (v as ArkVideoRatio) : undefined;
}

function onVideoArkResolutionSelect(ev: Event) {
  const v = (ev.target as HTMLSelectElement).value.trim();
  cfg.ensureCfgSections();
  const ar: ArkVideoResolution[] = ["480p", "720p", "1080p"];
  cfg.cfgDraft.video!.arkResolution = v && ar.includes(v as ArkVideoResolution) ? (v as ArkVideoResolution) : undefined;
}
</script>

<template>
  <section class="stack">
    <article class="card">
      <h3>模型与服务配置</h3>
      <p class="hint">
        文本、生图使用 OpenAI
        兼容接口（已内置<strong>阿里云百炼通义千问/万相</strong>与<strong>火山方舟</strong>一键预设）；视频支持<strong>阿里云万相视频</strong>、<strong
          >火山方舟 Seedance</strong
        >
        或自建 HTTP Hook 网关。
      </p>
      <p v-if="cfg.cfgMessage" class="cfg-msg">{{ cfg.cfgMessage }}</p>

      <div class="cfg-block">
        <h4>文本模型</h4>
        <p v-if="cfg.bailianPresets?.text?.length" class="hint">
          阿里云百炼千问：<a :href="cfg.bailianPresets.docUrl" target="_blank" rel="noopener noreferrer"
            >Managed Agents API 与模型调用</a
          >。选预设会自动填 Base URL 与 Model。
        </p>
        <label v-if="cfg.bailianPresets?.text?.length" class="field">
          <span>阿里云百炼千问预设</span>
          <select class="input" @change="cfg.applyBailianTextPresetFromSelect($event)">
            <option value="">（不套用预设）</option>
            <option v-for="p in cfg.bailianPresets.text" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.capabilityLine }}
            </option>
          </select>
        </label>
        <p v-if="cfg.volcPresets?.text?.length" class="hint">
          火山方舟对话/Agent：<a
            href="https://www.volcengine.com/docs/82379/1541594?lang=zh"
            target="_blank"
            rel="noopener noreferrer"
            >API Key 与 Base URL</a
          >。选预设会自动填 Base URL 与 Model。
        </p>
        <label v-if="cfg.volcPresets?.text?.length" class="field">
          <span>火山文字模型预设</span>
          <select class="input" @change="cfg.applyVolcTextPresetFromSelect($event)">
            <option value="">（不套用预设）</option>
            <option v-for="p in cfg.volcPresets.text" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.capabilityLine }}
            </option>
          </select>
        </label>
        <label class="field"
          ><span>Base URL</span
          ><input v-model="cfg.cfgDraft.text!.baseUrl" class="input" placeholder="https://api.openai.com/v1"
        /></label>
        <label class="field"
          ><span>API Key</span
          ><input
            v-model="cfg.cfgDraft.text!.apiKey"
            class="input"
            type="password"
            autocomplete="off"
            placeholder="留空或掩码表示沿用已保存"
        /></label>
        <label class="field"
          ><span>Model</span><input v-model="cfg.cfgDraft.text!.model" class="input" placeholder="gpt-4o-mini"
        /></label>
        <div class="cfg-model-slots">
          <h5>已保存文字模型方案</h5>
          <p class="hint">「另存为方案」后可在多组配置间切换；须点击底部「保存设置」持久化。</p>
          <button type="button" class="btn small" @click="cfg.saveCurrentTextModelProfile">另存当前为方案</button>
          <ul v-if="cfg.cfgDraft.textModels?.length" class="cfg-profile-list">
            <li v-for="row in cfg.cfgDraft.textModels" :key="row.id" class="cfg-profile-row">
              <span>{{ row.label }}</span>
              <code>{{ row.model }}</code>
              <button type="button" class="btn small" @click="cfg.loadTextModelProfile(row.id)">载入</button>
              <button type="button" class="btn small danger" @click="cfg.removeTextModelProfile(row.id)">删除</button>
            </li>
          </ul>
        </div>
      </div>

      <div class="cfg-block">
        <h4>生图模型</h4>
        <p v-if="cfg.bailianPresets?.image?.length" class="hint">
          阿里云百炼万相/千问生图兼容标准 OpenAI /images/generations 接口，选预设会自动填充。
        </p>
        <label v-if="cfg.bailianPresets?.image?.length" class="field">
          <span>阿里云百炼生图预设</span>
          <select class="input" @change="cfg.applyBailianImagePresetFromSelect($event)">
            <option value="">（不套用预设）</option>
            <option v-for="p in cfg.bailianPresets.image" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.capabilityLine }}
            </option>
          </select>
        </label>
        <p v-if="cfg.volcPresets?.image?.length" class="hint">
          火山 Seedream 等走 OpenAI 兼容图片接口；具体路径以控制台为准。选预设会填 Base URL 与 Model。
        </p>
        <label v-if="cfg.volcPresets?.image?.length" class="field">
          <span>火山生图模型预设</span>
          <select class="input" @change="cfg.applyVolcImagePresetFromSelect($event)">
            <option value="">（不套用预设）</option>
            <option v-for="p in cfg.volcPresets.image" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.capabilityLine }}
            </option>
          </select>
        </label>
        <label class="field"
          ><span>Base URL</span
          ><input v-model="cfg.cfgDraft.image!.baseUrl" class="input" placeholder="https://api.openai.com/v1"
        /></label>
        <label class="field"
          ><span>API Key</span
          ><input v-model="cfg.cfgDraft.image!.apiKey" class="input" type="password" autocomplete="off"
        /></label>
        <label class="field"
          ><span>Model</span><input v-model="cfg.cfgDraft.image!.model" class="input" placeholder="dall-e-3 或兼容模型"
        /></label>
        <label class="field"
          ><span>尺寸</span>
          <select v-model="cfg.cfgDraft.image!.size" class="input">
            <option value="1024x1024">1024x1024</option>
            <option value="1024x1536">1024x1536</option>
            <option value="1536x1024">1536x1024</option>
          </select>
        </label>
        <div class="cfg-model-slots">
          <h5>已保存生图模型方案</h5>
          <button type="button" class="btn small" @click="cfg.saveCurrentImageModelProfile">另存当前为方案</button>
          <ul v-if="cfg.cfgDraft.imageModels?.length" class="cfg-profile-list">
            <li v-for="row in cfg.cfgDraft.imageModels" :key="row.id" class="cfg-profile-row">
              <span>{{ row.label }}</span>
              <code>{{ row.model }}</code>
              <button type="button" class="btn small" @click="cfg.loadImageModelProfile(row.id)">载入</button>
              <button type="button" class="btn small danger" @click="cfg.removeImageModelProfile(row.id)">删除</button>
            </li>
          </ul>
        </div>
      </div>

      <div class="cfg-block">
        <h4>视频大模型</h4>
        <label v-if="cfg.bailianPresets?.video?.length" class="field">
          <span>阿里云百炼万相视频预设</span>
          <select
            class="input"
            :value="cfg.cfgDraft.video?.volcVideoPresetId || ''"
            @change="cfg.applyBailianVideoPresetFromSelect($event)"
          >
            <option value="">（不套用预设）</option>
            <option v-for="p in cfg.bailianPresets.video" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.modesLabel }}
            </option>
          </select>
        </label>
        <p v-if="cfg.volcPresets?.docVideoUrl" class="hint">
          官方说明见
          <a :href="cfg.volcPresets.docVideoUrl" target="_blank" rel="noopener noreferrer">创建视频生成任务 API</a>
          （不同模型支持文生视频、首帧/首尾帧、多图参考等；下列为内置摘要，model id 请以控制台推理接入点为准）。
        </p>
        <label v-if="cfg.volcPresets?.video?.length" class="field">
          <span>火山视频模型预设</span>
          <select
            class="input"
            :value="cfg.cfgDraft.video?.volcVideoPresetId || ''"
            @change="cfg.applyVolcVideoPresetFromSelect($event)"
          >
            <option value="">（自定义：手动填写 Base URL / Model）</option>
            <option v-for="p in cfg.volcPresets.video" :key="p.id" :value="p.id">
              {{ p.label }} — {{ p.modesLabel }}
            </option>
          </select>
        </label>
        <p v-if="settingsVideoPresetDetail" class="hint cfg-volc-cap-line">{{ settingsVideoPresetDetail }}</p>
        <div class="cfg-video-supported-modes">
          <h5>分镜可选视频模式（与接入点能力对齐）</h5>
          <p class="hint">勾选后，分镜页可为单镜选择对应模式；未勾选「首尾帧」则不会出现尾帧表单项。</p>
          <div class="cfg-video-mode-checks">
            <label class="opt"><input v-model="videoSmFirstFrame" type="checkbox" /><span>首帧图生视频</span></label>
            <label class="opt"><input v-model="videoSmFirstLast" type="checkbox" /><span>首尾帧</span></label>
            <label class="opt"><input v-model="videoSmMultiRef" type="checkbox" /><span>多图参考</span></label>
            <label class="opt"
              ><input v-model="videoSmOmni" type="checkbox" /><span>全能参考（音/视频 URL 透传网关）</span></label
            >
            <label class="opt"
              ><input v-model="videoSmTextOnly" type="checkbox" /><span
                >纯文本生视频（分镜可选，不传参考图）</span
              ></label
            >
          </div>
        </div>
        <label class="field"
          ><span>Base URL</span
          ><input
            v-model="cfg.cfgDraft.video!.baseUrl"
            class="input"
            placeholder="https://ark.../api/v3/contents/generations/tasks"
        /></label>
        <label class="field"
          ><span>API Key</span
          ><input v-model="cfg.cfgDraft.video!.apiKey" class="input" type="password" autocomplete="off"
        /></label>
        <label class="field"
          ><span>Model</span
          ><input v-model="cfg.cfgDraft.video!.model" class="input" placeholder="doubao-seedance-… 或第三方 model id"
        /></label>
        <p class="hint">方舟 Seedance 创建任务参数（与官方示例一致；仅对方舟路径生效）：</p>
        <label class="field">
          <span>ratio</span>
          <select class="input" :value="cfg.cfgDraft.video?.arkRatio ?? ''" @change="onVideoArkRatioSelect($event)">
            <option value="">（跟随项目「视频比例」）</option>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1</option>
            <option value="3:4">3:4</option>
            <option value="9:16">9:16</option>
            <option value="21:9">21:9</option>
            <option value="adaptive">adaptive（自动）</option>
          </select>
        </label>
        <label class="field">
          <span>resolution</span>
          <select
            class="input"
            :value="cfg.cfgDraft.video?.arkResolution ?? ''"
            @change="onVideoArkResolutionSelect($event)"
          >
            <option value="">（不接 resolution，由接入点默认）</option>
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        <label class="opt">
          <input v-model="cfg.cfgDraft.video!.arkWatermark" type="checkbox" />
          <span>含水印（watermark: true；默认关闭即去水印）</span>
        </label>
        <label class="opt">
          <input v-model="cfg.cfgDraft.video!.arkGenerateAudio" type="checkbox" />
          <span>生成有声视频（generate_audio，默认开启）</span>
        </label>
        <label class="field"
          ><span>参考图模式</span>
          <select v-model="cfg.cfgDraft.video!.referenceMode" class="input">
            <option value="off">关闭（仅按当前镜头）</option>
            <option value="auto">自动（优先镜头图，其次匹配资产图）</option>
          </select>
        </label>
        <label class="opt">
          <input v-model="cfg.cfgDraft.video!.aggregateAssets" type="checkbox" />
          <span
            >根据分镜描述自动匹配资产，并在视频中附带其参考图（提示词仅追加简短的「参考图附件」说明，不再嵌入整段资产
            prompt）</span
          >
        </label>
        <label class="opt">
          <input v-model="cfg.cfgDraft.video!.multiReferenceImages" type="checkbox" />
          <span>多参考图入 API（分镜图 + 多张资产图按序）；关闭则只传第一张图，兼容只支持单图的网关</span>
        </label>
        <div class="cfg-model-slots">
          <h5>已保存视频模型方案</h5>
          <button type="button" class="btn small" @click="cfg.saveCurrentVideoModelProfile">另存当前为方案</button>
          <ul v-if="cfg.cfgDraft.videoModels?.length" class="cfg-profile-list">
            <li v-for="row in cfg.cfgDraft.videoModels" :key="row.id" class="cfg-profile-row">
              <span>{{ row.label }}</span>
              <code>{{ row.model }}</code>
              <button type="button" class="btn small" @click="cfg.loadVideoModelProfile(row.id)">载入</button>
              <button type="button" class="btn small danger" @click="cfg.removeVideoModelProfile(row.id)">删除</button>
            </li>
          </ul>
        </div>
      </div>

      <div class="cfg-block">
        <h4>台词语音合成（TTS）与视频配音</h4>
        <p class="hint">
          支持使用<strong>阿里云 DashScope 官方神经语音（Sambert）</strong>或 <strong>CosyVoice</strong> 为剧本对白台词自动合成高品质角色语音。
        </p>
        <label class="opt">
          <input v-model="cfg.cfgDraft.tts!.enabled" type="checkbox" />
          <span>启用台词语音合成（分镜表支持单镜生成台词试听与重录）</span>
        </label>
        <label class="opt">
          <input v-model="cfg.cfgDraft.tts!.autoMuxVideo" type="checkbox" />
          <span>视频生成后自动合成台词音轨（生成无声视频后，自动将对白语音无损混流入 MP4 视频）</span>
        </label>
        <label v-if="cfg.bailianPresets?.tts?.length" class="field">
          <span>阿里百炼语音音色预设</span>
          <select v-model="cfg.cfgDraft.tts!.model" class="input">
            <option v-for="t in cfg.bailianPresets.tts" :key="t.id" :value="t.model">
              {{ t.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>API Key（默认复用上方百炼文本/视频 Key，可留空）</span>
          <input
            v-model="cfg.cfgDraft.tts!.apiKey"
            class="input"
            type="password"
            autocomplete="off"
            placeholder="留空则自动使用上方配置的百炼 API Key"
          />
        </label>
        <label class="field">
          <span>模型标识 (Model)</span>
          <input
            v-model="cfg.cfgDraft.tts!.model"
            class="input"
            placeholder="sambert-zhixiao-v1 或 cosyvoice-v2"
          />
        </label>
      </div>

      <div class="cfg-block">
        <h4>EasyImage 图床</h4>
        <p class="hint">
          配置后，<strong>资产生图</strong>与<strong>分镜生图</strong>（含管线批次、Runner
          生图任务）在落盘成功时会<strong>自动上传</strong>到图床，并将稳定外链写入
          <code>remoteImageUrl</code>（上传失败仅记日志，仍保留本地图与大模型临时链）。 分镜右键默认「上传图床（分镜 +
          本镜参考资产）」会在上传关键帧后，按与视频请求相同规则<strong>顺带上传</strong>本项目内参考资产（补全<strong>旧数据</strong>）；「仅上传分镜」跳过资产。请在图床后台开启
          API 上传；API 地址一般为完整路径，例如 <code>http://主机:端口/api/index.php</code>。
        </p>
        <label class="field">
          <span>API URL</span>
          <input
            v-model="cfg.cfgDraft.easyImage!.apiUrl"
            class="input"
            placeholder="http://ip:port/api/index.php"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span>上传 Token</span>
          <input
            v-model="cfg.cfgDraft.easyImage!.token"
            class="input"
            type="password"
            autocomplete="off"
            placeholder="留空或掩码表示沿用已保存"
          />
        </label>
      </div>

      <div class="cfg-block">
        <h4>Agents 提示词配置</h4>
        <p class="hint">留空则使用内置默认；灰色占位为默认提示词全文，保存空内容即可恢复默认行为。</p>
        <label class="field block">
          <span>剧本 Agent System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.scriptSystem"
            class="area"
            rows="3"
            :placeholder="AGENT_PROMPT_DEFAULTS.scriptSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>分镜 Agent System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.storyboardSystem"
            class="area"
            rows="3"
            :placeholder="AGENT_PROMPT_DEFAULTS.storyboardSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>分镜修复 System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.storyboardRepairSystem"
            class="area"
            rows="2"
            :placeholder="AGENT_PROMPT_DEFAULTS.storyboardRepairSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>资产 Agent System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.assetsSystem"
            class="area"
            rows="3"
            :placeholder="AGENT_PROMPT_DEFAULTS.assetsSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>导演 Gate System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.directorSystem"
            class="area"
            rows="4"
            :placeholder="AGENT_PROMPT_DEFAULTS.directorSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>视频修订 Agent System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.videoRefineSystem"
            class="area"
            rows="3"
            :placeholder="AGENT_PROMPT_DEFAULTS.videoRefineSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>原文润色 System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.polishSourceSystem"
            class="area"
            rows="2"
            :placeholder="AGENT_PROMPT_DEFAULTS.polishSourceSystem"
          ></textarea>
        </label>
        <label class="field block">
          <span>剧本润色 System</span>
          <textarea
            v-model="cfg.cfgDraft.agentPrompts!.polishScriptSystem"
            class="area"
            rows="2"
            :placeholder="AGENT_PROMPT_DEFAULTS.polishScriptSystem"
          ></textarea>
        </label>
      </div>

      <div class="actions">
        <button class="btn" type="button" :disabled="ui.busy" @click="cfg.loadRemoteConfig">重新加载</button>
        <button class="btn primary" type="button" :disabled="ui.busy" @click="cfg.saveRemoteConfig">保存配置</button>
      </div>
    </article>

    <article class="card">
      <h3>运行与交互</h3>
      <label class="opt">
        <input v-model="autoSave" type="checkbox" />
        <span>原文输入时自动保存</span>
      </label>
      <label class="opt">
        <input v-model="pipelineAllowPartial" type="checkbox" />
        <span>并行管线允许部分成功（资产/分镜互不阻断）</span>
      </label>
      <label class="opt">
        <span>Runner 间隔延时（ms）</span>
        <input v-model.number="simulateDelay" type="number" min="100" step="100" class="input small" />
      </label>
      <p class="hint">配置与项目数据在 <code>my-app/data/app.db</code>（SQLite），勿提交到 Git。</p>
    </article>
  </section>
</template>

<style scoped>
.cfg-block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(56, 189, 248, 0.15);
}

.cfg-block:first-of-type {
  margin-top: 16px;
  padding-top: 0;
  border-top: none;
}

.cfg-block h4 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.02em;
}

.cfg-block h5 {
  margin: 14px 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #7dd3fc;
}

.cfg-model-slots {
  margin-top: 12px;
}

.cfg-profile-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.cfg-profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(13, 20, 36, 0.7);
  border: 1px solid rgba(56, 189, 248, 0.15);
  color: #e2eaf4;
  font-size: 12px;
}

.cfg-profile-row span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cfg-video-supported-modes {
  margin-top: 12px;
}

.cfg-video-mode-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

.cfg-volc-cap-line {
  margin: 6px 0 10px;
}

.cfg-msg {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
  font-size: 13px;
  color: #38bdf8;
  margin: 10px 0;
}
</style>
