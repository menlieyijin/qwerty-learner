#!/usr/bin/env node
// 把「可运行的绿色目录」打成可分发产物：
//   Windows：品牌化 exe（rcedit）→ NSIS 安装器 → 静默安装/启动/卸载验证
//   Linux  ：tar.gz（含 .desktop 与图标）
//   macOS  ：写入 .icns / Info.plist → zip（签名与 dmg 需在 macOS 上做）
//
//   npm run package                          # 当前平台，默认 release/shell-<platform>-<arch>
//   npm run package -- --app-dir <目录>
//   npm run package -- --no-verify           # 只产出，不做安装/卸载验证
//   npm run package -- --platform linux --app-dir release/shell-linux-x64
//
// 依赖：Windows 需要 rcedit + NSIS（脚本自动下载到 .tools/，带 SHA256 校验）；
// Linux 需要 tar；macOS 需要 zip（ditto 优先）。都可离线：见 docs/DSH-FORK.md §7.4。
import { verifyIcons } from './icons.mjs'
import { APP_NAME, copyFileAtomic, copyLegalFiles, sha256, sizeOf, stampNow } from './lib/app-files.mjs'
import { brandWindowsExe, ensureNsis, icoPng, numericVersion, sha256File, windowsExeInfo } from './lib/desktop-tools.mjs'
import { checkInstallDir } from './lib/install-check.mjs'
import { runSmoke } from './lib/smoke.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
const flag = (name) => args.includes(`--${name}`)

const platform = opt('platform', process.platform)
const arch = opt('arch', process.arch)
const verify = !flag('no-verify')
const skipBrand = flag('skip-brand')
const keepTemp = flag('keep-temp')
const outDir = path.resolve(opt('out', path.join(REPO, 'release')))
const appDir = path.resolve(opt('app-dir', process.env.QZ_APP_DIR || path.join(REPO, 'release', `shell-${platform}-${arch}`)))
const ICONS = path.join(REPO, 'local-fork', 'icons')

