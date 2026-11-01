// 页面内浮层（词卡）回归（v11.5，dsh）
//
// 为什么单独做：v11 删掉了注入式面板，enhance.js 只剩「词卡 / 悬停提示 / toast」这些浮层，
// 但它们一条自动化都没有 —— 面板级用例缺失是上一版明确列出的遗留。
//
// 覆盖：qzRuntime.lookupWord 打开词卡、空词不崩、Esc 关闭、点遮罩关闭、点 ✕ 关闭、结束后不留残影。
//
// 用法：node scripts/verify-enhance.mjs [--exe <path>] [--port 9478]
// 退出码：0 全过；1 有失败；2 环境问题。会强制结束自己启动的实例。
import { ensurePortFree, killChild } from './lib/app-files.mjs'
import { resolveDesktopExe } from './lib/desktop-app.mjs'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

let EXE
try {
  EXE = resolveDesktopExe(argOf('exe', ''))
} catch (e) {
  console.error(`VERIFY_ERROR: ${e.message}`)
  process.exit(2)
}
const PORT = Number(argOf('port', process.env.QZ_VERIFY_PORT || 9478))
const GLOBAL_TIMEOUT = Number(process.env.QZ_VERIFY_TIMEOUT || 180000)

let failures = 0
const results = { checks: [], exceptions: [], consoleErrors: [] }
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  results.checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let child
let ws
let profileDir
let seq = 0
const pending = new Map()

const watchdog = setTimeout(() => {
  console.error('VERIFY_TIMEOUT')
  finish(2)
}, GLOBAL_TIMEOUT)

