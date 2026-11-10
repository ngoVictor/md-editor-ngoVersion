import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  resolve: { alias: { crypto: fileURLToPath(new URL("./src/docx-random.ts", import.meta.url)) } },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // html-to-docx 的依赖链（docx → xmlbuilder2 → @oozcitak/*）依赖多个 Node 内置模块
  // （events/buffer/stream 等）——浏览器无这些模块，用 polyfill 补齐（导出 Word 功能必需）
  plugins: [nodePolyfills({ include: ["events", "buffer", "stream", "util", "process"] })],
  define: {
    global: "globalThis",
  },
  // jszip 是 CommonJS 包（无 ESM 入口），强制预构建（docx 列宽后处理用）
  optimizeDeps: {
    include: ["jszip"],
  },
  build: {
    rollupOptions: { input: { main: "index.html", preview: "preview.html" } },
    // 主 chunk 约 1MB 是 Vditor 编辑器内核；html-to-docx（1.26MB）仅在导出 Word 时动态加载。
    // 本地桌面应用没有网络加载成本，调高阈值只消除无实际意义的告警噪音。
    chunkSizeWarningLimit: 1300,
  },
}));
