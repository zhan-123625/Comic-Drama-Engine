export type PipelineStage = "script" | "assets" | "storyboard" | "video";

export type StoryboardImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** 单镜视频生成模式（与视频模型 supportedModes 联动） */
export type VideoRunMode = "first_frame" | "first_last" | "multi_ref" | "omni" | "text_only";

export type StoryboardShot = {
  id: string;
  index: number;
  /** 镜头号（可与 index 一致，也可由用户手工调整显示） */
  shotNo: string;
  /** 景别：如 远景/全景/中景/近景/特写 等 */
  shotSize: string;
  /** 摄法/镜头运动：如 固定/推拉摇移/跟拍/航拍/手持 等 */
  camera: string;
  /** 画面内容（核心视觉描述，用于生图/视频 prompt 的主体） */
  content: string;
  /** 台词/旁白（可空） */
  dialogue: string;
  /** 音乐（可空） */
  music: string;
  /** 音响效果（可空） */
  sfx: string;
  /** 镜头长度（秒，可空）：与视频模型一致时为整秒，1～15 */
  durationSec?: number;
  /** 对应剧本场次表中的「场次」编号（与章内 Markdown 表一致）；多镜可同属一场 */
  sceneNo?: number;
  /**
   * 兼容字段：历史版本使用 prompt/note。
   * 仍保留以便旧数据加载与最小改造；新 UI 主要使用上方结构化字段。
   */
  prompt: string;
  note: string;
  /** 自定义视频生成提示词；空则服务端用分镜结构化字段拼接（含台词/音效等） */
  videoPrompt?: string;
  /** 自定义分镜生图基底（画面主体）；空则服务端用 content/景别/摄法等自动拼接纯画面描述 */
  imagePrompt?: string;
  /**
   * 视频生成时额外固定附带的资产 ID（本项目资产表），顺序优先于 @ 引用与文案自动匹配。
   */
  videoExtraAssetIds?: string[];
  /**
   * 用户在分镜页手动排除的资产 ID（包括系统自动匹配但被用户点击删除的资产）。
   */
  videoExcludedAssetIds?: string[];
  imageUrl?: string;
  /**
   * 生图接口返回的原始图 URL（常带时效签名，会过期）；视频/外链场景优先用已落盘的 `imageUrl`（/api/files/...）或稳定图床链。
   */
  remoteImageUrl?: string;
  /** 设置中「已保存生图方案」的 id；空则使用全局 image 配置 */
  imageModelId?: string;
  /** 设置中「已保存视频方案」的 id；空则使用全局 video 配置 */
  videoModelId?: string;
  /** 本镜视频生成模式（须为当前视频模型 supportedModes 所允许） */
  videoRunMode?: VideoRunMode;
  /** 首尾帧模式：尾帧（本地路径或 URL，逻辑同关键帧） */
  lastFrameImageUrl?: string;
  lastFrameRemoteUrl?: string;
  /** 台词对白语音音频 URL（/api/files/projects/.../audio/...） */
  audioUrl?: string;
  /** 本镜头台词音色标识（留空则根据角色或全局设置自动分配） */
  voice?: string;
  /** 说话人名称（如“团团”、“滚滚”、“旁白”，留空则自动从台词提取） */
  speaker?: string;
  /** 全能参考：参考音频 / 参考视频 URL（由下游网关解析） */
  videoRefAudioUrl?: string;
  videoRefVideoUrl?: string;
};

export type AssetItem = {
  id: string;
  index: number;
  type: "character" | "scene" | "prop" | "costume" | "action_pose" | "fx";
  name: string;
  /** 资产语义键（可读，调试友好） */
  key?: string;
  /** 由 type+key 计算的稳定数字主键（用于去重/复用） */
  stableId?: number;
  /** 同义称呼（如昵称/别名） */
  aliases?: string[];
  /** 出现场次号（可选） */
  sceneNos?: number[];
  prompt: string;
  /** 本地可访问展示图（/api/files/...，视频参考优先） */
  imageUrl?: string;
  /** 第三方或生图接口返回 URL（可能过期）；有本地 `imageUrl` 时视频侧优先本地 */
  remoteImageUrl?: string;
  note?: string;
  /** 角色资产专用：配音音色模型（如 sambert-zhixiao-v1、sambert-zhichu-v1） */
  voice?: string;
};

/** 单次 HTTP 调用快照（Authorization 已脱敏；body 内 data URL 已省略） */
export type ModelApiCallSnapshot = {
  capturedAt: string;
  taskKind: "image" | "video";
  /** 逻辑路由说明，如 openai_images_generations、ark_create_task、video_hook_generate */
  routeKind: string;
  method: string;
  requestUrl: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  notes?: string[];
};

export type VideoJob = {
  id: string;
  kind?: "video" | "image";
  status: "queued" | "running" | "done" | "failed";
  message: string;
  /** 关联分镜 ID（可选） */
  shotId?: string;
  /** 关联分镜序号（管线入队时写入，runner 用其取 prompt / 参考图） */
  shotIndex?: number;
  prompt?: string;
  /** 任务创建时的参考图快照（可选） */
  imageUrl?: string;
  resultUrl?: string;
  /** Runner / 直跑完成后写入：实际发往大模型网关的请求（脱敏+截断） */
  modelApiCall?: ModelApiCallSnapshot;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceText: string;
  outline: string;
  script: string;
  /** 画风 / 视觉参考描述（供润色与管线参考） */
  artStyle: string;
  /** 类型 / 题材（如玄幻、都市） */
  genreType: string;
  /** 目标视频画幅，如 16:9、9:16 */
  videoAspect: string;
  /** 分镜参考图生成尺寸（管线生图优先于全局设置中的默认尺寸） */
  storyboardImageSize: StoryboardImageSize;
  assets: AssetItem[];
  storyboards: StoryboardShot[];
  videoJobs: VideoJob[];
  pipelineStatus: "idle" | "running" | "done" | "error";
  pipelineError?: string;
  pipelineLog: string[];
};

export type DirectorStep = "script" | "assets" | "storyboard" | "image_batch" | "video_plan";

export type PolishField = "source" | "script";

export type PipelineEvent =
  | { type: "log"; message: string }
  | { type: "stage"; stage: PipelineStage; status: "start" | "done" | "error"; detail?: string }
  | { type: "director"; step: DirectorStep; approved: boolean; feedback: string; attempt: number }
  | { type: "job"; job: VideoJob; index: number }
  | { type: "storyboards"; storyboards: StoryboardShot[] }
  | { type: "complete" }
  | { type: "error"; message: string };
