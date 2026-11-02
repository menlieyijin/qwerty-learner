// 桌面打包工具链：rcedit（品牌化）+ NSIS（安装器）的下载、校验与调用。
//
// 这两个工具都不进仓库：按需下载到 .tools/（已 gitignore），并对 rcedit 做 SHA256 校验。
// 也支持完全离线：QZ_RCEDIT_EXE / QZ_NSIS_DIR / QZ_NSIS_ZIP 指向本地文件。
import { extractZip } from './app-files.mjs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const TOOLS_DIR = path.resolve(process.env.QZ_TOOLS_DIR || path.join(REPO, '.tools'))

export const RCEDIT = {
  version: '2.0.0',
  file: 'rcedit-x64.exe',
  sha256: '3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a',
  urls: [
    'https://ghfast.top/https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe',
    'https://gh-proxy.com/https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe',
    'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe',
  ],
}

export const NSIS = {
  version: '3.10',
  file: 'nsis-3.10.zip',
  dir: 'nsis-3.10',
  sha256: 'fcdce3229717a2a148e7cda0ab5bdb667f39d8fb33ede1da8dabc336bd5ad110',
  urls: [
    'https://sourceforge.net/projects/nsis/files/NSIS%203/3.10/nsis-3.10.zip/download',
    'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.10/nsis-3.10.zip',
  ],
}

export const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0)

/** 带断点续传的下载（.part 文件 + Range），大文件失败后不用从头再来 */
export async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let start = sizeOf(part)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const headers = start > 0 ? { Range: `bytes=${start}-` } : {}
      const res = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(900000) })
      if (res.status === 416 && start > 0) {
        // 本地 .part 已经不比远端短：直接认为完成
        fs.renameSync(part, dest)
        return { bytes: sizeOf(dest), resumed: true }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (res.status === 200) start = 0
      const total = Number(res.headers.get('content-length') || 0) + (res.status === 206 ? start : 0)
      const out = fs.createWriteStream(part, { flags: res.status === 206 && start > 0 ? 'a' : 'w' })
      let got = start
      for await (const chunk of res.body) {
        got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      if (total && got !== total) throw new Error(`长度不符：收到 ${got} / 期望 ${total}`)
      fs.renameSync(part, dest)
      return { bytes: got, resumed: start > 0 }
    } catch (e) {
      start = sizeOf(part)
      if (attempt === 2) throw new Error(`下载失败 ${url}\n  ${e.message}`)
    }
  }
  throw new Error(`下载失败：${url}`)
}

async function fetchVerified(url, dest, sha256) {
  await download(url, dest)
  const got = sha256File(dest)
  if (got !== sha256) {
    fs.rmSync(dest, { force: true })
    throw new Error(`校验失败 ${path.basename(dest)}：${got} ≠ ${sha256}`)
  }
}

/** 返回可用的 rcedit 路径；非 Windows 直接报错（rcedit 是 Windows PE 工具） */
export async function ensureRcedit() {
  if (process.env.QZ_RCEDIT_EXE) {
    const p = path.resolve(process.env.QZ_RCEDIT_EXE)
    if (!fs.existsSync(p)) throw new Error(`QZ_RCEDIT_EXE 不存在：${p}`)
    return p
  }
  const target = path.join(TOOLS_DIR, RCEDIT.file)
  if (fs.existsSync(target) && sha256File(target) === RCEDIT.sha256) return target
  if (fs.existsSync(target)) fs.rmSync(target, { force: true })
  if (process.platform !== 'win32') {
    throw new Error('品牌化 Windows 可执行文件需要 rcedit（Windows PE 工具），请在 Windows 上运行，或用 QZ_RCEDIT_EXE 指定。')
  }
  let last
  for (const url of RCEDIT.urls) {
    try {
      console.log(`    下载 rcedit ${RCEDIT.version}（${url}）`)
      await fetchVerified(url, target, RCEDIT.sha256)
      return target
    } catch (e) {
      last = e
    }
  }
  throw new Error(`rcedit 下载失败：${last?.message || '未知错误'}\n可手动下载后放到 ${target}，或设置 QZ_RCEDIT_EXE。`)
}

