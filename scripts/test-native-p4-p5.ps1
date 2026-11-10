param([string]$Executable = 'src-tauri/target/release/md-editor.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$testExecutable = (Resolve-Path -LiteralPath $Executable).Path
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native tests.' }
$fixtureRoot = Join-Path $PWD ('test-results/native-p4p5-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'doc') | Out-Null
$index = "# 文档索引`n`n[根 README](../README.md#目标标题)`n"
$target = "# 统一导出与链接验证`n`n[返回索引](./doc/index.md)`n`n| 维度 | 结果 | 证据 |`n| --- | --- | --- |`n| 跨文件跳转 | 通过 | 中文文档链接在编辑器内打开 |`n| 表格分割线 | 通过 | Word 与 PDF 保留横向和纵向边框 |`n| 快照保护 | 通过 | 导出使用点击时捕获的内容 |`n`n## 代码与排版`n`n``````ts`nconst message = 'Hello, 世界';`n  console.log(message);`n```````n`n" + (("填充段落用于验证跨文件定位、中文字体与多页输出。`n`n") * 35) + "## 目标标题`n`n目标内容。`n`n" + (("结尾内容用于留出滚动位置。`n`n") * 20)
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'doc/index.md'), $index, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'README.md'), $target + "`n`n[源码](./main.ts:1094:3)`n`n[PDF 链接](./test.pdf)`n`n[目录](./doc)`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'main.ts'), ((1..1500 | ForEach-Object { "// source line $_" }) -join "`r`n"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'script.ps1'), 'Write-Output DO_NOT_EXECUTE', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'test.pdf'), '%PDF-test-fixture', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'blocked.exe'), 'DO_NOT_EXECUTE', [Text.UTF8Encoding]::new($false))
node scripts/create-image-fixtures.mjs $fixtureRoot
if ($LASTEXITCODE -ne 0) { throw "Fixture generation failed." }
$fixtureFile = Join-Path $fixtureRoot 'README.md'
$fixtureText = [IO.File]::ReadAllText($fixtureFile)
$fixtureText += "`n`n## P4 综合样例`n`n正文脚注[^note]。`n`n3. 外层三`n   1. 内层一`n   2. 内层二`n4. 外层四`n`n" + '$x^2+y^2=z^2$' + "`n`n``````mermaid`ngraph LR`n A[开始] --> B[完成]`n```````n`n[^note]: 脚注正文。`n"
[IO.File]::WriteAllText($fixtureFile, $fixtureText, [Text.UTF8Encoding]::new($false))

$portLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portLease.Start()
$testCdpPort = $portLease.LocalEndpoint.Port
$portLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$testCdpPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$testCdpPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testProcess = Start-Process -FilePath $testExecutable -ArgumentList ('"' + (Join-Path $fixtureRoot 'doc/index.md') + '"') -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 2
  node scripts/native-p4-p5.mjs $fixtureRoot $testProcess.Id
  if ($LASTEXITCODE -ne 0) { throw 'Native navigation/export verification failed.' }
} finally {
  $testRunning = Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue
  if ($testRunning) {
    if ($testRunning.Path -ne $testExecutable) { throw 'Test PID no longer belongs to the selected executable.' }
    & taskkill.exe /PID $testProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test process tree cleanup failed.' }
  }
}
