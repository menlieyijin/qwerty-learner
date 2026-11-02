// 词卡浮层细分回归（v11.6）
//
// verify-enhance.mjs 覆盖的是「能不能打开/关掉」；这里补的是真正会出问题的地方：
// 输入边界（空/超长/XSS/emoji）、遮罩与内容的点击区域、重复开关是否泄漏、
// toast 生命周期、深浅色同步、只读 API 的返回类型、以及全程无异常/无控制台错误。
//
// 用法：node scripts/verify-enhance-detail.mjs [--exe <path>] [--port 9479]
// 退出码：0 全过；1 有失败；2 环境问题。
import { openApp } from './lib/cdp-app.mjs'
import { resolveDesktopExe } from './lib/desktop-app.mjs'

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
const PORT = Number(argOf('port', process.env.QZ_VERIFY_PORT_DETAIL || 9479))

let failures = 0
const results = []
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

const SR = `document.querySelector('#qz-enhance-host')?.shadowRoot`
const state = () =>
  ev(`(() => {
    const sr = ${SR}
    if (!sr) return { host: false }
    const root = sr.querySelector('#qz-wordcard-root')
    const mask = sr.querySelector('#wc-mask')
    const card = sr.querySelector('.wordcard')
    const word = sr.querySelector('.wc-word')
    const body = sr.querySelector('#wc-body')
    const r = card ? card.getBoundingClientRect() : null
    return {
      host: true,
      masks: sr.querySelectorAll('#wc-mask').length,
      cards: sr.querySelectorAll('.wordcard').length,
      open: !!mask,
      word: word ? (word.textContent || '').trim() : '',
      bodyText: body ? (body.innerText || '').trim() : '',
      empty: root ? (root.innerHTML || '').trim() === '' : true,
      rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
      overflowY: card ? getComputedStyle(card).overflowY : '',
      hostPos: getComputedStyle(document.querySelector('#qz-enhance-host')).position,
      hostW: document.querySelector('#qz-enhance-host').getBoundingClientRect().width,
    }
  })()`)

const openCard = (word) => ev(`window.qzRuntime.lookupWord(${JSON.stringify(word)}).then(() => true, (e) => String(e))`, 45000)
const shadowHas = (sel) => ev(`!!${SR}?.querySelector(${JSON.stringify(sel)})`)
const toastTexts = () => ev(`Array.from(${SR}?.querySelectorAll('.toast') || []).map((x) => x.textContent)`)

