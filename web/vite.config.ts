import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  root: __dirname,
  resolve: {
    alias: {
      "@": path.join(__dirname, "src"),
    },
  },
  base: '/mj/',
  server: {
    port: 5177,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3710",
        changeOrigin: true,
        /** SSE / 长连接：避免默认超时断开；部分环境下可减轻缓冲 */
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
