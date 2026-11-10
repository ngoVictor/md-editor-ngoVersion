param([string]$EvidenceDirectory = 'test-results/native-evidence/p4-p5')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Get-Process WINWORD -ErrorAction SilentlyContinue) { throw 'Existing Word instance; leave user documents untouched.' }
$root = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$wordPath = 'C:\Program Files\Microsoft Office\Root\Office16\WINWORD.EXE'
$testWordProcess = Start-Process -FilePath $wordPath -ArgumentList @('/a','/q',('"' + (Join-Path $root 'sample-docx.docx') + '"')) -WindowStyle Hidden -PassThru
$word = $null
try {
for ($attempt = 0; $attempt -lt 30 -and $null -eq $word; $attempt++) {
  Start-Sleep -Milliseconds 500
  try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application') } catch { }
}
if ($null -eq $word) { throw "Test Word automation unavailable; own PID: $($testWordProcess.Id)" }
Write-Output "Attached test Word PID $($testWordProcess.Id) with add-ins disabled (/a)"
$word.Documents.Close(0)
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
  foreach ($name in @('docx','docx-legacy')) {
    $document = $null
    try {
      $sourcePath = [string](Join-Path $root "sample-$name.docx")
      $pdfPath = [string](Join-Path $root "word-$name.pdf")
      [void]$word.Documents.Open($sourcePath, $false, $true)
      $document = $word.ActiveDocument
      Write-Output "Opened $name"
      $document.Repaginate()
      $pageCount = [int]$word.ActiveDocument.ComputeStatistics(2)
      Write-Output "Pages: $pageCount"
      $imageCount = [int]$word.ActiveDocument.InlineShapes.Count
      $tableCount = [int]$word.ActiveDocument.Tables.Count
      $footnoteCount = [int]$word.ActiveDocument.Footnotes.Count
      $version = [string]$word.Version
      $result = @{backend=$name;version=$version;pages=$pageCount;images=$imageCount;tables=$tableCount;footnotes=$footnoteCount}
      $word.ActiveDocument.ExportAsFixedFormat($pdfPath, 17, $false)
      Write-Output "PDF complete $name"
      $results += $result
    } finally { if ($null -ne $document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } }
  }
  $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'word-validation.json') -Encoding UTF8
  $results | ConvertTo-Json -Depth 4
} finally {
  if ($null -ne $word) {
    try { $word.Quit() } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
  }
  $testWordRunning = Get-Process -Id $testWordProcess.Id -ErrorAction SilentlyContinue
  if ($testWordRunning) {
    if ($testWordRunning.Path -ne $wordPath) { throw 'Test Word PID no longer belongs to the selected executable.' }
    Stop-Process -Id $testWordProcess.Id -Force
  }
}
