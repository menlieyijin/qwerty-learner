# 兼容包装：实际实现已迁移到跨平台的 scripts/rollback.mjs（macOS / Linux / Windows 通用）。
# 保留本文件是为了让既有命令（pwsh -File scripts\dsh-rollback.ps1 -List ...）继续可用。
#
# 等价用法：
#   node scripts/rollback.mjs --list
#   node scripts/rollback.mjs --install-dirs "<目录1>;<目录2>"
param(
  [string]$AsarPath = '',
  [switch]$List,
  [switch]$All,
  [switch]$Force,
  [string]$BackupDir = '',
  [string[]]$InstallDirs = @()
)

$ErrorActionPreference = 'Stop'
# node 输出 UTF-8；控制台默认按系统代码页（中文系统 936）解码，会变成乱码，这里显式设成 UTF-8。
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }
$repo = Split-Path -Parent $PSScriptRoot

$pass = @()
if ($AsarPath) { $pass += @('--asar', $AsarPath) }
if ($List) { $pass += '--list' }
if ($All) { $pass += '--all' }
if ($Force) { $pass += '--force' }
if ($BackupDir) { $pass += @('--backup-dir', $BackupDir) }
if ($InstallDirs.Count -gt 0) { $pass += @('--install-dirs', ($InstallDirs -join ';')) }

Push-Location $repo
try {
  & node scripts/rollback.mjs @pass
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
