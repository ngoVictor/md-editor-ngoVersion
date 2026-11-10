# 构建 md-editor.exe 全流程

目标是 Windows 便携 `src-tauri/target/release/md-editor.exe`；本文件集中维护开发、测试、构建和发布步骤。既有发布记录见[最新交付记录](资料/维护/MD图标与Claude主题交付-20261110/交付说明.md)。

## 1. 环境与依赖

需要 Node.js/npm、Rust stable MSVC 工具链、Visual Studio C++ 桌面工作负载与 Windows SDK。应用运行需要 WebView2 Runtime；不要假定每台 Windows 都已安装。编译环境与单文件交付的运行环境是两回事。

仓库 CI 使用 Node 20 和 Rust stable。依赖版本以 package-lock.json/Cargo.lock 为准，Windows WebView2 相关 crate 固定在 Cargo.toml。

在项目根目录执行：

```powershell
node --version
npm.cmd --version
rustc --version
cargo --version
npm.cmd ci
```

优先用 `npm ci` 复现锁文件，不在普通重建中更新依赖。首次安装依赖/Chromium 可能联网；应用核心运行不需要联网。Rust、MSVC 或 WebView2 缺失需先安装对应环境；本指南不修改全局 npm、PATH 或系统服务。

## 2. 本地资源与开发

```powershell
node scripts/copy-vditor-assets.mjs
node node_modules/@tauri-apps/cli/tauri.js dev
```

Tauri 配置的 beforeDevCommand/beforeBuildCommand 分别调用 dev-server.cmd/build-frontend.cmd，都会先执行资源生成器。手工只启动 Vite 或干净环境只做前端构建时，先生成资源。

**只能使用资源生成脚本**。项目采用运行时清单，不能恢复整目录 Copy-Item，也不能按“500+ 文件”判断是否完整。public/vditor-assets/dist 是可再生成目录，禁止放用户资源；脚本校验输入、字体配对和路径后会重建它。完整性由资源清单测试验证。

项目路径含 `&` 时外层 npm 的 cmd 转义可能失败；本指南用 node 直调 CLI。两个 cmd 文件内部已有带引号路径保护。

## 3. 自动化检查

以下命令在项目根目录运行：

```powershell
node node_modules/typescript/bin/tsc
node scripts/check-docs.mjs
node scripts/copy-vditor-assets.mjs
node --test scripts/vditor-assets.test.mjs
node node_modules/vite/bin/vite.js build
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test --list
node node_modules/@playwright/test/cli.js test
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --lib --locked -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
git diff --check
```

`test --list` 只发现用例，不算执行通过。前端数量随源码变化，不复制到各指南；新发布以当次实际执行结果为准。Vite 必须产出 index.html 与 preview.html 两个入口。CI 执行依赖安装、文档链接与门禁核对、资源复制与单测、tsc、Vite、Playwright、锁定依赖的 Rust test/Clippy 和 rustfmt；Tauri release、原生及人工检查仍需单独执行，见 [ci.yml](../.github/workflows/ci.yml)。

源码热更新后先重启自己管理的 Vite，再跑测试，避免 HMR 的静态/动态 import 形成不同模块实例而使 fake 注入失效。Node 24 本机历史上出现 Playwright 回收 Vite 子进程不退出，优先独立启动后复用：

```powershell
# 终端 A；1420 可用时保持默认端口
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420

# 终端 B
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:1420'
node node_modules/@playwright/test/cli.js test
```

全量回归可使用 localhost 或 127.0.0.1；离线检查按实际 baseURL 的 origin 判断。通过 PLAYWRIGHT_BASE_URL 指定自定义端口时，webServer 自动命令同步该主机/端口；独立启动服务也须与变量一致。无需改变 Tauri 正式 devUrl，测试完成只停止自己启动的服务。

## 4. 本机 MSVC 环境示例

