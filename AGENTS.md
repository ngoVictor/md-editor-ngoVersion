# AGENTS.md — md-editor 维护约定

Windows 离线 Markdown 编辑器，Tauri 2 + Vditor 3.11 + TypeScript/Vite，无前端框架。当前版本字段为 0.1.0，包含 Claude Code 主题与 MD 图标。此文件只保存编码约束；产品、操作、详细模块和数值分别见 [doc/README.md](doc/README.md) 的现行指南。

## 工作范围

- `orginal_version/` 是固定原版参考，不参与构建，不改写。
- 文件删除/重命名、全盘索引、便携 Data、诊断包已取消；体积优化已完成，不把旧阶段建议当作新授权。
- 阶段报告和证据写到 `doc/资料/`，指南直接更新，不继续追加 rN 记录或兼容入口。

## 模块边界

| 职责 | 归属 |
| --- | --- |
| 文档类型/纯工具与唯一状态写入口 | state / document-store |
| 文件 IPC、编辑器同步和文档协调 | file-service / editor-sync / docs |
| 编辑器生命周期、模式/语言与主题 | vditor / i18n / theme / theme-appearance / theme-palette |
| 保存、内存撤销、磁盘历史与会话 | save / history / history-view / autosave / session / external-changes |
| 大纲、标签、滚动、标题与表格 | outline / tabs / scroll / heading / table |
| 查找匹配、可终止正则与替换协调 | find-engine / find-worker / find |
| 窗口拖动、事务转移与窗口上下文 | tab-drag / window-transfer / window-context；Rust windows |
| 链接解析、文档导航与分类资源导航 | link-target / link / document-navigation / resource-navigation |
| 独立只读源码预览 | source-preview / source-preview-view / source-preview-main / preview.html；Rust preview_windows / resources |
| 图片显示、AST 引用、迁移与导出资源 | editor-images / image-references / image-migration / export-assets / raster-image；Rust assets / local_path |
| 导出注册、快照及独立格式后端 | export / export-snapshot；Word、HTML、PDF、PNG、print 模块 |
| 只读目录与搜索 | navigation-view / directory-search / recent-files；Rust navigation |
| 初始化、通用提示、开发诊断 | main / ui / debug |

依赖保持单向。vditor 只分发 input/after 注册钩子，不反向依赖业务；save/outline 通过 docs 注入刷新回调，不反向 import。theme-appearance 只协调偏好与 DOM，预览共享它，不依赖文档或编辑器业务。

## 文档与文件安全

1. S.docs、S.activeId、身份、revision、dirty 和磁盘基线只能经 document-store 修改。file-service 集中文件 IPC；autosave 只发保存请求，image-migration 不写状态。
2. 编辑器同步统一经过 editor-sync 的 mountDocument/applyDocumentEdit/syncDocFromEditor。主动 input 允许清空；被动快照有空读守卫。setValue 用 withSuppressInput 包裹，try/finally 复位。
3. 挂载保留渲染基线，未编辑正文不能被 Vditor 规范化改写；延迟同步绑定 docId/挂载代次。IME 合成和重建期间拒绝不安全切换、保存和导出。查找/表格/大纲/历史不得绕过 store 写正文。
4. 换行修改使用 splitLines/joinLines，保留 CRLF/LF；HTML 插值用 esc，导出 HTML 走净化流程。
5. 打开探测 UTF-8 BOM/UTF-8/GBK；稳定指纹快照后才提交。保存统一 UTF-8 无 BOM，空白覆盖需显式确认；Rust expected fingerprint compare-and-save 最终检查，用户确认后才可 force。
6. dirty 文档重复打开只激活并保留草稿/基线；clean 文档正文和基线一起替换。路径去重用 Rust pathKey，冲突用内容 fingerprint，不退回字符串或 mtime/size。
7. 保存按文档串行，旧 revision 返回不能清除新编辑的 dirty。Save As 候选身份仅在成功后提交；关闭循环保存至当前 revision 落盘。
8. history.rs 在覆盖前归档原始字节，失败阻止覆盖；历史恢复先形成可撤销修改并暂停自动保存，用户显式保存后才写盘。内存撤销与磁盘归档分开。
9. session 只存有路径标签，不存正文；按需读取与异步导航结果必须核对文档、revision、激活/挂载代次和编辑器实例。外改仅轮询激活文档，保存仍做 Rust 最终检查。
10. 图片 srcset 只用于显示，不泄漏进 Markdown；insertValue 图片 URL 不用尖括号包裹。AST 位置改写，保存事务核对 revision 后提交，另存为同时重定位撤销记录的图片基址。内容寻址资源不得覆盖不同内容，未命名资源不自动清理。

## 编辑器与窗口

