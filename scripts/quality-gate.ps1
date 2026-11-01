# 兼容包装：实现已统一到 npm 链（node scripts/release.mjs 同款门禁）。
# 保留本文件只为让既有命令继续可用，不再在这里复制一套检查逻辑。
#
# 等价用法：
#   npm run quality                     # 格式 + tsc + eslint + 单测 + 属性测试 + 下载测试 + 核心回归
#   npm run test:quality                # 只跑 tsc + eslint
#   node scripts/dsh-smoke.mjs          # CDP 冒烟（应用需带调试端口）
param(
  [switch]$SkipTypes,
  [switch]$SkipLint,
  [switch]$WithSim,
  [switch]$WithSmoke,
  [int]$SmokePort = 9472
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  if ($WithSmoke) {
    $env:QZ_SMOKE_PORT = "$SmokePort"
    & node scripts/dsh-smoke.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  if ($SkipTypes -and $SkipLint) {
    if ($WithSim) {
      & node scripts/core-regression/run.mjs
      exit $LASTEXITCODE
    }
    Write-Host '    ! 全部跳过（-SkipTypes -SkipLint 且无 -WithSim / -WithSmoke）'
    exit 0
  }
  if ($SkipTypes) {
    & npx eslint src --ext .ts,.tsx --max-warnings 0
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($WithSim) { & node scripts/core-regression/run.mjs; exit $LASTEXITCODE }
    exit 0
  }
  if ($SkipLint) {
    & npx tsc --noEmit -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($WithSim) { & node scripts/core-regression/run.mjs; exit $LASTEXITCODE }
    exit 0
  }
  if ($WithSim) {
    & npm run quality
    exit $LASTEXITCODE
  }
  & npm run test:quality
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