使用 Visual Studio 的 Developer PowerShell 或 x64 Native Tools Command Prompt，在已初始化的 MSVC 环境中运行构建和 Rust 检查。自定义安装位置时使用对应的 `Common7/Tools/VsDevCmd.bat -arch=x64 -host_arch=x64`。找不到 link.exe/cl.exe 时检查 C++ 工作负载、Windows SDK 与 shell 初始化。

## 5. 正式便携构建与产物核验

```powershell
node node_modules/@tauri-apps/cli/tauri.js build --no-bundle
Get-Item -LiteralPath src-tauri/target/release/md-editor.exe | Select-Object Length, LastWriteTime
Get-FileHash -LiteralPath src-tauri/target/release/md-editor.exe -Algorithm SHA256
```

`--no-bundle` 跳过安装器，Tauri 自动执行前端生成/类型检查/打包并嵌入 Rust exe。不要用 `cargo build --release` 替代，它不负责该前端流程，可能生成指向开发服务器的程序。旧 exe 存在也不能证明本次打包成功。

release 配置 s/LTO/单 codegen unit/strip 且保留 panic unwind；改变它或资源清单时必须用正式 exe 复验离线资源、编辑、主题和输出。首次依赖重编会更慢，不使用固定编译秒数作为门禁。既有留存产物的大小/哈希见[最新交付记录](资料/维护/MD图标与Claude主题交付-20261110/交付说明.md)，新发布重新记录自己的产物。

应用图标源图为 `doc/资料/设计/markdown-icon-20261110/markdown-editor-md-v2.png`。使用 Tauri `icon` 命令生成桌面资源并更新 `src-tauri/icons`；`build.rs` 跟踪该目录，避免已有 target 缓存沿用旧 Windows 图标资源。正式构建后核对 exe 内嵌图标，不能只检查资源目录。

## 6. 原生验证入口及证据管理

当前全功能发布优先组合 P4/P5、主题和针对变更的窗口回归。脚本会检查现有编辑器进程，使用独立 WebView2 profile、测试 PID 和工作区夹具；运行前由使用者正常关闭现有编辑器，不批量杀用户进程。保存/目录对话框多被固定测试路径替换，不能把它们算作人工选择验证。

```powershell
# 两个脚本支持新证据目录；在项目根运行
$env:MD_EDITOR_TEST_EVIDENCE_DIR = 'doc/资料/维护/native-export-本次版本'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-p4-p5.ps1
$env:MD_EDITOR_TEST_EVIDENCE_DIR = 'doc/资料/维护/native-theme-本次版本'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-themes.ps1
Remove-Item Env:MD_EDITOR_TEST_EVIDENCE_DIR
```

| 入口 | 适用范围/注意事项 |
| --- | --- |
| [test-native-p4-p5.ps1](../scripts/test-native-p4-p5.ps1) | 当前双 Word、PNG/打印、图片/迁移、导航/搜索综合；支持证据目录变量，默认写 test-results/native-evidence/p4-p5 |
| [test-native-themes.ps1](../scripts/test-native-themes.ps1) | 当前五主题、三模式、独立预览与偏好；默认写 test-results/native-evidence/themes，支持证据目录变量 |
| [test-native-windows.ps1](../scripts/test-native-windows.ps1) | 表格与窗口转移专项；默认写 test-results/native-evidence/windows |
| [test-native-readme-html.ps1](../scripts/test-native-readme-html.ps1) | HTML 混排、在线徽章与三模式原文保存；固定样例随 tests/fixtures 提交 |
| [test-native-review.ps1](../scripts/test-native-review.ps1) | 当前标签输入、真实 pathKey/删除后链接复用、严格编码与最近文件专项；支持 -Executable，默认写 test-results/native-evidence/review |
| [test-native-preview-windows.ps1](../scripts/test-native-preview-windows.ps1) | 独立源码窗口专项；默认写 test-results/native-evidence/preview |
| [test-native-image-export.ps1](../scripts/test-native-image-export.ps1) | 本地图片与预览专项；默认写 test-results/native-evidence/images |
| [verify-word-p4-p5.ps1](../scripts/verify-word-p4-p5.ps1) | 默认读取 test-results/native-evidence/p4-p5；自定义输出用 -EvidenceDirectory 指定；无现存 Word 时创建专用只读实例，勿复用用户工作实例 |
| [benchmark-native-io.ps1](../scripts/benchmark-native-io.ps1) | 有界暖缓存 IPC 对照；默认写 test-results/native-evidence/io；不是全应用性能测试 |

