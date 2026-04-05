<#
Apply schema.sql to a Supabase Postgres database using psql.
Usage (PowerShell):
  powershell -ExecutionPolicy Bypass -File .\scripts\apply_schema.ps1
This script prompts for either a full connection URI (postgresql://...) or
individual DB params and runs psql to execute `schema.sql` located in the
project root.

WARNING: Do NOT paste secret keys or service role tokens into chat. Run this
script locally and paste only non-sensitive results here.
#>

$schemaFile = Join-Path $PSScriptRoot '..\schema.sql'
if (-not (Test-Path $schemaFile)) {
  Write-Error "schema.sql not found at $schemaFile"
  exit 1
}

function Check-PSQL {
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Host "psql CLI not found. Install Postgres client: https://www.postgresql.org/download/"
    return $false
  }
  return $true
}

$choice = Read-Host "Use full connection URI? (y/n) [y]"
if ($choice -eq '' -or $choice -eq 'y' -or $choice -eq 'Y') {
  $conn = Read-Host "Paste full connection URI (postgresql://postgres:password@host:port/postgres)"
  if (-not (Check-PSQL)) { exit 1 }
  Write-Host "Applying $schemaFile using psql..."
  try {
    & psql $conn -f $schemaFile
    $code = $LASTEXITCODE
  } catch {
    Write-Error $_.Exception.Message
    exit 1
  }
  if ($code -eq 0) { Write-Host "Schema applied successfully." } else { Write-Error "psql exited with code $code" }
  exit $code
} else {
  $host = Read-Host "DB host (e.g. db.<project>.supabase.co)"
  if ($host -eq '') { Write-Error "host required"; exit 1 }
  $port = Read-Host "Port (default 5432)"
  if ($port -eq '') { $port = '5432' }
  $user = Read-Host "User (default postgres)"
  if ($user -eq '') { $user = 'postgres' }
  $db = Read-Host "Database (default postgres)"
  if ($db -eq '') { $db = 'postgres' }
  $securePwd = Read-Host -AsSecureString "DB password (hidden)"
  try {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd)
    $pwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  } catch {
    Write-Error "Failed to convert secure string to plain text"
    exit 1
  }
  $env:PGPASSWORD = $pwd
  if (-not (Check-PSQL)) { Remove-Variable PGPASSWORD -ErrorAction SilentlyContinue; exit 1 }
  Write-Host "Applying $schemaFile to $host:$port..."
  try {
    & psql -h $host -p $port -U $user -d $db -f $schemaFile
    $code = $LASTEXITCODE
  } catch {
    Write-Error $_.Exception.Message
    Remove-Variable PGPASSWORD -ErrorAction SilentlyContinue
    exit 1
  }
  if ($code -eq 0) { Write-Host "Schema applied successfully." } else { Write-Error "psql exited with code $code" }
  Remove-Variable PGPASSWORD -ErrorAction SilentlyContinue
  exit $code
}
