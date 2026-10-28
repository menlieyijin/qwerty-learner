<#
.SYNOPSIS
    Qwerty Learner — 本地质量门禁（v9.5 / L-08）

.DESCRIPTION
    一条命令跑完提交前必须通过的检查，避免"只跑了 build 没跑类型/lint"的漏网：
      1) tsc --noEmit -p tsconfig.json        （类型检查，0 error 才算通过）
      2) eslint src --ext .ts,.tsx --max-warnings 0（严格 lint，任何 warning 都算失败）
      3) 可选：核心算法回归（-WithSim，跑 audit 目录里的 SRS / 自动进阶仿真，需脚本存在）
      4) 可选：CDP 冒烟（-WithSmoke，需先以隔离 profile + --remote-debugging-port 启动应用）
    不负责 build / 安装 / commit（分别由 dsh-release.ps1 与人工负责）。

.PARAMETER SkipTypecheck
    跳过 tsc（仅在你已单独验证过类型时使用）。

.PARAMETER SkipLint
    跳过 eslint。

.PARAMETER WithSim
    追加运行核心算法回归：audit 目录下的 srs-sim.mjs 与 sim-autolevel.mjs（--strict）。

.PARAMETER WithSmoke
    追加运行 CDP 冒烟：node scripts/dsh-smoke.mjs（应用需已在 -SmokePort 上开好 CDP）。

.PARAMETER SmokePort
    冒烟使用的 CDP 端口，默认 9472（与 dsh-smoke.mjs 默认一致；隔离测试建议 94xx）。

.PARAMETER SimDir
    核心算法回归脚本所在目录；保留内置默认值，可用 -SimDir 或环境变量 QZ_AUDIT_DIR 覆盖。

.EXAMPLE
    pwsh -File scripts/quality-gate.ps1
    只跑类型 + 严格 lint（日常提交前用）。

.EXAMPLE
    pwsh -File scripts/quality-gate.ps1 -WithSim -WithSmoke -SmokePort 9472
    全量门禁（发布前用；需先以 QZ_USER_DATA 隔离 profile 启动应用）。

.NOTES
    Exit 0 = 全绿；Exit 1 = 有步骤失败（失败详情见各步骤输出与 $env:TEMP 下的日志）。
#>
[CmdletBinding()]
param(
    [switch]$SkipTypecheck,
    [switch]$SkipLint,
    [switch]$WithSim,
    [switch]$WithSmoke,
    [int]$SmokePort = 9472,
    [string]$SimDir = $(if ($env:QZ_AUDIT_DIR) { $env:QZ_AUDIT_DIR } else { 'D:\整理\audit' })
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    throw "仓库根目录识别失败（$repoRoot 下没有 package.json）"
}
$results = New-Object System.Collections.ArrayList

