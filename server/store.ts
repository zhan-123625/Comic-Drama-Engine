import { getDb, runTransaction } from "./db.js";
import { z } from "zod";
import { publicShotImagePath } from "./imagePersist.js";
import { jsonStringifyModelSnapshot } from "./modelRequestSnapshot.js";
import { SHOT_DURATION_SEC_MAX, SHOT_DURATION_SEC_MIN } from "./pipelineConstants.js";
import { dedupeAssets } from "./assetUtils.js";
import type {
  AssetItem,
  ModelApiCallSnapshot,
  Project,
  StoryboardImageSize,
  StoryboardShot,
  VideoJob,
} from "./types.js";

const assetTypeValues = ["character", "scene", "prop", "costume", "action_pose", "fx"] as const;
const assetTypeSchema = z.enum(assetTypeValues);

const assetJsonItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    index: z.union([z.number(), z.string()]).optional(),
    type: z.string().optional(),
    name: z.string().optional(),
    key: z.string().optional(),
    stableId: z.union([z.number(), z.string()]).optional(),
    aliases: z.array(z.union([z.string(), z.number()])).optional(),
    sceneNos: z.array(z.union([z.number(), z.string()])).optional(),
    prompt: z.string().optional(),
    imageUrl: z.string().optional(),
    remoteImageUrl: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const assetJsonArraySchema = z.array(assetJsonItemSchema);

const ASSET_LIBRARY_CACHE_TTL_MS = Number(process.env.MY_APP_ASSET_LIBRARY_CACHE_TTL_MS || 5000);
let assetLibraryCache: { expiresAt: number; items: AssetLibraryItem[] } | null = null;

function invalidateAssetLibraryCache() {
  assetLibraryCache = null;
}

function parseStoryboardImageSize(v: unknown): StoryboardImageSize {
  const s = typeof v === "string" ? v : "";
  if (s === "1024x1536" || s === "1536x1024") return s;
  return "1024x1024";
}

type ShotRow = {
  shot_id: string;
  project_id: string;
  sort_index: number;
  scene_no: number | null;
  shot_no: string;
  shot_size: string;
  camera: string;
  content: string;
  dialogue: string;
  music: string;
  sfx: string;
  duration_sec: number | null;
  prompt: string;
  note: string;
  video_prompt: string | null;
  image_prompt: string | null;
  video_extra_asset_ids_json: string | null;
  video_excluded_asset_ids_json?: string | null;
  image_gen_source_url: string | null;
  remote_image_url: string | null;
  image_mime: string | null;
  image_blob: Buffer | Uint8Array | null;
  image_model_id: string | null;
  video_model_id: string | null;
  video_run_mode: string | null;
  last_frame_image_url: string | null;
  last_frame_remote_url: string | null;
  video_ref_audio_url: string | null;
  video_ref_video_url: string | null;
};

/** Variant used by lightweight/lean queries that omit image_blob and image_mime. */
type LeanShotRow = Omit<ShotRow, "image_blob" | "image_mime"> & {
  has_blob: number;
};

function asBuffer(b: Buffer | Uint8Array | null | undefined): Buffer | null {
  if (b == null) return null;
  return Buffer.isBuffer(b) ? b : Buffer.from(b);
}

