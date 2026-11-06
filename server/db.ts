import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, renameSync } from "fs";
import type { Project } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, "..", "data");
const dbFile = path.join(dataDir, "app.db");

let db: DatabaseSync | null = null;

export type AppDb = DatabaseSync;

export function getDb(): AppDb {
  if (!db) throw new Error("数据库未初始化，请先调用 initDb()");
  return db;
}

/** 同步事务：失败回滚 */
export function runTransaction(d: AppDb, fn: () => void): void {
  d.exec("BEGIN IMMEDIATE");
  try {
    fn();
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function dataUrlToBuf(dataUrl: string): { buf: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  return { buf: Buffer.from(m[2]!, "base64"), mime: m[1]! };
}

function migrateLegacyConfig(d: AppDb) {
  const cfgPath = path.join(dataDir, "config.json");
  const row = d.prepare("SELECT config_json FROM app_settings WHERE id = 1").get() as { config_json: string };
  if (row.config_json && row.config_json !== "{}" && row.config_json.trim() !== "") return;
  if (!existsSync(cfgPath)) return;
  const raw = readFileSync(cfgPath, "utf-8");
  d.prepare("UPDATE app_settings SET config_json = ? WHERE id = 1").run(raw);
  try {
    renameSync(cfgPath, `${cfgPath}.migrated.bak`);
  } catch {
    /* ignore */
  }
}

function migrateLegacyProjects(d: AppDb) {
  const projectsPath = path.join(dataDir, "projects.json");
  const cnt = d.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number };
  if (cnt.c > 0 || !existsSync(projectsPath)) return;
  let data: { projects?: Project[] };
  try {
    data = JSON.parse(readFileSync(projectsPath, "utf-8")) as { projects?: Project[] };
  } catch {
    return;
  }
  const projects = data.projects ?? [];
  if (projects.length === 0) return;

  const insP = d.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at, source_text, outline, script, pipeline_status, pipeline_error, pipeline_log_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insS = d.prepare(`
    INSERT INTO storyboard_shots (shot_id, project_id, sort_index, prompt, note, remote_image_url, image_mime, image_blob)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insJ = d.prepare(`
    INSERT INTO video_jobs (job_id, project_id, sort_order, status, message, shot_index, prompt, hook_image_url, result_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  runTransaction(d, () => {
    for (const p of projects) {
      insP.run(
        p.id,
        p.name,
        p.createdAt,
        p.updatedAt,
        p.sourceText,
        p.outline,
        p.script,
        p.pipelineStatus,
        p.pipelineError ?? null,
        JSON.stringify(p.pipelineLog ?? []),
      );
      for (const s of p.storyboards) {
        let image_blob: Buffer | null = null;
        let image_mime: string | null = null;
        let remote_image_url: string | null = null;
        if (s.imageUrl?.startsWith("data:")) {
          const dec = dataUrlToBuf(s.imageUrl);
          if (dec) {
            image_blob = dec.buf;
            image_mime = dec.mime;
          }
        } else if (s.imageUrl?.startsWith("http://") || s.imageUrl?.startsWith("https://")) {
          remote_image_url = s.imageUrl;
        }
        insS.run(s.id, p.id, s.index, s.prompt, s.note, remote_image_url, image_mime, image_blob);
      }
      let order = 0;
      for (const j of p.videoJobs) {
        insJ.run(
          j.id,
          p.id,
          order++,
          j.status,
          j.message,
          j.shotIndex ?? null,
          j.prompt ?? null,
          j.imageUrl ?? null,
          j.resultUrl ?? null,
        );
      }
    }
  });

  try {
    renameSync(projectsPath, `${projectsPath}.migrated.bak`);
  } catch {
    /* ignore */
  }
}

/** 验证表名白名单，防止 SQL 注入 */
function validateTableName(table: string): void {
  const ALLOWED_TABLES = ["projects", "storyboard_shots", "assets", "video_jobs", "app_settings"];
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

/** 验证列定义格式，基本的注入检查 */
function validateColumnDefinition(ddl: string): void {
  // 检查是否包含危险的 SQL 关键字
  const dangerousPatterns = /(\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b|;|--|\/\*|\*\/)/i;
  if (dangerousPatterns.test(ddl)) {
    throw new Error(`Invalid column definition: contains dangerous SQL keywords`);
  }
  // 基本格式检查：列名 类型 [约束]
  if (!ddl.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s+\w+/)) {
    throw new Error(`Invalid column definition format`);
  }
}

function tableColumnNames(d: AppDb, table: string): Set<string> {
  validateTableName(table);
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(d: AppDb, table: string, ddl: string) {
  validateTableName(table);
  validateColumnDefinition(ddl);

  const name = ddl.trim().split(/\s+/)[0];
  if (!name) return;
  if (tableColumnNames(d, table).has(name)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** 旧库补列：画风、类型、视频比例、分镜图尺寸 */
export function migrateProjectColumns(d: AppDb) {
  addColumnIfMissing(d, "projects", "art_style TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "projects", "genre_type TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "projects", "video_aspect TEXT NOT NULL DEFAULT '16:9'");
  addColumnIfMissing(d, "projects", "storyboard_image_size TEXT NOT NULL DEFAULT '1024x1024'");
  addColumnIfMissing(d, "projects", "assets_json TEXT NOT NULL DEFAULT '[]'");
}

/** 旧库补列：分镜结构化字段（兼容旧 prompt/note） */
export function migrateStoryboardColumns(d: AppDb) {
  addColumnIfMissing(d, "storyboard_shots", "shot_no TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "shot_size TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "camera TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "content TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "dialogue TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "music TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "sfx TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, "storyboard_shots", "duration_sec REAL");
  /** 对应剧本场次表「场次」列（正整数）；多镜可同属一场 */
  addColumnIfMissing(d, "storyboard_shots", "scene_no INTEGER");
  /** 自定义视频生成提示词（空则服务端用分镜字段自动拼接） */
  addColumnIfMissing(d, "storyboard_shots", "video_prompt TEXT NOT NULL DEFAULT ''");
  /** 自定义分镜生图基底（空则服务端用 content/景别等自动拼接纯画面描述） */
  addColumnIfMissing(d, "storyboard_shots", "image_prompt TEXT NOT NULL DEFAULT ''");
  /** 视频侧手动附加资产 ID 列表 JSON 数组 */
  addColumnIfMissing(d, "storyboard_shots", "video_extra_asset_ids_json TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(d, "storyboard_shots", "video_excluded_asset_ids_json TEXT NOT NULL DEFAULT '[]'");
  /** 生图接口返回的 HTTPS 直链（视频 Hook 优先拉取；无则依赖 MY_APP_PUBLIC_URL + 本地路径） */
  addColumnIfMissing(d, "storyboard_shots", "image_gen_source_url TEXT");
  /** 分镜页选择的图模 / 视频模、视频模式与尾帧/全能参考 URL（与 PUT project storyboards 一致，避免生成视频后刷新丢失） */
  addColumnIfMissing(d, "storyboard_shots", "image_model_id TEXT");
  addColumnIfMissing(d, "storyboard_shots", "video_model_id TEXT");
  addColumnIfMissing(d, "storyboard_shots", "video_run_mode TEXT");
  addColumnIfMissing(d, "storyboard_shots", "last_frame_image_url TEXT");
  addColumnIfMissing(d, "storyboard_shots", "last_frame_remote_url TEXT");
  addColumnIfMissing(d, "storyboard_shots", "video_ref_audio_url TEXT");
  addColumnIfMissing(d, "storyboard_shots", "video_ref_video_url TEXT");
  addColumnIfMissing(d, "storyboard_shots", "tts_voice TEXT");
  addColumnIfMissing(d, "storyboard_shots", "tts_speaker TEXT");
}

/** 旧库补列：任务类型（video/image）、模型调用快照 JSON */
export function migrateVideoJobColumns(d: AppDb) {
  addColumnIfMissing(d, "video_jobs", "kind TEXT NOT NULL DEFAULT 'video'");
  addColumnIfMissing(d, "video_jobs", "model_request_json TEXT");
}

export function initDb(): AppDb {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO app_settings (id, config_json) VALUES (1, '{}');

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_text TEXT NOT NULL DEFAULT '',
      outline TEXT NOT NULL DEFAULT '',
      script TEXT NOT NULL DEFAULT '',
      pipeline_status TEXT NOT NULL DEFAULT 'idle',
      pipeline_error TEXT,
      pipeline_log_json TEXT NOT NULL DEFAULT '[]',
      assets_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS storyboard_shots (
      shot_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sort_index INTEGER NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      remote_image_url TEXT,
      image_mime TEXT,
      image_blob BLOB,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shots_project ON storyboard_shots(project_id, sort_index);

    CREATE TABLE IF NOT EXISTS video_jobs (
      job_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      shot_index INTEGER,
      prompt TEXT,
      hook_image_url TEXT,
      result_url TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_project ON video_jobs(project_id, sort_order);
  `);

  migrateProjectColumns(db);
  migrateStoryboardColumns(db);
  migrateVideoJobColumns(db);
  migrateLegacyConfig(db);
  migrateLegacyProjects(db);
  return db;
}