/** 返回 makensis 可执行文件；Windows 用下载的 NSIS，其它平台用 PATH 里的 makensis */
export async function ensureNsis() {
  if (process.env.QZ_NSIS_DIR) {
    const p = path.join(path.resolve(process.env.QZ_NSIS_DIR), 'makensis.exe')
    if (fs.existsSync(p)) return p
  }
  if (process.platform !== 'win32') {
    const r = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' })
    if (r.status === 0) return 'makensis'
    throw new Error('未找到 makensis。Linux/macOS 请安装 nsis（apt install nsis / brew install makensis），或设置 QZ_NSIS_DIR。')
  }
  const dir = path.join(TOOLS_DIR, NSIS.dir)
  const exe = path.join(dir, 'makensis.exe')
  if (fs.existsSync(exe)) return exe
  const zip = path.join(TOOLS_DIR, NSIS.file)
  if (!fs.existsSync(zip) || sha256File(zip) !== NSIS.sha256) {
    if (fs.existsSync(zip)) fs.rmSync(zip, { force: true })
    let last
    for (const url of NSIS.urls) {
      try {
        console.log(`    下载 NSIS ${NSIS.version}（${url}）`)
        await fetchVerified(url, zip, NSIS.sha256)
        last = null
        break
      } catch (e) {
        last = e
      }
    }
    if (last) throw new Error(`NSIS 下载失败：${last.message}\n可手动下载 ${NSIS.file} 放到 ${zip}，或设置 QZ_NSIS_DIR。`)
  }
  fs.mkdirSync(dir, { recursive: true })
  // 官方 zip 自带 nsis-3.10/ 顶层目录，解压到 .tools 即可
  extractZip(zip, TOOLS_DIR)
  if (!fs.existsSync(exe)) throw new Error(`NSIS 解压后缺少 makensis.exe：${exe}`)
  return exe
}

/** 应用版本 → Windows 四段数字版本。1.0.0-enhanced-v11.6.0 → 11.6.0.0 */
export function numericVersion(appVersion) {
  // 版本号形如 1.0.0-enhanced-v11.6.0：取 enhanced-v 之后的那一段，而不是前面的基础版本
  const s = String(appVersion)
  const m = s.match(/enhanced-v(\d+)\.(\d+)\.(\d+)/) || s.match(/(\d+)\.(\d+)\.(\d+)\s*$/) || s.match(/v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return '1.0.0.0'
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), 0].map((n) => Math.min(65535, Math.max(0, n)))
  return parts.join('.')
}

const PRODUCT = {
  name: 'Qwerty Learner',
  company: 'Qwerty Learner Contributors',
  copyright: 'GPL-3.0-or-later',
  description: 'Qwerty Learner 桌面版（本地增强版）',
}

/** 写入图标与版本元数据；失败时把 rcedit 输出原样带回 */
export async function brandWindowsExe(exe, { icon, appVersion }) {
  if (!fs.existsSync(exe)) throw new Error(`找不到可执行文件：${exe}`)
  if (!fs.existsSync(icon)) throw new Error(`找不到图标：${icon}`)
  const rcedit = await ensureRcedit()
  const ver = numericVersion(appVersion)
  const args = [
    exe,
    '--set-icon',
    icon,
    '--set-file-version',
    ver,
    '--set-product-version',
    ver,
    '--set-version-string',
    'FileDescription',
    PRODUCT.description,
    '--set-version-string',
    'ProductName',
    PRODUCT.name,
    '--set-version-string',
    'CompanyName',
    PRODUCT.company,
    '--set-version-string',
    'LegalCopyright',
    PRODUCT.copyright,
    '--set-version-string',
    'OriginalFilename',
    path.basename(exe),
    '--set-version-string',
    'InternalName',
    path.basename(exe, path.extname(exe)),
    '--set-version-string',
    'FileVersion',
    ver,
    '--set-version-string',
    'ProductVersion',
    String(appVersion),
  ]
  const r = spawnSync(rcedit, args, { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error(`rcedit 失败（exit ${r.status}）：${(r.stderr || r.stdout || '').trim()}`)
  return { version: ver }
}

/** 读取 exe 的版本资源（Windows 用 PowerShell；其它平台返回 null） */
export function windowsExeInfo(exe) {
  if (process.platform !== 'win32') return null
  const esc = exe.replace(/'/g, "''")
  const script = `$v=(Get-Item -LiteralPath '${esc}').VersionInfo; [pscustomobject]@{FileVersion=$v.FileVersion;ProductVersion=$v.ProductVersion;FileDescription=$v.FileDescription;ProductName=$v.ProductName;CompanyName=$v.CompanyName;OriginalFilename=$v.OriginalFilename} | ConvertTo-Json -Compress`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) return null
  try {
    return JSON.parse((r.stdout || '').trim())
  } catch {
    return null
  }
}

/** 从 ico 里取指定尺寸的 PNG（用于校验品牌化后的图标是否真的被替换） */
export function icoPng(icoFile, size = 32) {
  const buf = fs.readFileSync(icoFile)
  const count = buf.readUInt16LE(4)
  for (let i = 0; i < count; i += 1) {
    const e = 6 + 16 * i
    const s = buf.readUInt8(e) === 0 ? 256 : buf.readUInt8(e)
    if (s === size) {
      const bytes = buf.readUInt32LE(e + 8)
      const off = buf.readUInt32LE(e + 12)
      return buf.subarray(off, off + bytes)
    }
  }
  return null
}
