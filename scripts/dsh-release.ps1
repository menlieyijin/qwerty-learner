# ============================================================================
# Qwerty Learner Plus — dsh 一键发布脚本（v9.4 起：原子安装 / 可追溯 / 回归门禁）
# 用途：源码 → 质量门禁（tsc + SRS/自动进阶回归）→ Vite build → 组装 asar → SHA256
#       → 可选测试安装/隔离冒烟 → 可选双目录正式安装（先备份、原子替换、失败回滚）→ 发布日志
# 用法示例：
#   pwsh -File scripts\dsh-release.ps1                          # 质量门禁 + 构建 + 打包（不安装）
#   pwsh -File scripts\dsh-release.ps1 -TestInstall             # 构建并安装到测试目录 D:\整理\qtest9\app
#   pwsh -File scripts\dsh-release.ps1 -TestInstall -Smoke      # 构建+测试安装+隔离 profile CDP 冒烟
#   pwsh -File scripts\dsh-release.ps1 -Install                 # 构建并安装到两个正式目录（自动备份+校验+日志）
#   pwsh -File scripts\dsh-release.ps1 -SkipBuild -Install      # 用已有 build/ 直接打包安装
#   pwsh -File scripts\dsh-release.ps1 -SkipCheck -SkipAudit    # 跳过 tsc / 核心回归门禁
# 回滚：scripts\dsh-rollback.ps1（自动选择“与当前版本不同的最近备份”，回滚前会再备份当前版本）
# ============================================================================
param(
  [string]$Version = '',
  [switch]$SkipBuild,
  [switch]$SkipCheck,
  [switch]$SkipAudit,
  [switch]$TestInstall,
  [switch]$Install,
  [switch]$Smoke,
  [string]$StageRoot = 'D:\整理\QwertyRelease',
  [string]$BackupDir = 'D:\整理\Qwerty备份',
  [string]$AuditRoot = 'D:\整理\audit',
  [string]$TestAppDir = 'D:\整理\qtest9\app',
  [string[]]$InstallDirs = @('D:\bangong\QwertyLearner-Plus', 'D:\bangong\新建文件夹 (2)\Qwerty Learner'),
  [int]$KeepStaging = 5
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }

function Get-Sha256([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

function Copy-FileAtomic([string]$source, [string]$target) {
  # 同卷原子替换：先复制到同目录临时文件并校验大小，再 Move-Item -Force 覆盖
  $dir = Split-Path -Parent $target
  $tmp = Join-Path $dir ('.tmp-' + [guid]::NewGuid().ToString('N') + '-' + (Split-Path -Leaf $target))
  Copy-Item -LiteralPath $source -Destination $tmp -Force
  if ((Get-Item -LiteralPath $tmp).Length -ne (Get-Item -LiteralPath $source).Length) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw "临时文件大小不一致：$source"
  }
  Move-Item -LiteralPath $tmp -Destination $target -Force
}

function Wait-Cdp([int]$port, [int]$timeoutMs = 30000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2 -ErrorAction Stop
      if ($r.webSocketDebuggerUrl) { return $true }
    } catch { Start-Sleep -Milliseconds 400 }
  }
  return $false
}

function Stop-Qwerty([string]$pathPrefix = '') {
  Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | Where-Object {
    (-not $pathPrefix) -or ($_.Path -and $_.Path.StartsWith($pathPrefix, [System.StringComparison]::OrdinalIgnoreCase))
  } | ForEach-Object {
    try { & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null } catch { }
  }
}

