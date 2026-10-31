// Qwerty Learner Plus — 冒烟测试（CDP，v9.4）
// 用法：先以隔离 profile 启动测试版程序并开 --remote-debugging-port=9472，然后：
//   node scripts/dsh-smoke.mjs
// 退出码 0 = 全部通过；1 = 有检查失败；2 = 无法连接/无页面/通道超时（未能完成检查）。
// 也可被 scripts/dsh-release.ps1 -Smoke 调用（其会等待 CDP 就绪后再执行）。
// 超时（v9.15 / M5-001）：总超时默认 90s（QZ_SMOKE_TIMEOUT 覆盖），单次 CDP 调用默认 15s
//   （QZ_SMOKE_SEND_TIMEOUT 覆盖），页面启动就绪的轮询窗口默认 15s（QZ_SMOKE_STARTUP 覆盖）。
const PORT = Number(process.env.QZ_SMOKE_PORT || 9472)
const READY_TIMEOUT = Number(process.env.QZ_SMOKE_WAIT || 30000)
// v9.15（dsh，M5-001）：总超时 / 单次 CDP 调用超时 / 启动就绪轮询窗口
const GLOBAL_TIMEOUT = Number(process.env.QZ_SMOKE_TIMEOUT || 90000)
const SEND_TIMEOUT = Number(process.env.QZ_SMOKE_SEND_TIMEOUT || 15000)
const STARTUP_TIMEOUT = Number(process.env.QZ_SMOKE_STARTUP || 15000)
const results = {
  ts: new Date().toISOString(),
  port: PORT,
  exceptions: [],
  consoleErrors: [],
  consoleWarnings: [],
  checks: {},
}

// v9.15（dsh，M5-001）：总超时看门狗 —— 目标页崩溃 / DevTools 通道断开时 Runtime.evaluate 永不回包，
//   原实现没有任何看门狗，node 进程会悬挂（-Smoke 发布流程卡死）。超时以退出码 2 + 明确信息结束。
const watchdog = setTimeout(() => {
  console.error(`SMOKE_TIMEOUT（总超时 ${GLOBAL_TIMEOUT}ms 内未完成；可能是目标页崩溃或 CDP 通道无响应）`)
  process.exit(2)
}, GLOBAL_TIMEOUT)
const stopWatchdog = () => clearTimeout(watchdog)

const wait = (ms) => new Promise((res) => setTimeout(res, ms))

async function waitForPage() {
  const deadline = Date.now() + READY_TIMEOUT
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* CDP not ready */
    }
    await wait(400)
  }
  return null
}

const page = await waitForPage()
if (!page) {
  console.error('NO_PAGE（CDP 在超时内不可用）')
  process.exit(2)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
// v9.15（dsh，M5-001）：ev() 级别的 CDP 失败（超时/断连）记在这里，汇总时据此改用退出码 2
const cdpErrors = []
// v9.15（dsh，M5-001）：每次 CDP 调用都有超时，且断连时立刻拒绝所有未决 promise（否则永久挂起）
const send = (m, p = {}, ms = SEND_TIMEOUT) =>
  new Promise((res, rej) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      rej(new Error(`CDP_TIMEOUT ${m}（${ms}ms 无回包）`))
    }, ms)
    pending.set(id, {
      res: (v) => {
        clearTimeout(timer)
        res(v)
      },
      rej: (e) => {
        clearTimeout(timer)
        rej(e)
      },
    })
    try {
      ws.send(JSON.stringify({ id, method: m, params: p }))
    } catch (e) {
      pending.delete(id)
      clearTimeout(timer)
      rej(e)
    }
  })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    results.exceptions.push((d.exception && d.exception.description) || d.text)
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description))
      .join(' ')
      .slice(0, 300)
    if (m.params.type === 'error') results.consoleErrors.push(text)
    else if (m.params.type === 'warning') results.consoleWarnings.push(text)
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const text = m.params.entry.text || ''
    // 网络资源加载失败（离线/被墙）不算应用错误；应用内错误已由 console/exception 捕获
    if (!/net::|Failed to load resource|ERR_/.test(text)) results.consoleErrors.push(`[log] ${text}`)
  }
})
// v9.15（dsh，M5-001）：通道关闭时拒绝所有未决调用，避免 send() 的 promise 永不 settle
ws.addEventListener('close', () => {
  for (const [, p] of pending) {
    try {
      p.rej(new Error('CDP 通道已关闭'))
    } catch {
      /* ignore */
    }
  }
  pending.clear()
})
let connectTimer = setTimeout(() => {
  console.error(`CDP_CONNECT_TIMEOUT（websocket 在 ${SEND_TIMEOUT}ms 内未建立）`)
  process.exit(2)
}, SEND_TIMEOUT)
try {
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('CDP websocket 连接失败')))
  })
} catch (e) {
  clearTimeout(connectTimer)
  console.error('CDP_CONNECT_FAILED ' + String((e && e.message) || e))
  process.exit(2)
}
clearTimeout(connectTimer)
try {
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
} catch (e) {
  console.error('CDP_INIT_FAILED ' + String((e && e.message) || e))
  process.exit(2)
}

