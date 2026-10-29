// 打字主链路回归（v10.1，dsh）
//
// 目的：给「拆分 Word / SoundSetting」提供行为护栏。冒烟只验「练习能开始」，这里验的是逐操作：
//   1 首屏有当前词；
//   2 敲一个字母 → 进入输入态（出现「暂停」按钮）；
//   3 敲错一个字母 → 该位置变红（wrong 态）；
//   4 补完整个词 → 切到下一个词，且记录库新增（wordRecords / memoryRecords）；
//   5 暂停 → 写入一条会话记录（chapterRecords），再点开始可继续；
//   6 设置面板：三个开关 + 三个滑块存在，切换「单词发音」后 localStorage 的 pronunciationConfig 翻转；
//   7 全程无未捕获异常 / 控制台错误。
//
// 用法：node scripts/verify-typing.mjs [--exe <path>] [--port 9477]
// 退出码：0 全过；1 有失败；2 环境问题。会强制结束正在运行的 Qwerty Learner。

import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const EXE = argOf('exe', process.env.QZ_VERIFY_EXE || 'D:\\整理\\qtest9\\app\\Qwerty Learner.exe')
const PORT = Number(argOf('port', process.env.QZ_VERIFY_PORT || 9477))
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
    if (child) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
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
    await wait(200)
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

/** 当前词与已正确的字母数（字母 span 的 class 反映状态） */
const readWordState = () =>
  ev(`(() => {
    const el = document.querySelector('[data-testid="current-word"]')
    if (!el) return { word: '', correct: 0, wrong: 0 }
    const spans = [...el.querySelectorAll('span')]
    const correct = spans.filter((s) => /text-green-600|text-green-400/.test(s.className)).length
    const wrong = spans.filter((s) => /text-red-600|text-red-400/.test(s.className)).length
    return { word: el.textContent || '', correct, wrong, spans: spans.length }
  })()`)

