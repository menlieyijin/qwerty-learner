#!/usr/bin/env node
// 跨平台一键回滚：从备份目录挑一个 asar 原子替换回安装目录。
//   node scripts/rollback.mjs --list                     # 列出可回滚备份（含版本/哈希/是否当前）
//   node scripts/rollback.mjs                            # 回滚到「与当前不同」的最近备份
//   node scripts/rollback.mjs --asar <xxx.asar>          # 回滚到指定文件
//   node scripts/rollback.mjs --list --all               # 列出全部历史 asar（含非 before-*）
//   node scripts/rollback.mjs --force                    # 目标与当前内容相同时默认中止；--force 才重放
//
// 回滚前会先把当前已安装 asar 备份为 app.asar.pre-rollback-<stamp>.asar（redo 点），
// 因此回滚本身可撤销；替换失败会自动恢复回滚前版本。
import { copyFileAtomic, resourcesDirFor, sha256, sizeOf, stampNow, stopApp, versionFromName } from './lib/app-files.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 用 fileURLToPath 而不是 import.meta.dirname：后者要 Node 20.11+，而 engines 允许 18
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIN_BYTES = 10 * 1024 * 1024

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
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

const list = flag('list')
const all = flag('all')
const force = flag('force')
let asarPath = opt('asar')
const backupDir = path.resolve(opt('backup-dir', process.env.QZ_BACKUP_DIR || path.join(REPO, 'backup')))
const installDirs = (
  optAll('install-dirs').length
    ? optAll('install-dirs')
    : (process.env.QZ_INSTALL_DIRS || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
).map((d) => path.resolve(d))

const C = { step: '\u001b[36m', ok: '\u001b[32m', warn: '\u001b[33m', dim: '\u001b[90m', off: '\u001b[0m' }
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.off}` : s)
const step = (m) => console.log(color(C.step, `==> ${m}`))
const ok = (m) => console.log(color(C.ok, `    ${m}`))
const warn = (m) => console.log(color(C.warn, `    ! ${m}`))

if (!installDirs.length) {
  console.error(
    [
      '需要指定安装目录，任选一种方式：',
      '  node scripts/rollback.mjs --install-dirs "<目录1>;<目录2>"',
      '  QZ_INSTALL_DIRS="<目录1>;<目录2>" node scripts/rollback.mjs',
    ].join('\n'),
  )
  process.exit(2)
}

// ---------------------------------------------------------------- 1. 当前安装状态
const current = []
for (const dir of installDirs) {
  let target
  try {
    target = path.join(resourcesDirFor(dir), 'app.asar')
  } catch (e) {
    warn(`跳过 ${dir}：${e.message.split('\n')[0]}`)
    continue
  }
  if (!fs.existsSync(target)) {
    warn(`缺少当前安装：${target}`)
    continue
  }
  current.push({ dir, path: target, sha256: sha256(target), size: sizeOf(target) })
}
if (!current.length) {
  console.error('未找到任何可回滚的安装目录（检查 --install-dirs / QZ_INSTALL_DIRS）')
  process.exit(2)
}
const currentHashes = [...new Set(current.map((c) => c.sha256))]
if (currentHashes.length > 1 && !force) {
  console.error(`各安装目录当前 asar 哈希不一致，拒绝回滚；确认要统一覆盖请加 --force\n${currentHashes.join('\n')}`)
  process.exit(2)
}
if (currentHashes.length > 1) warn('各目录当前 asar 不一致，--force 将统一覆盖为同一版本')
const currentHash = currentHashes[0]

// ---------------------------------------------------------------- 2. 候选备份
let candidates = []
if (fs.existsSync(backupDir)) {
  for (const name of fs.readdirSync(backupDir)) {
    if (!name.toLowerCase().endsWith('.asar')) continue
    if (!all && !name.includes('before-')) continue
    const full = path.join(backupDir, name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (!st.isFile() || st.size <= MIN_BYTES) continue
    const hash = sha256(full)
    candidates.push({
      at: st.mtimeMs,
      name,
      path: full,
      sizeMB: Math.round((st.size / 1024 / 1024) * 10) / 10,
      version: versionFromName(name),
      sha256: hash,
      isCurrent: hash === currentHash,
    })
  }
}
candidates.sort((a, b) => b.at - a.at)

if (list) {
  if (!candidates.length) {
    warn(`没有可回滚的备份（${backupDir}）`)
    process.exit(0)
  }
  for (const c of candidates) {
    const when = new Date(c.at).toLocaleString()
    console.log(
      `${when}  ${c.version.padEnd(24)} ${String(c.sizeMB).padStart(6)}MB  ${c.sha256.slice(0, 8)}  ${
        c.isCurrent ? '*当前*' : '       '
      }  ${c.name}`,
    )
  }
  console.log(color(C.dim, `当前安装 sha256=${currentHash}`))
  process.exit(0)
}

// ---------------------------------------------------------------- 3. 选择目标
if (!asarPath) {
  let pick = candidates.find((c) => !c.isCurrent)
  if (!pick) {
    if (!candidates.length) {
      console.error(`没有找到可回滚的备份（${backupDir}）`)
      process.exit(2)
    }
    pick = candidates[0]
    warn('所有备份内容都与当前安装相同（回滚将是无操作；如确需重放请加 --force）')
  }
  asarPath = pick.path
}
if (!fs.existsSync(asarPath)) {
  console.error(`asar 不存在：${asarPath}`)
  process.exit(2)
}
const targetSize = sizeOf(asarPath)
if (targetSize < MIN_BYTES) {
  console.error(`备份文件大小异常（<10MB），拒绝回滚：${asarPath}`)
  process.exit(2)
}
const targetHash = sha256(asarPath)
step(`回滚目标：${asarPath}`)
console.log(`    version=${versionFromName(path.basename(asarPath))} sha256=${targetHash} size=${targetSize}`)
if (targetHash === currentHash && !force) {
  // 原来只 warn 就继续，会白跑一次「备份当前 + 原子替换」，消耗 86MB 备份并污染清单
  warn('目标与当前安装内容相同，已中止（无实际变化）。如确需重放一次替换请加 --force')
  process.exit(0)
}
if (targetHash === currentHash) warn('目标与当前版本内容相同（--force 已指定）：将重放一次原子替换')

// ---------------------------------------------------------------- 4. 退出应用
step('退出正在运行的 Qwerty Learner')
stopApp()
await new Promise((r) => setTimeout(r, 600))

// ---------------------------------------------------------------- 5. redo 点 + 逐目录替换
const stamp = stampNow()
const redo = []
for (const item of current) {
  const suffix = currentHashes.length > 1 ? `-${item.sha256.slice(0, 8)}` : ''
  const redoPath = path.join(backupDir, `app.asar.pre-rollback-${stamp}${suffix}.asar`)
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(item.path, redoPath)
  if (sha256(redoPath) !== item.sha256) {
    console.error(`回滚前备份校验失败：${redoPath}`)
    process.exit(2)
  }
  redo.push(redoPath)
}
ok(`已保存回滚前版本（redo 点）：${redo.join('; ')}`)

const restored = []
try {
  for (const item of current) {
    copyFileAtomic(asarPath, item.path)
    const got = sha256(item.path)
    if (got !== targetHash) throw new Error(`回滚后哈希不一致：${item.path}`)
    restored.push({ dir: item.dir, path: item.path, sha256: got, size: sizeOf(item.path) })
    ok(`回滚 -> ${item.path} (${got})`)
  }
} catch (e) {
  warn(`回滚失败，恢复回滚前版本：${e.message}`)
  current.forEach((item, i) => {
    try {
      copyFileAtomic(redo[i], item.path)
    } catch {
      warn(`恢复失败：${item.path}`)
    }
  })
  process.exit(1)
}

const logDir = path.join(REPO, 'logs')
fs.mkdirSync(logDir, { recursive: true })
const logPath = path.join(logDir, `qwerty-rollback-${stamp}.json`)
fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      rolledBackAt: new Date().toISOString(),
      platform: process.platform,
      target: asarPath,
      targetSha256: targetHash,
      targetVersion: versionFromName(path.basename(asarPath)),
      previousSha256: currentHash,
      redoBackups: redo,
      dirs: restored,
    },
    null,
    2,
  ),
)

step('回滚完成（重新启动应用生效）')
console.log(`日志：${logPath}`)
console.log(`如需撤销本次回滚：node scripts/rollback.mjs --asar "${redo[0]}"`)