function Invoke-Smoke([string]$exe, [string]$userDir, [string]$plusDir, [int]$port) {
  New-Item -ItemType Directory -Force -Path $userDir, $plusDir | Out-Null
  $env:QZ_USER_DATA = $userDir
  $env:QZ_PLUS_DIR = $plusDir
  $env:QZ_ALLOW_MULTI = '1'
  $env:QZ_SMOKE_PORT = "$port"
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$port" -PassThru
  try {
    if (-not (Wait-Cdp -port $port -timeoutMs 45000)) { throw "CDP $port 在 45s 内未就绪" }
    & cmd.exe /c "node scripts\dsh-smoke.mjs > `"$logDir\smoke-$stamp.txt`" 2>&1"
    $code = $LASTEXITCODE
    Get-Content "$logDir\smoke-$stamp.txt" -Raw -ErrorAction SilentlyContinue | Write-Host
    if ($code -ne 0) { throw "冒烟测试失败（exit $code）" }
    Write-Ok '冒烟测试通过'
  } finally {
    Stop-Qwerty -pathPrefix $exe
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
# 0. 基础信息
# ---------------------------------------------------------------------------
$pack = Get-Content 'local-fork\package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = if ($Version) { $Version } else { $pack.version }
if (-not $ver) { throw '无法确定版本号：local-fork/package.json 缺少 version' }
if ($Version -and $Version -ne $pack.version) { Write-Warn "命令行 -Version=$Version 与 package.json=$($pack.version) 不一致（仅本次使用）" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$gitSha = (git rev-parse --short HEAD 2>$null)
$stage = Join-Path $StageRoot "staging-$ver-$stamp"
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir, $BackupDir, $StageRoot | Out-Null
Write-Step "版本 $ver（git $gitSha），暂存目录 $stage"

# ---------------------------------------------------------------------------
# 1. 预检：所有目标目录必须已存在，且双目录当前 asar 一致（否则拒绝覆盖，避免混合版本）
# ---------------------------------------------------------------------------
if ($Install) {
  if ($InstallDirs.Count -lt 1) { throw 'InstallDirs 为空' }
  $existingHashes = @()
  foreach ($dir in $InstallDirs) {
    $res = Join-Path $dir 'resources'
    if (-not (Test-Path -LiteralPath $res)) { throw "安装目录不存在或缺少 resources：$res" }
    $target = Join-Path $res 'app.asar'
    if (-not (Test-Path -LiteralPath $target)) { throw "缺少现有 app.asar：$target" }
    $existingHashes += (Get-Sha256 $target)
  }
  if (($existingHashes | Select-Object -Unique).Count -gt 1) {
    throw "双目录当前 app.asar 哈希不一致，拒绝自动安装；请先人工核对：`n$($existingHashes -join "`n")"
  }
  Write-Ok "预检通过：$($InstallDirs.Count) 个安装目录存在，当前 asar 哈希一致（$($existingHashes[0].Substring(0,12))…）"
}
if ($TestInstall) {
  $testRes = Join-Path $TestAppDir 'resources'
  $testExe = Join-Path $TestAppDir 'Qwerty Learner.exe'
  if (-not (Test-Path -LiteralPath $testRes)) { throw "测试目录不存在：$testRes" }
  if (-not (Test-Path -LiteralPath $testExe)) { throw "测试程序不存在：$testExe" }
}

# ---------------------------------------------------------------------------
# 2. 质量门禁：tsc
# ---------------------------------------------------------------------------
if (-not $SkipCheck) {
  Write-Step 'TypeScript 检查（tsc --noEmit）...'
  & cmd.exe /c 'npx tsc --noEmit -p tsconfig.json 2>&1'
  if ($LASTEXITCODE -ne 0) { throw "TypeScript 检查失败（exit $LASTEXITCODE）" }
  Write-Ok 'tsc 通过'
} else { Write-Warn '已跳过 tsc（-SkipCheck）' }

# ---------------------------------------------------------------------------
# 3. 质量门禁：SRS / 自动进阶回归（真实源码 bundle + strict）
# ---------------------------------------------------------------------------
if (-not $SkipAudit) {
  $buildCore = Join-Path $AuditRoot '_v93-build-core.mjs'
  $srsSim = Join-Path $AuditRoot 'srs-sim.mjs'
  $autoSim = Join-Path $AuditRoot 'sim-autolevel.mjs'
  if ((Test-Path $buildCore) -and (Test-Path $srsSim) -and (Test-Path $autoSim)) {
    Write-Step '核心回归门禁（重建 bundle + srs-sim / sim-autolevel --strict）...'
    Push-Location $AuditRoot
    try {
      & cmd.exe /c "node .\_v93-build-core.mjs > `"$logDir\audit-build-core-$stamp.txt`" 2>&1"
      if ($LASTEXITCODE -ne 0) { throw "audit 核心 bundle 重建失败（exit $LASTEXITCODE）" }
      & cmd.exe /c "node .\srs-sim.mjs --strict > `"$logDir\audit-srs-$stamp.txt`" 2>&1"
      if ($LASTEXITCODE -ne 0) { throw "SRS 回归失败（exit $LASTEXITCODE），详见 $logDir\audit-srs-$stamp.txt" }
      & cmd.exe /c "node .\sim-autolevel.mjs --strict > `"$logDir\audit-autolevel-$stamp.txt`" 2>&1"
      if ($LASTEXITCODE -ne 0) { throw "自动进阶回归失败（exit $LASTEXITCODE），详见 $logDir\audit-autolevel-$stamp.txt" }
      & cmd.exe /c "node .\_v93-aggregate.mjs > `"$logDir\audit-aggregate-$stamp.txt`" 2>&1"
      if ($LASTEXITCODE -ne 0) { throw "回归汇总失败（exit $LASTEXITCODE）" }
    } finally { Pop-Location }
    Write-Ok '核心回归门禁通过'
  } else {
    Write-Warn "未找到核心回归脚本（$AuditRoot），跳过 -SkipAudit 可显式跳过"
  }
} else { Write-Warn '已跳过核心回归门禁（-SkipAudit）' }