const C = { step: '\u001b[36m', ok: '\u001b[32m', warn: '\u001b[33m', off: '\u001b[0m' }
const color = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.off}` : s)
const step = (m) => console.log(color(C.step, `==> ${m}`))
const ok = (m) => console.log(color(C.ok, `    ${m}`))
const warn = (m) => console.log(color(C.warn, `    ! ${m}`))
const die = (m) => {
  throw new Error(m)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const forkPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'local-fork', 'package.json'), 'utf8'))
const appVersion = forkPkg.version
const short = (appVersion.match(/enhanced-(v[\d.]+)/) || [])[1] || appVersion
const fileVersion = numericVersion(appVersion)

function assertAppDir() {
  if (!fs.existsSync(appDir)) die(`外壳目录不存在：${appDir}\n先运行 npm run shell，或用 --app-dir 指定。`)
  const exe = path.join(appDir, platform === 'win32' ? `${APP_NAME}.exe` : platform === 'darwin' ? `${APP_NAME}.app` : 'qwerty-learner')
  if (!fs.existsSync(exe)) die(`目录里没有 ${path.basename(exe)}，可能不是为 ${platform} 组装的外壳。`)
  return exe
}

function ensureIcons() {
  const r = verifyIcons(ICONS)
  if (!r.ok) die(`图标校验失败（先运行 npm run icons）：\n  - ${r.issues.join('\n  - ')}`)
  ok(`图标就绪（ico / icns / 1024 png）`)
}

function run(cmd, argv, { label = cmd, logFile, cwd = REPO } = {}) {
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8', windowsHide: true })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  if (logFile) fs.writeFileSync(logFile, out)
  if (res.status !== 0) {
    console.log(out.trim().split('\n').slice(-25).join('\n'))
    die(`${label} 失败（exit ${res.status}）${logFile ? `，详见 ${logFile}` : ''}`)
  }
  return out
}

/** 取一个不含空格的临时目录：NSIS 的 /D= 参数不允许带引号，路径含空格会解析失败 */
function asciiTempDir(prefix) {
  const candidates = [os.tmpdir(), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'qz-temp')]
  const base = candidates.find((p) => p && !p.includes(' '))
  if (!base) die(`找不到不含空格的临时目录（NSIS /D 限制）：${candidates.join(' / ')}`)
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, prefix))
}

function pngDiffRatio(aBuf, bBuf) {
  const a = PNG.sync.read(aBuf)
  const b = PNG.sync.read(bBuf)
  if (a.width !== b.width || a.height !== b.height) return 1
  let sum = 0
  for (let i = 0; i < a.data.length; i += 1) sum += Math.abs(a.data[i] - b.data[i])
  return sum / (a.data.length * 255)
}

function writeSums(files, name = `SHA256SUMS-${short}.txt`) {
  const lines = files.map((f) => `${sha256(f)}  ${path.basename(f)}`)
  const p = path.join(outDir, name)
  fs.writeFileSync(p, `${lines.join('\n')}\n`)
  ok(`校验和：${p}`)
  return p
}

// ---------------------------------------------------------------- Windows
async function packageWindows(exe) {
  step(`Windows 产物：${short}`)
  if (!skipBrand) {
    step('品牌化 exe（图标 + 版本元数据，rcedit）')
    await brandWindowsExe(exe, { icon: path.join(ICONS, 'icon.ico'), appVersion })
    const info = windowsExeInfo(exe)
    if (!info) die('写入后读不到 exe 版本信息')
    const bad = []
    if (!String(info.FileVersion || '').startsWith(fileVersion)) bad.push(`FileVersion=${info.FileVersion}，期望 ${fileVersion}`)
    if (info.ProductName !== APP_NAME) bad.push(`ProductName=${info.ProductName}`)
    if (!String(info.ProductVersion || '').includes(short)) bad.push(`ProductVersion=${info.ProductVersion}，期望含 ${short}`)
    if (bad.length) die(`品牌化校验失败：\n  - ${bad.join('\n  - ')}`)
    ok(`版本资源：${info.FileVersion} / ${info.ProductVersion}`)

    // 图标是否真的进资源：从 exe 提取 32px 图标，与 ico 里的 32px 图对比
    const tmpPng = path.join(asciiTempDir('qz-icon-'), 'icon.png')
    const esc = (s) => s.replace(/'/g, "''")
    const ps = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon('${esc(
      exe,
    )}'); if(-not $i){exit 3}; $i.ToBitmap().Save('${esc(tmpPng)}',[System.Drawing.Imaging.ImageFormat]::Png)`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true })
    if (r.status === 0 && fs.existsSync(tmpPng)) {
      const want = icoPng(path.join(ICONS, 'icon.ico'), 32)
      const ratio = want ? pngDiffRatio(want, fs.readFileSync(tmpPng)) : 1
      if (ratio > 0.15) warn(`exe 图标与预期差异 ${(ratio * 100).toFixed(1)}%（阈值 15%），请人工看一眼任务栏图标`)
      else ok(`exe 图标已替换（与 32px 源图差异 ${(ratio * 100).toFixed(1)}%）`)
      if (!keepTemp) fs.rmSync(path.dirname(tmpPng), { recursive: true, force: true })
    } else {
      warn(`无法从 exe 提取图标做比对（PowerShell exit ${r.status}），跳过图标像素校验`)
    }
  } else warn('已跳过品牌化（--skip-brand）')

  step('生成 NSIS 安装器')
  const makensis = await ensureNsis()
  const buildDir = path.join(outDir, 'installer')
  fs.mkdirSync(buildDir, { recursive: true })
  const setup = path.join(outDir, `QwertyLearner-${short}-win-${arch}-Setup.exe`)
  const nsi = path.join(REPO, 'scripts', 'templates', 'installer.nsi')
  const logFile = path.join(buildDir, `makensis-${stampNow()}.log`)
  run(
    makensis,
    [
      '/V2',
      `/DAPP_NAME=${APP_NAME}`,
      `/DAPP_EXE=${path.basename(exe)}`,
      `/DAPP_VERSION=${appVersion}`,
      `/DAPP_FILE_VERSION=${fileVersion}`,
      `/DAPP_DIR=${appDir}`,
      `/DOUT_FILE=${setup}`,
      `/DICON_FILE=${path.join(ICONS, 'icon.ico')}`,
      nsi,
    ],
    { label: 'makensis', logFile },
  )
  if (!fs.existsSync(setup)) die(`makensis 没有产出安装器：${setup}`)
  ok(`安装器：${setup}（${(sizeOf(setup) / 1024 / 1024).toFixed(1)}MB）`)

  const sums = writeSums([setup])
  if (!verify) {
    warn('已跳过安装/卸载验证（--no-verify）')
    return { primary: setup, sums }
  }
  return verifyWindowsInstaller(setup, exe)
}

