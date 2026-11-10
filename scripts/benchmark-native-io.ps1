param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][ValidateSet('baseline','optimized')][string]$Label)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-Process 'md-editor*' -ErrorAction SilentlyContinue) { throw 'Close existing editors before isolated native benchmark.' }
$exePath = (Resolve-Path -LiteralPath $Executable).Path
$fixtureRoot = Join-Path $PWD ('test-results/native-size-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'start.md'), '# Size benchmark', [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'large.md'), ('abcdefghijklmno' * 349525), [Text.UTF8Encoding]::new($false))
$portLease = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portLease.Start()
$testCdpPort = $portLease.LocalEndpoint.Port
$portLease.Stop()
$env:MD_EDITOR_TEST_CDP_PORT = [string]$testCdpPort
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$testCdpPort --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $fixtureRoot 'webview-profile'
$testProcess = Start-Process -FilePath $exePath -ArgumentList ('"' + (Join-Path $fixtureRoot 'start.md') + '"') -WindowStyle Hidden -PassThru
try {
  node scripts/benchmark-native-io.mjs $fixtureRoot $Label
  if ($LASTEXITCODE -ne 0) { throw 'Native benchmark failed.' }
} finally {
  if (Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $testProcess.Id }
}
