# 兼容包装：实际实现已迁移到跨平台的 scripts/release.mjs（macOS / Linux / Windows 通用）。
# 保留本文件是为了让既有命令（pwsh -File scripts\dsh-release.ps1 -Install ...）继续可用。
#
# 等价用法：
#   node scripts/release.mjs --test-install --smoke
#   node scripts/release.mjs --install --install-dirs "<目录1>;<目录2>"
param(
  [string]$Version = '',
  [switch]$SkipBuild,
  [switch]$SkipCheck,
  [switch]$SkipAudit,
  [switch]$TestInstall,
  [switch]$Install,
  [switch]$Smoke,
  [string]$StageRoot = '',
  [string]$BackupDir = '',
  [string]$AuditRoot = '',
  [string]$TestAppDir = '',
  [string[]]$InstallDirs = @(),
  [int]$KeepStaging = 5
)

$ErrorActionPreference = 'Stop'
# node 输出 UTF-8；控制台默认按系统代码页（中文系统 936）解码，会变成乱码，这里显式设成 UTF-8。
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }
$repo = Split-Path -Parent $PSScriptRoot

$pass = @()
if ($Version) { $pass += @('--version', $Version) }
if ($SkipBuild) { $pass += '--skip-build' }
if ($SkipCheck) { $pass += '--skip-check' }
if ($SkipAudit) { $pass += '--skip-audit' }
if ($TestInstall) { $pass += '--test-install' }
if ($Install) { $pass += '--install' }
if ($Smoke) { $pass += '--smoke' }
if ($StageRoot) { $pass += @('--stage-root', $StageRoot) }
if ($BackupDir) { $pass += @('--backup-dir', $BackupDir) }
if ($AuditRoot) { $pass += @('--audit-dir', $AuditRoot) }
if ($TestAppDir) { $pass += @('--test-app-dir', $TestAppDir) }
if ($InstallDirs.Count -gt 0) { $pass += @('--install-dirs', ($InstallDirs -join ';')) }
if ($KeepStaging -ne 5) { $pass += @('--keep-staging', "$KeepStaging") }

Push-Location $repo
try {
  & node scripts/release.mjs @pass
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
