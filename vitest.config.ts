import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    include: ["server/**/*.test.ts", "web/src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "web/src") },
  },
});
