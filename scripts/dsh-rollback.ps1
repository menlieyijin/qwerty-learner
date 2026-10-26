# ============================================================================
# Qwerty Learner Plus — dsh 一键回滚脚本（v9.4 起：可选择上一版本 / 自动 redo 备份 / 日志）
# 用法：
#   pwsh -File scripts\dsh-rollback.ps1 -List                     # 列出可回滚 asar（含版本/哈希/是否当前）
#   pwsh -File scripts\dsh-rollback.ps1                            # 回滚到“与当前版本不同的最近备份”
#   pwsh -File scripts\dsh-rollback.ps1 -AsarPath <xxx.asar>       # 回滚到指定 asar
#   pwsh -File scripts\dsh-rollback.ps1 -List -All                 # 列出全部历史 asar（含非 before-*）
# 说明：回滚前会把当前已安装 asar 自动备份为 app.asar.pre-rollback-<stamp>.asar，
#       因此回滚本身也可“重做/撤销”；失败会自动恢复回滚前版本。
# 路径覆盖：下列路径参数均保留内置默认值（作者本机布局），优先级 = 显式参数 > 环境变量 > 内置默认：
#   QZ_BACKUP_DIR / QZ_INSTALL_DIRS（分号分隔多个目录）
# 迁移到其它机器或公开仓库使用时，设置对应环境变量即可，无需改脚本。
# ============================================================================
param(
  [string]$AsarPath = '',
  [switch]$List,
  [switch]$All,
  [switch]$Force,
  [string]$BackupDir = $(if ($env:QZ_BACKUP_DIR) { $env:QZ_BACKUP_DIR } else { 'D:\整理\Qwerty备份' }),
  [string[]]$InstallDirs = $(if ($env:QZ_INSTALL_DIRS) { $env:QZ_INSTALL_DIRS -split '\s*;\s*' } else { @('D:\bangong\QwertyLearner-Plus', 'D:\bangong\新建文件夹 (2)\Qwerty Learner') })
)