function parseVideoExcludedAssetIdsJson(raw: string | null | undefined): string[] | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "[]") return undefined;
  try {
    const j = JSON.parse(s) as unknown;
    if (!Array.isArray(j)) return undefined;
    const ids = [
      ...new Set(
        j
          .map((x) =>
            String(x ?? "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ].slice(0, 100);
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}

function parseVideoExtraAssetIdsJson(raw: string | null | undefined): string[] | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "[]") return undefined;
  try {
    const j = JSON.parse(s) as unknown;
    if (!Array.isArray(j)) return undefined;
    const ids = [...new Set(j.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 24);
    return ids.length ? ids : undefined;
  } catch {
    return undefined;
  }
}

function normalizeShotDurationSec(v: number | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(SHOT_DURATION_SEC_MAX, Math.max(SHOT_DURATION_SEC_MIN, Math.round(n)));
}

function parseVideoRunModeDb(v: string | null | undefined): StoryboardShot["videoRunMode"] {
  const s = String(v ?? "").trim();
  if (s === "first_frame" || s === "first_last" || s === "multi_ref" || s === "omni" || s === "text_only") return s;
  return undefined;
}

type JobRow = {
  job_id: string;
  project_id: string;
  sort_order: number;
  kind: string;
  status: string;
  message: string;
  shot_index: number | null;
  prompt: string | null;
  hook_image_url: string | null;
  result_url: string | null;
  model_request_json?: string | null;
};

export type AssetLibraryItem = {
  projectId: string;
  projectName: string;
  projectUpdatedAt: string;
  asset: AssetItem;
};

function normalizeAssetType(value: unknown): AssetItem["type"] {
  const parsed = assetTypeSchema.safeParse(String(value ?? ""));
  return parsed.success ? parsed.data : "scene";
}

function parseAssetArrayFromJson(v: unknown): AssetItem[] {
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(typeof v === "string" ? v : "[]");
  } catch {
    return [];
  }

  const parsed = assetJsonArraySchema.safeParse(rawParsed);
  if (!parsed.success) return [];

  const mapped: AssetItem[] = parsed.data.map((x, i) => {
    const id = String(x.id ?? "").trim() || crypto.randomUUID();
    const index = Number(x.index ?? i + 1);
    const stableIdNum = x.stableId == null ? undefined : Number(x.stableId);
    const aliases = Array.isArray(x.aliases) ? x.aliases.map((v) => String(v)).filter(Boolean) : undefined;
    const sceneNos = Array.isArray(x.sceneNos)
      ? x.sceneNos.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
      : undefined;

    return {
      id,
      index: Number.isFinite(index) ? index : i + 1,
      type: normalizeAssetType(x.type),
      name: String(x.name ?? ""),
      key: x.key ? String(x.key) : undefined,
      stableId: Number.isInteger(stableIdNum) ? stableIdNum : undefined,
      aliases,
      sceneNos,
      prompt: String(x.prompt ?? ""),
      imageUrl: x.imageUrl ? String(x.imageUrl) : undefined,
      remoteImageUrl: x.remoteImageUrl ? String(x.remoteImageUrl) : undefined,
      note: x.note ? String(x.note) : undefined,
    } satisfies AssetItem;
  });
  return dedupeAssets(mapped);
}

function mapShot(
  projectId: string,
  row: Omit<ShotRow, "image_blob" | "image_mime"> & {
    has_blob?: number;
    image_blob?: ShotRow["image_blob"];
    image_mime?: ShotRow["image_mime"];
  },
): StoryboardShot {
  const blob = asBuffer(row.image_blob);
  const hasBlob = row.has_blob === 1 || (blob != null && blob.length > 0);
  const imageUrl = hasBlob ? publicShotImagePath(projectId, row.shot_id) : row.remote_image_url || undefined;
  const sn = row.scene_no == null ? undefined : Number(row.scene_no);
  return {
    id: row.shot_id,
    index: row.sort_index,
    shotNo: row.shot_no || String(row.sort_index),
    sceneNo: sn != null && Number.isInteger(sn) && sn > 0 ? sn : undefined,
    shotSize: row.shot_size || "",
    camera: row.camera || "",
    content: row.content || row.prompt || "",
    dialogue: row.dialogue || "",
    music: row.music || "",
    sfx: row.sfx || "",
    durationSec: normalizeShotDurationSec(row.duration_sec),
    prompt: row.prompt,
    note: row.note,
    videoPrompt: row.video_prompt?.trim() ? row.video_prompt : undefined,
    imagePrompt: row.image_prompt?.trim() ? row.image_prompt : undefined,
    videoExtraAssetIds: parseVideoExtraAssetIdsJson(row.video_extra_asset_ids_json),
    videoExcludedAssetIds: parseVideoExcludedAssetIdsJson(row.video_excluded_asset_ids_json),
    imageUrl,
    remoteImageUrl: row.image_gen_source_url?.trim() || undefined,
    imageModelId: row.image_model_id?.trim() || undefined,
    videoModelId: row.video_model_id?.trim() || undefined,
    videoRunMode: parseVideoRunModeDb(row.video_run_mode),
    lastFrameImageUrl: row.last_frame_image_url?.trim() ? row.last_frame_image_url.trim().slice(0, 50_000) : undefined,
    lastFrameRemoteUrl: row.last_frame_remote_url?.trim()
      ? row.last_frame_remote_url.trim().slice(0, 50_000)
      : undefined,
    videoRefAudioUrl: row.video_ref_audio_url?.trim() ? row.video_ref_audio_url.trim().slice(0, 2000) : undefined,
    videoRefVideoUrl: row.video_ref_video_url?.trim() ? row.video_ref_video_url.trim().slice(0, 2000) : undefined,
  };
}

function mapJob(row: JobRow): VideoJob {
  let modelApiCall: ModelApiCallSnapshot | undefined;
  const raw = row.model_request_json?.trim();
  if (raw) {
    try {
      modelApiCall = JSON.parse(raw) as ModelApiCallSnapshot;
    } catch {
      modelApiCall = undefined;
    }
  }
  return {
    id: row.job_id,
    kind: row.kind === "image" ? "image" : "video",
    status: row.status as VideoJob["status"],
    message: row.message,
    shotIndex: row.shot_index ?? undefined,
    prompt: row.prompt ?? undefined,
    imageUrl: row.hook_image_url ?? undefined,
    resultUrl: row.result_url ?? undefined,
    modelApiCall,
  };
}

function parseAssets(v: unknown): AssetItem[] {
  return parseAssetArrayFromJson(v);
}

function buildProject(
  projectRow: Record<string, unknown>,
  shots: (ShotRow & { has_blob: number })[],
  jobs: JobRow[],
): Project {
  const id = projectRow.id as string;
  let pipelineLog: string[];
  try {
    pipelineLog = JSON.parse((projectRow.pipeline_log_json as string) || "[]") as string[];
  } catch {
    pipelineLog = [];
  }

  return {
    id,
    name: projectRow.name as string,
    createdAt: projectRow.created_at as string,
    updatedAt: projectRow.updated_at as string,
    sourceText: projectRow.source_text as string,
    outline: projectRow.outline as string,
    script: projectRow.script as string,
    artStyle: typeof projectRow.art_style === "string" ? projectRow.art_style : "",
    genreType: typeof projectRow.genre_type === "string" ? projectRow.genre_type : "",
    videoAspect:
      typeof projectRow.video_aspect === "string" && projectRow.video_aspect ? projectRow.video_aspect : "16:9",
    storyboardImageSize: parseStoryboardImageSize(projectRow.storyboard_image_size),
    assets: parseAssets(projectRow.assets_json),
    storyboards: shots.map((r) => mapShot(id, r)),
    videoJobs: jobs.map(mapJob),
    pipelineStatus: projectRow.pipeline_status as Project["pipelineStatus"],
    pipelineError: (projectRow.pipeline_error as string) || undefined,
    pipelineLog,
  };
}

function hydrateProject(projectRow: Record<string, unknown>): Project {
  const id = projectRow.id as string;
  const d = getDb();
  const shots = d
    .prepare(
      `SELECT shot_id, project_id, sort_index, scene_no,
              shot_no, shot_size, camera, content, dialogue, music, sfx, duration_sec,
              prompt, note, video_prompt, image_prompt, video_extra_asset_ids_json, video_excluded_asset_ids_json, video_excluded_asset_ids_json, image_gen_source_url, remote_image_url, image_mime,
              image_blob,
              image_model_id, video_model_id, video_run_mode,
              last_frame_image_url, last_frame_remote_url, video_ref_audio_url, video_ref_video_url,
              (CASE WHEN image_blob IS NOT NULL AND length(image_blob) > 0 THEN 1 ELSE 0 END) AS has_blob
       FROM storyboard_shots WHERE project_id = ? ORDER BY sort_index ASC`,
    )
    .all(id) as (ShotRow & { has_blob: number })[];
  const jobs = d.prepare(`SELECT * FROM video_jobs WHERE project_id = ? ORDER BY sort_order ASC`).all(id) as JobRow[];

  return buildProject(projectRow, shots, jobs);
}

function emptyProject(input: {
  name: string;
  genreType?: string;
  artStyle?: string;
  videoAspect?: string;
  storyboardImageSize?: StoryboardImageSize;
}): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    sourceText: "",
    outline: "",
    script: "",
    artStyle: input.artStyle ?? "",
    genreType: input.genreType ?? "",
    videoAspect: input.videoAspect ?? "16:9",
    storyboardImageSize: input.storyboardImageSize ?? "1024x1024",
    assets: [],
    storyboards: [],
    videoJobs: [],
    pipelineStatus: "idle",
    pipelineLog: [],
  };
}

