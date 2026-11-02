#!/usr/bin/env node
// 跨平台一键发布：质量门禁 → 构建 → 组装 asar → SHA256 → 可选测试安装/冒烟 → 可选正式安装 → 日志
//
// 与旧 PowerShell 版功能一一对应，但不再依赖 Windows / 本机路径：
//   node scripts/release.mjs                     # 门禁 + 构建 + 打包（不安装）
//   node scripts/release.mjs --test-install      # 装到测试目录（--test-app-dir / QZ_TEST_APP_DIR）
//   node scripts/release.mjs --test-install --smoke
//   node scripts/release.mjs --install --install-dirs "/opt/qwerty;/opt/qwerty2"
//   node scripts/release.mjs --skip-build --install
//   node scripts/release.mjs --skip-check --skip-audit
//
// 路径优先级：命令行参数 > 环境变量 > 仓库内默认值（release/ 与 backup/）。
// 回滚：node scripts/rollback.mjs
import { cleanEnv, copyFileAtomic, copyLegalFiles, copyTree, resourcesDirFor, sha256, sizeOf, stampNow, stopApp } from './lib/app-files.mjs'
import { resolveDesktopExe } from './lib/desktop-app.mjs'
import { checkInstallDir } from './lib/install-check.mjs'
import { runSmoke } from './lib/smoke.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 用 fileURLToPath 而不是 import.meta.dirname：后者要 Node 20.11+，而 engines 允许 18
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const APP_NAME = 'Qwerty Learner'

// ---------------------------------------------------------------- 参数
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
function opt(name, fallback = '') {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
function optAll(name) {
  const out = []
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1])
    else if (a.startsWith(`--${name}=`)) out.push(a.slice(name.length + 3))
  })
  return out
}

const version = opt('version')
const skipBuild = flag('skip-build')
const skipCheck = flag('skip-check')
const skipAudit = flag('skip-audit')
const testInstall = flag('test-install')
const install = flag('install')
const smoke = flag('smoke')
const stageRoot = path.resolve(opt('stage-root', process.env.QZ_STAGE_ROOT || path.join(REPO, 'release')))
const backupDir = path.resolve(opt('backup-dir', process.env.QZ_BACKUP_DIR || path.join(REPO, 'backup')))
const auditRoot = path.resolve(opt('audit-dir', process.env.QZ_AUDIT_DIR || path.join(REPO, 'scripts', 'core-regression')))
const testAppDir = path.resolve(opt('test-app-dir', process.env.QZ_TEST_APP_DIR || path.join(stageRoot, 'test-app')))
const installDirs = (
  optAll('install-dirs').length
    ? optAll('install-dirs')
    : (process.env.QZ_INSTALL_DIRS || '')
        .split(/[;]/)
        .map((s) => s.trim())
        .filter(Boolean)
).map((d) => path.resolve(d))
const keepStaging = Number(opt('keep-staging', '5')) || 5

