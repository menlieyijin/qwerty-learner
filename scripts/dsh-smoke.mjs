// Qwerty Learner Plus — 冒烟测试（CDP，v9.4）
// 用法：先以隔离 profile 启动测试版程序并开 --remote-debugging-port=9472，然后：
//   node scripts/dsh-smoke.mjs
// 退出码 0 = 全部通过；1 = 有检查失败；2 = 无法连接/无页面。
// 也可被 scripts/dsh-release.ps1 -Smoke 调用（其会等待 CDP 就绪后再执行）。
const PORT = Number(process.env.QZ_SMOKE_PORT || 9472)
const READY_TIMEOUT = Number(process.env.QZ_SMOKE_WAIT || 30000)
const results = {
  ts: new Date().toISOString(),
  port: PORT,
  exceptions: [],
  consoleErrors: [],
  consoleWarnings: [],
  checks: {},
}

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
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method: m, params: p }))
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
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')

async function ev(expr, ap = false) {
  const x = await send('Runtime.evaluate', { expression: expr, awaitPromise: ap, returnByValue: true, userGesture: true })
  if (x.exceptionDetails) return null
  return x.result?.value ?? null
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
  ev(`(function(){var els=[...document.querySelectorAll('span.font-mono')];if(!els.length){els=[...document.querySelectorAll('[class*="font-mono"] span')]}return els.map(function(s){return s.textContent}).join('')})()`)

await wait(1500)

// 1) 版本 / 页面加载
results.checks.version = await ev('window.qwertyEnhance ? window.qwertyEnhance.version : null')
results.checks.url = await ev('location.href')
results.checks.hasApp =
  !!results.checks.url && (results.checks.url.includes('app.asar/build/index.html') || results.checks.url.startsWith('file:'))
results.checks.startText = (await ev(`(document.body.innerText||'').replace(/\\s+/g,' ')`)) || ''
results.checks.started =
  results.checks.startText.length > 40 &&
  (results.checks.startText.includes('Qwerty') || results.checks.startText.includes('开始') || results.checks.startText.includes('Start'))

// 2) 增强面板可打开、tabs 存在
await ev(`window.dispatchEvent(new CustomEvent('qz-open-enhance')); 1`)
await wait(800)
results.checks.tabs = await ev(
  `(function(){var h=document.getElementById('qz-enhance-host');var sr=h&&h.shadowRoot;return sr?[...sr.querySelectorAll('.tabs button')].map(function(b){return b.textContent.trim()}):null})()`,
)
results.checks.dataDueSection = await ev(
  `(function(){var h=document.getElementById('qz-enhance-host');var sr=h&&h.shadowRoot;return !!(sr&&sr.querySelector('#btn-due-start')&&sr.querySelector('#trend-box'))})()`,
)
// 关闭面板，避免遮挡练习按钮
await ev(
  `window.dispatchEvent(new CustomEvent('qz-close-enhance')); (function(){var h=document.getElementById('qz-enhance-host');if(h&&h.shadowRoot){var b=[...h.shadowRoot.querySelectorAll('button')].find(function(x){return /关闭|Close|×/.test(x.textContent)});if(b)b.click()}})(); 1`,
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
results.checks.analysisWorks =
  (results.checks.analysisCanvas || 0) >= 1 && results.exceptions.length === errBeforeAnalysis

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
  panelTabs: Array.isArray(results.checks.tabs) && results.checks.tabs.length >= 5,
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
  process.exit(1)
}
try {
  await send('Runtime.evaluate', { expression: 'window.qwertyEnhance && window.qwertyEnhance.quit && window.qwertyEnhance.quit()' })
} catch {
  /* ignore */
}
process.exit(0)
