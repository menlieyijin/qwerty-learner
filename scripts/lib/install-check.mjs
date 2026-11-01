// 安装目录体检：确认「这个目录真的能跑、且合规」。
// 为什么单独做：安装是原子替换 + 拷贝几个文件，出错时往往只表现为「应用打不开」，
// 现场很难判断是 asar 坏了、还是 LICENSE 没带、还是上次失败留下的 .tmp。
import { resourcesDirFor, sha256, sizeOf } from './app-files.mjs'
import { resolveDesktopExe } from './desktop-app.mjs'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// asar 里必须存在的条目（相对包根，统一用 / 分隔）
const REQUIRED = ['/package.json', '/electron/main.js', '/build/index.html']
const LEGAL = ['LICENSE', 'FORK-NOTICE.md']

export function checkInstallDir(dir, { expectedHash = '' } = {}) {
  const issues = []
  const info = { dir: path.resolve(dir) }

  if (!fs.existsSync(dir)) {
    return { ok: false, issues: [`目录不存在：${dir}`], info }
  }

  let exe = ''
  try {
    exe = resolveDesktopExe(dir)
    info.exe = exe
  } catch (e) {
    issues.push(`找不到可执行文件：${e.message.split('\n')[0]}`)
  }

  let asar = ''
  try {
    asar = path.join(resourcesDirFor(dir), 'app.asar')
  } catch (e) {
    return { ok: false, issues: [...issues, e.message], info }
  }
  if (!fs.existsSync(asar)) {
    return { ok: false, issues: [...issues, `缺少 app.asar：${asar}`], info }
  }

  info.asar = asar
  info.size = sizeOf(asar)
  info.sha256 = sha256(asar)
  if (expectedHash && info.sha256 !== expectedHash) {
    issues.push(`app.asar 哈希不符：期望 ${expectedHash}，实际 ${info.sha256}`)
  }

  // asar 结构：能读出目录且关键文件在，才说明包是完整的（截断的 asar 读头就会抛）
  try {
    const { listPackage } = requireAsar()
    const entries = listPackage(asar).map((p) => p.replace(/\\/g, '/'))
    info.entries = entries.length
    for (const must of REQUIRED) {
      if (!entries.includes(must)) issues.push(`asar 缺少 ${must}`)
    }
  } catch (e) {
    issues.push(`asar 无法读取（可能被截断）：${String(e.message || e).slice(0, 120)}`)
  }

  // 上次安装失败可能留下的临时文件
  try {
    const resDir = path.dirname(asar)
    const stray = fs.readdirSync(resDir).filter((f) => f.startsWith('.tmp-'))
    if (stray.length) issues.push(`resources 下有 ${stray.length} 个残留临时文件：${stray.slice(0, 3).join(', ')}`)
  } catch {
    /* 目录读不了已在上面报过 */
  }

  // GPL 合规：安装目录根部要有许可证与 fork 声明
  for (const f of LEGAL) {
    if (!fs.existsSync(path.join(dir, f))) issues.push(`安装目录缺少 ${f}（GPL 合规要求）`)
  }

  return { ok: issues.length === 0, issues, info }
}

const require = createRequire(import.meta.url)
let asarModule = null
function requireAsar() {
  if (!asarModule) asarModule = require('@electron/asar')
  return asarModule
}
