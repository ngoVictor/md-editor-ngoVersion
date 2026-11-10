param([string]$Executable = 'src-tauri/target/release/md-editor.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$testExecutable = (Resolve-Path -LiteralPath $Executable).Path
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native tests.' }
$fixtureRoot = Join-Path $PWD ('test-results/native-themes-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$fixture = "# 一级标题 · Heading 1`n`n正文与行内代码。`n`n## 二级标题 · Heading 2`n`n### 三级标题 · Heading 3`n`n#### 四级标题 · Heading 4`n`n##### 五级标题 · Heading 5`n`n###### 六级标题 · Heading 6`n`n> 引用：柔和底色与清晰文字。`n`n| 项目 | 内容 |`n| --- | --- |`n| 表格 | 中文 English 123 |`n"
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'theme.md'), $fixture, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'sample.ts'), "// source preview`r`nconst value = 42;", [Text.UTF8Encoding]::new($false))
$portLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portLease.Start()
$testCdpPort = $portLease.LocalEndpoint.Port
$portLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$testCdpPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$testCdpPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testProcess = Start-Process -FilePath $testExecutable -ArgumentList ('"' + (Join-Path $fixtureRoot 'theme.md') + '"') -WindowStyle Hidden -PassThru
try {
  node scripts/native-themes.mjs $fixtureRoot
  if ($LASTEXITCODE -ne 0) { throw 'Native theme verification failed.' }
} finally {
  $testRunning = Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue
  if ($testRunning) {
    if ($testRunning.Path -ne $testExecutable) { throw 'Test PID no longer belongs to the selected executable.' }
    & taskkill.exe /PID $testProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test process tree cleanup failed.' }
  }
}
