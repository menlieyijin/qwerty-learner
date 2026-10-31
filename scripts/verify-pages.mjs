// 页面级回归：错题本（排序 / 详情 / Esc / 删除取消）+ 设置面板结构（v9.19，dsh）
//
// 为什么要有这个脚本：发布链原本只有 dsh-smoke.mjs，它对错题本的检查只有「页面文本里出现过'错题'」，
// 拆分 components / hooks 之后这种粒度的检查无法证明行为没变。这里用 CDP 直接操纵页面：
//   1. 往记录库注入 3 条确定的错题（不同词典、不同错误次数），
//   2. 断言列表按错误次数升序、点表头切降序、点行进详情、Esc 关详情、取消删除不改数据，
//   3. 设置面板：打开后三个页签都在、面板可关闭。
//
// 用法：node scripts/verify-pages.mjs [--exe <path>] [--port 9476]
// 退出码：0 全过；1 有失败；2 环境问题。注意会强制结束正在运行的 Qwerty Learner。
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const EXE = argOf('exe', process.env.QZ_VERIFY_EXE || 'D:\\整理\\qtest9\\app\\Qwerty Learner.exe')
const PORT = Number(argOf('port', process.env.QZ_VERIFY_PORT || 9476))
const GLOBAL_TIMEOUT = Number(process.env.QZ_VERIFY_TIMEOUT || 120000)

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

/** 往 RecordDB.wordRecords 注入确定的错题（绕过 UI，保证断言可复现） */
const seedWrongRecords = () =>
  ev(`(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('RecordDB')
    req.onerror = () => reject(new Error('open db failed'))
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('wordRecords', 'readwrite')
      const store = tx.objectStore('wordRecords')
      const now = Math.floor(Date.now() / 1000)
      const rows = [
        { word: 'apple', dict: 'cet4', chapter: 0, timing: [120, 130], wrongCount: 3, mistakes: {}, timeStamp: now - 30 },
        { word: 'banana', dict: 'cet4', chapter: 0, timing: [90], wrongCount: 1, mistakes: {}, timeStamp: now - 20 },
        { word: 'cherry', dict: 'cet6', chapter: 0, timing: [110], wrongCount: 2, mistakes: {}, timeStamp: now - 10 },
      ]
      rows.forEach((r) => store.add(r))
      tx.oncomplete = () => { db.close(); resolve(rows.length) }
      tx.onerror = () => reject(new Error('seed failed: ' + (tx.error && tx.error.message)))
    }
  }))()`)

const rowWords = () =>
  ev(`[...document.querySelectorAll('li[role="button"][aria-label^="查看"]')].map((li) => {
    const aria = li.getAttribute('aria-label') || ''
    const m = aria.match(/「(.+?)」/)
    return m ? m[1] : ''
  })`)

