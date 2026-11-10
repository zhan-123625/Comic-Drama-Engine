import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PersonalCenter from "./PersonalCenter.vue";
import { normalizeProject } from "../projectUtils";
import type { Project } from "../types";
const project = (id: string, name: string) =>
  normalizeProject({ id, name, pipelineStatus: "idle", storyboards: [], videoJobs: [] } as unknown as Project);
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
describe("personal center", () => {
  it("counts successful video jobs, excludes images and failures, deduplicates URLs, filters and opens projects", async () => {
    const p1 = project("a", "零号回声");
    const p2 = project("b", "月光旅人");
    p1.videoJobs = [
      { id: "v1", status: "done", resultUrl: "/a.mp4", message: "" },
      { id: "duplicate", status: "done", resultUrl: "/a.mp4", message: "" },
      { id: "image", kind: "image", status: "done", resultUrl: "/a.png", message: "" },
      { id: "failed", status: "failed", resultUrl: "/bad.mp4", message: "" },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ items: [{ projectId: "b", name: "合成作品", url: "/merged.mp4" }] }),
        }),
    );
    const w = mount(PersonalCenter, {
      props: { projects: [p1, p2], projectsLoadError: null },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.findAll(".portfolio-stats dd").map((x) => x.text())).toEqual(["2", "2", "0"]);
    await w.findAll(".portfolio-tabs button")[1]!.trigger("click");
    expect(w.findAll(".portfolio-video")).toHaveLength(2);
    await w.find("select").setValue("b");
    expect(w.findAll(".portfolio-video")).toHaveLength(1);
    await w.find(".portfolio-preview").trigger("click");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/merged.mp4");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.querySelector(".portfolio-player-mask")).toBeNull();
    await w.findAll(".portfolio-tabs button")[0]!.trigger("click");
    await w.find("input").setValue("月光");
    expect(w.findAll(".portfolio-project")).toHaveLength(1);
    await w.find(".portfolio-project").trigger("click");
    expect(w.emitted("open-project")).toEqual([["b"]]);
    w.unmount();
  });
  it("retains project access when export loading fails and supports retry and empty search", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }),
    );
    const w = mount(PersonalCenter, { props: { projects: [project("a", "零号回声")], projectsLoadError: null } });
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(true);
    expect(w.findAll(".portfolio-project")).toHaveLength(1);
    await w.find('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    await w.find("input").setValue("不存在");
    expect(w.text()).toContain("没有匹配的项目");
    w.unmount();
  });
});
