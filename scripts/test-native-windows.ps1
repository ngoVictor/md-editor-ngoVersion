param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editor processes before running isolated native tests.' }
$evidenceDirectory = if ($env:MD_EDITOR_TEST_EVIDENCE_DIR) { $env:MD_EDITOR_TEST_EVIDENCE_DIR } else { 'test-results/native-evidence/windows' }
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$fixtureRoot = Join-Path $PWD ('test-results/native-window-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'native-table.md'), "# Native table`n`nalpha`n`n| 项目 | 内容 |`n| --- | --- |`n| 自动保存暂停 | $(('不循环' * 100)) |`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'forwarded.md'), '# Forwarded', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'remaining.md'), '# Remaining', [Text.UTF8Encoding]::new($false))
$portLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portLease.Start()
$testCdpPort = $portLease.LocalEndpoint.Port
$portLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$testCdpPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$testCdpPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testExecutable = (Resolve-Path -LiteralPath (Join-Path $PWD 'src-tauri/target/release/md-editor.exe')).Path
$testProcess = Start-Process -FilePath $testExecutable -ArgumentList ('"' + (Join-Path $fixtureRoot 'native-table.md') + '"') -WindowStyle Hidden -PassThru
@{pid=$testProcess.Id;root=$fixtureRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'native-run.json')
try {
  Start-Sleep -Seconds 2
  node scripts/native-window-smoke.mjs $fixtureRoot
  if ($LASTEXITCODE -ne 0) { throw 'Native window verification failed.' }
} finally {
  $testRunning = Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue
  if ($testRunning) {
    if ($testRunning.Path -ne $testExecutable) { throw 'Test PID no longer belongs to the selected executable.' }
    & taskkill.exe /PID $testProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test process tree cleanup failed.' }
  }
}
