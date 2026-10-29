// Qwerty Learner Plus — 起点选择行为级验证（CDP，v9.16 / dsh）
//
// 与 dsh-smoke.mjs 的区别：冒烟只验「应用能起来、面板能开」，这里验的是**选完之后学习行为对不对**：
//   1. 首次打开（全新 profile）确实弹起点选择；
//   2. 选「六级」后：走的是 cet6 级别、真的去取 CET6 词表、顶栏显示「大学六级」；
//   3. 重启后不再弹窗，级别仍是 cet6（持久化生效）；
//   4. 从词库页改「初中」后：立刻切到 junior-1 并取初中词表（不需要重启）；
//   5. 老用户路径（有进阶状态、没有起点记录）不会被弹窗拦住。
//
// 用法：
//   node scripts/verify-start-level.mjs
//   node scripts/verify-start-level.mjs --exe "D:\path\Qwerty Learner.exe" --port 9474
// 退出码：0 全部通过；1 有断言失败；2 环境问题（连不上 / 启动失败 / 超时）。
//
// 注意：会强制结束正在运行的 Qwerty Learner（单实例锁会让新进程直接退出）。请先保存正在练的内容。

import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const EXE = argOf('exe', process.env.QZ_VERIFY_EXE || 'D:\\整理\\qtest9\\app\\Qwerty Learner.exe')
const PORT = Number(argOf('port', process.env.QZ_VERIFY_PORT || 9474))
const GLOBAL_TIMEOUT = Number(process.env.QZ_VERIFY_TIMEOUT || 120000)
const SEND_TIMEOUT = 15000

const results = { ts: new Date().toISOString(), exe: EXE, port: PORT, checks: [], consoleErrors: [], exceptions: [] }
let failures = 0

const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  return ok
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const watchdog = setTimeout(() => {
  console.error(`VERIFY_TIMEOUT（总超时 ${GLOBAL_TIMEOUT}ms）`)
  finish(2)
}, GLOBAL_TIMEOUT)

let child
let ws
let profileDir

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
    /* 已经退出 */
  }
  try {
    if (profileDir) rmSync(profileDir, { recursive: true, force: true })
  } catch {
    /* 被占用时留给人清理 */
  }
  console.log(JSON.stringify(results, null, 2))
  process.exit(code)
}

// --- CDP 通道 -------------------------------------------------------------
let seq = 0
const pending = new Map()

const send = (method, params = {}, timeoutMs = SEND_TIMEOUT) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP 超时：${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })

/** 在页面里执行表达式并取回 JSON 值 */
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text} ${expression.slice(0, 80)}`)
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

const readState = () =>
  ev(`(() => {
    const parse = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
    return {
      start: parse('qzLearningStart'),
      level: (parse('qzAutoLevelState') || {}).levelId || null,
      bodyText: document.body ? document.body.innerText : '',
      hasPicker: !!document.querySelector('[data-testid="start-level-cet6"]'),
    }
  })()`)

// 用 CDP 的 Network 域收集请求：Electron 下 file:// 的 fetch 不一定进 performance 条目，
// 而 Network.requestWillBeSent 对所有请求都生效，更适合证明「词表真的去取了」。
const reqUrls = []
const dictsSince = (mark) =>
  reqUrls
    .slice(mark)
    .filter((n) => n.includes('/dicts/'))
    .map((n) => n.split('/').pop())
const markRequests = () => reqUrls.length

const clickSel = (sel) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)

const clickByText = (text) =>
  ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(${JSON.stringify(text)}))
    if (!btn) return false
    btn.click(); return true
  })()`)

const reload = async () => {
  await ev(`location.reload(); true`).catch(() => undefined)
  await wait(1200)
  await until(async () => (await ev(`document.readyState === 'complete' && !!document.getElementById('root')`)) === true, 20000, 'reload')
  await wait(800)
}