async function main() {
  try {
    execFileSync('taskkill', ['/IM', 'Qwerty Learner.exe', '/F'], { stdio: 'ignore' })
    await wait(800)
  } catch {
    /* 没有在运行 */
  }

  profileDir = mkdtempSync(join(tmpdir(), 'qz-verify-pages-'))
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
  await until(async () => (await ev(`document.readyState === 'complete' && !!document.getElementById('root')`)) === true, 25000, '首屏')

  // 等应用自己把 RecordDB 建好，再注入
  await until(
    async () =>
      (await ev(`(async () => { const dbs = await indexedDB.databases(); return dbs.some((d) => d.name === 'RecordDB') })()`)) === true,
    20000,
    'RecordDB 就绪',
  )
  const seeded = await seedWrongRecords()
  check('0 注入 3 条错题记录', seeded === 3, seeded)

  // 1) 列表
  await ev(`location.hash = '#/error-book'; true`)
  const words = await until(
    async () => {
      const list = await rowWords()
      return list.length >= 3 ? list : null
    },
    20000,
    '错题列表渲染',
  )
  check(
    '1 三条错题全部渲染',
    ['apple', 'banana', 'cherry'].every((w) => words.includes(w)),
    words,
  )

  const counts = await ev(`[...document.querySelectorAll('li[role="button"][aria-label^="查看"]')].map((li) => {
    const hit = [...li.querySelectorAll('span')].map((s) => (s.textContent || '').trim()).find((t) => /^\\d+$/.test(t))
    return hit === undefined ? -1 : Number(hit)
  })`)
  check('2 默认按错误次数升序（1 → 2 → 3）', JSON.stringify(counts) === JSON.stringify([1, 2, 3]), counts)

  // 2) 排序切换
  await ev(`(() => {
    const th = [...document.querySelectorAll('span')].find((s) => (s.textContent || '').trim().startsWith('错误次数'))
    if (!th) return false
    th.click()
    return true
  })()`)
  const sortedDesc = await until(
    async () => {
      const c = await ev(`[...document.querySelectorAll('li[role="button"][aria-label^="查看"]')].map((li) => {
      const hit = [...li.querySelectorAll('span')].map((s) => (s.textContent || '').trim()).find((t) => /^\\d+$/.test(t))
      return hit === undefined ? -1 : Number(hit)
    })`)
      return JSON.stringify(c) === JSON.stringify([3, 2, 1]) ? c : null
    },
    8000,
    '降序排序',
  )
  check('3 点「错误次数」切降序（3 → 2 → 1）', !!sortedDesc, sortedDesc)

  // 3) 详情 + Esc
  await ev(`document.querySelector('li[role="button"][aria-label^="查看"]').click(); true`)
  const detailOpen = await until(async () => (await ev(`!!document.querySelector('.my-card')`)) === true, 8000, '详情打开')
  check('4 点击行打开详情', detailOpen === true)

  // 注意：react-hotkeys-hook 绑在 document 上，事件必须从 body 冒泡上去（派发到 window 不会向下传）
  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`)
  const detailClosed = await until(async () => (await ev(`!document.querySelector('.my-card')`)) === true, 8000, '详情关闭')
  check('5 Esc 关闭详情', detailClosed === true)
  const stillOnPage = await ev(`document.body.innerText.includes('错题回顾练习')`)
  check('5b Esc 关闭详情后仍停留在错题本', stillOnPage === true)

  // 4) 删除：取消时数据不变（覆盖 buildDeleteConfirmText + 删除确认路径）
  const beforeDelete = (await rowWords()).length
  await ev(`window.confirm = () => false; true`)
  await ev(`(() => {
    const btn = document.querySelector('li[role="button"][aria-label^="查看"] button[aria-label^="删除"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  await wait(1200)
  const afterDelete = (await rowWords()).length
  check('6 删除确认框取消后记录数不变', afterDelete === beforeDelete, { beforeDelete, afterDelete })

  // 5) 设置面板结构
  await ev(`location.hash = '#/'; true`)
  await wait(800)
  // 设置入口按钮的可断言标记：title="打开设置对话框"（见 pages/Typing/components/Setting/index.tsx）
  const opened = await ev(`(() => {
    const btn = document.querySelector('button[title="打开设置对话框"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  check('7 设置入口存在且可点击', opened === true)
  const settingsText = await until(
    async () => {
      const t = await ev(`document.body.innerText`)
      return t.includes('音效设置') ? t : null
    },
    8000,
    '设置面板',
  )
  check('7b 设置面板可打开（音效设置页签存在）', !!settingsText)
  check(
    '7c 设置面板含五个页签',
    ['音效设置', '高级设置', '显示设置', '数据设置', '关于'].every((t) => settingsText.includes(t)),
    ['音效设置', '高级设置', '显示设置', '数据设置', '关于'].filter((t) => !settingsText.includes(t)),
  )

  // 7d「关于」页：版本号必须与 local-fork/package.json 一致（构建期注入 APP_VERSION）
  await ev(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"], button')].find((b) => (b.textContent || '').trim() === '关于')
    if (tab) tab.click()
    return true
  })()`)
  await wait(600)
  const expectedVersion = JSON.parse(readFileSync('local-fork/package.json', 'utf8')).version
  const aboutText = await ev(`document.body.innerText`)
  check('7d 关于页显示当前版本号', aboutText.includes(expectedVersion), { expected: expectedVersion })

  // 7e 顶栏不再有重复的「工具」入口（已合并到 设置 → 关于）
  const toolButtons = await ev(`([...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '工具')).length`)
  check('7e 顶栏无独立「工具」按钮（入口已合并）', toolButtons === 0, { count: toolButtons })

  // 6) 到期复习通道的脏 payload（F5-002）：不可信输入不应白屏，也不应误进复习模式
  await ev(`localStorage.setItem('qzDueReviewWords', JSON.stringify([{ bad: 1 }, null, 'x', 42])); true`)
  await ev(`location.reload(); true`).catch(() => undefined)
  await wait(1500)
  await until(async () => (await ev(`document.readyState === 'complete' && !!document.getElementById('root')`)) === true, 20000, 'reload')
  await wait(1200)
  const dirtyState = await ev(`({
    left: localStorage.getItem('qzDueReviewWords'),
    // 顶栏词库/水平入口的文本就是当前模式：复习模式下正好是「到期复习」，
    // 不能用 body.innerText 判断（该提示文案也含「到期复习」，会误判）
    navTexts: [...document.querySelectorAll('a')].map((a) => (a.textContent || '').trim()),
    // 只判断 #root 是否存在不够：ErrorBoundary 接管后 #root 仍在、但整页是错误提示
    bodySnippet: (document.body.innerText || '').slice(0, 200),
  })`)
  check('9 脏 payload 后页面仍正常渲染（顶栏存在）', dirtyState.navTexts.length > 0, dirtyState.bodySnippet.slice(0, 80))
  check('9b 脏 payload 不进入复习模式', dirtyState.navTexts.length > 0 && !dirtyState.navTexts.includes('到期复习'), dirtyState.navTexts)
  check('9c 脏 payload 已被消费（不会反复触发）', dirtyState.left === null, dirtyState.left)

  // 6b) 正控：合法 payload 仍能正常进入复习（证明上面的过滤没有把正常路径一起拦掉）
  await ev(`localStorage.setItem('qzDueReviewWords', JSON.stringify([{ name: 'apple', trans: ['苹果'], dict: 'cet4' }])); true`)
  await ev(`location.reload(); true`).catch(() => undefined)
  await wait(1500)
  await until(async () => (await ev(`document.readyState === 'complete' && !!document.getElementById('root')`)) === true, 20000, 'reload2')
  const reviewMode = await until(
    async () => {
      const nav = await ev(`[...document.querySelectorAll('a')].map((a) => (a.textContent || '').trim())`)
      return nav.includes('到期复习') ? nav : null
    },
    15000,
    '合法 payload 进入复习',
  )
  check('10 合法 payload 仍能进入到期复习（正控）', !!reviewMode)

  const noisy = results.consoleErrors.filter((e) => !/favicon|Autofill|React DevTools/i.test(e))
  check('8 全程无未捕获异常', results.exceptions.length === 0, results.exceptions.slice(0, 3))
  check('8b 全程无控制台错误', noisy.length === 0, noisy.slice(0, 3))

  return finish(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`VERIFY_ERROR: ${e.message}`)
  results.error = e.message
  finish(2)
})