$ErrorActionPreference = 'Stop'
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }
function Get-Sha256([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

function Copy-FileAtomic([string]$source, [string]$target) {
  $dir = Split-Path -Parent $target
  $tmp = Join-Path $dir ('.tmp-' + [guid]::NewGuid().ToString('N') + '-' + (Split-Path -Leaf $target))
  Copy-Item -LiteralPath $source -Destination $tmp -Force
  if ((Get-Item -LiteralPath $tmp).Length -ne (Get-Item -LiteralPath $source).Length) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw "临时文件大小不一致：$source"
  }
  Move-Item -LiteralPath $tmp -Destination $target -Force
}

function Get-VersionFromName([string]$name) {
  $m = [regex]::Match($name, 'before-(.+?)-\d{8}-\d{6}')
  if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match($name, 'staging-before-(.+?)_\d{8}')
  if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match($name, 'enhanced-(.+?)_\d{8}')
  if ($m.Success) { return $m.Groups[1].Value }
  return '(unknown)'
}

# ---------------------------------------------------------------------------
# 1. 当前安装状态
# ---------------------------------------------------------------------------
$current = @()
foreach ($dir in $InstallDirs) {
  $target = Join-Path $dir 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $target)) { Write-Warn "缺少当前安装：$target"; continue }
  $current += [pscustomobject]@{ dir = $dir; path = $target; sha256 = (Get-Sha256 $target); size = (Get-Item $target).Length }
}
if ($current.Count -eq 0) { throw '未找到任何可回滚的安装目录（检查 -InstallDirs）' }
$currentHashes = @($current | ForEach-Object { $_.sha256 } | Select-Object -Unique)
if ($currentHashes.Count -gt 1) {
  if (-not $Force) { throw "双目录当前 asar 哈希不一致，拒绝回滚；确认要统一覆盖请加 -Force`n$($currentHashes -join "`n")" }
  Write-Warn '双目录当前 asar 不一致，-Force 将统一覆盖为同一版本'
}
$currentHash = $currentHashes[0]

# ---------------------------------------------------------------------------
# 2. 候选备份清单
# ---------------------------------------------------------------------------
$candidates = @()
Get-ChildItem -LiteralPath $BackupDir -File -Filter '*.asar' -ErrorAction SilentlyContinue | Where-Object {
  $_.Length -gt 10MB -and ($All -or $_.Name -match 'before-')
} | ForEach-Object {
  $sha = Get-Sha256 $_.FullName
  $candidates += [pscustomobject]@{
    Time    = $_.LastWriteTime
    Name    = $_.Name
    Path    = $_.FullName
    SizeMB  = [math]::Round($_.Length / 1MB, 1)
    Version = Get-VersionFromName $_.Name
    Sha256  = $sha
    Current = ($sha -eq $currentHash)
  }
}
$candidates = @($candidates | Sort-Object Time -Descending)

if ($List) {
  if (-not $candidates) { Write-Host "没有可回滚的备份（$BackupDir）" -ForegroundColor Yellow; return }
  $candidates | Select-Object @{n = 'Time'; e = { $_.Time.ToString('MM-dd HH:mm:ss') } }, Version, SizeMB,
    @{n = 'Sha8'; e = { $_.Sha256.Substring(0, 8) } }, @{n = 'Current'; e = { if ($_.Current) { '*当前*' } else { '' } } }, Name |
    Format-Table -AutoSize
  Write-Host "当前安装 sha256=$currentHash" -ForegroundColor DarkGray
  return
}

# ---------------------------------------------------------------------------
# 3. 选择目标：默认“最近且与当前不同的备份”
# ---------------------------------------------------------------------------
if (-not $AsarPath) {
  $pick = $candidates | Where-Object { -not $_.Current } | Select-Object -First 1
  if (-not $pick) {
    if ($candidates) {
      $pick = $candidates | Select-Object -First 1
      Write-Warn '所有备份内容都与当前安装相同（回滚将是无操作）'
    } else { throw "没有找到可回滚的备份（$BackupDir）" }
  }
  $AsarPath = $pick.Path
}
if (-not (Test-Path -LiteralPath $AsarPath)) { throw "asar 不存在：$AsarPath" }
$targetFile = Get-Item -LiteralPath $AsarPath
if ($targetFile.Length -lt 10MB) { throw "备份文件大小异常（<10MB），拒绝回滚：$AsarPath" }
$targetHash = Get-Sha256 $AsarPath
Write-Step "回滚目标：$($targetFile.FullName)"
Write-Host "    version=$(Get-VersionFromName $targetFile.Name) sha256=$targetHash size=$($targetFile.Length)"
if ($targetHash -eq $currentHash -and -not $Force) { Write-Warn '目标与当前版本内容相同（无实际变化）；如确认继续请加 -Force' }

# ---------------------------------------------------------------------------
# 4. 退出应用
# ---------------------------------------------------------------------------
Write-Step '退出正在运行的 Qwerty Learner'
Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | ForEach-Object {
  try { & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null } catch { }
}
Start-Sleep -Milliseconds 600

# ---------------------------------------------------------------------------
# 5. 回滚前先备份当前版本（redo 点），再逐目录原子替换
# ---------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$redo = @()
foreach ($item in $current) {
  $suffix = if ($currentHashes.Count -gt 1) { '-' + $item.sha256.Substring(0, 8) } else { '' }
  $redoPath = Join-Path $BackupDir "app.asar.pre-rollback-$stamp$suffix.asar"
  Copy-Item -LiteralPath $item.path -Destination $redoPath -Force
  if ((Get-Sha256 $redoPath) -ne $item.sha256) { throw "回滚前备份校验失败：$redoPath" }
  $redo += $redoPath
}
Write-Ok "已保存回滚前版本（redo 点）：$($redo -join '; ')"

$restored = @()
try {
  foreach ($item in $current) {
    Copy-FileAtomic -source $AsarPath -target $item.path
    $got = Get-Sha256 $item.path
    if ($got -ne $targetHash) { throw "回滚后哈希不一致：$($item.path)" }
    $restored += [ordered]@{ dir = $item.dir; path = $item.path; sha256 = $got; size = (Get-Item $item.path).Length }
    Write-Ok "回滚 -> $($item.path) ($got)"
  }
} catch {
  Write-Warn "回滚失败，恢复回滚前版本：$($_.Exception.Message)"
  $i = 0
  foreach ($item in $current) {
    try { Copy-FileAtomic -source $redo[$i] -target $item.path } catch { Write-Warn "恢复失败：$($item.path)" }
    $i++
  }
  throw
}

$logDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "qwerty-rollback-$stamp.json"
[ordered]@{
  rolledBackAt = (Get-Date).ToString('o')
  target       = $AsarPath
  targetSha256 = $targetHash
  targetVersion = Get-VersionFromName $targetFile.Name
  previousSha256 = $currentHash
  redoBackups  = $redo
  dirs         = $restored
} | ConvertTo-Json -Depth 5 | Set-Content $logPath -Encoding UTF8

Write-Step '回滚完成（重新启动应用生效）'
Write-Host "日志：$logPath"
Write-Host "如需撤销本次回滚：pwsh -File scripts\dsh-rollback.ps1 -AsarPath `"$($redo[0])`""