async function verifyWindowsInstaller(setup, sourceExe) {
  step('验证安装器：静默安装 → 校验 → 启动冒烟 → 静默卸载')
  // 目录名不要带空格：NSIS 的 /D= 与卸载器 _?= 都不接受引号
  const testDir = path.join(asciiTempDir('qz-install-'), 'app')
  let installed = false
  try {
    // /D= 必须是最后一个参数，且不能加引号（NSIS 限制）
    const r = spawnSync(setup, ['/S', '/NODESKTOP', `/D=${testDir}`], { encoding: 'utf8', windowsHide: true, timeout: 600000 })
    if (r.status !== 0) die(`静默安装失败（exit ${r.status}）：${(r.stderr || r.stdout || '').trim()}`)
    installed = true
    const exe = path.join(testDir, `${APP_NAME}.exe`)
    if (!fs.existsSync(exe)) die(`安装后缺少主程序：${exe}`)
    const markers = ['.qz-install', 'Uninstall.exe', 'LICENSE', 'FORK-NOTICE.md']
    const miss = markers.filter((m) => !fs.existsSync(path.join(testDir, m)))
    if (miss.length) die(`安装目录缺少：${miss.join(', ')}`)
    ok(`已安装到 ${testDir}`)

    const sourceAsar = path.join(appDir, 'resources', 'app.asar')
    const expected = sha256(sourceAsar)
    const check = checkInstallDir(testDir, { expectedHash: expected })
    if (!check.ok) die(`安装体检失败：\n  - ${check.issues.join('\n  - ')}`)
    ok(`安装体检通过（${check.info.entries} 个条目，asar 哈希一致）`)

    const info = windowsExeInfo(exe)
    if (!info || !String(info.FileVersion || '').startsWith(fileVersion)) die(`安装后的 exe 版本元数据不符：${JSON.stringify(info)}`)
    ok(`安装后版本资源：${info.FileVersion}`)

    step('启动冒烟（隔离 profile，13 项）')
    const smokeRoot = path.join(testDir, '..', 'smoke')
    const out = await runSmoke(exe, {
      port: 9481,
      userDir: path.join(smokeRoot, 'userdata'),
      plusDir: path.join(smokeRoot, 'plus'),
      logFile: path.join(outDir, 'installer', 'smoke.txt'),
    })
    // dsh-smoke 输出的是 {check: boolean} JSON；退出码 0 之外再核对一遍条目数，避免「空对象也算过」
    let smoke = {}
    try {
      smoke = JSON.parse(out.trim())
    } catch {
      /* 下面按 0 项处理 */
    }
    const total = Object.keys(smoke).length
    const passed = Object.values(smoke).filter((v) => v === true).length
    if (total < 13 || passed !== total) die(`冒烟结果不完整：${passed}/${total} 项通过`)
    ok(`冒烟通过（${passed}/${total} 项）`)

    step('静默卸载')
    const uninst = path.join(testDir, 'Uninstall.exe')
    // 不加 _?=：卸载器会先把自己复制到临时目录，才能把安装目录整个删掉
    const u = spawnSync(uninst, ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 300000 })
    if (u.status !== 0) die(`静默卸载失败（exit ${u.status}）：${(u.stderr || u.stdout || '').trim()}`)
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && fs.existsSync(path.join(testDir, `${APP_NAME}.exe`))) await wait(300)
    if (fs.existsSync(path.join(testDir, `${APP_NAME}.exe`)) || fs.existsSync(path.join(testDir, 'resources'))) {
      die(`卸载后仍有程序文件：${testDir}`)
    }
    ok('卸载完成，程序目录已清理')
    installed = false
    return { primary: setup, verified: true }
  } finally {
    if (installed) {
      try {
        const uninst = path.join(testDir, 'Uninstall.exe')
        if (fs.existsSync(uninst)) spawnSync(uninst, ['/S'], { windowsHide: true, timeout: 120000 })
      } catch {
        /* ignore */
      }
    }
    if (!keepTemp) fs.rmSync(path.dirname(testDir), { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- Linux
function packageLinux(exe) {
  step(`Linux 产物：${short}`)
  const desktop = path.join(appDir, 'qwerty-learner.desktop')
  fs.writeFileSync(
    desktop,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Qwerty Learner',
      'Comment=Qwerty Learner 桌面版（本地增强版）',
      `Exec=${path.basename(exe)}`,
      'Icon=qwerty-learner',
      'Terminal=false',
      'Categories=Education;Languages;',
    ].join('\n') + '\n',
  )
  copyFileAtomic(path.join(ICONS, 'icon.png'), path.join(appDir, 'qwerty-learner.png'))
  copyLegalFiles(appDir, REPO)
  const tgz = path.join(outDir, `QwertyLearner-${short}-linux-${arch}.tar.gz`)
  // Windows 上的 GNU tar 会把 "D:" 当成远程主机；--force-local 关掉这个解析。
  // bsdtar 不支持该参数，所以先正常跑，失败再带参数重试。
  const gnuTar = /GNU tar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '')
  const tar = (argv, label) => run('tar', process.platform === 'win32' && gnuTar ? ['--force-local', ...argv] : argv, { label })
  tar(['-czf', tgz, '-C', appDir, '.'], 'tar')
  const list = tar(['-tzf', tgz], 'tar -t')
  for (const must of [path.basename(exe), 'resources/app.asar', 'qwerty-learner.desktop', 'qwerty-learner.png', 'LICENSE']) {
    if (!list.includes(must)) die(`tar 包缺少 ${must}`)
  }
  ok(`tar.gz：${tgz}（${(sizeOf(tgz) / 1024 / 1024).toFixed(1)}MB）`)
  writeSums([tgz])
  return { primary: tgz }
}

// ---------------------------------------------------------------- macOS
function patchPlist(plist, key, value) {
  const buf = fs.readFileSync(plist)
  if (buf.subarray(0, 6).toString('ascii') === 'bplist') return false // 二进制 plist 只能靠 plutil
  const text = buf.toString('utf8')
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
  if (!re.test(text)) return false
  fs.writeFileSync(plist, text.replace(re, `$1${value}$2`))
  return true
}

function packageDarwin() {
  step(`macOS 产物：${short}`)
  const app = path.join(appDir, `${APP_NAME}.app`)
  const resources = path.join(app, 'Contents', 'Resources')
  const plist = path.join(app, 'Contents', 'Info.plist')
  copyFileAtomic(path.join(ICONS, 'icon.icns'), path.join(resources, 'icon.icns'))
  if (process.platform === 'darwin') {
    run('plutil', ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', plist], { label: 'plutil' })
    run('plutil', ['-replace', 'CFBundleIdentifier', '-string', 'com.qwertylearner.desktop', plist], { label: 'plutil' })
  } else if (!patchPlist(plist, 'CFBundleIconFile', 'icon.icns')) {
    warn('Info.plist 不是 XML 或缺少 CFBundleIconFile，无法在非 macOS 上改图标键；请在 macOS 上重跑 --force')
  }
  copyLegalFiles(path.join(app, 'Contents', 'Resources'), REPO)
  // macOS 上优先用 ditto（保留资源分支/权限）；其它平台没有 ditto，退而求其次：
  // 有 zip 用 zip，没有就出 tar.gz（同样保留权限/符号链接），并在结尾明确提示需在 macOS 上重打。
  const hasZip = spawnSync('zip', ['-v'], { encoding: 'utf8' }).status === 0
  let archive
  let ext
  if (process.platform === 'darwin') {
    ext = 'zip'
    archive = path.join(outDir, `QwertyLearner-${short}-mac-${arch}.${ext}`)
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], { label: 'ditto' })
  } else if (hasZip) {
    ext = 'zip'
    archive = path.join(outDir, `QwertyLearner-${short}-mac-${arch}.${ext}`)
    run('zip', ['-qry', archive, path.basename(app)], { label: 'zip', cwd: appDir })
  } else {
    ext = 'tar.gz'
    archive = path.join(outDir, `QwertyLearner-${short}-mac-${arch}.${ext}`)
    const gnuTar = /GNU tar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '')
    run('tar', [...(process.platform === 'win32' && gnuTar ? ['--force-local'] : []), '-czf', archive, '-C', appDir, path.basename(app)], {
      label: 'tar',
    })
    warn('当前机器没有 zip/ditto，已产出 tar.gz；dmg/zip 与签名仍需在 macOS 上生成。')
  }
  ok(`产物：${archive}（${(sizeOf(archive) / 1024 / 1024).toFixed(1)}MB）`)
  warn('未签名/未公证：首次打开需右键「打开」，或 xattr -dr com.apple.quarantine；dmg 与签名需在 macOS 上做。')
  writeSums([archive])
  return { primary: archive }
}

// ---------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  step(`打包 ${APP_NAME} ${appVersion}（${platform}-${arch}）`)
  const exe = assertAppDir()
  ensureIcons()
  const infoPath = path.join(appDir, 'shell-info.json')
  if (fs.existsSync(infoPath)) ok(`外壳信息：${JSON.parse(fs.readFileSync(infoPath, 'utf8')).builtAt || '未知时间'}`)
  else warn('缺少 shell-info.json（不是 npm run shell 组装的目录），继续但无法核对 asar 来源')

  let result
  if (platform === 'win32') result = await packageWindows(exe)
  else if (platform === 'linux') result = packageLinux(exe)
  else if (platform === 'darwin') result = packageDarwin()
  else die(`不支持的平台：${platform}`)

  step('完成')
  console.log(`产物：${result.primary}`)
  console.log(`版本：${appVersion}（文件版本 ${fileVersion}）`)
  if (result.verified) console.log('安装/启动/卸载：已验证')
}

main().catch((e) => {
  console.error(`PACKAGE_ERROR: ${e.message}`)
  process.exitCode = 1
})