// --- 主流程 ---------------------------------------------------------------
async function main() {
  // 单实例锁：先结束所有正在运行的实例，否则新进程会把参数交给旧进程后直接退出
  try {
    execFileSync('taskkill', ['/IM', 'Qwerty Learner.exe', '/F'], { stdio: 'ignore' })
    await wait(800)
  } catch {
    /* 没有在运行 */
  }

  profileDir = mkdtempSync(join(tmpdir(), 'qz-verify-'))
  // 隔离 profile：应用自己认 QZ_USER_DATA / QZ_PLUS_DIR 两个环境变量（见 local-fork/electron/main.js），
  // 用 --user-data-dir 会被应用的参数校验拒掉。QZ_ALLOW_MULTI 允许与正式安装版并行。
  const env = { ...process.env, QZ_USER_DATA: profileDir, QZ_PLUS_DIR: join(profileDir, 'plus'), QZ_ALLOW_MULTI: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { detached: false, stdio: 'ignore', env })

  const page = await waitPage()
  if (!page) {
    console.error('NO_PAGE（CDP 在超时内不可用，检查 exe 路径与端口是否被占用）')
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
    if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) reqUrls.push(msg.params.request.url)
    if (msg.method === 'Runtime.exceptionThrown') results.exceptions.push(msg.params?.exceptionDetails?.text || 'exception')
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      results.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '))
    }
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true })
  })
  await send('Runtime.enable')
  await send('Network.enable')

  await until(async () => (await ev(`document.readyState === 'complete' && !!document.getElementById('root')`)) === true, 25000, '首屏')

  // 1) 首次打开弹起点选择
  const boot = await until(async () => {
    const s = await readState()
    return s.hasPicker ? s : null
  }, 15000, '首次打开弹窗')
  check('1 首次打开弹出起点选择', !!boot?.hasPicker)
  check('1b 首次打开尚未写入起点记录', boot.start === null, boot.start)

  // 2) 选六级 → 立刻按 cet6 出词
  const markCet6 = markRequests()
  const clicked = await clickSel('[data-testid="start-level-cet6"]')
  check('2 点击「大学六级」卡片', clicked === true)

  const cet6 = await until(async () => {
    const s = await readState()
    return s.start?.choiceId === 'cet6' && s.level === 'cet6' ? s : null
  }, 15000, '应用 cet6')
  check('2b 起点记录写入 qzLearningStart', cet6.start?.choiceId === 'cet6', cet6.start)
  check('2c 自动进阶级别切到 cet6', cet6.level === 'cet6', cet6.level)

  const dictsAfterCet6 = await until(
    async () => {
      const list = dictsSince(markCet6)
      return list.includes('CET6_T.json') ? list : null
    },
    20000,
    '取 CET6 词表',
  )
  check('2d 选完立刻从 CET6 词表取词', dictsAfterCet6.includes('CET6_T.json'), dictsAfterCet6)
  check('2e 弹层已关闭', (await readState()).hasPicker === false)

  const labelCet6 = await until(async () => {
    const s = await readState()
    return s.bodyText.includes('大学六级') ? s.bodyText : null
  }, 10000, '顶栏显示大学六级')
  check('2f 顶栏级别显示「大学六级」', !!labelCet6)

  // 3) 重启（同 profile）→ 不再弹窗，级别保持
  await reload()
  const afterReload = await readState()
  check('3 重启后不再弹起点选择', afterReload.hasPicker === false)
  check('3b 重启后级别仍为 cet6', afterReload.level === 'cet6', afterReload.level)
  check('3c 重启后顶栏仍显示「大学六级」', afterReload.bodyText.includes('大学六级'))

  // 4) 词库页修改起点 → 初中，立刻生效（不重启）
  const markJunior = markRequests()
  await ev(`location.hash = '#/gallery'; true`)
  await until(async () => (await ev(`!!document.querySelector('[data-testid="start-level-cet6"]') || [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('学习起点'))`)) === true, 15000, '词库页入口')
  const openEntry = await clickByText('学习起点')
  check('4 词库页存在「学习起点」修改入口（不在主界面）', openEntry === true)
  await until(async () => (await ev(`!!document.querySelector('[data-testid="start-level-junior"]')`)) === true, 10000, '修改弹层')

  const juniorClicked = await clickSel('[data-testid="start-level-junior"]')
  check('4b 在修改弹层选「初中水平」', juniorClicked === true)

  const junior = await until(async () => {
    const s = await readState()
    return s.start?.choiceId === 'junior' && s.level === 'junior-1' ? s : null
  }, 15000, '应用 junior-1')
  check('4c 起点记录更新为 junior', junior.start?.choiceId === 'junior', junior.start)
  check('4d 级别切到 junior-1', junior.level === 'junior-1', junior.level)

  // 修改入口在词库页：练习页此时是卸载状态，回到练习页才会重新取词（同一次运行内，不需要重启）
  await ev(`location.hash = '#/'; true`)
  const dictsAfterJunior = await until(
    async () => {
      const list = dictsSince(markJunior)
      return list.some((n) => n.startsWith('PEPChuZhong7_')) ? list : null
    },
    25000,
    '取初中词表',
  )
  check('4e 改完回练习页即从初中词表取词（无需重启）', dictsAfterJunior.some((n) => n.startsWith('PEPChuZhong7_')), dictsAfterJunior)
  const labelJunior = await until(async () => {
    const s = await readState()
    return s.bodyText.includes('初中一年级') ? s.bodyText : null
  }, 15000, '顶栏显示初中一年级')
  check('4f 顶栏级别显示「初中一年级」', !!labelJunior)

  // 5) 老用户兼容：有进阶状态、没有起点记录 → 不弹窗
  await ev(`localStorage.removeItem('qzLearningStart'); true`)
  await reload()
  await wait(2500)
  const oldUser = await readState()
  check('5 老用户（有练习状态、无起点记录）不被弹窗拦截', oldUser.hasPicker === false)
  check('5b 老用户级别不被改动', oldUser.level === 'junior-1', oldUser.level)

  // 6) 全程无异常 / 无控制台错误
  const noisyErrors = results.consoleErrors.filter((e) => !/favicon|Autofill|Download the React DevTools/i.test(e))
  check('6 全程无未捕获异常', results.exceptions.length === 0, results.exceptions.slice(0, 3))
  check('6b 全程无控制台错误', noisyErrors.length === 0, noisyErrors.slice(0, 3))

  return finish(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`VERIFY_ERROR: ${e.message}`)
  results.error = e.message
  finish(2)
})