export const store = {
  /** 列出全部项目（按最近更新时间倒序）。 */
  async list(): Promise<Project[]> {
    const d = getDb();
    const rows = d.prepare(`SELECT * FROM projects ORDER BY datetime(updated_at) DESC`).all() as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id as string);
    const placeholders = ids.map(() => "?").join(",");

    // Batch-load all shots for all projects in one query（排除 image_blob/image_mime 减少内存占用）
    const allShots = d
      .prepare(
        `SELECT shot_id, project_id, sort_index, scene_no,
                shot_no, shot_size, camera, content, dialogue, music, sfx, duration_sec,
                prompt, note, video_prompt, image_prompt, video_extra_asset_ids_json, video_excluded_asset_ids_json, image_gen_source_url, remote_image_url,
                image_model_id, video_model_id, video_run_mode,
                last_frame_image_url, last_frame_remote_url, video_ref_audio_url, video_ref_video_url,
                (CASE WHEN image_blob IS NOT NULL AND length(image_blob) > 0 THEN 1 ELSE 0 END) AS has_blob
         FROM storyboard_shots WHERE project_id IN (${placeholders}) ORDER BY sort_index ASC`,
      )
      .all(...ids) as (ShotRow & { has_blob: number })[];

    // Batch-load all jobs for all projects in one query
    const allJobs = d
      .prepare(`SELECT * FROM video_jobs WHERE project_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .all(...ids) as JobRow[];

    // Index shots and jobs by project_id
    const shotsByProject = new Map<string, (ShotRow & { has_blob: number })[]>();
    for (const shot of allShots) {
      let arr = shotsByProject.get(shot.project_id);
      if (!arr) {
        arr = [];
        shotsByProject.set(shot.project_id, arr);
      }
      arr.push(shot);
    }

    const jobsByProject = new Map<string, JobRow[]>();
    for (const job of allJobs) {
      let arr = jobsByProject.get(job.project_id);
      if (!arr) {
        arr = [];
        jobsByProject.set(job.project_id, arr);
      }
      arr.push(job);
    }

    return rows.map((r) =>
      buildProject(r, shotsByProject.get(r.id as string) ?? [], jobsByProject.get(r.id as string) ?? []),
    );
  },

  /** 按项目 ID 读取完整项目（含资产、分镜与任务）。 */
  async get(id: string): Promise<Project | undefined> {
    const d = getDb();
    const row = d.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return hydrateProject(row);
  },

  /**
   * 轻量化项目加载 - 仅返回元数据和脚本，避免加载大型二进制数据（图片、分镜详情）
   * 用于需要快速访问项目基础信息的场景，如列表视图、设置页面等
   */
  async getLean(id: string): Promise<Project | undefined> {
    const d = getDb();
    const row = d
      .prepare(
        `SELECT id, name, created_at, updated_at,
                source_text, outline, script,
                art_style, genre_type, video_aspect, storyboard_image_size,
                assets_json, pipeline_status, pipeline_error, pipeline_log_json
         FROM projects WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;

    // 仅加载最少的分镜信息（不含图片二进制数据）
    const shots = d
      .prepare(
        `SELECT shot_id, project_id, sort_index, scene_no,
              shot_no, shot_size, camera, content, dialogue, music, sfx, duration_sec,
              prompt, note, video_prompt, image_prompt, video_extra_asset_ids_json, video_excluded_asset_ids_json, image_gen_source_url, remote_image_url,
              image_model_id, video_model_id, video_run_mode,
              (CASE WHEN image_blob IS NOT NULL AND length(image_blob) > 0 THEN 1 ELSE 0 END) AS has_blob
       FROM storyboard_shots WHERE project_id = ? ORDER BY sort_index ASC`,
      )
      .all(id) as LeanShotRow[];

    // 不加载视频任务（可选）
    let pipelineLog: string[];
    try {
      pipelineLog = JSON.parse((row.pipeline_log_json as string) || "[]") as string[];
    } catch {
      pipelineLog = [];
    }

    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      sourceText: row.source_text as string,
      outline: row.outline as string,
      script: row.script as string,
      artStyle: typeof row.art_style === "string" ? row.art_style : "",
      genreType: typeof row.genre_type === "string" ? row.genre_type : "",
      videoAspect: typeof row.video_aspect === "string" && row.video_aspect ? row.video_aspect : "16:9",
      storyboardImageSize: parseStoryboardImageSize(row.storyboard_image_size),
      assets: parseAssets(row.assets_json),
      storyboards: shots.map((r) => mapShot(id, r)),
      videoJobs: [], // 未加载任务
      pipelineStatus: row.pipeline_status as Project["pipelineStatus"],
      pipelineError: (row.pipeline_error as string) || undefined,
      pipelineLog,
    };
  },

  /** 聚合所有项目中的可复用资产，供资产库选择器快速检索。 */
  async listAssetLibrary(): Promise<AssetLibraryItem[]> {
    if (assetLibraryCache && assetLibraryCache.expiresAt > Date.now()) {
      return assetLibraryCache.items;
    }

    const d = getDb();
    const rows = d
      .prepare(
        `SELECT id, name, updated_at, assets_json
         FROM projects
         WHERE assets_json IS NOT NULL AND assets_json <> '' AND assets_json <> '[]'
         ORDER BY datetime(updated_at) DESC`,
      )
      .all() as Array<{ id: string; name: string; updated_at: string; assets_json: string }>;

    const out: AssetLibraryItem[] = [];
    for (const row of rows) {
      const arr = parseAssetArrayFromJson(row.assets_json);
      for (const item of arr) {
        const id = String(item.id ?? "").trim();
        const prompt = String(item.prompt ?? "").trim();
        if (!id || !prompt) continue;

        out.push({
          projectId: row.id,
          projectName: row.name,
          projectUpdatedAt: row.updated_at,
          asset: { ...item, prompt },
        });
      }
    }

    assetLibraryCache = {
      expiresAt: Date.now() + ASSET_LIBRARY_CACHE_TTL_MS,
      items: out,
    };

    return out;
  },

  /** 创建新项目并写入默认初始结构。 */
  async create(input: {
    name: string;
    genreType?: string;
    artStyle?: string;
    videoAspect?: string;
    storyboardImageSize?: StoryboardImageSize;
  }): Promise<Project> {
    invalidateAssetLibraryCache();
    const p = emptyProject(input);
    const d = getDb();
    d.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at, source_text, outline, script, pipeline_status, pipeline_error, pipeline_log_json,
        art_style, genre_type, video_aspect, storyboard_image_size, assets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      p.id,
      p.name,
      p.createdAt,
      p.updatedAt,
      p.sourceText,
      p.outline,
      p.script,
      p.pipelineStatus,
      null,
      JSON.stringify(p.pipelineLog),
      p.artStyle,
      p.genreType,
      p.videoAspect,
      p.storyboardImageSize,
      JSON.stringify(p.assets ?? []),
    );
    return p;
  },

  /** 保存项目主数据，并以事务方式同步分镜与任务表。 */
  async save(project: Project) {
    invalidateAssetLibraryCache();
    const d = getDb();
    const now = new Date().toISOString();
    project.updatedAt = now;

    runTransaction(d, () => {
      // 1. Update project metadata
      d.prepare(
        `UPDATE projects SET name=?, updated_at=?, source_text=?, outline=?, script=?, pipeline_status=?, pipeline_error=?, pipeline_log_json=?,
         art_style=?, genre_type=?, video_aspect=?, storyboard_image_size=?, assets_json=?
         WHERE id=?`,
      ).run(
        project.name,
        project.updatedAt,
        project.sourceText,
        project.outline,
        project.script,
        project.pipelineStatus,
        project.pipelineError ?? null,
        JSON.stringify(project.pipelineLog ?? []),
        project.artStyle,
        project.genreType,
        project.videoAspect,
        project.storyboardImageSize,
        JSON.stringify(project.assets ?? []),
        project.id,
      );

      // 2. Incremental Storyboard Update (UPSERT pattern)
      // First: Delete shots that are no longer in the project
      const currentShotIds = project.storyboards.map((s) => s.id);
      if (currentShotIds.length > 0) {
        const placeholders = currentShotIds.map(() => "?").join(",");
        d.prepare(`DELETE FROM storyboard_shots WHERE project_id = ? AND shot_id NOT IN (${placeholders})`).run(
          project.id,
          ...currentShotIds,
        );
      } else {
        d.prepare(`DELETE FROM storyboard_shots WHERE project_id = ?`).run(project.id);
      }

      // Second: Upsert shots (insert or update)
      const insShot = d.prepare(`
        INSERT INTO storyboard_shots (
          shot_id, project_id, sort_index, scene_no,
          shot_no, shot_size, camera, content, dialogue, music, sfx, duration_sec,
          prompt, note, video_prompt, image_prompt, video_extra_asset_ids_json, video_excluded_asset_ids_json,
          image_gen_source_url, remote_image_url, image_mime, image_blob,
          image_model_id, video_model_id, video_run_mode,
          last_frame_image_url, last_frame_remote_url, video_ref_audio_url, video_ref_video_url
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shot_id) DO UPDATE SET
          sort_index=excluded.sort_index, scene_no=excluded.scene_no, shot_no=excluded.shot_no,
          shot_size=excluded.shot_size, camera=excluded.camera, content=excluded.content,
          dialogue=excluded.dialogue, music=excluded.music, sfx=excluded.sfx, duration_sec=excluded.duration_sec,
          prompt=excluded.prompt, note=excluded.note, video_prompt=excluded.video_prompt,
          image_prompt=excluded.image_prompt, video_extra_asset_ids_json=excluded.video_extra_asset_ids_json, video_excluded_asset_ids_json=excluded.video_excluded_asset_ids_json,
          image_gen_source_url=excluded.image_gen_source_url, remote_image_url=excluded.remote_image_url,
          image_mime=excluded.image_mime, image_blob=excluded.image_blob,
          image_model_id=excluded.image_model_id, video_model_id=excluded.video_model_id,
          video_run_mode=excluded.video_run_mode, last_frame_image_url=excluded.last_frame_image_url,
          last_frame_remote_url=excluded.last_frame_remote_url, video_ref_audio_url=excluded.video_ref_audio_url,
          video_ref_video_url=excluded.video_ref_video_url
      `);

      for (const shot of project.storyboards) {
        const remote_image_url = shot.imageUrl ?? null;
        const image_gen_source_url = shot.remoteImageUrl?.trim() || null;
        const image_mime: string | null = null;
        const image_blob: Buffer | null = null;
        const extraIds = [
          ...new Set((shot.videoExtraAssetIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)),
        ].slice(0, 24);
        const videoExtraJson = JSON.stringify(extraIds);
        const excludedIds = [
          ...new Set(
            (shot.videoExcludedAssetIds ?? [])
              .map((x) =>
                String(x ?? "")
                  .trim()
                  .toLowerCase(),
              )
              .filter(Boolean),
          ),
        ].slice(0, 100);
        const videoExcludedJson = JSON.stringify(excludedIds);

        insShot.run(
          shot.id,
          project.id,
          shot.index,
          shot.sceneNo != null && Number.isInteger(shot.sceneNo) && shot.sceneNo > 0 ? shot.sceneNo : null,
          shot.shotNo ?? String(shot.index),
          shot.shotSize ?? "",
          shot.camera ?? "",
          shot.content ?? "",
          shot.dialogue ?? "",
          shot.music ?? "",
          shot.sfx ?? "",
          normalizeShotDurationSec(shot.durationSec ?? undefined) ?? null,
          shot.prompt,
          shot.note,
          shot.videoPrompt?.trim() ?? "",
          shot.imagePrompt?.trim() ?? "",
          videoExtraJson,
          videoExcludedJson,
          image_gen_source_url,
          remote_image_url,
          image_mime,
          image_blob,
          shot.imageModelId?.trim() || null,
          shot.videoModelId?.trim() || null,
          shot.videoRunMode?.trim() || null,
          shot.lastFrameImageUrl?.trim() ? shot.lastFrameImageUrl.trim().slice(0, 50_000) : null,
          shot.lastFrameRemoteUrl?.trim() ? shot.lastFrameRemoteUrl.trim().slice(0, 50_000) : null,
          shot.videoRefAudioUrl?.trim() ? shot.videoRefAudioUrl.trim().slice(0, 2000) : null,
          shot.videoRefVideoUrl?.trim() ? shot.videoRefVideoUrl.trim().slice(0, 2000) : null,
        );
      }

      // 3. Re-handle Jobs (full replacement as jobs are transient state-based entities)
      d.prepare(`DELETE FROM video_jobs WHERE project_id = ?`).run(project.id);
      const insJob = d.prepare(`
        INSERT INTO video_jobs (job_id, project_id, sort_order, kind, status, message, shot_index, prompt, hook_image_url, result_url, model_request_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      project.videoJobs.forEach((j, order) => {
        insJob.run(
          j.id,
          project.id,
          order,
          j.kind === "image" ? "image" : "video",
          j.status,
          j.message,
          j.shotIndex ?? null,
          j.prompt ?? null,
          j.imageUrl ?? null,
          j.resultUrl ?? null,
          j.modelApiCall ? jsonStringifyModelSnapshot(j.modelApiCall) : null,
        );
      });
    });
  },

  /** 更新原文并触发统一保存流程。 */
  async updateSource(id: string, sourceText: string) {
    const p = await this.get(id);
    if (!p) throw new Error("project not found");
    p.sourceText = sourceText;
    await this.save(p);
    return p;
  },

  /** 删除项目（关联子表由数据库外键级联清理）。 */
  async delete(id: string): Promise<boolean> {
    invalidateAssetLibraryCache();
    const d = getDb();
    const r = d.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    const n = typeof r.changes === "bigint" ? Number(r.changes) : r.changes;
    return n > 0;
  },

  /** 分镜行内嵌图片 BLOB（无有效数据时返回 null）。 */
  getStoryboardShotImagePayload(projectId: string, shotId: string): { body: Buffer; mime: string } | null {
    const d = getDb();
    const row = d
      .prepare("SELECT image_blob, image_mime FROM storyboard_shots WHERE project_id = ? AND shot_id = ?")
      .get(projectId, shotId) as { image_blob: Buffer | Uint8Array | null; image_mime: string | null } | undefined;
    if (!row) return null;
    const raw = row.image_blob;
    if (raw == null) return null;
    const size = Buffer.isBuffer(raw) ? raw.length : raw.byteLength;
    if (!size) return null;
    const body: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const mime = (row.image_mime && String(row.image_mime).trim()) || "application/octet-stream";
    return { body, mime };
  },
};
