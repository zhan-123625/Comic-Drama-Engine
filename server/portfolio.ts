import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db.js";

export async function listPortfolioExports(
  projects: { id: string }[],
  filesRoot = path.join(dataDir, "files", "projects"),
) {
  const items: { projectId: string; name: string; url: string; createdAt: string }[] = [];
  // Sequential reads bound filesystem concurrency even in a large project library.
  for (const p of projects) {
    const root = path.resolve(filesRoot);
    const dir = path.resolve(root, p.id, "exports");
    if (!dir.startsWith(root + path.sep)) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    for (const file of entries) {
      if (!file.isFile() || !/^merged_\d+\.mp4$/i.test(file.name)) continue;
      let info;
      try {
        info = await stat(path.join(dir, file.name));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      if (!info.size) continue;
      items.push({
        projectId: p.id,
        name: `合成作品 · ${new Date(info.mtimeMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        url: `/api/files/projects/${encodeURIComponent(p.id)}/exports/${encodeURIComponent(file.name)}`,
        createdAt: info.mtime.toISOString(),
      });
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