async function ev(expr, ap = false) {
  try {
    const x = await send('Runtime.evaluate', { expression: expr, awaitPromise: ap, returnByValue: true, userGesture: true })
    if (x && x.exceptionDetails) return null
    return x && x.result ? x.result.value ?? null : null
  } catch (e) {
    // v9.15（dsh，M5-001）：单次求值失败不抛到顶层（否则只能看到半截 JSON/堆栈），
    //   记数后返回 null，由轮询或汇总逻辑决定最终退出码。
    cdpErrors.push(String((e && e.message) || e))
    return null
  }
}
async function poll(fn, timeout = 12000, interval = 150) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await fn()
    if (v) return v
    await wait(interval)
  }
  return null
}
const currentWord = () =>
  ev(
    `(function(){var els=[...document.querySelectorAll('span.font-mono')];if(!els.length){els=[...document.querySelectorAll('[class*="font-mono"] span')]}return els.map(function(s){return s.textContent}).join('')})()`,
  )

// 1) 版本 / 页面加载
// v9.15（dsh，M5-002）：原来是「固定等 1.5s + 一次性快照」，而 waitForPage() 只要 CDP 出现任意 page 就返回
//   （此时文档可能还是 about:blank / 首屏脚本未执行），冷启动（大 IndexedDB、杀软扫描 asar、机械盘）会误报失败。
//   改为轮询直到通过或超时；检查项名称与 JSON 结构保持不变。
results.checks.version = await poll(() => ev('window.qwertyEnhance ? window.qwertyEnhance.version : null'), STARTUP_TIMEOUT)
results.checks.url = await poll(
  () => ev(`(function(){var u=String(location.href||'');return u && u.indexOf('about:blank')!==0 ? u : null})()`),
  STARTUP_TIMEOUT,
)
results.checks.hasApp =
  !!results.checks.url && (results.checks.url.includes('app.asar/build/index.html') || results.checks.url.startsWith('file:'))
results.checks.started = !!(await poll(
  () =>
    ev(
      `(function(){var t=((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ');if(t.length<=40)return 0;return (t.indexOf('Qwerty')>=0||t.indexOf('开始')>=0||t.indexOf('Start')>=0)?1:0})()`,
    ),
  STARTUP_TIMEOUT,
))
results.checks.startText = (await ev(`(document.body.innerText||'').replace(/\\s+/g,' ')`)) || ''

// 2) 设置对话框：桌面页签 + 数据页 + 运行时（v11：增强面板已并入设置）
const settingsOpened = await ev(
  `(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.getAttribute('title')==='打开设置对话框'});if(b){b.click();return true}return false})()`,
)
results.checks.settingsOpened = settingsOpened
await wait(700)
results.checks.tabs = await ev(`[...document.querySelectorAll('[role="tab"]')].map(function(b){return (b.textContent||'').trim()})`)
results.checks.runtimeReady = await ev(
  `!!(window.qzRuntime && typeof window.qzRuntime.collectStats === 'function' && typeof window.qzRuntime.startDueReview === 'function')`,
)
results.checks.statsRuntime = await ev(
  `window.qzRuntime.collectStats().then(function(s){return !!(s && typeof s.totalWords === 'number' && Array.isArray(s.heatDays) && Array.isArray(s.wrongWords))}).catch(function(){return false})`,
  true,
)
await ev(
  `(function(){var t=[...document.querySelectorAll('[role="tab"]')].find(function(x){return (x.textContent||'').trim()==='数据设置'});if(t)t.click();return true})()`,
)
await wait(2200)
results.checks.dataDueSection = await ev(
  `(function(){var t=(document.body.innerText||'');return t.indexOf('学习概览')>=0 && t.indexOf('每日目标')>=0})()`,
)
// 关闭设置，避免遮挡练习按钮
await ev(
  `(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.getAttribute('title')==='关闭对话框'});if(b)b.click();return true})()`,
)
await wait(300)

