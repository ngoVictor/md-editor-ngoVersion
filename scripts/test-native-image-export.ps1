$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native tests.' }
$fixtureRoot = Join-Path $PWD ('test-results/native-images-' + [guid]::NewGuid().ToString('N'))
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
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testProcess = Start-Process -FilePath (Join-Path $PWD 'src-tauri/target/release/md-editor.exe') -ArgumentList ('"' + (Join-Path $fixtureRoot 'doc/index.md') + '"') -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 2
  node scripts/native-image-export.mjs $fixtureRoot $testProcess.Id
  if ($LASTEXITCODE -ne 0) { throw 'Native navigation/export verification failed.' }
} finally {
  if (Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $testProcess.Id }
}
