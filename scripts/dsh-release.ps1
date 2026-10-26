# ============================================================================
# Qwerty Learner Plus — dsh 一键发布脚本（v8.9 起）
# 用途：源码 → Vite build → 组装 asar → 计算 SHA256 → 可选测试安装/正式安装 → 自动备份
# 用法示例：
#   pwsh -File scripts\dsh-release.ps1                          # 只构建，产出 app.asar + SHA256SUMS
#   pwsh -File scripts\dsh-release.ps1 -TestInstall             # 构建并安装到测试目录 D:\整理\qtest9\app
#   pwsh -File scripts\dsh-release.ps1 -Install                 # 构建并安装到两个正式目录（会先退出应用）
#   pwsh -File scripts\dsh-release.ps1 -SkipBuild -Install      # 用已有 build/ 直接打包安装
# 回滚：scripts\dsh-rollback.ps1
# ============================================================================
param(
  [string]$Version = '',
  [switch]$SkipBuild,
  [switch]$TestInstall,
  [switch]$Install,
  [string]$StageRoot = 'D:\整理\QwertyRelease',
  [string]$BackupDir = 'D:\整理\Qwerty备份',
  [string]$TestAppDir = 'D:\整理\qtest9\app',
  [string[]]$InstallDirs = @('D:\bangong\QwertyLearner-Plus', 'D:\bangong\新建文件夹 (2)\Qwerty Learner')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

# 1. 版本：以 local-fork/package.json 为唯一来源（D 批次会进一步收敛到 version.json）
$pack = Get-Content 'local-fork\package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = if ($Version) { $Version } else { $pack.version }
if (-not $ver) { throw '无法确定版本号：local-fork/package.json 缺少 version' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $StageRoot "staging-$ver-$stamp"
$gitSha = (git rev-parse --short HEAD 2>$null)
Write-Step "版本 $ver（git $gitSha），暂存目录 $stage"

# 2. 构建网页产物
if (-not $SkipBuild) {
  Write-Step 'Vite build...'
  & cmd.exe /c 'npm run build 2>&1'
  if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（exit $LASTEXITCODE）" }
} else {
  Write-Step '跳过 build（使用现有 build/）'
}
if (-not (Test-Path 'build\index.html')) { throw '缺少 build/index.html，无法打包' }

# 3. 组装 asar 根目录
Write-Step '组装 staging（package.json + electron/ + build/ + GPL 材料）'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item 'local-fork\package.json' (Join-Path $stage 'package.json') -Force
Copy-Item 'local-fork\electron' (Join-Path $stage 'electron') -Recurse -Force
Copy-Item 'build' (Join-Path $stage 'build') -Recurse -Force
foreach ($f in @('LICENSE', 'FORK-NOTICE.md')) {
  if (Test-Path $f) { Copy-Item $f (Join-Path $stage $f) -Force }
}

# 4. 打包 asar
Write-Step '打包 app.asar（npx @electron/asar）'
$asarOut = Join-Path $stage 'app.asar'
$asarCmd = 'npx --yes @electron/asar pack "' + $stage + '" "' + $asarOut + '" 2>&1'
& cmd.exe /c $asarCmd
if ($LASTEXITCODE -ne 0) { throw "asar pack 失败（exit $LASTEXITCODE）" }

# 5. 校验与索引
$hash = (Get-FileHash $asarOut -Algorithm SHA256).Hash
$size = (Get-Item $asarOut).Length
Write-Step "产物：$asarOut"
Write-Ok "size=$size sha256=$hash"
$info = [ordered]@{
  version   = $ver
  gitSha    = "$gitSha"
  builtAt   = (Get-Date).ToString('o')
  asar      = $asarOut
  size      = $size
  sha256    = $hash
  installDirs = $InstallDirs
}
$info | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $stage 'release-info.json') -Encoding UTF8
"$hash  app.asar" | Set-Content (Join-Path $stage 'SHA256SUMS') -Encoding UTF8

# 6. 测试安装
if ($TestInstall) {
  Write-Step "测试安装 -> $TestAppDir\resources\app.asar"
  $testRes = Join-Path $TestAppDir 'resources'
  if (-not (Test-Path $testRes)) { throw "测试目录不存在：$testRes" }
  Copy-Item $asarOut (Join-Path $testRes 'app.asar') -Force
  Write-Ok '测试安装完成（用 QZ_USER_DATA / QZ_PLUS_DIR 隔离 profile 启动）'
}

# 7. 正式安装
if ($Install) {
  Write-Step '正式安装（先退出正在运行的 Qwerty Learner）'
  Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.CloseMainWindow() | Out-Null } catch { }
  }
  Start-Sleep -Milliseconds 1200
  Get-Process -Name 'Qwerty Learner' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  foreach ($dir in $InstallDirs) {
    $res = Join-Path $dir 'resources'
    $target = Join-Path $res 'app.asar'
    if (-not (Test-Path $target)) { Write-Host "    跳过（不存在）：$target" -ForegroundColor Yellow; continue }
    $bak = Join-Path $BackupDir ("app.asar.staging-before-{0}_{1}.asar" -f $ver, (Get-Date -Format 'yyyyMMdd'))
    Copy-Item $target $bak -Force
    Copy-Item $asarOut $target -Force
    $got = (Get-FileHash $target -Algorithm SHA256).Hash
    Write-Ok "$target -> $got"
    if ($got -ne $hash) { throw "安装后哈希不一致：$target" }
  }
}

Write-Step '完成'
Write-Host "asar:   $asarOut"
Write-Host "sha256: $hash"
Write-Host "info:   $(Join-Path $stage 'release-info.json')"
