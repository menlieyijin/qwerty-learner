// 启动桌面程序 + 连接 CDP 的最小封装（验证脚本共用）。
// 只处理「起进程 → 等页面 → 发命令 → 收尾」这些每脚本都要重复一遍的事；
// 断言逻辑仍留在各脚本里，避免把测试意图藏进公共层。
import { ensurePortFree, killChild } from './app-files.mjs'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function openApp({ exe, port, prefix = 'qz-cdp-', pageTimeout = 30000, env = {} }) {
  if (!(await ensurePortFree(port))) throw new Error(`端口 ${port} 仍被占用，无法开始`)
  const profileDir = mkdtempSync(join(tmpdir(), prefix))
  const childEnv = { ...process.env, ...env, QZ_USER_DATA: profileDir, QZ_PLUS_DIR: join(profileDir, 'plus'), QZ_ALLOW_MULTI: '1' }
  // 从 Node/CI 继承 ELECTRON_RUN_AS_NODE 时，Electron 会把调试参数当 Node 参数然后立刻退出
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { detached: false, stdio: 'ignore', env: childEnv })

  let page = null
  const deadline = Date.now() + pageTimeout
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) break
    } catch {
      /* not ready */
    }
    await wait(300)
  }

  if (!page) {
    killChild(child)
    rmSync(profileDir, { recursive: true, force: true })
    throw new Error(`CDP ${port} 在 ${pageTimeout}ms 内未就绪`)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })

  let seq = 0
  const pending = new Map()
  const exceptions = []
  const consoleErrors = []
  const listeners = new Set()

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(p.timer)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params?.exceptionDetails?.text || 'unknown')
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const line = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ')
      if (!/fetch|network|net::|ERR_|Failed to load|离线/i.test(line)) consoleErrors.push(line)
    }
    listeners.forEach((fn) => fn(msg))
  })

  const send = (method, params = {}, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const ev = async (expression, timeoutMs = 15000) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
    return r.result?.value
  }

  const until = async (fn, timeoutMs, label) => {
    const end = Date.now() + timeoutMs
    let last
    while (Date.now() < end) {
      try {
        last = await fn()
        if (last) return last
      } catch (e) {
        last = e.message
      }
      await wait(120)
    }
    throw new Error(`等待超时（${label}）：${JSON.stringify(last)}`)
  }

  const close = async () => {
    try {
      if (ws.readyState === 1) ws.close()
    } catch {
      /* ignore */
    }
    try {
      killChild(child)
    } catch {
      /* ignore */
    }
    // 给进程一点退出时间，再清 profile；清不掉说明仍被占用，留给系统临时目录
    await wait(200)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  return { ws, send, ev, until, close, child, profileDir, exceptions, consoleErrors, onMessage: (fn) => listeners.add(fn) }
}
