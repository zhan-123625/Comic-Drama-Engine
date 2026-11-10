// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPortfolioExports } from "./portfolio.js";
let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("portfolio exports", () => {
  it("finds only completed merged videos for existing projects, including historical exports", async () => {
    root = await mkdtemp(path.join(tmpdir(), "comic-portfolio-"));
    for (const id of ["p1", "deleted"]) await mkdir(path.join(root, id, "exports"), { recursive: true });
    const dir = path.join(root, "p1", "exports");
    await writeFile(path.join(dir, "merged_123.mp4"), "video");
    await writeFile(path.join(dir, "merged_124.mp4"), "");
    await writeFile(path.join(dir, "list_123.txt"), "temporary");
    await writeFile(path.join(dir, "unrelated.mp4"), "unrelated");
    await writeFile(path.join(root, "deleted", "exports", "merged_999.mp4"), "old video");
    const rows = await listPortfolioExports([{ id: "p1" }, { id: "missing" }, { id: "../../escape" }], root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: "p1", url: "/api/files/projects/p1/exports/merged_123.mp4" });
    expect(Date.parse(rows[0]!.createdAt)).not.toBeNaN();
  });
});
