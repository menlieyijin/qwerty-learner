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
import { APP_NAME, copyFileAtomic, copyLegalFiles, extractZip, patchPlistKey, sha256, sizeOf, stampNow } from './lib/app-files.mjs'
import { brandWindowsExe, download, sha256File } from './lib/desktop-tools.mjs'
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
const noBrand = flag('no-brand')
const iconDir = path.join(REPO, 'local-fork', 'icons')

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

/** Electron 官方 SHASUMS256.txt 里的 zip 哈希；取不到就失败（可显式 QZ_SKIP_ELECTRON_VERIFY=1） */
async function expectedSha() {
  if (process.env.QZ_ELECTRON_SHA256) return process.env.QZ_ELECTRON_SHA256.trim().toLowerCase()
  if (process.env.QZ_SKIP_ELECTRON_VERIFY === '1') {
    warn('已跳过 Electron 发行包校验（QZ_SKIP_ELECTRON_VERIFY=1）——只应在完全离线且信任本地包时使用')
    return ''
  }
  const cacheFile = path.join(dlDir, `SHASUMS256-${electronVersion}.txt`)
  let text = ''
  if (fs.existsSync(cacheFile)) text = fs.readFileSync(cacheFile, 'utf8')
  else {
    try {
      const res = await fetch(`${MIRROR}/${electronVersion}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) })
      if (res.ok) {
        text = await res.text()
        fs.mkdirSync(dlDir, { recursive: true })
        fs.writeFileSync(cacheFile, text)
      }
    } catch {
      /* 下面统一报错 */
    }
  }
  const line = text.split(/\r?\n/).find((l) => l.trim().endsWith(`*${zipName}`) || l.trim().endsWith(` ${zipName}`))
  const m = line && line.match(/^([a-f0-9]{64})\s+\*?/)
  if (!m) {
    die(
      [
        `拿不到 Electron ${electronVersion} 的官方校验和（${MIRROR}/${electronVersion}/SHASUMS256.txt）。`,
        '三种办法：',
        '  1) 联网后重试；',
        '  2) QZ_ELECTRON_SHA256=<sha256> 指定你信任的哈希；',
        '  3) 完全离线且信任本地包时，显式 QZ_SKIP_ELECTRON_VERIFY=1。',
      ].join('\n'),
    )
  }
  return m[1]
}

const expectedHash = await expectedSha()

if (fs.existsSync(zipPath)) {
  const got = sha256File(zipPath)
  if (expectedHash && got !== expectedHash) {
    if (zipOverride) die(`本地 --zip 的 SHA256 不符：\n  期望 ${expectedHash}\n  实际 ${got}\n请重新获取官方包。`)
    warn(`已有发行包哈希不符（${got.slice(0, 12)}… ≠ ${expectedHash.slice(0, 12)}…），删除后重新下载`)
    fs.rmSync(zipPath, { force: true })
  } else {
    ok(`复用已有发行包 ${zipPath}（SHA256 已核对）`)
  }
}

if (!fs.existsSync(zipPath)) {
  const url = `${MIRROR}/${electronVersion}/${zipName}`
  step(`下载 Electron ${electronVersion}（${platform}-${arch}）`)
  console.log(`    ${url}`)
  await download(url, zipPath)
  const got = sha256File(zipPath)
  if (expectedHash && got !== expectedHash) {
    fs.rmSync(zipPath, { force: true })
    die(`Electron 发行包校验失败：\n  期望 ${expectedHash}\n  实际 ${got}\n已删除损坏文件，请重试或换 --mirror。`)
  }
  fs.writeFileSync(`${zipPath}.sha256`, `${got}  ${zipName}\n`)
  ok(`已下载 ${zipPath}（${Math.round(sizeOf(zipPath) / 1024 / 1024)}MB，SHA256 ${got.slice(0, 12)}…）`)
}

// ---------------------------------------------------------------- 解压
step(`解压到 ${outDir}`)
const used = extractZip(zipPath, outDir)
ok(`解压完成（${used}）`)

// ---------------------------------------------------------------- 平台收尾
const resources = platform === 'darwin' ? path.join(outDir, `${APP_NAME}.app`, 'Contents', 'Resources') : path.join(outDir, 'resources')

function renameIfExists(from, to) {
  if (!fs.existsSync(from)) return false
  if (fs.existsSync(to)) {
    const empty = fs.statSync(to).isDirectory() && fs.readdirSync(to).length === 0
    if (!empty) throw new Error(`目标已存在且非空，拒绝覆盖：${to}`)
    fs.rmdirSync(to)
  }
  // Windows 上直接 rename 目录会被安全软件/文件系统代理拦成 EPERM（实测 macOS .app 解压后必现）；
  // 同一卷上的 move 是原子重命名，能绕过这层代理，也不复制任何文件。
  if (process.platform === 'win32' && fs.statSync(from).isDirectory()) {
    const r = spawnSync('cmd', ['/c', 'move', from, to], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) throw new Error(`重命名失败：${from} → ${to}\n${(r.stderr || r.stdout || '').trim()}`)
    return true
  }
  fs.renameSync(from, to)
  return true
}

let branded = false
if (platform === 'win32') {
  if (!renameIfExists(path.join(outDir, 'electron.exe'), path.join(outDir, `${APP_NAME}.exe`))) {
    die('发行包里没有 electron.exe，可能下载的是别的平台')
  }
  if (!noBrand && process.platform === 'win32') {
    step('品牌化 exe（图标 + 版本元数据）')
    try {
      const forkPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'local-fork', 'package.json'), 'utf8'))
      const res = await brandWindowsExe(path.join(outDir, `${APP_NAME}.exe`), {
        icon: path.join(iconDir, 'icon.ico'),
        appVersion: forkPkg.version,
      })
      branded = true
      ok(`品牌化完成（文件版本 ${res.version}）`)
    } catch (e) {
      // 外壳本身仍可运行；安装器阶段会再做一次并把它当硬失败，这里只提示
      warn(`品牌化失败，exe 仍显示 Electron 图标/描述：${e.message}`)
    }
  } else if (noBrand) warn('已跳过品牌化（--no-brand）')
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
  const icon = path.join(iconDir, 'icon.icns')
  fs.mkdirSync(resources, { recursive: true })
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(resources, 'icon.icns'))
  if (fs.existsSync(plist)) {
    const keys = [
      ['CFBundleExecutable', APP_NAME],
      ['CFBundleName', APP_NAME],
      ['CFBundleDisplayName', APP_NAME],
      ['CFBundleIconFile', 'icon.icns'],
      ['CFBundleIdentifier', 'com.qwertylearner.desktop'],
    ]
    if (process.platform === 'darwin') {
      for (const [key, value] of keys) spawnSync('plutil', ['-replace', key, '-string', value, plist], { stdio: 'ignore' })
      ok('Info.plist 已用 plutil 更新（名称 / 图标 / bundle id）')
    } else {
      const failed = keys.filter(([k, v]) => !patchPlistKey(plist, k, v)).map(([k]) => k)
      if (failed.length) warn(`非 macOS 上只能改 XML plist，以下键未写入：${failed.join(', ')}；请在 macOS 上重跑 --force`)
      else ok('Info.plist 已按 XML 文本更新（名称 / 图标 / bundle id）')
    }
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
  branded,
}
fs.writeFileSync(path.join(outDir, 'shell-info.json'), JSON.stringify(info, null, 2))

const check = checkInstallDir(outDir, { expectedHash: info.asarSha256, platform })
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