// 说明：应用自身的按键监听在 window 上，而 react-hotkeys-hook（Enter/开始暂停）绑在 document 上。
// 从 body 派发并冒泡，两种监听都能收到；直接派发到 window 则到不了 document。
const press = (key) =>
  ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); true`)

const dbCount = (store) =>
  ev(`(() => new Promise((resolve) => {
    const req = indexedDB.open('RecordDB')
    req.onerror = () => resolve(-1)
    req.onsuccess = () => {
      const db = req.result
      let n = -1
      try {
        const tx = db.transaction(${JSON.stringify(store)}, 'readonly')
        const cr = tx.objectStore(${JSON.stringify(store)}).count()
        cr.onsuccess = () => { n = cr.result }
        tx.oncomplete = () => { db.close(); resolve(n) }
        tx.onerror = () => { db.close(); resolve(-1) }
      } catch (e) { db.close(); resolve(-1) }
    }
  }))()`)

async function main() {
  try {
    execFileSync('taskkill', ['/IM', 'Qwerty Learner.exe', '/F'], { stdio: 'ignore' })
    await wait(800)
  } catch {
    /* 没有在运行 */
  }

  profileDir = mkdtempSync(join(tmpdir(), 'qz-verify-typing-'))
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
    }
    if (msg.method === 'Runtime.exceptionThrown') results.exceptions.push(msg.params?.exceptionDetails?.text || 'exception')
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      results.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '))
    }
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true })
  })
  await send('Runtime.enable')

  // 1) 首屏有词
  const first = await until(async () => {
    const s = await readWordState()
    return s.word.length >= 2 && s.spans >= 2 ? s : null
  }, 30000, '首屏出词')
  check('1 首屏出现当前词', first.word.length >= 2, { word: first.word, letters: first.spans })

  // 关闭「首次起点弹窗」干扰：如果存在就选“以后再说”，避免遮挡
  const picker = await ev(`!!document.querySelector('[data-testid="start-level-cet6"]')`)
  if (picker) {
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('以后再说')); if (b) b.click(); return true })()`)
    await wait(600)
  }

  // 2) 敲第一个字母 → 进入输入态
  const w0 = (await readWordState()).word
  await press(w0[0].toLowerCase())
  const typing = await until(async () => (await ev(`!!document.querySelector('button[aria-label="暂停"]')`)) === true, 10000, '进入输入态')
  check('2 敲一个字母即进入输入态（出现「暂停」按钮）', typing === true)

  // 3) 敲错一个字母 → 出现 wrong 态
  const s1 = await readWordState()
  const wrongKey = s1.correct < s1.word.length ? (s1.word[s1.correct].toLowerCase() === 'z' ? 'q' : 'z') : 'q'
  await press(wrongKey)
  const wrongShown = await until(async () => (await readWordState()).wrong > 0, 8000, '出现错误字母')
  check('3 敲错字母后该位置标红（wrong 态）', wrongShown === true, await readWordState())

  // 4) 补完整个词 → 切词 + 落库
  const before = { word: await dbCount('wordRecords'), mem: await dbCount('memoryRecords') }
  let guard = 0
  let finished = false
  let lastWord = (await readWordState()).word
  while (guard < 40) {
    guard += 1
    const s = await readWordState()
    if (!s.word) break
    if (s.word !== lastWord && s.correct === 0) {
      finished = true
      break
    }
    const idx = s.correct
    if (idx >= s.word.length) {
      await wait(300) // 等结算与切词
      const after = await readWordState()
      if (after.word !== s.word) {
        finished = true
        break
      }
      continue
    }
    await press(s.word[idx].toLowerCase())
    await wait(120)
  }
  check('4 正确敲完整个词后切到下一个词', finished === true, { guard, lastWord })

  const afterWord = await dbCount('wordRecords')
  const afterMem = await dbCount('memoryRecords')
  check('4b 完成一个词后记录库新增（wordRecords 或 memoryRecords）', afterWord > before.word || afterMem > before.mem, {
    wordRecords: [before.word, afterWord],
    memoryRecords: [before.mem, afterMem],
  })

  // 5) 暂停 → 写会话记录；再继续
  await press('Enter')
  await wait(1200)
  const paused = await ev(`!!document.querySelector('button[aria-label="开始"]')`)
  const chapters = await dbCount('chapterRecords')
  check('5 Enter 可暂停（按钮回到「开始」）', paused === true)
  check('5b 暂停后写入会话记录 chapterRecords', chapters >= 1, chapters)

  // 6) 设置面板：开关与滑块 + 配置持久化
  await ev(`(() => { const b = document.querySelector('button[title="打开设置对话框"]'); if (b) b.click(); return true })()`)
  await until(async () => (await ev(`document.body.innerText.includes('音效设置')`)) === true, 10000, '设置面板')
  const controls = await ev(`({
    switches: document.querySelectorAll('[role="switch"]').length,
    sliders: document.querySelectorAll('[role="slider"]').length,
    labels: [...document.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute('aria-label')),
  })`)
  check('6 音效设置里有 ≥3 个开关与 ≥3 个滑块', controls.switches >= 3 && controls.sliders >= 3, controls)

  // 新 profile 里 pronunciationConfig 尚未落盘（atomForConfig 只在需要合并/写回时才写），
  // 所以用 Radix Switch 的 data-state 作为 UI 真相，再确认 localStorage 已随之写入。
  const switchState = () => ev(`(() => {
    const s = document.querySelector('[aria-label="单词发音开关"]')
    if (!s) return null
    let stored = null
    try { stored = JSON.parse(localStorage.getItem('pronunciation') || 'null') } catch { stored = null }
    // Headless UI 的 Switch 用 aria-checked 表达状态（Radix 才是 data-state）
    return { ui: s.getAttribute('aria-checked'), storedOpen: stored ? stored.isOpen : null }
  })()`)
  const sBefore = await switchState()
  await ev(`(() => { const s = document.querySelector('[aria-label="单词发音开关"]'); if (!s) return false; s.click(); return true })()`)
  await wait(700)
  const sAfter = await switchState()
  check('6b 切换「单词发音」开关后 UI 翻转且配置落盘', !!sBefore && !!sAfter && sBefore.ui !== sAfter.ui && sAfter.storedOpen !== null, {
    before: sBefore,
    after: sAfter,
  })
  await ev(`(() => { const s = document.querySelector('[aria-label="单词发音开关"]'); if (s) s.click(); return true })()`)
  await wait(500)
  const sRestored = await switchState()
  check('6c 再切回后 UI 与配置恢复', !!sRestored && sRestored.ui === sBefore.ui && sRestored.storedOpen === (sAfter.storedOpen === true ? false : true), sRestored)

  // 6d 滑块接线：键盘右移一格，配置里的 volume 应从 1 涨不动、从 1 开始测「左移」
  //（默认 volume=1 已在上限，按左移才看得出变化；Radix Slider 的键盘交互绑在 Thumb 上）
  const volBefore = await ev(`(() => { const c = JSON.parse(localStorage.getItem('pronunciation') || 'null'); return c ? c.volume : null })()`)
  await ev(`(() => {
    const t = document.querySelector('[aria-label="单词发音音量"]')
    if (!t) return false
    t.focus()
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    return true
  })()`)
  await wait(600)
  const volAfter = await ev(`(() => { const c = JSON.parse(localStorage.getItem('pronunciation') || 'null'); return c ? c.volume : null })()`)
  check('6d 音量滑块键盘左移后配置随之下降', typeof volBefore === 'number' && typeof volAfter === 'number' && volAfter < volBefore, {
    before: volBefore,
    after: volAfter,
  })

  // 8) 默写模式（hideAll）：字母占位为 `_`，直接检验 letterVisibility 抽出的规则
  await ev(`localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: true, type: 'hideAll', openBy: 'auto' })); true`)
  await ev(`location.reload(); true`).catch(() => undefined)
  await wait(1600)
  await until(async () => (await ev(`!!document.querySelector('[data-testid="current-word"]')`)) === true, 25000, 'reload')
  const hidden = await ev(`(() => {
    const el = document.querySelector('[data-testid="current-word"]')
    return el ? (el.textContent || '') : ''
  })()`)
  check('8 默写（hideAll）时当前词全部显示为占位符', hidden.length > 0 && /^_+$/.test(hidden.replace(/\s/g, '')), hidden)
  await ev(`localStorage.removeItem('wordDictationConfig'); true`)
  await ev(`location.reload(); true`).catch(() => undefined)
  await wait(1500)
  await until(async () => (await ev(`!!document.querySelector('[data-testid="current-word"]')`)) === true, 25000, 'reload-2')
  const shown = await ev(`(() => { const el = document.querySelector('[data-testid="current-word"]'); return el ? (el.textContent || '') : '' })()`)
  check('8b 关闭默写后当前词恢复可见', shown.length > 0 && !/_/.test(shown), shown)

  const noisy = results.consoleErrors.filter((e) => !/favicon|Autofill|React DevTools/i.test(e))
  check('7 全程无未捕获异常', results.exceptions.length === 0, results.exceptions.slice(0, 3))
  check('7b 全程无控制台错误', noisy.length === 0, noisy.slice(0, 3))

  return finish(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`VERIFY_ERROR: ${e.message}`)
  results.error = e.message
  finish(2)
})
