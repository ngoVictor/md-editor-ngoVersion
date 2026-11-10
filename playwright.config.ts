// Playwright 冒烟测试配置：复用 vite dev server（Tauri 专属能力如文件 IO 无法在纯浏览器测，
// 编辑器核心交互（模式/大纲/复制/代码块/语言）均可测）
import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:1420";
const serverURL = new URL(baseURL);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/playwright", // keep native WebView profiles outside Playwright cleanup
  timeout: 30000,
  fullyParallel: false, // 串行：共享 dev server 且避免剪贴板互相干扰
  workers: 1,
  use: {
    baseURL,
    permissions: ["clipboard-read", "clipboard-write"], // 复制测试需要
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host ${serverURL.hostname} --port ${serverURL.port || (serverURL.protocol === "https:" ? "443" : "80")}`,
    url: baseURL,
    reuseExistingServer: true, // tauri dev / 手动起服务时复用
    timeout: 30000,
  },
});
