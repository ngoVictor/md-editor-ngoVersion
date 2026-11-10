param([string]$Executable = 'src-tauri/target/release/md-editor.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$testExecutable = (Resolve-Path -LiteralPath $Executable).Path
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native tests.' }
$fixtureRoot = Join-Path $PWD ('test-results/native-readme-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
Copy-Item -LiteralPath 'tests/fixtures/readme-html.md' -Destination (Join-Path $fixtureRoot 'README.md')
$portLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portLease.Start()
$testCdpPort = $portLease.LocalEndpoint.Port
$portLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$testCdpPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$testCdpPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testProcess = Start-Process -FilePath $testExecutable -ArgumentList ('"' + (Join-Path $fixtureRoot 'README.md') + '"') -WindowStyle Hidden -PassThru
try {
  node scripts/native-readme-html.mjs $fixtureRoot
  if ($LASTEXITCODE -ne 0) { throw 'Native README HTML verification failed.' }
} finally {
  $testRunning = Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue
  if ($testRunning) {
    if ($testRunning.Path -ne $testExecutable) { throw 'Test PID no longer belongs to the selected executable.' }
    & taskkill.exe /PID $testProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Test process tree cleanup failed.' }
  }
}
