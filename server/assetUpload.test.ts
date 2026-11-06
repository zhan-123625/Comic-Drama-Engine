import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { initDb } from "./db.js";
import { createApp } from "./http/createApp.js";
import { store } from "./store.js";
import type { Project } from "./types.js";

describe("POST /api/projects/:id/assets/:assetId/upload", () => {
  const origToken = process.env.API_TOKEN;
  let testProject: Project;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    initDb();
    delete process.env.API_TOKEN; // allows dev-token
    testProject = await store.create({
      name: "Upload Test Project",
    });

    testProject.assets = [
      {
        id: "asset-upload-1",
        index: 1,
        name: "测试角色",
        type: "character",
        prompt: "一只可爱的小白兔",
      },
    ];
    await store.save(testProject);

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (origToken !== undefined) process.env.API_TOKEN = origToken;
    else delete process.env.API_TOKEN;
    if (testProject?.id) {
      await store.delete(testProject.id);
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("成功上传 base64 资产图片并更新 project 中的 imageUrl", async () => {
    // 1x1 transparent png in base64
    const png1x1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const res = await fetch(`${baseUrl}/api/projects/${testProject.id}/assets/asset-upload-1/upload`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dev-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataUrl: png1x1,
        filename: "rabbit.png",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.imageUrl).toContain(`/api/files/projects/${testProject.id}/assets/asset-upload-1.png`);

    const refreshed = await store.get(testProject.id);
    const updatedAsset = refreshed?.assets.find((a) => a.id === "asset-upload-1");
    expect(updatedAsset?.imageUrl).toContain(`/api/files/projects/${testProject.id}/assets/asset-upload-1.png`);
  });

  it("空数据返回 400", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${testProject.id}/assets/asset-upload-1/upload`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dev-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataUrl: "",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("资产不存在时返回 404", async () => {
    const png1x1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const res = await fetch(`${baseUrl}/api/projects/${testProject.id}/assets/non-existent-asset/upload`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer dev-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataUrl: png1x1,
      }),
    });

    expect(res.status).toBe(404);
  });
});
