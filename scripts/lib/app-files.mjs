// 发布 / 回滚脚本共用的文件与进程操作（跨平台）。
// 只做「确定性、可校验」的动作：哈希、原子替换、退出应用、定位 resources。
import { resolveDesktopExe } from './desktop-app.mjs'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

export const APP_NAME = 'Qwerty Learner'
export const isWindows = process.platform === 'win32'

/** 大写十六进制 SHA256（与旧脚本 Get-FileHash 输出一致，便于对比历史日志） */
export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()
}

export function sizeOf(file) {
  return fs.statSync(file).size
}

/** 本地时间 yyyyMMdd-HHmmss */
export function stampNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 子进程环境：去掉 ELECTRON_RUN_AS_NODE，否则 Electron 会以 Node 模式启动并立刻退出 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * 同卷原子替换：复制到同目录临时文件 → 校验大小 → rename 覆盖。
 * rename 在同一卷上是原子操作，避免安装过程中留下半个 86MB 的 app.asar。
 * 失败时删除临时文件，不在安装目录残留 .tmp-*。
 */
export function copyFileAtomic(source, target) {
  const dir = path.dirname(target)
  const tmp = path.join(dir, `.tmp-${randomUUID().replace(/-/g, '')}-${path.basename(target)}`)
  fs.copyFileSync(source, tmp)
  try {
    if (sizeOf(tmp) !== sizeOf(source)) throw new Error(`临时文件大小不一致：${source}`)
    fs.renameSync(tmp, target)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw e
  }
}

/**
 * 递归复制目录。
 * 不用 fs.cpSync：Node 22.22.2 / Windows 上它对任意目录都会以 0xC0000409（STATUS_STACK_BUFFER_OVERRUN）
 * 直接崩掉进程（不是抛异常，catch 抓不到）。手写遍历可预期、能报错、能逐项处理。
 */
export function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to)
    else fs.copyFileSync(from, to)
  }
}

/** 桌面程序的 resources 目录。
 * 直接看传进来的目录，不去别处找程序：安装/回滚必须作用在「你指定的那个目录」上，
 * 不能因为找不到就回退到仓库产物目录，否则会替换错目标。
 */
export function resourcesDirFor(appDir) {
  const dir = path.resolve(appDir)
  const candidates = dir.endsWith('.app')
    ? [path.join(dir, 'Contents', 'Resources')]
    : [path.join(dir, 'resources'), path.join(dir, 'Contents', 'Resources')]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) throw new Error(`不是可识别的安装目录（缺少 resources）：${dir}`)
  return found
}

/**
 * 退出应用。传入路径前缀时只退出该目录下的实例（测试目录与正式目录可能同时存在）。
 * Windows 用 taskkill（按进程名+路径过滤），macOS/Linux 用 pkill -f。
 */
export function stopApp(prefix = '') {
  if (isWindows) {
    const escaped = String(prefix).replace(/'/g, "''")
    const filter = escaped ? `Where-Object { $_.Path -like '${escaped}*' }` : ''
    const script = `Get-Process -Name '${APP_NAME}' -ErrorAction SilentlyContinue | ${filter} | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }`
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
    return
  }
  if (prefix) spawnSync('pkill', ['-f', prefix], { stdio: 'ignore' })
  spawnSync('pkill', ['-x', APP_NAME], { stdio: 'ignore' })
}

/** 从备份文件名里解析版本号（兼容历史命名） */
export function versionFromName(name) {
  const patterns = [/before-(.+?)-\d{8}-\d{6}/, /staging-before-(.+?)_\d{8}/, /enhanced-(.+?)_\d{8}/]
  for (const re of patterns) {
    const m = name.match(re)
    if (m) return m[1]
  }
  return '(unknown)'
}

// ---------------------------------------------------------------- 端口 / 进程

/** 占用指定 TCP 端口（LISTENING）的进程 PID；查不到返回空数组 */
export function portOwnerPids(port) {
  try {
    if (isWindows) {
      const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).stdout || ''
      const re = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'g')
      const pids = new Set()
      let m
      while ((m = re.exec(out))) pids.add(Number(m[1]))
      return [...pids]
    }
    const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).stdout || ''
    return out
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 结束占用端口的进程（只动这一个端口，不误杀用户正在使用的应用） */
export function killPortOwner(port) {
  const pids = portOwnerPids(port)
  for (const pid of pids) {
    if (isWindows) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* 已退出 */
      }
    }
  }
  return pids
}

/** 端口是否有进程在监听（connect 探测，不用 ping 命令） */
function isPortOpen(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port })
    const done = (v) => {
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    setTimeout(() => done(false), timeoutMs)
  })
}

/** 等到端口不再处于监听状态（Windows 上端口释放有延迟，固定 sleep 会偶发连到旧实例） */
export async function waitPortFree(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/** 结束本进程启动的子进程（含子进程树）；Windows 用 taskkill /T，其余用 SIGKILL */
export function killChild(child) {
  if (!child) return
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* 已退出 */
  }
}

/** 给验证脚本用：确保端口空闲（只清理占用该端口的旧实例） */
export async function ensurePortFree(port) {
  if (portOwnerPids(port).length) killPortOwner(port)
  return waitPortFree(port)
}