function Write-Step([string]$text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Fail([string]$text) { Write-Host "    FAIL $text" -ForegroundColor Red }
function Write-Skip([string]$text) { Write-Host "    SKIP $text" -ForegroundColor DarkGray }

function Add-Result([string]$name, [string]$status, [string]$detail) {
    [void]$results.Add([pscustomobject]@{ Step = $name; Status = $status; Detail = $detail })
}

function Invoke-Node([string[]]$arguments) {
    # 用 node_modules 里已装的可执行文件，避免依赖全局 npx 解析差异。
    # 注意：子进程的 stdout/stderr 必须经 Write-Host 转发（信息流），否则会被当成函数返回值，
    # 导致 $code 变成一整段 lint 文本而不是退出码。
    # v9.15（dsh，M5-010）：删除从未使用的 $label 形参
    $npx = Join-Path $repoRoot 'node_modules\.bin\npx.cmd'
    if (-not (Test-Path $npx)) { $npx = 'npx.cmd' }
    & $npx @arguments 2>&1 | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}

Push-Location $repoRoot
$started = Get-Date
Write-Host "Qwerty Learner 质量门禁开始：$repoRoot" -ForegroundColor White
Write-Host "时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

try {
    # ---------- 1) 类型检查 ----------
    if ($SkipTypecheck) {
        Write-Step 'TypeScript 类型检查（跳过）'
        Write-Skip '已指定 -SkipTypecheck'
        Add-Result 'tsc' 'skipped' ''
    }
    else {
        Write-Step 'TypeScript 类型检查：tsc --noEmit -p tsconfig.json'
        $code = Invoke-Node -arguments @('tsc', '--noEmit', '-p', 'tsconfig.json')
        if ($code -ne 0) {
            Write-Fail "tsc 有类型错误（exit $code）"
            Add-Result 'tsc' 'failed' "exit $code"
        }
        else {
            Write-Ok 'tsc 0 error'
            Add-Result 'tsc' 'passed' '0 error'
        }
    }

    # ---------- 2) 严格 lint ----------
    if ($SkipLint) {
        Write-Step 'ESLint（跳过）'
        Write-Skip '已指定 -SkipLint'
        Add-Result 'eslint' 'skipped' ''
    }
    else {
        Write-Step 'ESLint 严格模式：eslint src --ext .ts,.tsx --max-warnings 0'
        $code = Invoke-Node -arguments @('eslint', 'src', '--ext', '.ts,.tsx', '--max-warnings', '0')
        if ($code -ne 0) {
            Write-Fail "eslint 未通过（exit $code；warning 也算失败）"
            Add-Result 'eslint' 'failed' "exit $code"
        }
        else {
            Write-Ok 'eslint 0 error / 0 warning'
            Add-Result 'eslint' 'passed' '0 error / 0 warning'
        }
    }

    # ---------- 3) 核心算法回归（可选） ----------
    if ($WithSim) {
        Write-Step "核心算法回归（$SimDir）"
        $sims = @(
            @{ Name = 'srs-sim'; Path = (Join-Path $SimDir 'srs-sim.mjs') },
            @{ Name = 'sim-autolevel'; Path = (Join-Path $SimDir 'sim-autolevel.mjs') }
        )
        foreach ($sim in $sims) {
            if (-not (Test-Path $sim.Path)) {
                Write-Skip "$($sim.Name) 不存在：$($sim.Path)"
                Add-Result $sim.Name 'skipped' '脚本不存在'
                continue
            }
            & node $sim.Path --strict
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "$($sim.Name) --strict 未通过（exit $LASTEXITCODE）"
                Add-Result $sim.Name 'failed' "exit $LASTEXITCODE"
            }
            else {
                Write-Ok "$($sim.Name) --strict 通过"
                Add-Result $sim.Name 'passed' '--strict'
            }
        }
    }

    # ---------- 4) CDP 冒烟（可选） ----------
    if ($WithSmoke) {
        Write-Step "CDP 冒烟：node scripts/dsh-smoke.mjs（端口 $SmokePort）"
        $smoke = Join-Path $repoRoot 'scripts\dsh-smoke.mjs'
        if (-not (Test-Path $smoke)) {
            Write-Skip "冒烟脚本不存在：$smoke"
            Add-Result 'smoke' 'skipped' '脚本不存在'
        }
        else {
            $env:QZ_SMOKE_PORT = "$SmokePort"
            & node $smoke
            $code = $LASTEXITCODE
            if ($code -ne 0) {
                Write-Fail "冒烟失败（exit $code；2 = 连不上 CDP，请先以隔离 profile 启动应用）"
                Add-Result 'smoke' 'failed' "exit $code"
            }
            else {
                Write-Ok '冒烟通过'
                Add-Result 'smoke' 'passed' "port $SmokePort"
            }
        }
    }
}
finally {
    Pop-Location
}

# ---------- 汇总 ----------
$failed = @($results | Where-Object { $_.Status -eq 'failed' })
Write-Host ''
Write-Host '================ 质量门禁汇总 ================' -ForegroundColor White
foreach ($r in $results) {
    $color = switch ($r.Status) { 'passed' { 'Green' } 'failed' { 'Red' } default { 'DarkGray' } }
    Write-Host ("  {0,-14} {1,-8} {2}" -f $r.Step, $r.Status, $r.Detail) -ForegroundColor $color
}
$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
if ($failed.Count -gt 0) {
    Write-Host "结果：FAIL（$($failed.Count) 项失败，耗时 ${elapsed}s）" -ForegroundColor Red
    exit 1
}
Write-Host "结果：PASS（耗时 ${elapsed}s）" -ForegroundColor Green
exit 0
