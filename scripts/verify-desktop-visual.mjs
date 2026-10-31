// 桌面设置页视觉回归（v11.1）
//
// 目的：设置里的「词库管理 / 桌面工具 / 数据设置 / 显示设置」是 Electron 独有页面，
// Playwright 的网页基线覆盖不到。这里用 CDP 启动真实桌面程序、固定视口、逐页截图并与基线比较。
//
// 用法：
//   node scripts/verify-desktop-visual.mjs                 # 比较
//   node scripts/verify-desktop-visual.mjs --update        # 重建基线
//   node scripts/verify-desktop-visual.mjs --exe "<path>"  # 指定程序（也可用 QZ_VERIFY_EXE）
// 说明：基线按平台命名（win32 / darwin / linux），字体渲染跨系统不同，不跨平台共用。
import { resolveDesktopExe } from './lib/desktop-app.mjs'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = Number(argOf('port', process.env.QZ_DESKTOP_VISUAL_PORT || 9477))
const UPDATE = args.includes('--update')
const THRESHOLD = Number(process.env.QZ_DESKTOP_VISUAL_THRESHOLD || 0.003)
const BASELINE_DIR = resolve('tests/desktop-visual')
const PLATFORM = process.platform

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }
const PAGES = [
  ['显示设置', 'view', 900, `document.body.innerText.includes('窗口与系统')`],
  ['数据设置', 'data', 2200, `document.body.innerText.includes('学习概览') && !document.body.innerText.includes('读取中')`],
  ['词库管理', 'dict', 1800, `document.body.innerText.includes('内置词库') && !document.body.innerText.includes('加载中')`],
  ['桌面工具', 'tools', 900, `document.body.innerText.includes('番茄钟')`],
]
// 强调色是 CSS 变量驱动的：额外截一张换色后的数据页，锁住「带透明度/渐变也跟随」这件事
const ACCENT = 'qz-accent-rose'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let child = null
let ws = null
let profileDir = null
let seq = 0
const pending = new Map()

function fail(msg) {
  // 抛错而不是 process.exit：process.exit 会跳过 finally，留下未退出的 Electron 与临时 profile
  throw new Error(msg)
}

async function waitForPage(deadlineMs = 45000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await wait(500)
  }
  throw new Error(`CDP ${PORT} 在 ${deadlineMs}ms 内未就绪`)
}

function connect(url) {
  return new Promise((res, rej) => {
    const sock = new WebSocket(url)
    sock.addEventListener('open', () => res(sock))
    sock.addEventListener('error', (e) => rej(e))
  })
}

function send(method, params = {}, ms = 20000) {
  return new Promise((res, rej) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      rej(new Error(`CDP_TIMEOUT ${method}`))
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
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result && r.result.value
}

// 固定 sleep 会在慢机器/冷缓存时截到「加载中」；改为等页面自己进入就绪态
async function waitUntil(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ev(expression)) return true
    await wait(200)
  }
  return false
}

function compare(name, actualBuf) {
  const file = join(BASELINE_DIR, `${name}-${PLATFORM}.png`)
  if (UPDATE || !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, actualBuf)
    console.log(`BASE  ${name}（已写入 ${file}）`)
    return true
  }
  const base = PNG.sync.read(readFileSync(file))
  const cur = PNG.sync.read(actualBuf)
  if (base.width !== cur.width || base.height !== cur.height) {
    console.log(`FAIL  ${name} 尺寸变化：${base.width}x${base.height} -> ${cur.width}x${cur.height}`)
    return false
  }
  const diff = new PNG({ width: base.width, height: base.height })
  const pixels = pixelmatch(base.data, cur.data, diff.data, base.width, base.height, { threshold: 0.12 })
  const ratio = pixels / (base.width * base.height)
  if (ratio > THRESHOLD) {
    const diffFile = join(BASELINE_DIR, `${name}-${PLATFORM}.diff.png`)
    writeFileSync(diffFile, PNG.sync.write(diff))
    console.log(`FAIL  ${name} 差异 ${(ratio * 100).toFixed(2)}% > ${(THRESHOLD * 100).toFixed(2)}%，见 ${diffFile}`)
    return false
  }
  console.log(`PASS  ${name} 差异 ${(ratio * 100).toFixed(3)}%`)
  return true
}

