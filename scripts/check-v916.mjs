// v9.16 首启起点选择卡专项验证（CDP，隔离 profile）
// 用法：node check-v916.mjs <port>


const port = process.argv[2] || '9486'
const send = (ws, id, method, params = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 15000)
    const onMsg = (ev) => {
      const raw = ev && typeof ev.data === 'string' ? ev.data : ''
      if (!raw) return
      let m
      try { m = JSON.parse(raw) } catch { return }
      if (m.id === id) { ws.removeEventListener('message', onMsg); clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evalJs = async (ws, id, expr) => {
  const r = await send(ws, id, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result.value
}

// 找到页面 target
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('NO_PAGE'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => ws.addEventListener('open', res, { once: true }))
let id = 0

const hasDialog = await evalJs(ws, ++id, `!!document.querySelector('[role="dialog"][aria-label*="起点"]')`)
const hasButton = await evalJs(ws, ++id, `!!document.querySelector('button[aria-label="查看或修改学习路线起点"]')`)
// 点击「六级水平」选项
const clickOk = await evalJs(ws, ++id, `(() => { const btns=[...document.querySelectorAll('[role="dialog"] button')]; const t=btns.find(b=>b.textContent.includes('六级水平')); if(!t) return false; t.click(); return true })()`)
await new Promise((r) => setTimeout(r, 400))
const storedChoice = await evalJs(ws, ++id, `localStorage.getItem('learningStartChoice')`)
const levelId = await evalJs(ws, ++id, `(() => { try { return JSON.parse(localStorage.getItem('qzAutoLevelState')).levelId } catch { return null } })()`)
const dialogGone = await evalJs(ws, ++id, `!document.querySelector('[role="dialog"][aria-label*="起点"]')`)
// 重开入口：顶栏按钮点击后应再次出现
const reopen = await evalJs(ws, ++id, `(() => { const b=document.querySelector('button[aria-label="查看或修改学习路线起点"]'); if(!b) return false; b.click(); return true })()`)
await new Promise((r) => setTimeout(r, 300))
const dialogAgain = await evalJs(ws, ++id, `!!document.querySelector('[role="dialog"][aria-label*="起点"]')`)
ws.close()

console.log(JSON.stringify({
  firstRunDialog: hasDialog, headerButton: hasButton, clickCet6: clickOk,
  storedChoice, levelId, dialogGoneAfterChoose: dialogGone, reopenOpensAgain: reopen && dialogAgain,
}, null, 2))
const pass = hasDialog && hasButton && clickOk && storedChoice === 'cet6' && levelId === 'cet6' && dialogGone && reopen && dialogAgain
console.log(pass ? 'V916-PASS' : 'V916-FAIL')
process.exit(pass ? 0 : 1)