async function pressKey(key, code, vk) {
  // 这里只验证「页面处理函数」本身；真实键盘事件由 verify-enhance.mjs 用 CDP Input 覆盖。
  // 用 JS 构造事件可以避免测试机窗口失焦导致的偶发失败。
  await ev(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(
      code,
    )}, keyCode: ${vk}, which: ${vk}, bubbles: true, cancelable: true }))`,
  )
}

async function closeCard() {
  await ev(`(() => { const b = ${SR}?.querySelector('#wc-close'); if (b) b.click(); return !!b })()`)
  await until(async () => (await state()).empty, 5000, '关闭词卡')
}

let app
let ev
let send
let until

async function main() {
  app = await openApp({ exe: EXE, port: PORT, prefix: 'qz-enhance-detail-' })
  ;({ ev, send, until } = app)
  await send('Runtime.enable')

  // ------------------------------------------------------------ 1. 运行时与宿主
  const ready = await until(
    async () => (await ev(`typeof window.qzRuntime?.lookupWord === 'function' && !!${SR}`)) === true,
    30000,
    'qzRuntime 与浮层宿主就绪',
  ).catch(() => false)
  check('1 qzRuntime 与浮层宿主就绪', ready === true)
  // 页面自身的 overflow 可能是 hidden（练习页本来如此），记录基线用于结尾对比
  const overflowBefore = await ev(`document.documentElement.style.overflow || document.body.style.overflow || ''`)

  const api = await ev(`(() => {
    const rt = window.qzRuntime || {}
    const keys = Object.keys(rt)
    return { keys, allFn: keys.every((k) => typeof rt[k] === 'function'), count: keys.length }
  })()`)
  const EXPECTED = [
    'collectStats',
    'collectInsights',
    'lookupWord',
    'startDueReview',
    'reevaluateLevel',
    'resumeSuspended',
    'exportAll',
    'importAll',
    'exportWrongCsv',
    'exportRecordsCsv',
    'setCurrentDict',
    'toggleDictFavorite',
    'currentDict',
    'listCustomDicts',
    'importCustomDict',
    'removeCustomDict',
    'startCustomMemory',
    'toast',
  ]
  const missing = EXPECTED.filter((k) => !api.keys.includes(k))
  check('2 qzRuntime 暴露 18 个入口且全为函数', api.allFn && api.count === EXPECTED.length && missing.length === 0, {
    count: api.count,
    missing,
  })

  const host = await ev(`(() => {
    const h = document.querySelector('#qz-enhance-host')
    if (!h) return null
    return { id: h.id, open: !!h.shadowRoot, pos: getComputedStyle(h).position, z: getComputedStyle(h).zIndex, w: h.getBoundingClientRect().width }
  })()`)
  check('3 宿主为 open shadow root 且固定定位', !!host && host.open && host.pos === 'fixed' && Number(host.z) >= 2147483000, host)
  check('4 宿主自身不占布局（宽度 0）', !!host && host.w === 0, host)
  check(
    '5 浮层容器三件套存在（词卡/toast/tooltip）',
    (await shadowHas('#qz-wordcard-root')) && (await shadowHas('#qz-toasts')) && (await shadowHas('#qz-tooltip')),
  )
  const bleed = await ev(`document.querySelectorAll('.wordcard, #wc-mask').length`)
  check('6 页面主文档无浮层节点（Shadow DOM 隔离）', bleed === 0, { bleed })

  // ------------------------------------------------------------ 2. 正常词卡
  const opened = await openCard('apple')
  const s1 = await until(
    async () => {
      const x = await state()
      // 「查询中…」是占位符，等它被真实结果或错误信息替换
      return x.open && x.bodyText && !/^查询中…?$/.test(x.bodyText) ? x : null
    },
    25000,
    '词卡打开并渲染',
  )
  check('7 lookupWord 打开词卡', opened === true && s1.open === true, { opened })
  check('8 词卡标题为查询词', s1.word === 'apple', s1.word)
  check(
    '9 关闭按钮存在且可聚焦',
    await ev(`(() => { const b = ${SR}?.querySelector('#wc-close'); return !!b && b.title === '关闭' && b.tabIndex >= 0 })()`),
  )
  check('10 正文不是一直停在「查询中…」', s1.bodyText.length > 4 && !/^查询中…?$/.test(s1.bodyText), s1.bodyText.slice(0, 60))
  check(
    '11 词卡整体在视口内',
    !!s1.rect && s1.rect.x >= -1 && s1.rect.y >= -1 && s1.rect.right <= s1.vw + 1 && s1.rect.bottom <= s1.vh + 1,
    s1.rect,
  )
  check('12 词卡宽度受 660 / 视口双重限制', !!s1.rect && s1.rect.w <= Math.min(660, s1.vw - 40) + 1, { w: s1.rect?.w, vw: s1.vw })
  check('13 内容超高时纵向滚动而不是撑破', s1.overflowY === 'auto' || s1.overflowY === 'scroll', s1.overflowY)
  check('14 同时只存在一个遮罩/卡片', s1.masks === 1 && s1.cards === 1, { masks: s1.masks, cards: s1.cards })

  const insideClick = await ev(
    `(() => { const c = ${SR}?.querySelector('.wordcard'); if (!c) return false; c.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`,
  )
  await new Promise((r) => setTimeout(r, 200))
  check('15 点卡片内部不关闭（只有遮罩本体关闭）', insideClick === true && (await state()).open === true)

  await pressKey('Escape', 'Escape', 27)
  const closedEsc = await until(
    async () => {
      const x = await state()
      return x.empty ? x : null
    },
    5000,
    'Esc 关闭',
  ).catch(() => null)
  check('16 Esc 关闭并清空容器', !!closedEsc && closedEsc.masks === 0, closedEsc && { empty: closedEsc.empty, masks: closedEsc.masks })

  const overflowAfterEsc = await ev(`document.documentElement.style.overflow || document.body.style.overflow || ''`)
  check('17 关闭词卡不改变页面滚动设置', overflowAfterEsc === overflowBefore, { before: overflowBefore, after: overflowAfterEsc })

  // ------------------------------------------------------------ 3. 输入边界
  const empty = await openCard('')
  await new Promise((r) => setTimeout(r, 300))
  const sEmpty = await state()
  check('17 空词：resolve 且不打开词卡', empty === true && sEmpty.open === false, { empty, open: sEmpty.open })
  const t1 = await toastTexts()
  check('18 空词给出明确提示', t1.includes('请输入单词或短语'), t1)
  await until(async () => (await toastTexts()).length === 0, 6000, '提示自动消失')

  await ev(`window.qzRuntime.toast('短提示', 600); true`)
  const t2 = await toastTexts()
  await new Promise((r) => setTimeout(r, 1100))
  const t3 = await toastTexts()
  check('19 toast 立即出现并按指定时长消失', t2.length === 1 && t3.length === 0, { t2, t3 })

  await ev(`window.qzRuntime.toast('A', 800); window.qzRuntime.toast('B', 800); true`)
  const t4 = await toastTexts()
  await new Promise((r) => setTimeout(r, 1200))
  const t5 = await toastTexts()
  check('20 多条 toast 可叠加且全部清理', t4.length === 2 && t5.length === 0, { t4, t5 })

  await ev(`window.qzRuntime.toast(123, 400); true`)
  check('21 toast 非字符串入参不崩', (await toastTexts())[0] === '123', await toastTexts())
  await until(async () => (await toastTexts()).length === 0, 4000, 'toast 清理')

  // ------------------------------------------------------------ 4. 替换与关闭方式
  await openCard('book')
  await until(async () => (await state()).open, 15000, '打开 book')
  await openCard('cat')
  const s2 = await until(
    async () => {
      const x = await state()
      return x.open && x.word === 'cat' ? x : null
    },
    15000,
    '替换为 cat',
  )
  check('22 打开第二个词时替换而不是叠加', s2.masks === 1 && s2.cards === 1, { masks: s2.masks, cards: s2.cards })

  await ev(
    `(() => { const m = ${SR}?.querySelector('#wc-mask'); if (!m) return false; m.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`,
  )
  const closedMask = await until(async () => (await state()).empty, 5000, '遮罩关闭').catch(() => null)
  check('23 点遮罩关闭', !!closedMask)

  await openCard('dog')
  await until(async () => (await state()).open, 15000, '打开 dog')
  await closeCard()
  check('24 点 ✕ 关闭', (await state()).empty === true)

  // ------------------------------------------------------------ 5. 恶意/极端输入
  const xss = '<img src=x onerror="window.__qzXss=1">'
  const xssOk = await openCard(xss)
  const sx = await until(
    async () => {
      const x = await state()
      return x.open && x.word ? x : null
    },
    15000,
    'XSS 字符串打开',
  )
  const xssProbe = await ev(`(() => { const sr = ${SR}; return { img: sr.querySelectorAll('img').length, flag: !!window.__qzXss } })()`)
  check('25 尖括号内容按文本显示（不注入 HTML）', xssOk === true && sx.word === xss && xssProbe.img === 0 && xssProbe.flag === false, {
    word: sx.word,
    ...xssProbe,
  })
  await closeCard()

  const longWord = 'a'.repeat(200)
  const longOk = await openCard(longWord)
  const sl = await until(
    async () => {
      const x = await state()
      return x.open && x.word ? x : null
    },
    15000,
    '超长词打开',
  )
  check('27 200 字符长词不崩、完整显示', longOk === true && sl.word.length === 200, { len: sl.word.length })
  check('28 长词仍在视口内（word-break）', !!sl.rect && sl.rect.right <= sl.vw + 1 && sl.rect.w <= Math.min(660, sl.vw - 40) + 1, sl.rect)
  await closeCard()
  check('29 长词可正常关闭', (await state()).empty === true)

  const weird = '中文 "test" 😀 <b>'
  const weirdOk = await openCard(weird)
  const sw = await until(
    async () => {
      const x = await state()
      return x.open && x.word === weird ? x : null
    },
    15000,
    '特殊字符打开',
  )
  check('30 中文/引号/emoji 原样显示', weirdOk === true && !!sw, { word: sw?.word })
  await closeCard()

  // ------------------------------------------------------------ 6. 主题同步
  await ev(`document.documentElement.classList.add('dark'); true`)
  const darkOn = await until(
    async () => (await ev(`document.querySelector('#qz-enhance-host')?.classList.contains('qz-dark')`)) === true,
    3000,
    '深色同步',
  ).catch(() => false)
  await ev(`document.documentElement.classList.remove('dark'); true`)
  const darkOff = await until(
    async () => (await ev(`document.querySelector('#qz-enhance-host')?.classList.contains('qz-dark')`)) === false,
    3000,
    '浅色同步',
  ).catch(() => false)
  check('31 浮层跟随页面深浅色（MutationObserver）', darkOn === true && darkOff === true, { darkOn, darkOff })

  const accent = await ev(`(() => { document.documentElement.classList.add('qz-accent-rose'); return true })()`)
  const accentOpen = await openCard('apple')
  check('32 换强调色后词卡仍可打开', accent === true && accentOpen === true)
  await closeCard()
  await ev(`document.documentElement.classList.remove('qz-accent-rose'); true`)

  // ------------------------------------------------------------ 7. 只读 API
  const listCount = await ev(`window.qzRuntime.listCustomDicts().then((x) => (Array.isArray(x) ? x.length : -1), () => -2)`)
  check('33 listCustomDicts 返回数组', typeof listCount === 'number' && listCount >= 0, { count: listCount })

  const cur = await ev(`window.qzRuntime.currentDict().then((x) => (x === null ? 'null' : typeof x), () => 'rejected')`)
  check('34 currentDict 返回对象或 null（不抛错）', cur === 'object' || cur === 'null', cur)

  const stats = await ev(
    `window.qzRuntime.collectStats().then((x) => (x && typeof x === 'object' ? { today: x.today, goal: x.goal } : null), () => null)`,
  )
  check('35 collectStats 返回统计对象', !!stats && typeof stats.goal === 'number', stats)

  const insights = await ev(
    `window.qzRuntime.collectInsights().then((x) => (x && typeof x === 'object' ? Object.keys(x).length : 0), () => -1)`,
  )
  check('36 collectInsights 返回非空对象', typeof insights === 'number' && insights > 0, { keys: insights })

  // ------------------------------------------------------------ 8. 重复开关 / 稳定性
  const before = await ev(
    `(() => { const sr = ${SR}; return { wrap: sr.querySelector('#qz-toasts')?.parentElement?.children.length || 0, nodes: sr.querySelectorAll('*').length } })()`,
  )
  const t0 = Date.now()
  let cyclesOk = true
  for (let i = 0; i < 15; i += 1) {
    const okOpen = await openCard(i % 2 ? 'apple' : 'book')
    if (okOpen !== true) {
      cyclesOk = false
      break
    }
    await closeCard()
  }
  const elapsed = Date.now() - t0
  const after = await ev(
    `(() => { const sr = ${SR}; return { wrap: sr.querySelector('#qz-toasts')?.parentElement?.children.length || 0, nodes: sr.querySelectorAll('*').length, masks: sr.querySelectorAll('#wc-mask').length } })()`,
  )
  check('37 连续 15 次开关全部成功', cyclesOk === true, { cyclesOk })
  check('38 开关后无残留遮罩', after.masks === 0, after)
  check('39 浮层节点数不随开关增长（无泄漏）', before.wrap === after.wrap && Math.abs(after.nodes - before.nodes) <= 5, { before, after })
  check('40 15 次开关在 20s 内完成（无卡死）', elapsed < 20000, { ms: elapsed })

  // ------------------------------------------------------------ 9. 全程异常
  check('42 全程无未捕获异常', app.exceptions.length === 0, app.exceptions.slice(0, 3))
  check('43 全程无控制台错误（网络类已过滤）', app.consoleErrors.length === 0, app.consoleErrors.slice(0, 3))

  console.log(`\n${failures === 0 ? 'ENHANCE_DETAIL_PASS' : 'ENHANCE_DETAIL_FAIL'}  ${results.length} 项，失败 ${failures}`)
  return failures === 0 ? 0 : 1
}

main()
  .then(async (code) => {
    if (app) await app.close()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error(`VERIFY_ERROR: ${e.message}`)
    try {
      app && (await app.close())
    } catch {
      /* ignore */
    }
    process.exit(2)
  })