# ---------------------------------------------------------------------------
# 4. 构建网页产物
# ---------------------------------------------------------------------------
if (-not $SkipBuild) {
  Write-Step 'Vite build...'
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & cmd.exe /c "npm run build > `"$logDir\build-$stamp.txt`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（exit $LASTEXITCODE），详见 $logDir\build-$stamp.txt" }
  Write-Ok 'Vite build 通过'
} else {
  Write-Step '跳过 build（使用现有 build/）'
  if (-not (Test-Path 'build\index.html')) { throw '缺少 build/index.html，无法打包' }
  $buildAge = (Get-Date) - (Get-Item 'build\index.html').LastWriteTime
  Write-Warn ("使用已有 build/（index.html 生成于 {0:yyyy-MM-dd HH:mm:ss}，{1:N1} 小时前）" -f (Get-Item 'build\index.html').LastWriteTime, $buildAge.TotalHours)
}
if (-not (Test-Path 'build\index.html')) { throw '缺少 build/index.html，无法打包' }

# ---------------------------------------------------------------------------
# 5. 组装 staging 并打包 asar
# ---------------------------------------------------------------------------
Write-Step '组装 staging（package.json + electron/ + build/ + GPL 材料）'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item 'local-fork\package.json' (Join-Path $stage 'package.json') -Force
Copy-Item 'local-fork\electron' (Join-Path $stage 'electron') -Recurse -Force
Copy-Item 'build' (Join-Path $stage 'build') -Recurse -Force
foreach ($f in @('LICENSE', 'FORK-NOTICE.md')) {
  if (Test-Path $f) { Copy-Item $f (Join-Path $stage $f) -Force }
}

Write-Step '打包 app.asar（npx @electron/asar）'
$asarOut = Join-Path $stage 'app.asar'
& cmd.exe /c ('npx --yes @electron/asar pack "' + $stage + '" "' + $asarOut + '" 2>&1')
if ($LASTEXITCODE -ne 0) { throw "asar pack 失败（exit $LASTEXITCODE）" }
$hash = Get-Sha256 $asarOut
$size = (Get-Item $asarOut).Length
Write-Step "产物：$asarOut"
Write-Ok "size=$size sha256=$hash"
$info = [ordered]@{
  version     = $ver
  gitSha      = "$gitSha"
  builtAt     = (Get-Date).ToString('o')
  asar        = $asarOut
  size        = $size
  sha256      = $hash
  installDirs = $InstallDirs
}
$info | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $stage 'release-info.json') -Encoding UTF8
"$hash  app.asar" | Set-Content (Join-Path $stage 'SHA256SUMS') -Encoding UTF8

# ---------------------------------------------------------------------------
# 6. 测试安装（原子替换）
# ---------------------------------------------------------------------------
if ($TestInstall) {
  $testTarget = Join-Path $TestAppDir 'resources\app.asar'
  Write-Step "测试安装 -> $testTarget"
  Copy-FileAtomic -source $asarOut -target $testTarget
  $got = Get-Sha256 $testTarget
  if ($got -ne $hash) { throw "测试安装后哈希不一致：$got" }
  Write-Ok "测试安装完成（sha256=$got）"

  if ($Smoke) {
    Write-Step '隔离 profile 冒烟（每次使用全新 profile，避免状态残留）'
    $exe = Join-Path $TestAppDir 'Qwerty Learner.exe'
    $smokeRoot = Join-Path (Split-Path $TestAppDir -Parent) 'smoke'
    New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
    $smokeUser = Join-Path $smokeRoot "userdata-$stamp"
    $smokePlus = Join-Path $smokeRoot "plus-$stamp"
    Stop-Qwerty -pathPrefix $TestAppDir
    Start-Sleep -Milliseconds 600
    Invoke-Smoke -exe $exe -userDir $smokeUser -plusDir $smokePlus -port 9472
  }
}

# ---------------------------------------------------------------------------
# 7. 正式安装（备份→原子替换→校验，失败自动回滚）
# ---------------------------------------------------------------------------
$installLog = $null
if ($Install) {
  Write-Step '正式安装（退出正在运行的 Qwerty Learner）'
  Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.CloseMainWindow() | Out-Null } catch { }
  }
  Start-Sleep -Milliseconds 1200
  Stop-Qwerty
  Start-Sleep -Milliseconds 400

  $firstRes = Join-Path $InstallDirs[0] 'resources'
  $oldHash = Get-Sha256 (Join-Path $firstRes 'app.asar')
  $backupPath = Join-Path $BackupDir "app.asar.before-$ver-$stamp.asar"
  Copy-Item -LiteralPath (Join-Path $firstRes 'app.asar') -Destination $backupPath -Force
  if ((Get-Sha256 $backupPath) -ne $oldHash) { throw "备份校验失败：$backupPath" }
  Write-Ok "已备份当前 asar：$backupPath（sha256=$oldHash）"

  $installed = @()
  $newHashes = @()
  try {
    foreach ($dir in $InstallDirs) {
      $res = Join-Path $dir 'resources'
      $target = Join-Path $res 'app.asar'
      Write-Step "安装 -> $target"
      Copy-FileAtomic -source $asarOut -target $target
      $got = Get-Sha256 $target
      if ($got -ne $hash) { throw "安装后哈希不一致：$target -> $got" }
      foreach ($f in @('LICENSE', 'FORK-NOTICE.md')) {
        if (Test-Path $f) { Copy-Item $f (Join-Path $dir $f) -Force }
      }
      $installed += [ordered]@{ dir = $dir; target = $target; sha256 = $got; size = (Get-Item $target).Length }
      Write-Ok "$target -> $got"
      $newHashes += $got
    }
  } catch {
    Write-Warn "安装失败，回滚到备份：$($_.Exception.Message)"
    foreach ($item in $installed) {
      try { Copy-FileAtomic -source $backupPath -target $item.target } catch { Write-Warn "回滚失败：$($item.target)" }
    }
    throw
  }

  if (($newHashes | Select-Object -Unique).Count -ne 1) { throw '双目录安装后哈希不一致' }

  $installLog = [ordered]@{
    version        = $ver
    gitSha         = "$gitSha"
    installedAt    = (Get-Date).ToString('o')
    asar           = $asarOut
    sha256         = $hash
    size           = $size
    previousSha256 = $oldHash
    backup         = $backupPath
    dirs           = $installed
    smoke          = [bool]$Smoke
  }
  $installLogPath = Join-Path $logDir "qwerty-$ver-installed-$stamp.json"
  $installLog | ConvertTo-Json -Depth 5 | Set-Content $installLogPath -Encoding UTF8
  Write-Ok "安装日志：$installLogPath"
}

# ---------------------------------------------------------------------------
# 8. 清理旧 staging（保留最近 N 份）
# ---------------------------------------------------------------------------
Get-ChildItem $StageRoot -Directory -Filter 'staging-*' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepStaging | ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Recurse -Force; Write-Host "    清理旧 staging：$($_.Name)" -ForegroundColor DarkGray } catch { }
  }

# ---------------------------------------------------------------------------
# 9. 汇总
# ---------------------------------------------------------------------------
Write-Step '完成'
Write-Host "版本:   $ver（git $gitSha）"
Write-Host "asar:   $asarOut"
Write-Host "sha256: $hash"
Write-Host "info:   $(Join-Path $stage 'release-info.json')"
Write-Host "logs:   $logDir"