- Vditor 3.11 切模式/语言只能 destroy 后重建；switchInFlight 锁及兜底保持单实例。主题切换不重建，不修改正文、dirty、基线或撤销。
- Windows HTML5 DnD 与 dragDropEnabled 冲突：大纲与标签用 Pointer Events，文件拖放用 Tauri onDragDropEvent。表格浮层重建后用 selectionchange 控制；宽表保持 display:block、max-width:100%、overflow-x:auto。
- link.isOpen=false。link 在捕获阶段统一处理，heading 共用 slug；外链仅 http/https/mailto/tel，经 opener IPC 和 opener:default capability。本地导航由 main 注入，不用 WebView URL 当文件基址。
- Windows 本地资源每次在 Rust 规范化并分类；拒绝 UNC、设备、ADS、可执行文件和快捷方式。Markdown 编辑扩展名与只读源码/默认应用的资源白名单分开，脚本只能查看。
- find-engine 是纯匹配，find-worker 可终止正则，find 必须核对 docId/revision 后一次提交。Vditor 原生复制需 capture 覆写，列表 CSS 计数器用 bakeListNumbers 烧入。
- tab-drag 只处理事件和回调；window-transfer 两阶段冻结/快照/确认/回退，Rust windows 管载荷/生命周期。接收成功前保留源标签，草稿、基线、撤销均转移；至少两个标签可拖出，无拖回合并、无批量关闭入口。
- window-context 区分拆分窗口，不覆盖主窗会话；普通双击文件只定向一个编辑器，禁止全局广播。预览/PDF/打印窗不接收 open-file，主窗关闭后其他窗口继续工作。
- preview.html/source-preview-main 是独立入口，不启动 main、Vditor、session、autosave，不改回 showModal。预览独立多开、无 owner/置顶，能力隔离；只剩预览时双击文档创建 main。Vite 构建 index 和 preview 两入口。
- preferences 写前合并最新值并响应跨窗口 storage 更新，避免覆盖其他窗口设置。五套主题和 H1–H6 使用共享色板，编辑器与预览一致，正文/标题对背景对比度保持至少 4.5:1。

## 离线资源与导出

- Vditor i18n 为本地 ESM，cdn 使用 /vditor-assets；构造与 setTheme 使用本地 content-theme，满足 script-src 'self'。copy-vditor-assets.mjs 是资源清单和生成器，清理前校验路径/重定向；生成目录禁止用户资源。保留运行时 js/css/images/method.min.js，KaTeX WOFF2 与 CSS 配对。
- export 统一格式注册/UI 忙碌状态；各后端只协调自身流程，不控制工具栏。所有导出用 export-snapshot 捕获正文/HTML/sourcePath 和输入门禁，不在 await 后读 activeDoc，不修改 dirty/身份。
- 所有格式先经 export-assets/raster-image；模板 inert，不下载远程资源，先检查尺寸/签名再解码，失败保留说明并提示。图片缓存只限本次导出；Word 用兼容 PNG 静态画面。限制集中见能力边界指南。
- docx-tokens 无 IPC，export-docx-token 管新 Word 流程；export-docx/docx 保留兼容后端。两者保持 A4 可用宽度 8306 twips、显式边框/tblGrid/tcW、中文字体、编号与脚注。兼容后端的 OOXML spacing/底纹/字体后处理不可用 HTML 空段替代；Blob 用 arrayBuffer 读取。
- PDF 复用净化 HTML，Rust pdf 管门禁/互斥/原子提交，pdf_webview 管隐藏 WebView2 PrintToPdf/超时/清理。禁止脚本、临时输入之外导航及编辑器 capability，不恢复外部 Edge exe 方案。
- export-specials 只渲染捕获源码，PNG/打印共享净化快照。output 的 print-* 窗口隔离；打开系统打印界面不能宣称实体作业完成。
- Vite crypto 别名只适配 html-to-docx 的 randomFillSync，并非完整 Node crypto。升级导出依赖需复测图片关系和浏览器构建。
- Cargo release 使用 opt-level=s、LTO、单 codegen unit、strip，保留 panic unwind；改资源或 release 配置必须实测正式 exe。打包用 tauri build --no-bundle，不能用普通 cargo release 替代。

## 检查入口

```powershell
node scripts/copy-vditor-assets.mjs
node node_modules/typescript/bin/tsc
node --test scripts/vditor-assets.test.mjs
node node_modules/vite/bin/vite.js build
node node_modules/@playwright/test/cli.js test
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
```

源码变化后重启自己的 Vite 再跑浏览器测试，避免 HMR 模块重复。环境、Clippy/rustfmt、原生脚本及发布手工项见[构建指南](doc/构建exe全流程.md)。依赖/构建/测试缓存可再生成；保留锁文件、离线资源生成器、现行回归和最新稳定 exe。应用标识 com.alei.md-editor.integration，不迁移原版本数据。