function finish(code) {
  clearTimeout(watchdog)
  try {
    if (ws && ws.readyState === 1) ws.close()
  } catch {
    /* ignore */
  }
  try {
    killChild(child)
  } catch {
    /* 已退出 */
  }
  try {
    if (profileDir) rmSync(profileDir, { recursive: true, force: true })
  } catch {
    /* 占用则留给人清理 */
  }
  console.log(JSON.stringify(results, null, 2))
  process.exit(code)
}

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

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text}`)
  return r.result?.value
}

async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e.message
    }
    await wait(150)
  }
  throw new Error(`等待超时（${label}）：${JSON.stringify(last)}`)
}

async function waitPage() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not ready */
    }
    await wait(400)
  }
  return null
}

// 浮层挂在 #qz-enhance-host 的 shadow root 里（open 模式），必须从 shadowRoot 里查
const SR = `document.querySelector('#qz-enhance-host')?.shadowRoot`
const cardState = () =>
  ev(`(() => {
    const sr = ${SR}
    if (!sr) return { hasHost: false, open: false, word: '', rootEmpty: true }
    const root = sr.querySelector('#qz-wordcard-root')
    const mask = sr.querySelector('#wc-mask')
    const word = sr.querySelector('.wc-word')
    return {
      hasHost: true,
      open: !!mask,
      word: word ? (word.textContent || '').trim() : '',
      rootEmpty: root ? (root.innerHTML || '').trim() === '' : true,
    }
  })()`)

const openCard = (w) => ev(`window.qzRuntime.lookupWord(${JSON.stringify(w)}).then(() => true, () => false)`)

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function main() {
  if (!(await ensurePortFree(PORT))) {
    console.error(`VERIFY_ERROR: 端口 ${PORT} 仍被占用，无法开始`)
    return finish(2)
  }

  profileDir = mkdtempSync(join(tmpdir(), 'qz-verify-enhance-'))
  const env = { ...process.env, QZ_USER_DATA: profileDir, QZ_PLUS_DIR: join(profileDir, 'plus'), QZ_ALLOW_MULTI: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { detached: false, stdio: 'ignore', env })

  const page = await waitPage()
  if (!page) {
    console.error('NO_PAGE')
    return finish(2)
  }

  ws = new WebSocket(page.webSocketDebuggerUrl)
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      clearTimeout(p.timer)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      results.exceptions.push(msg.params?.exceptionDetails?.text || 'unknown')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const line = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ')
      // 查词要走网络：离线环境下 freeLookup 会报 fetch 失败，这不算缺陷
      if (!/fetch|network|net::|ERR_|Failed to load|离线/i.test(line)) results.consoleErrors.push(line)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')

  // 1. 运行时在（enhance.js 是页面加载后注入的，要等，不能立刻断言）
  const ready = await until(
    async () => (await ev(`typeof window.qzRuntime?.lookupWord === 'function' && typeof window.qzRuntime?.toast === 'function'`)) === true,
    30000,
    'qzRuntime 就绪',
  ).catch(() => false)
  const api = await ev(`(() => {
    const rt = window.qzRuntime
    return { ok: !!rt, lookup: typeof rt?.lookupWord, toast: typeof rt?.toast }
  })()`)
  check('1 qzRuntime 暴露 lookupWord / toast', ready === true && api.ok, api)

  // 等首屏（词卡是页面内浮层，需要应用壳就绪）
  await until(async () => (await ev(`!!${SR}?.querySelector('#qz-wordcard-root')`)) === true, 30000, '浮层容器就绪')

  // 2. 打开词卡
  await openCard('apple')
  const opened = await until(
    async () => {
      const s = await cardState()
      return s.open && s.word ? s : null
    },
    15000,
    '词卡打开',
  )
  check('2 lookupWord 打开词卡并显示查询词', opened.open === true && opened.word === 'apple', opened)

  // 3. 空词不打开、不崩
  const empty = await ev(`window.qzRuntime.lookupWord('').then(() => true, () => false)`)
  await wait(300)
  const afterEmpty = await cardState()
  check('3 空词调用不打开词卡（仅提示）', empty === true && afterEmpty.word === 'apple', { empty, afterEmpty })

  // 4. Esc 关闭（v11 补回的全局监听）
  await pressEscape()
  const closedByEsc = await until(
    async () => {
      const s = await cardState()
      return s.rootEmpty ? s : null
    },
    5000,
    'Esc 关闭',
  )
  check('4 Esc 关闭词卡并清空容器', closedByEsc.rootEmpty === true && closedByEsc.open === false, closedByEsc)

  // 5. 点遮罩关闭
  await openCard('book')
  await until(async () => (await cardState()).open, 10000, '再次打开')
  await ev(`(() => {
    const mask = ${SR}?.querySelector('#wc-mask')
    if (!mask) return false
    // 点在遮罩本体（target 是 mask）才应关闭
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })()`)
  const closedByMask = await until(
    async () => {
      const s = await cardState()
      return s.rootEmpty ? s : null
    },
    5000,
    '遮罩关闭',
  )
  check('5 点遮罩关闭词卡', closedByMask.rootEmpty === true, closedByMask)

  // 6. 点 ✕ 关闭
  await openCard('cat')
  await until(async () => (await cardState()).open, 10000, '第三次打开')
  await ev(`(() => { const b = ${SR}?.querySelector('#wc-close'); if (b) b.click(); return !!b })()`)
  const closedByBtn = await until(
    async () => {
      const s = await cardState()
      return s.rootEmpty ? s : null
    },
    5000,
    '按钮关闭',
  )
  check('6 点关闭按钮关闭词卡', closedByBtn.rootEmpty === true, closedByBtn)

  // 7. 关闭后不残留遮罩（避免挡住练习区）
  const residue = await ev(`(() => {
    const sr = ${SR}
    return {
      mask: !!sr?.querySelector('#wc-mask'),
      wordcards: sr ? sr.querySelectorAll('.wordcard').length : 0,
    }
  })()`)
  check('7 关闭后页面不残留遮罩/卡片', residue.mask === false && residue.wordcards === 0, residue)

  // 8. 无异常 / 控制台错误（网络类已过滤）
  check('8 全程无未捕获异常', results.exceptions.length === 0, results.exceptions.slice(0, 3))
  check('8b 全程无控制台错误', results.consoleErrors.length === 0, results.consoleErrors.slice(0, 3))

  finish(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`VERIFY_ERROR: ${e.message}`)
  finish(2)
})
