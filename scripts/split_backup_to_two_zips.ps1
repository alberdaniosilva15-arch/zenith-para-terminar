Param(
  [Parameter(Mandatory=$true)][string]$SourceZip,
  [Parameter(Mandatory=$true)][string]$Part1Dir,
  [Parameter(Mandatory=$true)][string]$Part2Dir,
  [int]$MaxMB = 30
)

$ErrorActionPreference = 'Stop'

# Convert MB to bytes
$maxBytes = [int64]$MaxMB * 1024 * 1024

Write-Host "Source: $SourceZip"
Write-Host "Part1Dir: $Part1Dir"
Write-Host "Part2Dir: $Part2Dir"
Write-Host "MaxMB: $MaxMB -> maxBytes=$maxBytes bytes"

if (-not (Test-Path -LiteralPath $SourceZip)) {
  Write-Error "Source ZIP not found: $SourceZip"
  exit 1
}

# Ensure part dirs exist
if (-not (Test-Path -LiteralPath $Part1Dir)) { New-Item -ItemType Directory -Path $Part1Dir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $Part2Dir)) { New-Item -ItemType Directory -Path $Part2Dir -Force | Out-Null }

# Make a working copy so original is untouched
$guid = [guid]::NewGuid().ToString()
$workingCopy = Join-Path $env:TEMP ("zenith-backup-copy-$guid.zip")
Copy-Item -LiteralPath $SourceZip -Destination $workingCopy -Force
Write-Host "Created working copy: $workingCopy"

# Extract working copy
$extractDir = Join-Path $env:TEMP ("zenith_extract_$guid")
if (Test-Path $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $extractDir | Out-Null
Expand-Archive -LiteralPath $workingCopy -DestinationPath $extractDir -Force
Write-Host "Extracted archive to: $extractDir"

# Gather files sorted by size descending
$files = Get-ChildItem -Path $extractDir -Recurse -File | Sort-Object -Property Length -Descending

if ($files.Count -eq 0) {
  # Nothing to split: copy the zip into both folders (copy-of-copy)
  $c1 = Join-Path $Part1Dir (Split-Path $SourceZip -Leaf)
  $c2 = Join-Path $Part2Dir (Split-Path $SourceZip -Leaf)
  Copy-Item -LiteralPath $SourceZip -Destination $c1 -Force
  Copy-Item -LiteralPath $SourceZip -Destination $c2 -Force
  Write-Host "No files found in archive; copied original zip into both part folders: `n  $c1`n  $c2"
  exit 0
}

# Greedy two-bin assignment (largest-first, assign to smaller bin)
$part1 = @()
$part2 = @()
$size1 = 0L
$size2 = 0L

foreach ($f in $files) {
  if ($size1 -le $size2) {
    $part1 += $f
    $size1 += $f.Length
  } else {
    $part2 += $f
    $size2 += $f.Length
  }
}

Write-Host "Greedy assignment sizes -> part1=$([Math]::Round($size1/1MB,2))MB part2=$([Math]::Round($size2/1MB,2))MB"

if ($size1 -gt $maxBytes -or $size2 -gt $maxBytes) {
  Write-Host "Greedy failed to satisfy max size; trying sequential fill into part1 then part2..."
  # Sequential fill: fill part1 until adding next file would exceed, rest to part2
  $part1 = @(); $part2 = @(); $size1 = 0L; $size2 = 0L
  foreach ($f in $files) {
    if ($size1 + $f.Length -le $maxBytes) {
      $part1 += $f; $size1 += $f.Length
    } else {
      $part2 += $f; $size2 += $f.Length
    }
  }
  Write-Host "Sequential assignment sizes -> part1=$([Math]::Round($size1/1MB,2))MB part2=$([Math]::Round($size2/1MB,2))MB"
}

if ($size1 -gt $maxBytes -or $size2 -gt $maxBytes) {
  Write-Error "Unable to split into 2 parts each <= $MaxMB MB. Required sizes: part1=$([Math]::Round($size1/1MB,2))MB, part2=$([Math]::Round($size2/1MB,2))MB. Consider using more parts or a larger limit."
  exit 2
}

# Helper to create zip from a list of FileInfo objects, preserving relative paths
function Create-ZipFromFileObjs {
  param(
    [string]$DestZip,
    [System.Object[]]$FileObjs,
    [string]$RootDir
  )

  if ($FileObjs.Count -eq 0) {
    # create an empty zip (compressing an empty temp dir)
    $tmp = Join-Path $env:TEMP ("zenith_empty_{0}" -f [guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Push-Location $tmp
    Compress-Archive -Path * -DestinationPath $DestZip -Force
    Pop-Location
    Remove-Item -LiteralPath $tmp -Recurse -Force
    return
  }

  Push-Location $RootDir
  $relPaths = @()
  foreach ($fo in $FileObjs) {
    $rel = $fo.FullName.Substring($RootDir.Length)
    # Trim leading slash/backslash
    $rel = $rel -replace '^[\\/]',''
    $relPaths += $rel
  }

  Compress-Archive -Path $relPaths -DestinationPath $DestZip -CompressionLevel Optimal -Force
  Pop-Location
}

$dest1 = Join-Path $Part1Dir "zenith-part1.zip"
$dest2 = Join-Path $Part2Dir "zenith-part2.zip"

Write-Host "Creating $dest1 (files: $($part1.Count))"
Create-ZipFromFileObjs -DestZip $dest1 -FileObjs $part1 -RootDir $extractDir
Write-Host "Creating $dest2 (files: $($part2.Count))"
Create-ZipFromFileObjs -DestZip $dest2 -FileObjs $part2 -RootDir $extractDir

# Report sizes
$sizeDest1 = (Get-Item -LiteralPath $dest1).Length
$sizeDest2 = (Get-Item -LiteralPath $dest2).Length
Write-Host "Result sizes: part1=$([Math]::Round($sizeDest1/1MB,2)) MB, part2=$([Math]::Round($sizeDest2/1MB,2)) MB"

# Cleanup working copy and extracted files
Remove-Item -LiteralPath $workingCopy -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done. Zips placed in:`n  $dest1`n  $dest2"
exit 0
