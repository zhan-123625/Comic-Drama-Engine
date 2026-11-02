#Requires -Version 5.1
# =============================================================
# Backup the SQLite database (PowerShell version)
# - Copies data\app.db to data\backups\app-{timestamp}.db
# - Keeps the last 30 backups, deletes older ones
# =============================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

$DbPath = Join-Path $ProjectRoot "data\app.db"
$BackupDir = Join-Path $ProjectRoot "data\backups"
$Keep = 30

if (-not (Test-Path $DbPath)) {
    Write-Error "Database not found at $DbPath"
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "app-$Timestamp.db"

Copy-Item -Path $DbPath -Destination $BackupFile
Write-Host "Backup created: $BackupFile"

# Remove old backups, keeping the newest $Keep
$backups = Get-ChildItem -Path $BackupDir -Filter "app-*.db" | Sort-Object LastWriteTime -Descending

if ($backups.Count -gt $Keep) {
    $toDelete = $backups | Select-Object -Skip $Keep
    foreach ($old in $toDelete) {
        Remove-Item -Path $old.FullName -Force
        Write-Host "Deleted old backup: $($old.Name)"
    }
}

$totalBackups = (Get-ChildItem -Path $BackupDir -Filter "app-*.db").Count
Write-Host "Backup complete. Total backups: $totalBackups"
