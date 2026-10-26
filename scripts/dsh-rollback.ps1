# ============================================================================
# Qwerty Learner Plus — dsh 一键回滚脚本
# 用法：
#   pwsh -File scripts\dsh-rollback.ps1 -List                  # 列出可回滚的 asar
#   pwsh -File scripts\dsh-rollback.ps1                         # 回滚到最近一次安装前备份
#   pwsh -File scripts\dsh-rollback.ps1 -AsarPath <xxx.asar>    # 回滚到指定 asar
# ============================================================================
param(
  [string]$AsarPath = '',
  [switch]$List,
  [string]$BackupDir = 'D:\整理\Qwerty备份',
  [string[]]$InstallDirs = @('D:\bangong\QwertyLearner-Plus', 'D:\bangong\新建文件夹 (2)\Qwerty Learner')
)

$ErrorActionPreference = 'Stop'
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

$candidates = Get-ChildItem $BackupDir -Filter '*before-*.asar' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending

if ($List) {
  $candidates | Select-Object LastWriteTime, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }, Name |
    Format-Table -AutoSize
  return
}

if (-not $AsarPath) {
  if (-not $candidates) { throw "没有找到可回滚的备份（$BackupDir\*before-*.asar）" }
  $AsarPath = $candidates[0].FullName
}
if (-not (Test-Path $AsarPath)) { throw "asar 不存在：$AsarPath" }

$hash = (Get-FileHash $AsarPath -Algorithm SHA256).Hash
Write-Step "回滚到 $AsarPath"
Write-Host "    sha256=$hash size=$((Get-Item $AsarPath).Length)"

Write-Step '退出正在运行的 Qwerty Learner'
Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

foreach ($dir in $InstallDirs) {
  $target = Join-Path $dir 'resources\app.asar'
  if (-not (Test-Path $target)) { Write-Host "    跳过（不存在）：$target" -ForegroundColor Yellow; continue }
  Copy-Item $AsarPath $target -Force
  $got = (Get-FileHash $target -Algorithm SHA256).Hash
  if ($got -ne $hash) { throw "回滚后哈希不一致：$target" }
  Write-Host "    ok $target" -ForegroundColor Green
}
Write-Step '回滚完成（重新启动应用生效）'
