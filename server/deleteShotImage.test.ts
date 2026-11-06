import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db.js";
import { deleteShotImageFiles, listShotImageFileUrlsFromDisk } from "./imagePersist.js";

describe("deleteShotImageFiles", () => {
  const testProjectId = "test-proj-delete-shot";
  const testShotId = "shot-del-12345678-abcd";
  const shotDir = path.join(dataDir, "files", "projects", testProjectId, "shots");

  beforeEach(async () => {
    await mkdir(shotDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(path.join(dataDir, "files", "projects", testProjectId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("deletes all shot images when targetUrl is not specified", async () => {
    const file1 = path.join(shotDir, `${testShotId}.png`);
    const file2 = path.join(shotDir, `${testShotId}-1730000000.png`);
    await writeFile(file1, "dummy-png-1");
    await writeFile(file2, "dummy-png-2");

    const before = await listShotImageFileUrlsFromDisk(testProjectId, testShotId);
    expect(before.length).toBe(2);

    const { deletedFiles, remainingUrls } = await deleteShotImageFiles(testProjectId, testShotId);
    expect(deletedFiles.length).toBe(2);
    expect(remainingUrls.length).toBe(0);

    const after = await listShotImageFileUrlsFromDisk(testProjectId, testShotId);
    expect(after.length).toBe(0);
  });

  it("deletes only the specified targetUrl when provided", async () => {
    const file1 = path.join(shotDir, `${testShotId}.png`);
    const file2 = path.join(shotDir, `${testShotId}-1730000000.png`);
    await writeFile(file1, "dummy-png-1");
    await writeFile(file2, "dummy-png-2");

    const targetUrl = `/api/files/projects/${testProjectId}/shots/${testShotId}-1730000000.png`;
    const { deletedFiles, remainingUrls } = await deleteShotImageFiles(testProjectId, testShotId, targetUrl);

    expect(deletedFiles).toEqual([`${testShotId}-1730000000.png`]);
    expect(remainingUrls.length).toBe(1);
    expect(remainingUrls[0]).toContain(`${testShotId}.png`);
  });
});
