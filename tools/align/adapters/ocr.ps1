param([string]$Dir, [string]$Lang = 'en-US')
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
$language = [Windows.Globalization.Language]::new($Lang)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) { throw "No OCR engine for $Lang" }
$files = @(Get-ChildItem -Path $Dir -Filter 'page-*.png' | Sort-Object Name)
$out = @()
foreach ($file in $files) {
  $fs = [System.IO.File]::OpenRead($file.FullName)
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs)
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) {
    $words = @($line.Words)
    if ($words.Count -eq 0) { continue }
    $x = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
    $y = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
    $r = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
    $b = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
    $lines += [pscustomobject]@{ text=$line.Text; x=$x; y=$y; w=($r-$x); h=($b-$y) }
  }
  $out += [pscustomobject]@{ file=$file.Name; lines=$lines }
  $fs.Dispose()
  Write-Progress -Activity 'OCR' -Status $file.Name -PercentComplete (($out.Count / $files.Count) * 100)
}
$out | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path (Join-Path $Dir 'ocr.json') -Encoding UTF8
