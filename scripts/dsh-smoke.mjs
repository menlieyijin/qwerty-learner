// Qwerty Learner Plus — 冒烟测试（CDP）
// 用法：先以隔离 profile 启动测试版程序并开 --remote-debugging-port=9472，然后：
//   node scripts/dsh-smoke.mjs
// 退出码 0 = 全部通过；1 = 有检查失败。也可被 scripts/dsh-release.ps1 -Smoke 调用。
const PORT = Number(process.env.QZ_SMOKE_PORT || 9472)
const results = { ts: new Date().toISOString(), exceptions: [], consoleErrors: [], checks: {} }
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('NO_PAGE'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })) })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; results.exceptions.push((d.exception && d.exception.description) || d.text) }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) results.consoleErrors.push((m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description)).join(' ').slice(0, 200))
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
await send('Runtime.enable')
const wait = (ms) => new Promise((res) => setTimeout(res, ms))
async function ev(expr, ap = false) {
  const x = await send('Runtime.evaluate', { expression: expr, awaitPromise: ap, returnByValue: true, userGesture: true })
  if (x.exceptionDetails) return null
  return x.result?.value ?? null
}
const currentWord = () => ev(`[...document.querySelectorAll('span.font-mono')].map(s=>s.textContent).join('')`)
async function poll(fn, t = 12000, i = 150) { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await wait(i) } return null }

await wait(3000)
results.checks.version = await ev('window.qwertyEnhance ? window.qwertyEnhance.version : null')
results.checks.url = await ev('location.href')
results.checks.hasApp = !!results.checks.url && results.checks.url.includes('app.asar/build/index.html')
results.checks.startText = (await ev(`(document.body.innerText||'').replace(/\\s+/g,' ')`)) || ''

// 面板可打开、5 个 tab 存在
await ev(`window.dispatchEvent(new CustomEvent('qz-open-enhance')); 1`)
await wait(700)
results.checks.tabs = await ev(`(function(){var h=document.getElementById('qz-enhance-host');var sr=h&&h.shadowRoot;return sr?[...sr.querySelectorAll('.tabs button')].map(function(b){return b.textContent.trim()}):null})()`)
results.checks.dataDueSection = await ev(`(function(){var h=document.getElementById('qz-enhance-host');var sr=h&&h.shadowRoot;return !!(sr&&sr.querySelector('#btn-due-start')&&sr.querySelector('#trend-box'))})()`)

// 练一个词（验证练习主流程）
await ev(`(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.textContent.trim()==='Start'});if(b){b.click();return true}return false})()`)
await wait(700)
const w1 = await poll(() => currentWord(), 10000)
results.checks.word = w1
if (w1) {
  for (let i = 0; i < w1.length; i++) {
    await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(w1[i])},bubbles:true,cancelable:true})); 1`)
    await wait(i === 0 ? 170 : 105)
  }
  await wait(1800)
}
results.checks.nextWord = await currentWord()

// 备份 IPC（逻辑快照）
results.checks.backup = await ev(`window.qwertyEnhance.backupNow().then(function(r){return !!(r&&r.ok)}).catch(function(){return false})`, true)

results.summary = {
  versionOk: typeof results.checks.version === 'string' && results.checks.version.startsWith('1.0.0-enhanced-'),
  pageLoaded: results.checks.hasApp === true,
  panelTabs: Array.isArray(results.checks.tabs) && results.checks.tabs.length === 5,
  dataSections: results.checks.dataDueSection === true,
  practiceWorks: !!results.checks.nextWord,
  backupWorks: results.checks.backup === true,
  noExceptions: results.exceptions.length === 0,
  noConsoleErrors: results.consoleErrors.length === 0,
}
console.log(JSON.stringify(results.summary, null, 2))
if (!Object.values(results.summary).every(Boolean)) {
  console.log('checks:', JSON.stringify(results.checks, null, 2))
  console.log('exceptions:', results.exceptions.slice(0, 3), 'consoleErrors:', results.consoleErrors.slice(0, 3))
  process.exit(1)
}
try { await send('Runtime.evaluate', { expression: 'window.qwertyEnhance && window.qwertyEnhance.quit && window.qwertyEnhance.quit()', returnByValue: true }) } catch {}
process.exit(0)