// 3) 练习主流程：开始 → 识别单词 → 输入 → 进入下一词
const startClicked = await ev(
  `(function(){var b=[...document.querySelectorAll('button')].find(function(x){var t=x.textContent.trim();return t==='Start'||t==='开始'});if(b){b.click();return true}return false})()`,
)
results.checks.startClicked = startClicked
await wait(700)
const w1 = await poll(() => currentWord(), 10000)
results.checks.word = w1
if (w1) {
  for (let i = 0; i < w1.length; i++) {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(w1[i])},bubbles:true,cancelable:true})); 1`)
    await wait(i === 0 ? 160 : 100)
  }
  await wait(1200)
}
results.checks.nextWord = await currentWord()
results.checks.finishedText = (await ev(`(document.body.innerText||'').includes('正确率')`)) === true
results.checks.practiceWorks = !!w1 && (!!results.checks.nextWord || results.checks.finishedText)

// 4) 备份 IPC（逻辑快照）
results.checks.backup = await ev(
  `window.qwertyEnhance.backupNow().then(function(r){return !!(r&&r.ok)}).catch(function(){return false})`,
  true,
)

// 5) 统计页：图表实例渲染（离开练习后路由）
const errBeforeAnalysis = results.exceptions.length
await ev(`location.hash='#/analysis'; 1`)
await wait(2600)
results.checks.analysisCanvas = await ev(`document.querySelectorAll('canvas').length`)
results.checks.analysisText = (await ev(`(document.body.innerText||'').slice(0,400)`)) || ''
results.checks.analysisWorks = (results.checks.analysisCanvas || 0) >= 1 && results.exceptions.length === errBeforeAnalysis

// 6) 错题本：空状态/列表/加载失败三态之一，且不崩溃
const errBeforeErrorBook = results.exceptions.length
await ev(`location.hash='#/error-book'; 1`)
await wait(1800)
results.checks.errorBookText = (await ev(`(document.body.innerText||'').slice(0,400)`)) || ''
results.checks.errorBookWorks =
  results.exceptions.length === errBeforeErrorBook &&
  (results.checks.errorBookText.includes('错题') ||
    results.checks.errorBookText.includes('暂无') ||
    results.checks.errorBookText.includes('加载失败') ||
    results.checks.errorBookText.includes('练习'))

// 7) 回首页并收起
await ev(`location.hash='#/'; 1`)
await wait(600)

results.summary = {
  versionOk: typeof results.checks.version === 'string' && results.checks.version.startsWith('1.0.0-enhanced-'),
  pageLoaded: results.checks.hasApp === true,
  started: results.checks.started === true,
  // v11：设置对话框（桌面版 7 个页签）取代原增强面板
  settingsTabs:
    Array.isArray(results.checks.tabs) &&
    ['音效设置', '显示设置', '数据设置', '词库管理', '桌面工具', '高级设置', '关于'].every((t) => results.checks.tabs.includes(t)),
  runtimeReady: results.checks.runtimeReady === true,
  statsRuntime: results.checks.statsRuntime === true,
  dataSections: results.checks.dataDueSection === true,
  practiceWorks: results.checks.practiceWorks === true,
  backupWorks: results.checks.backup === true,
  analysisWorks: results.checks.analysisWorks === true,
  errorBookWorks: results.checks.errorBookWorks === true,
  noExceptions: results.exceptions.length === 0,
  noConsoleErrors: results.consoleErrors.length === 0,
}

console.log(JSON.stringify(results.summary, null, 2))
if (!Object.values(results.summary).every(Boolean)) {
  console.log('checks:', JSON.stringify(results.checks, null, 2))
  console.log('exceptions:', results.exceptions.slice(0, 5))
  console.log('consoleErrors:', results.consoleErrors.slice(0, 5))
  // v9.15（dsh，M5-001）：CDP 调用超时/断连（页面崩溃、DevTools 通道断开）单独用退出码 2 区分，
  //   便于发布脚本区分「检查失败」(1) 与「测试本身没跑完」(2)。
  if (cdpErrors.length) {
    console.log('cdpErrors:', cdpErrors.slice(0, 5))
    console.error(`SMOKE_CDP_ERROR（${cdpErrors.length} 次 CDP 调用失败，判定为无法完成检查）`)
    process.exit(2)
  }
  process.exit(1)
}
stopWatchdog()
try {
  await send('Runtime.evaluate', { expression: 'window.qwertyEnhance && window.qwertyEnhance.quit && window.qwertyEnhance.quit()' })
} catch {
  /* ignore */
}
process.exit(0)
