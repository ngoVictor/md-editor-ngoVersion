param([string]$Executable = 'src-tauri/target/release/md-editor.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$reviewExecutable = (Resolve-Path -LiteralPath $Executable).Path
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native tests.' }
$reviewRoot = Join-Path $PWD ('test-results/native-review-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reviewRoot | Out-Null
[IO.File]::WriteAllText((Join-Path $reviewRoot 'target.md'), "# Target`n`noriginal`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $reviewRoot 'source.md'), "# Source`n`n[Draft target](./target.md)`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $reviewRoot 'bad.md'), [string]::Empty, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllBytes((Join-Path $reviewRoot 'bad.md'), [byte[]](0xef, 0xbb, 0xbf, 0xff))
$reviewLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$reviewLease.Start(); $reviewPort = $reviewLease.LocalEndpoint.Port; $reviewLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$reviewPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$reviewPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $reviewRoot 'webview-profile'
$reviewProcess = Start-Process -FilePath $reviewExecutable -ArgumentList ('"' + (Join-Path $reviewRoot 'target.md') + '"') -WindowStyle Hidden -PassThru
try {
  node scripts/native-review-regressions.mjs $reviewRoot $reviewExecutable
  if ($LASTEXITCODE -ne 0) { throw 'Native review regression failed.' }
} finally {
  $reviewRunning = Get-Process -Id $reviewProcess.Id -ErrorAction SilentlyContinue
  if ($reviewRunning) {
    if ($reviewRunning.Path -ne $reviewExecutable) { throw 'Test PID no longer belongs to the selected executable.' }
    & taskkill.exe /PID $reviewProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test process tree cleanup failed.' }
  }
}