async function main() {
  const exe = resolveDesktopExe(argOf('exe', ''))
  profileDir = mkdtempSync(join(tmpdir(), 'qz-desktop-visual-'))
  const env = { ...process.env, QZ_USER_DATA: profileDir, QZ_PLUS_DIR: join(profileDir, 'plus'), QZ_ALLOW_MULTI: '1' }
  // 从 Node/CI 里继承 ELECTRON_RUN_AS_NODE 时，Electron 会把 --remote-debugging-port 当 Node 参数而退出
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(exe, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })

  const page = await waitForPage()
  ws = await connect(page.webSocketDebuggerUrl)
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', VIEWPORT)
  await wait(1200)

  const opened = await ev(
    `(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.getAttribute('title')==='打开设置对话框'});if(b){b.click();return true}return false})()`,
  )
  if (!opened) fail('找不到设置入口')
  await wait(900)

  let ok = true
  for (const [tab, name, ms, ready] of PAGES) {
    const clicked = await ev(
      `(function(){var t=[...document.querySelectorAll('[role="tab"]')].find(function(x){return (x.textContent||'').trim()==='${tab}'});if(t){t.click();return true}return false})()`,
    )
    if (!clicked) fail(`找不到页签：${tab}`)
    await wait(Math.min(ms, 800))
    if (!(await waitUntil(ready))) fail(`页签 ${tab} 在 15s 内未就绪`)
    await wait(300)
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    ok = compare(name, Buffer.from(shot.data, 'base64')) && ok
  }

  // —— 强调色：先取一个 bg-indigo-400/70 的柱子颜色，换色后必须变化，再截图 ——
  await ev(
    `(function(){var t=[...document.querySelectorAll('[role="tab"]')].find(function(x){return (x.textContent||'').trim()==='数据设置'});if(t)t.click();return true})()`,
  )
  await wait(1800)
  const colorOf = (expr) => ev(`(function(){var el=${expr};return el?getComputedStyle(el).backgroundColor:''})()`)
  const before = await colorOf(`document.querySelector('[class~="bg-indigo-400/70"]')`)
  await ev(`document.documentElement.classList.add('${ACCENT}'); true`)
  await wait(400)
  const after = await colorOf(`document.querySelector('[class~="bg-indigo-400/70"]')`)
  const accentOk = !!before && !!after && before !== after
  if (!accentOk) console.log(`FAIL  强调色未生效（before=${before}, after=${after}）`)
  // 把带透明度的柱子滚到视口内，让基线覆盖「/70 也跟随主题」这件事
  await ev(
    `(function(){var el=document.querySelector('[class~="bg-indigo-400/70"]');if(el)el.scrollIntoView({block:'center'});return true})()`,
  )
  await wait(500)
  const accentShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  ok = compare('accent', Buffer.from(accentShot.data, 'base64')) && ok && accentOk
  await ev(`document.documentElement.classList.remove('${ACCENT}'); true`)

  const errText = await ev(`/读取失败|加载失败|未就绪/.test(document.body.innerText)`)
  if (errText) {
    console.log('FAIL  页面出现「读取失败/加载失败/未就绪」')
    ok = false
  }

  console.log(ok ? 'DESKTOP_VISUAL_PASS' : 'DESKTOP_VISUAL_FAIL')
  process.exitCode = ok ? 0 : 1
}

main()
  .catch((e) => {
    console.error(`VERIFY_ERROR: ${e.message || e}`)
    process.exitCode = 2
  })
  .finally(async () => {
    try {
      ws && ws.close()
    } catch {
      /* ignore */
    }
    if (child) {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    if (profileDir) {
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