P4/P5 与主题脚本支持 `-Executable <exe路径>`，默认检查本次构建的 target/release/md-editor.exe；清理后也可显式指定根目录稳定程序 md-editor.exe，不把旧产物当作新构建。现行原生脚本默认输出到 test-results/native-evidence，不再在 doc 根目录创建阶段文件夹；均可用 MD_EDITOR_TEST_EVIDENCE_DIR 指定新输出。只有确认需长期留存的证据才归入 doc/资料。Word 校验读取相同的新输出，使用其他目录时显式指定参数。

## 7. 人工发布检查

| 领域 | 最低检查 |
| --- | --- |
| 文件与保存 | 对话框选择/取消；UTF-8/BOM/GBK；拖放/关联/首个合法 CLI 参数；外改同长度、删除、清空、保存中编辑、另存为失败/占用、关闭取消 |
| 编辑与窗口 | 真实中文 IME；三模式/三语重建；撤销/查找/表格/大纲；真实鼠标拖出、失败回退、多显示器/DPI；主窗关闭后的拆分/预览存活 |
| 主题与离线 | 五主题/跟随系统、H1–H6、跨窗口偏好；关闭开发服务器并断网启动；本地语言、公式字体、图表、图片与 CSP |
| 导航 | 草稿目标/中文空格路径/跨文档锚点；行列定位；外部编辑器/默认应用/目录；非法协议、程序、脚本不误执行 |
| 输出 | 两套 Word 的编号/脚注/中文/代码/引用/表格/图片；HTML 独立阅读、PDF 分页、PNG 截断；打印界面与所需驱动，实体作业单独确认 |
| 发布信息 | commit、版本字段、exe 字节/SHA-256、自动化结果、人工覆盖范围；正式版无开发诊断入口 |

## 8. 常见故障

资源/字体缺失先用 npm ci 和生成脚本核对，不手工塞回旧资源。EPERM 先区分沙箱权限、ACL、文件占用与受控文件夹；只排查目标产物目录，必要时使用独立输出位置，不改业务代码掩盖环境问题。Rust 离线缺 crate 时先在允许的环境准备锁定依赖；不将下载失败当作产品测试失败。

dist、target、test-results 是可再生产物，清理不是普通构建的前置条件；本文不要求删除用户历史或图片草稿。正式运行、原生回归和浏览器测试的证据范围分别记录。

## 9. 项目清理后的恢复

Git 只维护源码、锁文件、现行回归与必要资源。node_modules、public/vditor-assets、dist、target、测试产物和本机 exe 均可从源码或发布产物恢复，不随仓库提交。干净克隆先执行 npm ci 与资源生成脚本，再运行开发或正式构建。原版参考目录 orginal_version 只在本机保留。

不重新构建、仅核验留存稳定版时：

```powershell
$env:MD_EDITOR_TEST_EVIDENCE_DIR = 'doc/资料/维护/本次版本/exports'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-p4-p5.ps1 -Executable .\md-editor.exe
$env:MD_EDITOR_TEST_EVIDENCE_DIR = 'doc/资料/维护/本次版本/themes'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-themes.ps1 -Executable .\md-editor.exe
Remove-Item Env:MD_EDITOR_TEST_EVIDENCE_DIR
```

发布前运行 `node scripts/check-docs.mjs` 检查现行文档链接与主要门禁数值；本次仓库整理见[清理记录](资料/维护/GitHub发布前清理.md)。
