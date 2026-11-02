// 冒烟测试：启动指定桌面程序 → 等 CDP → 跑 dsh-smoke.mjs（13 项）→ 收尾。
// release.mjs 与 package.mjs 共用，避免两套「等端口/杀进程」逻辑各自漂移。
import { cleanEnv, stopApp } from './app-files.mjs'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitCdp(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) {
        const j = await r.json()
        if (j.webSocketDebuggerUrl) return true
      }
    } catch {
      /* 还没起来 */
    }
    await wait(400)
  }
  return false
}

/**
 * @param {string} exe 可执行文件
 * @param {{port?:number,userDir:string,plusDir:string,logFile?:string}} opts
 * @returns {Promise<string>} 冒烟脚本的完整输出
 */
export async function runSmoke(exe, { port = 9472, userDir, plusDir, logFile } = {}) {
  fs.mkdirSync(userDir, { recursive: true })
  fs.mkdirSync(plusDir, { recursive: true })
  const env = cleanEnv({ QZ_USER_DATA: userDir, QZ_PLUS_DIR: plusDir, QZ_ALLOW_MULTI: '1', QZ_SMOKE_PORT: String(port) })
  const proc = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore', detached: false })
  try {
    if (!(await waitCdp(port))) throw new Error(`CDP ${port} 在 45s 内未就绪`)
    const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dsh-smoke.mjs')], { cwd: REPO, encoding: 'utf8', env })
    const out = `${res.stdout || ''}${res.stderr || ''}`
    if (logFile) fs.writeFileSync(logFile, out)
    if (res.status !== 0) throw new Error(`冒烟测试失败（exit ${res.status}）${logFile ? `，详见 ${logFile}` : ''}\n${out.trim()}`)
    return out
  } finally {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    stopApp(exe)
  }
}
