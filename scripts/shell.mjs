#!/usr/bin/env node
// 组装可运行的桌面外壳：Electron 发行包 → 替换 app.asar → 平台重命名 → 体检。
//
// 之前这一步是「手工准备一个已装好的外壳目录」，别人 clone 下来跑不起来；
// 这个脚本把「从零得到一个能启动的目录」变成一条命令。
//
//   node scripts/shell.mjs                                  # 用默认 Electron 版本，产出 release/shell-<platform>-<arch>
//   node scripts/shell.mjs --electron-version 43.8.3 --out /tmp/qz-shell
//   node scripts/shell.mjs --zip ~/Downloads/electron-v43.8.3-win32-x64.zip   # 离线：用本地包
//   node scripts/shell.mjs --asar release/staging-.../app.asar                # 指定 asar（默认取最新 staging）
//
// 说明：只做「可运行的绿色目录」，不生成安装器/图标（那需要平台工具链，见 docs/DSH-FORK.md §7）。
import { APP_NAME, copyFileAtomic, copyLegalFiles, sha256, sizeOf, stampNow } from './lib/app-files.mjs'
import { checkInstallDir } from './lib/install-check.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
const flag = (name) => args.includes(`--${name}`)

// 与当前发布的桌面外壳保持一致（安装目录里的 `version` 文件就是它）
const DEFAULT_ELECTRON = '43.8.3'
const MIRROR = opt('mirror', process.env.QZ_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron')

const electronVersion = opt('electron-version', process.env.QZ_ELECTRON_VERSION || DEFAULT_ELECTRON)
const platform = opt('platform', process.platform)
const arch = opt('arch', process.arch === 'x64' ? 'x64' : process.arch)
const outDir = path.resolve(opt('out', path.join(REPO, 'release', `shell-${platform}-${arch}`)))
const zipOverride = opt('zip', '')
const asarOverride = opt('asar', '')
const force = flag('force')

const C = { step: '\u001b[36m', ok: '\u001b[32m', warn: '\u001b[33m', off: '\u001b[0m' }
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.off}` : s)
const step = (m) => console.log(color(C.step, `==> ${m}`))
const ok = (m) => console.log(color(C.ok, `    ${m}`))
const warn = (m) => console.log(color(C.warn, `    ! ${m}`))
const die = (m) => {
  throw new Error(m)
}

// ---------------------------------------------------------------- asar 定位
function latestStagingAsar() {
  // 暂存目录可能是仓库内 release/，也可能是 QZ_STAGE_ROOT 指定的位置
  const roots = [path.join(REPO, 'release')]
  if (process.env.QZ_STAGE_ROOT) roots.unshift(path.resolve(process.env.QZ_STAGE_ROOT))
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('staging-'))
      .map((d) => ({ name: d.name, at: fs.statSync(path.join(root, d.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const d of dirs) {
      const p = path.join(root, d.name, 'app.asar')
      if (fs.existsSync(p)) return p
    }
  }
  return ''
}

const asarPath = asarOverride ? path.resolve(asarOverride) : latestStagingAsar()
if (!asarPath || !fs.existsSync(asarPath)) {
  die(
    [
      '找不到 app.asar。三种办法：',
      '  1) 先跑 npm run release（会在 release/staging-*/ 产出）',
      '  2) node scripts/shell.mjs --asar <app.asar 路径>',
      process.env.QZ_STAGE_ROOT ? `  3) 当前 QZ_STAGE_ROOT=${process.env.QZ_STAGE_ROOT}，确认里面有 staging-*/app.asar` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

// ---------------------------------------------------------------- 目标目录
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) {
  if (!force) die(`输出目录非空：${outDir}\n如确认覆盖请加 --force，或换 --out。`)
  fs.rmSync(outDir, { recursive: true, force: true })
}
fs.mkdirSync(outDir, { recursive: true })

// ---------------------------------------------------------------- 取发行包
const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`
const dlDir = path.join(REPO, 'release', 'downloads')
let zipPath = zipOverride ? path.resolve(zipOverride) : path.join(dlDir, zipName)

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600000) })
  if (!res.ok) die(`下载失败：HTTP ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const tmp = `${dest}.part`
  const out = fs.createWriteStream(tmp)
  let got = 0
  let lastPct = -1
  for await (const chunk of res.body) {
    got += chunk.length
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
    if (total) {
      const pct = Math.floor((got / total) * 100)
      if (pct >= lastPct + 10) {
        lastPct = pct
        process.stdout.write(`\r    下载中 ${pct}%（${Math.round(got / 1024 / 1024)}MB）`)
      }
    }
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
  if (total) process.stdout.write('\r')
  fs.renameSync(tmp, dest)
}

if (!fs.existsSync(zipPath)) {
  const url = `${MIRROR}/${electronVersion}/${zipName}`
  step(`下载 Electron ${electronVersion}（${platform}-${arch}）`)
  console.log(`    ${url}`)
  await download(url, zipPath)
  ok(`已下载 ${zipPath}（${Math.round(sizeOf(zipPath) / 1024 / 1024)}MB）`)
} else {
  ok(`复用已有发行包 ${zipPath}`)
}

// ---------------------------------------------------------------- 解压
function extractZip(zip, dest) {
  // Windows 自带 bsdtar；macOS/Linux 用 unzip；都失败再试 bsdtar
  const candidates =
    process.platform === 'win32'
      ? [
          { cmd: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), args: ['-xf', zip, '-C', dest] },
          { cmd: 'unzip', args: ['-q', '-o', zip, '-d', dest] },
        ]
      : [
          { cmd: 'unzip', args: ['-q', '-o', zip, '-d', dest] },
          { cmd: 'bsdtar', args: ['-xf', zip, '-C', dest] },
          { cmd: 'tar', args: ['-xf', zip, '-C', dest] },
        ]
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, { stdio: 'ignore' })
    if (r.status === 0) return c.cmd
  }
  die('解压失败：没有可用的 zip 解压工具（Windows 需要 System32\\tar.exe，macOS/Linux 需要 unzip 或 bsdtar）')
}

step(`解压到 ${outDir}`)
const used = extractZip(zipPath, outDir)
ok(`解压完成（${used}）`)

// ---------------------------------------------------------------- 平台收尾
const resources = platform === 'darwin' ? path.join(outDir, `${APP_NAME}.app`, 'Contents', 'Resources') : path.join(outDir, 'resources')

function renameIfExists(from, to) {
  if (!fs.existsSync(from)) return false
  fs.renameSync(from, to)
  return true
}

if (platform === 'win32') {
  if (!renameIfExists(path.join(outDir, 'electron.exe'), path.join(outDir, `${APP_NAME}.exe`))) {
    die('发行包里没有 electron.exe，可能下载的是别的平台')
  }
} else if (platform === 'linux') {
  if (!renameIfExists(path.join(outDir, 'electron'), path.join(outDir, 'qwerty-learner'))) {
    die('发行包里没有 electron 可执行文件')
  }
} else if (platform === 'darwin') {
  renameIfExists(path.join(outDir, 'Electron.app'), path.join(outDir, `${APP_NAME}.app`))
  const macos = path.join(outDir, `${APP_NAME}.app`, 'Contents', 'MacOS')
  renameIfExists(path.join(macos, 'Electron'), path.join(macos, APP_NAME))
  // Info.plist 里仍指向 Electron：不 patch 的话 Finder 双击会找不到可执行文件
  const plist = path.join(outDir, `${APP_NAME}.app`, 'Contents', 'Info.plist')
  if (fs.existsSync(plist) && process.platform === 'darwin') {
    for (const [key, value] of [
      ['CFBundleExecutable', APP_NAME],
      ['CFBundleName', APP_NAME],
      ['CFBundleDisplayName', APP_NAME],
    ]) {
      spawnSync('plutil', ['-replace', key, '-string', value, plist], { stdio: 'ignore' })
    }
  } else if (fs.existsSync(plist)) {
    warn('在非 macOS 上无法修改 Info.plist（plutil 不可用）；该 .app 需要在 macOS 上再跑一次 --force')
  }
}

step('放入 app.asar 与 GPL 材料')
fs.mkdirSync(resources, { recursive: true })
copyFileAtomic(asarPath, path.join(resources, 'app.asar'))
// 发行包自带 default_app.asar：留着会让 Electron 在没有 app.asar 时启动默认应用，容易误判
fs.rmSync(path.join(resources, 'default_app.asar'), { force: true })
copyLegalFiles(outDir, REPO)

// ---------------------------------------------------------------- 记录 + 体检
const info = {
  name: APP_NAME,
  electron: electronVersion,
  platform,
  arch,
  asar: asarPath,
  asarSha256: sha256(asarPath),
  asarSize: sizeOf(asarPath),
  builtAt: new Date().toISOString(),
  stamp: stampNow(),
}
fs.writeFileSync(path.join(outDir, 'shell-info.json'), JSON.stringify(info, null, 2))

const check = checkInstallDir(outDir, { expectedHash: info.asarSha256 })
if (!check.ok) die(`外壳体检失败：\n  - ${check.issues.join('\n  - ')}`)

step('完成')
console.log(`目录:   ${outDir}`)
console.log(`Electron: ${electronVersion}（${platform}-${arch}）`)
console.log(`app.asar: ${info.asarSha256.slice(0, 12)}…`)
console.log(`启动:   ${check.info.exe}`)
console.log(`体检:   ${check.info.entries} 个条目，GPL 材料齐全`)
if (platform !== process.platform) {
  warn(`这是为 ${platform} 准备的外壳，当前机器（${process.platform}）无法直接启动它`)
}
