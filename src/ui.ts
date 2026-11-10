// ui.ts —— 通用 UI 工具：模态错误提示
// window.alert 在 Tauri WebView2 中不可靠（可能一闪而过、需逐帧截图才看清），
// 统一改用自定义模态（复用 close-confirm 的 modal 样式），错误信息持久显示直到用户点确定。
import { t } from "./i18n";

let bound = false;
function ensureBound() {
  if (bound) return;
  bound = true;
  document.getElementById("err-ok")!.addEventListener("click", () => {
    document.getElementById("error-modal")!.hidden = true;
  });
}

// 模态提示（错误/成功通用）：信息持久显示直到点「确定」
export function showModal(msg: string) {
  ensureBound();
  const modal = document.getElementById("error-modal")!;
  document.getElementById("err-msg")!.textContent = msg;
  modal.hidden = false;
}
// 语义别名（错误/信息场景）
export const showError = showModal;
export const showInfo = showModal;

// 初始化错误模态文案（随语言切换）
export function applyErrorModalText() {
  const ok = document.getElementById("err-ok");
  if (ok) ok.textContent = t("ok");
}