// ---------------------------------------------------------------- 输出
const C = { step: '\u001b[36m', ok: '\u001b[32m', warn: '\u001b[33m', dim: '\u001b[90m', off: '\u001b[0m' }
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.off}` : s)
const step = (m) => console.log(color(C.step, `==> ${m}`))
const ok = (m) => console.log(color(C.ok, `    ${m}`))
const warn = (m) => console.log(color(C.warn, `    ! ${m}`))
const dim = (m) => console.log(color(C.dim, `    ${m}`))
const die = (m) => {
  throw new Error(m)
}

// ---------------------------------------------------------------- 工具
// 跑外部命令：非 0 退出即失败，并把「最后 20 行 + 日志路径」打出来（不吞输出）
function run(cmd, args, { logFile, label, env } = {}) {
  const res = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', env: cleanEnv(env) })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  if (logFile) fs.writeFileSync(logFile, out)
  if (res.status !== 0) {
    if (out.trim()) console.log(out.trim().split('\n').slice(-20).join('\n'))
    die(`${label || cmd} 失败（exit ${res.status}）${logFile ? `，详见 ${logFile}` : ''}`)
  }
  return out
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- 0. 基础信息
fs.mkdirSync(REPO, { recursive: true })
const forkPkgPath = path.join(REPO, 'local-fork', 'package.json')
const forkPkg = JSON.parse(fs.readFileSync(forkPkgPath, 'utf8'))
const ver = version || forkPkg.version
if (!ver) die('无法确定版本号：local-fork/package.json 缺少 version')
if (version && version !== forkPkg.version) warn(`--version=${version} 与 package.json=${forkPkg.version} 不一致（仅本次使用）`)

const stamp = stampNow()
const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout?.trim() || 'unknown'
const stage = path.join(stageRoot, `staging-${ver}-${stamp}`)
const logDir = path.join(REPO, 'logs')
for (const d of [logDir, backupDir, stageRoot]) fs.mkdirSync(d, { recursive: true })
step(`版本 ${ver}（git ${gitSha}），暂存目录 ${stage}`)

// ---------------------------------------------------------------- 1. 预检
if (install) {
  if (!installDirs.length) {
    die(
      [
        '--install 需要至少一个安装目录，任选一种方式指定：',
        '  node scripts/release.mjs --install --install-dirs "<目录1>;<目录2>"',
        '  QZ_INSTALL_DIRS="<目录1>;<目录2>" node scripts/release.mjs --install',
      ].join('\n'),
    )
  }
  const hashes = []
  for (const dir of installDirs) {
    const target = path.join(resourcesDirFor(dir), 'app.asar')
    if (!fs.existsSync(target)) die(`缺少现有 app.asar：${target}`)
    hashes.push(sha256(target))
  }
  if (new Set(hashes).size > 1) die(`各安装目录当前 app.asar 哈希不一致，拒绝自动安装：\n${hashes.join('\n')}`)
  ok(`预检通过：${installDirs.length} 个安装目录存在，当前 asar 哈希一致（${hashes[0].slice(0, 12)}…）`)
}
if (testInstall) {
  if (!fs.existsSync(testAppDir)) die(`测试目录不存在：${testAppDir}（用 --test-app-dir 或 QZ_TEST_APP_DIR 指定）`)
  resolveDesktopExe(testAppDir) // 找不到程序会抛带提示的错误
}

// ---------------------------------------------------------------- 2. tsc
if (!skipCheck) {
  step('TypeScript 检查（tsc --noEmit）...')
  run(nodeBin(), [localBin('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], { label: 'TypeScript 检查' })
  ok('tsc 通过')
} else warn('已跳过 tsc（--skip-check）')

// 仓库内可执行文件（node_modules 里的真实入口，跨平台且不依赖 npx 解析）
function localBin(rel) {
  return path.join(REPO, 'node_modules', ...rel.split('/'))
}
function nodeBin() {
  return process.execPath
}

// ---------------------------------------------------------------- 3. 核心回归
if (!skipAudit) {
  const files = ['build-core.mjs', 'srs-sim.mjs', 'sim-autolevel.mjs', 'aggregate.mjs'].map((f) => path.join(auditRoot, f))
  if (files.every((f) => fs.existsSync(f))) {
    step('核心回归门禁（重建 bundle + srs-sim / sim-autolevel --strict）...')
    const jobs = [
      ['build-core.mjs', [], 'audit-build-core'],
      ['srs-sim.mjs', ['--strict'], 'audit-srs'],
      ['sim-autolevel.mjs', ['--strict'], 'audit-autolevel'],
      ['aggregate.mjs', [], 'audit-aggregate'],
    ]
    for (const [script, extra, tag] of jobs) {
      const res = spawnSync(nodeBin(), [script, ...extra], { cwd: auditRoot, encoding: 'utf8' })
      fs.writeFileSync(path.join(logDir, `${tag}-${stamp}.txt`), `${res.stdout || ''}${res.stderr || ''}`)
      if (res.status !== 0) {
        console.log(`${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-15).join('\n'))
        die(`${script} 失败（exit ${res.status}），详见 ${path.join(logDir, `${tag}-${stamp}.txt`)}`)
      }
    }
    ok('核心回归门禁通过')
  } else warn(`未找到核心回归脚本（${auditRoot}），用 --skip-audit 可显式跳过`)
} else warn('已跳过核心回归门禁（--skip-audit）')

// ---------------------------------------------------------------- 4. 构建
if (!skipBuild) {
  step('Vite build...')
  run(nodeBin(), [localBin('vite/bin/vite.js'), 'build', '--base=./'], {
    logFile: path.join(logDir, `build-${stamp}.txt`),
    label: 'vite build',
    env: { CI: 'false' },
  })
  ok('Vite build 通过')
} else {
  step('跳过 build（使用现有 build/）')
  if (!fs.existsSync(path.join(REPO, 'build', 'index.html'))) die('缺少 build/index.html，无法打包')
  const ageH = (Date.now() - sizeAge(path.join(REPO, 'build', 'index.html'))) / 36e5
  warn(
    `使用已有 build/（index.html 生成于 ${new Date(sizeAge(path.join(REPO, 'build', 'index.html'))).toLocaleString()}，${ageH.toFixed(
      1,
    )} 小时前）`,
  )
}
function sizeAge(p) {
  return fs.statSync(p).mtimeMs
}
if (!fs.existsSync(path.join(REPO, 'build', 'index.html'))) die('缺少 build/index.html，无法打包')

