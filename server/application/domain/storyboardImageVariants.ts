/** 分镜图：当前库里的 imageUrl 优先，再合并磁盘上主文件与历史归档（去重） */
export function mergeStoryboardImageVariantUrls(preferred: string | undefined, diskUrls: string[]): string[] {
  const norm = (u: string) => u.trim().split("?")[0];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string) => {
    const t = u.trim();
    if (!t) return;
    const n = norm(t);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(t);
  };
  if (preferred?.trim()) push(preferred);
  for (const u of diskUrls) push(u);
  return out;
}
