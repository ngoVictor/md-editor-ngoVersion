# md-editor-ngoVersion

**本地写作，清晰表达。**

[使用指南](doc/使用指南.md) · [能力边界](doc/能力边界与限制.md) · [反馈问题](https://github.com/ngoVictor/md-editor-ngoVersion/issues)

![Claude Code 主题中的实际编辑界面](doc/screenshots/editor-claude.png)

本项目是 [frandy820/md-editor](https://github.com/frandy820/md-editor) 的个人维护与修改版本，由 [ngoVictor](https://github.com/ngoVictor) 发布。感谢原作者提供开源基础，以及 Tauri、Vditor 和相关开源依赖。原项目版权声明与 MIT 许可证完整保留；本版独立维护，功能与发布节奏以此仓库为准。

面向 Windows 的离线 Markdown 桌面编辑器，使用 Tauri 2、Vditor 3.11 和 TypeScript/Vite。包含五套主题与 MD 图标，版本字段为 0.1.0。

## 使用与功能

运行程序 `md-editor.exe` 需要 Windows WebView2 Runtime。源码仓库不包含 exe，可按下方步骤构建。程序无需安装，用户数据保存在应用本地数据目录。本次产物校验值和验证范围见[交付记录](doc/资料/维护/MD图标与Claude主题交付-20261110/交付说明.md)。

- WYSIWYG、语法编辑、分屏预览三种模式；简体中文、繁体中文、English。
- 可视化表格、大纲、多标签页、标签拖出独立窗口、每文档撤销与查找替换。
- 安全保存、外部修改提醒、保存前历史归档；自动保存与恢复文件标签可选，默认关闭。
- 本地图片插入/粘贴与另存为迁移；公式和 Mermaid 离线渲染。
- Word 新/兼容后端、HTML 带样式/纯净、PDF、PNG，以及系统打印入口。
- 本地文档与锚点导航、独立源码预览、最近文件、只读目录浏览及有界搜索。
- 浅色、深色、护眼绿、暖纸、Claude Code 主题和跟随系统，六级标题独立配色。

完整操作见[使用指南](doc/使用指南.md)，输入和输出限制见[能力边界](doc/能力边界与限制.md)。文件删除/重命名、全盘索引、便携 Data 设置、诊断包已取消。

## 边写边看

分屏预览将 Markdown 源码与排版结果放在同一个窗口，适合检查语法、链接与文档结构。

![分屏预览模式](doc/screenshots/editor-split.png)

五套主题覆盖不同阅读习惯。首图为 Claude Code 主题，下图为暖纸主题；切换主题不修改正文。

![暖纸主题](doc/screenshots/editor-paper.png)

截图来自正式 Windows exe 的 WebView2 界面，使用[公开演示文档](doc/screenshots/demo.md)，不含个人笔记。

## 开始使用

本版二进制附件发布后会放在[本仓库 Releases](https://github.com/ngoVictor/md-editor-ngoVersion/releases)，没有附件时请按下文构建。**上游 Releases 的程序不代表本版功能。** 缺少 WebView2 Runtime 的电脑需要先安装运行时。

1. 双击 exe，点击“打开”，或将 Markdown 文件拖入窗口。
2. 默认使用“排版成品”，可直接编辑文字与表格。顶部下拉框或 `Ctrl+Alt+M` 切换模式。
3. `Ctrl+S` 保存，`Ctrl+Shift+S` 另存为；选择辅助栏的格式后点击“导出”，生成其他格式。

| 常用操作 | 入口 |
| --- | --- |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` 或 `Ctrl+Shift+Z` |
| 查找 / 替换 | `Ctrl+F` / `Ctrl+H` |
| 快速打开 / 命令 | `Ctrl+P` / `Ctrl+Shift+P` |
| 表格增删与对齐 | 排版成品模式中点击表格，使用浮层工具栏 |
| 拆分窗口 | 至少两个标签时，将其中一个标签拖出窗口 |

自动保存与恢复文件标签默认关闭。恢复标签只记住已保存文件的路径，不备份未保存草稿；历史恢复先生成未保存修改，确认后再手动保存。偏好与历史存于本机应用数据目录，不会跟随 exe 移动。

编辑与本地渲染无需网络、无需登录。Markdown 中的在线图片仍需网络；远程图片及任意 SVG/BMP 不作为本地资源自动嵌入导出。Word 中的公式与图表为静态画面。其他限制见[能力边界](doc/能力边界与限制.md)。

## 开发与构建

需要 Node.js/npm（CI 使用 Node 20）、Rust stable MSVC、Visual Studio C++ 构建工具、Windows SDK 和 WebView2。在项目根运行：

```powershell
git clone https://github.com/ngoVictor/md-editor-ngoVersion.git
cd md-editor-ngoVersion
npm.cmd ci
node scripts/copy-vditor-assets.mjs
node node_modules/@tauri-apps/cli/tauri.js dev
```

打包便携 exe：

```powershell
node node_modules/@tauri-apps/cli/tauri.js build --no-bundle
```

构建产物为 `src-tauri/target/release/md-editor.exe`。target/dist 和测试缓存可以再生成；不影响留存稳定 exe 的离线运行。资源必须由生成脚本准备，不能整目录复制 Vditor。本机根目录留存 exe 不随源码修改更新，也不纳入 Git；GitHub 发布时将已验证的 exe 作为 Release 附件上传。

类型检查、浏览器/Rust 测试、原生验证和 MSVC 环境说明集中在[构建指南](doc/构建exe全流程.md)。维护代码先读 [AGENTS.md](AGENTS.md) 和[架构指南](doc/架构与维护指南.md)。

## 项目目录

| 位置 | 用途 |
| --- | --- |
| src/、src-tauri/ | 前端与 Rust 后端源码、能力配置、图标及依赖锁文件 |
| public/vditor-assets/ | 可生成的离线资源；本机保留供直接开发使用 |
| tests/、scripts/ | 现行自动化回归、资源生成与发布验证 |
| [doc/](doc/README.md) | 现行指南；doc/资料/ 仅保留最新交付证据、正式设计源图及清理记录 |
| orginal_version/ | 本机固定原版参考，Git 忽略，不随仓库发布，不修改 |

MD Editor is an offline Windows Markdown editor with three editing modes, safe local saving, multiple windows, image support, themes, and Word/HTML/PDF/PNG export. See the [documentation index](doc/README.md).

## License

沿用 [MIT License](LICENSE)，保留 `Copyright (c) 2026 frandy820`。本版修改与维护由 ngoVictor 发布，原作者不对本版改动承担维护责任。

第三方依赖、内置字体及渲染资源遵循各自的许可证；本项目的 MIT 声明不替代它们的许可。`package.json` 中的 `private: true` 仅防止误发布到 npm，不影响 GitHub 开源。

欢迎通过 [Issues](https://github.com/ngoVictor/md-editor-ngoVersion/issues) 反馈问题，请附 Windows/WebView2 版本、复现步骤与可公开的最小 Markdown 样例；截图请隐去个人内容。