// ---------------------------------------------------------------- 5. 组装 + 打包
step('组装 staging（package.json + electron/ + build/ + GPL 材料）')
fs.mkdirSync(stage, { recursive: true })
const asarOut = path.join(stage, 'app.asar')
let hash
let size
try {
  fs.copyFileSync(forkPkgPath, path.join(stage, 'package.json'))
  copyTree(path.join(REPO, 'local-fork', 'electron'), path.join(stage, 'electron'))
  copyTree(path.join(REPO, 'build'), path.join(stage, 'build'))
  for (const f of ['LICENSE', 'FORK-NOTICE.md']) {
    const src = path.join(REPO, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, f))
  }

  step('打包 app.asar（本地 @electron/asar，无需联网）')
  const asarBin = path.join(REPO, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs')
  if (!fs.existsSync(asarBin)) die('缺少 @electron/asar，请先 npm install')
  // 先打到 staging 之外再移进来：避免 asar 把上一次的 app.asar 当成源文件打进去（体积翻倍/自我包含）
  const asarTmp = path.join(stageRoot, `.app-${stamp}.asar`)
  try {
    run(nodeBin(), [asarBin, 'pack', stage, asarTmp], { label: 'asar pack' })
    fs.renameSync(asarTmp, asarOut)
  } finally {
    try {
      if (fs.existsSync(asarTmp)) fs.rmSync(asarTmp, { force: true })
    } catch {
      /* 已移走 */
    }
  }
  hash = sha256(asarOut)
  size = sizeOf(asarOut)
  step(`产物：${asarOut}`)
  ok(`size=${size} sha256=${hash}`)

  const info = {
    version: ver,
    gitSha,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    asar: asarOut,
    size,
    sha256: hash,
    installDirs,
  }
  fs.writeFileSync(path.join(stage, 'release-info.json'), JSON.stringify(info, null, 2))
  fs.writeFileSync(path.join(stage, 'SHA256SUMS'), `${hash}  app.asar\n`)
} catch (e) {
  warn(`组装/打包失败，清理本次 staging：${stage}`)
  try {
    fs.rmSync(stage, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  throw e
}

// ---------------------------------------------------------------- 6. 测试安装
if (testInstall) {
  const testResources = resourcesDirFor(testAppDir)
  const testTarget = path.join(testResources, 'app.asar')
  step(`测试安装 -> ${testTarget}`)
  copyFileAtomic(asarOut, testTarget)
  const got = sha256(testTarget)
  if (got !== hash) die(`测试安装后哈希不一致：${got}`)
  ok(`测试安装完成（sha256=${got}）`)
  copyLegalFiles(testAppDir, REPO)

  const testCheck = checkInstallDir(testAppDir, { expectedHash: hash })
  if (!testCheck.ok) die(`测试安装体检失败：\n  - ${testCheck.issues.join('\n  - ')}`)
  ok(`测试安装体检通过（asar ${testCheck.info.entries} 个条目，GPL 材料齐全）`)

  if (smoke) {
    step('隔离 profile 冒烟（每次全新 profile，避免状态残留）')
    const exe = resolveDesktopExe(testAppDir)
    const smokeRoot = path.join(testRoot(testAppDir), 'smoke')
    fs.mkdirSync(smokeRoot, { recursive: true })
    stopApp(testAppDir)
    await wait(600)
    const smokeOut = await runSmoke(exe, {
      port: 9472,
      userDir: path.join(smokeRoot, `userdata-${stamp}`),
      plusDir: path.join(smokeRoot, `plus-${stamp}`),
      logFile: path.join(logDir, `smoke-${stamp}.txt`),
    })
    console.log(smokeOut.trim())
    ok('冒烟测试通过')
  }
}
function testRoot(dir) {
  return path.dirname(dir)
}

// ---------------------------------------------------------------- 7. 正式安装
if (install) {
  step('正式安装（退出正在运行的 Qwerty Learner）')
  stopApp()
  await wait(1200)
  stopApp()
  await wait(400)

  // 每个安装目录各备份一份：只备份第一个目录时，若某个目录在安装窗口期被外部改动，
  // 回滚会把第一份写回所有目录，造成版本混用。
  const backups = new Map()
  for (const [index, dir] of installDirs.entries()) {
    const target = path.join(resourcesDirFor(dir), 'app.asar')
    const oldHash = sha256(target)
    const backupPath = path.join(backupDir, `app.asar.before-${ver}-${stamp}-${index}.asar`)
    fs.copyFileSync(target, backupPath)
    if (sha256(backupPath) !== oldHash) die(`备份校验失败：${backupPath}`)
    backups.set(dir, { backupPath, oldHash })
    ok(`已备份 ${dir} -> ${backupPath}（sha256=${oldHash}）`)
  }

  const installed = []
  const newHashes = []
  try {
    for (const dir of installDirs) {
      const target = path.join(resourcesDirFor(dir), 'app.asar')
      step(`安装 -> ${target}`)
      copyFileAtomic(asarOut, target)
      const got = sha256(target)
      if (got !== hash) die(`安装后哈希不一致：${target} -> ${got}`)
      copyLegalFiles(dir, REPO)
      installed.push({ dir, target, sha256: got, size: sizeOf(target) })
      ok(`${target} -> ${got}`)
      newHashes.push(got)
    }
  } catch (e) {
    warn(`安装失败，回滚到备份：${e.message}`)
    const rollbackFailures = []
    for (const item of installed) {
      const backup = backups.get(item.dir)
      try {
        if (!backup) throw new Error('缺少该目录的备份')
        copyFileAtomic(backup.backupPath, item.target)
        if (sha256(item.target) !== backup.oldHash) throw new Error('回滚后哈希不一致')
      } catch (rollbackError) {
        rollbackFailures.push({ dir: item.dir, error: String(rollbackError.message || rollbackError) })
        warn(`回滚失败：${item.target}（${rollbackError.message || rollbackError}）`)
      }
    }
    if (rollbackFailures.length) {
      fs.writeFileSync(
        path.join(logDir, `partial-rollback-${stamp}.json`),
        JSON.stringify({ version: ver, at: new Date().toISOString(), failures: rollbackFailures }, null, 2),
      )
      process.exitCode = 3
      warn(`有 ${rollbackFailures.length} 个目录未能回滚，详见 logs/partial-rollback-${stamp}.json`)
    }
    // 防御性清理失败瞬间可能残留的 .tmp-*
    for (const dir of installDirs) {
      try {
        for (const f of fs.readdirSync(resourcesDirFor(dir))) {
          if (f.startsWith('.tmp-')) fs.rmSync(path.join(resourcesDirFor(dir), f), { force: true })
        }
      } catch {
        /* ignore */
      }
    }
    warn(`本次 staging 保留（内含已通过校验的 app.asar，可直接重试 --skip-build --install）：${stage}`)
    throw e
  }

  if (new Set(newHashes).size !== 1) die('各目录安装后哈希不一致')

  const installLog = {
    version: ver,
    gitSha,
    installedAt: new Date().toISOString(),
    platform: process.platform,
    asar: asarOut,
    sha256: hash,
    size,
    previousSha256: oldHash,
    backup: backupPath,
    dirs: installed,
    smoke,
  }
  // 落盘后体检：asar 完整性 / 关键文件 / .tmp 残留 / GPL 材料（只看结构，不启动应用）
  for (const item of installed) {
    const c = checkInstallDir(item.dir, { expectedHash: hash })
    if (!c.ok) die(`安装体检失败（${item.dir}）：\n  - ${c.issues.join('\n  - ')}`)
  }
  ok('各安装目录体检通过（asar 结构 / GPL 材料 / 无临时残留）')

  const installLogPath = path.join(logDir, `qwerty-${ver}-installed-${stamp}.json`)
  fs.writeFileSync(installLogPath, JSON.stringify(installLog, null, 2))
  ok(`安装日志：${installLogPath}`)
}

// ---------------------------------------------------------------- 8. 清理旧 staging
try {
  const entries = fs
    .readdirSync(stageRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('staging-'))
    .map((d) => ({ name: d.name, at: fs.statSync(path.join(stageRoot, d.name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  for (const old of entries.slice(keepStaging)) {
    try {
      fs.rmSync(path.join(stageRoot, old.name), { recursive: true, force: true })
      dim(`清理旧 staging：${old.name}`)
    } catch {
      /* ignore */
    }
  }
} catch {
  /* 目录不可读就算了 */
}

// ---------------------------------------------------------------- 9. 汇总
step('完成')
console.log(`版本:   ${ver}（git ${gitSha}）`)
console.log(`asar:   ${asarOut}`)
console.log(`sha256: ${hash}`)
console.log(`info:   ${path.join(stage, 'release-info.json')}`)
console.log(`logs:   ${logDir}`)
