# StudyNotes: handwriting recognition with the recognizer built into Windows
# (Windows.UI.Input.Inking). Reads one JSON request from stdin, writes JSON.
#   { "mode": "list" }
#   { "mode": "recognize", "recognizer": "<name or empty>", "strokes": [[x,y,x,y,...], ...] }
#   { "mode": "batch", "recognizer": "...", "groups": [ <strokes>, <strokes>, ... ] }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
function Out-Json($o) { [Console]::Out.Write(($o | ConvertTo-Json -Depth 6 -Compress)) }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.UI.Input.Inking.InkStrokeContainer, Windows.UI.Input.Inking, ContentType = WindowsRuntime]
  $null = [Windows.UI.Input.Inking.InkRecognizerContainer, Windows.UI.Input.Inking, ContentType = WindowsRuntime]
  $null = [Windows.UI.Input.Inking.InkStrokeBuilder, Windows.UI.Input.Inking, ContentType = WindowsRuntime]
  # Windows.Foundation.Point comes with System.Runtime.WindowsRuntime (loaded above);
  # loading it as a WinRT type fails on many PCs ("Unable to find type")
  try { $null = [Windows.Foundation.Point] } catch { $null = [Windows.Foundation.Point, Windows.Foundation, ContentType = WindowsRuntime] }
  $req = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $script:added = 0
  $script:results = 0
  $rc = New-Object Windows.UI.Input.Inking.InkRecognizerContainer
  $names = @($rc.GetRecognizers() | ForEach-Object { $_.Name })
  if ($req.mode -eq 'list') { Out-Json @{ ok = $true; recognizers = $names }; exit 0 }

  if ($req.recognizer) {
    $r = $rc.GetRecognizers() | Where-Object { $_.Name -eq $req.recognizer } | Select-Object -First 1
    if ($r) { $rc.SetDefaultRecognizer($r) }
  }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $asTask = $asTask.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.UI.Input.Inking.InkRecognitionResult]])
  $builder = New-Object Windows.UI.Input.Inking.InkStrokeBuilder
  # fast constructor if this PowerShell allows it, otherwise New-Object
  $fast = $true
  try { $null = [Windows.Foundation.Point]::new(1.0, 2.0) } catch { $fast = $false }
  function New-Pt([double]$x, [double]$y) {
    if ($fast) { return [Windows.Foundation.Point]::new($x, $y) }
    return New-Object Windows.Foundation.Point -ArgumentList $x, $y
  }

  function Read-Strokes($strokes) {
    $container = New-Object Windows.UI.Input.Inking.InkStrokeContainer
    foreach ($o in $strokes) {
      # strokes come as { p: [x,y,...] }: a bare [[...]] with one stroke would be unrolled by ConvertFrom-Json
      $s = if ($o.p) { $o.p } else { $o }
      $n = $s.Count
      if ($n -lt 2) { continue }
      $pts = New-Object 'System.Collections.Generic.List[Windows.Foundation.Point]' ($n / 2 + 1)
      for ($i = 0; $i + 1 -lt $n; $i += 2) { $pts.Add((New-Pt $s[$i] $s[$i + 1])) }
      if ($pts.Count -eq 1) { $pts.Add((New-Pt ($pts[0].X + 0.5) $pts[0].Y)) }
      $container.AddStroke($builder.CreateStroke($pts))
    }
    $words = New-Object 'System.Collections.Generic.List[object]'
    $script:added += $container.GetStrokes().Count
    if ($container.GetStrokes().Count -eq 0) { return ,$words }
    $task = $asTask.Invoke($null, @($rc.RecognizeAsync($container, [Windows.UI.Input.Inking.InkRecognitionTarget]::All)))
    $null = $task.Wait(-1)
    $script:results += @($task.Result).Count
    foreach ($res in $task.Result) {
      $b = $res.BoundingRect
      $words.Add(@{ alts = @($res.GetTextCandidates()); x = $b.X; y = $b.Y; w = $b.Width; h = $b.Height })
    }
    return ,$words
  }

  if ($req.mode -eq 'batch') {
    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($g in $req.groups) { $results.Add(@{ words = @(Read-Strokes $g) }) }
    Out-Json @{ ok = $true; results = @($results) }
  } else {
    $w = @(Read-Strokes $req.strokes)
    $used = try { $rc.GetRecognizers() | Where-Object { $_.Name -eq $req.recognizer } | Select-Object -First 1 | ForEach-Object { $_.Name } } catch { '' }
    Out-Json @{ ok = $true; recognizers = $names; words = $w; info = @{ strokes = $script:added; results = $script:results; recognizer = $(if ($used) { $used } else { 'default' }) } }
  }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message }
}
