/* ==========================================================================
 * Qwerty Learner Plus — 增强 UI（注入到页面的主世界，不改 build/ 原文件）
 * 功能：
 *   A1 置顶 / A3 迷你 / A4 托盘(设置) / A5 自启 / A6 透明度缩放
 *   B1 每日目标+连续打卡 / B2 CSV 导出 / B3 统计(热力图/WPM/错词)
 *   B4' 免费释义（本地词库+有道+dictionaryapi）+ 整句翻译 + 逐词悬停
 *   B5 剪贴板查词开关 / B6 自定义词库导入+练习
 *   B8 番茄钟 / B9 主题/字体/键音 / A9 托盘进度上报
 * 所有 UI 放在 Shadow DOM 中，与页面 Tailwind 样式完全隔离。
 * ========================================================================== */
;(function () {
  'use strict'
  const api = window.qwertyEnhance
  if (!api) {
    console.warn('[QZ-ENHANCE] window.qwertyEnhance 不存在，增强 UI 跳过')
    return
  }
  if (window.__QZ_PANEL_HOST__) return
  window.__QZ_PANEL_HOST__ = true

  // ---------------------------------------------------------------- 工具函数
  const TODAY = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const dayKey = (ts) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const normTs = (v) => {
    const n = Number(v) || 0
    if (n <= 0) return 0
    if (n < 1e12) return n * 1000 // 秒 → 毫秒
    if (n > 1e15) return Math.floor(n / 1000) // 微秒 → 毫秒
    return n
  }
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  // v9.15（dsh，M5-010）：删除只定义无引用的 nowIso（grep 全仓库仅此一处）

  // v9.2：版本号单一来源——主进程在注入脚本前设置 window.__QZ_VERSION__（来自 package.json）
  // v9.4（SHELL-010）：不再保留硬编码版本兜底；v9.4（SHELL-008）：测试钩子仅测试环境开放
  const APP_VERSION = (typeof window !== 'undefined' && window.__QZ_VERSION__) || 'unknown'
  const APP_VERSION_SHORT = APP_VERSION.replace('1.0.0-enhanced-', '')
  const TEST_HOOKS = typeof window !== 'undefined' && window.__QZ_TEST_HOOKS__ === true

  let settings = {
    version: APP_VERSION,
    dailyGoal: 30,
    theme: 'indigo',
    dictFavorites: [],
    dictRecent: {},
    fontFamily: 'default',
    opacity: 1,
    zoom: 1,
    pomodoroFocus: 25,
    pomodoroBreak: 5,
    keySound: false,
    keySoundVolume: 0.25,
    clipboardWatch: false,
    onlineLookup: true,
    aiExperimental: false,
    pronCache: false,
    closeToTray: true,
    alwaysOnTop: false,
    miniMode: false,
    todayStats: {},
  }
  let appStats = null // 缓存统计

  // v5：词库更新文件请求层覆盖（若 preload 的早期注入不可用，这里在面板注入时兜底）
  ;(function installDictFetchPatch() {
    try {
      if (window.__QZ_DICT_PATCH__) return
      window.__QZ_DICT_PATCH__ = true
      const orig = window.fetch ? window.fetch.bind(window) : null
      if (!orig) return
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || ''
          const m = /(?:^|\/)dicts\/([^/?#]+\.json)(?:[?#]|$)/.exec(url)
          if (m && api.dictOverride) {
            return api
              .dictOverride(m[1])
              .then((has) => (has ? orig('qzcache://dict/' + encodeURIComponent(m[1]), init) : orig(input, init)))
              .catch(() => orig(input, init))
          }
        } catch {
          /* ignore */
        }
        return orig(input, init)
      }
    } catch {
      /* ignore */
    }
  })()

  // ---------------------------------------------------------------- IndexedDB
  function idbOpen(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name)
      req.onupgradeneeded = (e) => {
        try {
          upgrade && upgrade(req.result, e)
        } catch (err) {
          reject(err)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('indexedDB open failed: ' + name))
      req.onblocked = () => reject(new Error('indexedDB blocked: ' + name))
    })
  }
  function idbAll(db, store) {
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(store)) return resolve([])
      try {
        const tx = db.transaction(store, 'readonly')
        const req = tx.objectStore(store).getAll()
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
  }
  function idbPut(db, store, value) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        const req = tx.objectStore(store).put(value)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      } catch (e) {
        reject(e)
      }
    })
  }
  // v9.15（dsh，M5-010）：删除 `idbGetAll`（仅是 idbAll 的别名，全仓库无引用）
  function idbDelete(db, store, key) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite')
        tx.objectStore(store).delete(key)
        tx.oncomplete = resolve
        tx.onerror = resolve
      } catch {
        resolve()
      }
    })
  }

  // 只读应用数据库：读完立即关闭连接，避免阻塞应用自身的 Dexie 版本升级
  async function readAppRecords() {
    let db = null
    try {
      db = await idbOpen('RecordDB')
      const wordRecords = await idbAll(db, 'wordRecords')
      const chapterRecords = await idbAll(db, 'chapterRecords')
      const memoryRecords = await idbAll(db, 'memoryRecords')
      return { wordRecords, chapterRecords, memoryRecords }
    } catch {
      return { wordRecords: [], chapterRecords: [], memoryRecords: [] }
    } finally {
      try {
        if (db) db.close()
      } catch {
        /* ignore */
      }
    }
  }

  // v8：一次读取官方学习数据（wordRecords + memoryRecords），供数据页统一使用
  // 设置页一次打开会同时要「统计 + 洞察」，两者都读 wordRecords。
  // 3 秒 TTL 让第二次读走缓存，避免同一份全表被解析两遍（练习中数据每秒都在变，缓存不做更长）。
  let insightsCache = { at: 0, data: null }
  async function readRecordInsights() {
    if (insightsCache.data && Date.now() - insightsCache.at < 3000) return insightsCache.data
    let db = null
    try {
      db = await idbOpen('RecordDB')
      const wordRecords = await idbAll(db, 'wordRecords')
      const memoryRecords = await idbAll(db, 'memoryRecords')
      insightsCache = { at: Date.now(), data: { wordRecords, memoryRecords } }
      return insightsCache.data
    } catch {
      return { wordRecords: [], memoryRecords: [] }
    } finally {
      try {
        if (db) db.close()
      } catch {
        /* ignore */
      }
    }
  }

  let plusDBPromise = null
  function getPlusDB() {
    if (!plusDBPromise) {
      plusDBPromise = idbOpen('QwertyPlusDB', 3, (db) => {
        if (!db.objectStoreNames.contains('dicts')) db.createObjectStore('dicts', { keyPath: 'name' })
      }).catch((e) => {
        console.warn('[QZ] plus db:', e)
        return null
      })
    }
    return plusDBPromise
  }

  // ---------------------------------------------------------------- v8.9 逻辑备份快照
  // 主进程在备份时通过 'backup:request' 事件请求；这里只读收集 RecordDB 全部 store、
  // QwertyPlusDB.dicts（自定义词库）、localStorage 全量与主进程设置，序列化后回传。
  // 注意：全程只读、连接用完即关；任何一步失败都不影响主进程的目录副本备份。
  async function collectBackupSnapshot() {
    const snap = {
      version: api.version || settings.version || '',
      ts: Date.now(),
      recordDb: {},
      customDicts: [],
      localStorage: {},
      settings: {},
    }
    // RecordDB：遍历全部 object store（只读打开，读完立即关闭，避免阻塞应用自身 Dexie 升级）
    let db = null
    try {
      db = await idbOpen('RecordDB')
      const stores = Array.from(db.objectStoreNames || [])
      for (const store of stores) {
        snap.recordDb[store] = await idbAll(db, store)
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot RecordDB:', e)
    } finally {
      try {
        if (db) db.close()
      } catch {
        /* ignore */
      }
    }
    // QwertyPlusDB.dicts：库不存在时跳过（用 databases() 探测，避免只读操作顺手建空库）
    try {
      let exists = true
      if (indexedDB.databases) {
        const list = await indexedDB.databases()
        exists = list.some((d) => d && d.name === 'QwertyPlusDB')
      }
      if (exists) {
        let pdb = null
        try {
          pdb = await idbOpen('QwertyPlusDB')
          if (pdb.objectStoreNames.contains('dicts')) snap.customDicts = await idbAll(pdb, 'dicts')
        } finally {
          try {
            if (pdb) pdb.close()
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot QwertyPlusDB:', e)
    }
    // localStorage 全量（含 qzCustomDict / state 等，原样保留字符串，可能较大）
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k == null) continue
        snap.localStorage[k] = localStorage.getItem(k)
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot localStorage:', e)
    }
    // 主进程设置（只读快照）
    try {
      snap.settings = await api.getSettings()
    } catch {
      snap.settings = {}
    }
    return snap
  }
  function handleBackupRequest() {
    collectBackupSnapshot()
      .then((snap) => {
        let text = null
        try {
          text = JSON.stringify(snap)
        } catch (e) {
          console.warn('[QZ] backup snapshot stringify:', e)
          return null
        }
        return api.writeBackupSnapshot(text)
      })
      .catch((e) => console.warn('[QZ] backup snapshot:', e))
  }

  // ---------------------------------------------------------------- 统计
  async function collectStats() {
    const stats = {
      today: TODAY(),
      words: 0,
      goal: settings.dailyGoal || 30,
      streak: 0,
      ratio: 0,
      heat: [],
      totalWords: 0,
      wrongCount: 0,
      wrongWords: [],
      records: [],
      chapters: [],
      totalMinutes: 0,
      wpm: 0,
      practiceCount: 0,
      source: 'none',
    }
    const dbData = await readAppRecords()
    let wordRecords = dbData.wordRecords
    const chapterRecords = dbData.chapterRecords
    const memoryRecords = dbData.memoryRecords || []
    if (wordRecords.length || chapterRecords.length) stats.source = 'RecordDB'
    // 兼容：若 RecordDB 为空，尝试读 localStorage.state 里的旧记录
    if (!wordRecords.length) {
      try {
        const raw = localStorage.getItem('state')
        if (raw) {
          const st = JSON.parse(raw)
          const maybe = st.wordRecords || (st.state && st.state.wordRecords)
          if (Array.isArray(maybe)) {
            wordRecords = maybe
            stats.source = 'localStorage'
          }
        }
      } catch {
        /* ignore */
      }
    }
    const daySet = new Set()
    const todayWords = new Set()
    const seenWords = new Set()
    const heatMap = {}
    const dayWordsMap = {}
    for (const r of wordRecords) {
      const ts = normTs(r.timeStamp || r.timestamp || r.ts || 0)
      if (!ts) continue
      const k = dayKey(ts)
      daySet.add(k)
      heatMap[k] = (heatMap[k] || 0) + 1
      const w = String(r.word || '').trim()
      if (!w) continue
      seenWords.add(w)
      if (k === stats.today) todayWords.add(w)
      if (!dayWordsMap[k]) dayWordsMap[k] = new Set()
      dayWordsMap[k].add(w)
      const wc = Number(r.wrongCount || r.errorCount || 0)
      if (wc > 0) stats.wrongCount += 1
    }
    stats.words = todayWords.size
    stats.totalWords = seenWords.size
    stats.heat = Object.entries(heatMap)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-14)
      .map(([d, n]) => ({ date: d, count: n }))
    // 连续打卡
    let cursor = new Date()
    if (!daySet.has(stats.today)) cursor.setDate(cursor.getDate() - 1)
    let streak = 0
    for (let i = 0; i < 3650; i++) {
      const k = dayKey(cursor.getTime())
      if (daySet.has(k)) {
        streak++
        cursor.setDate(cursor.getDate() - 1)
      } else break
    }
    stats.streak = streak
    stats.ratio = stats.goal > 0 ? clamp(stats.words / stats.goal, 0, 1) : 0
    // 章节记录（练习时长 / WPM / 正确率）
    let totalSec = 0,
      totalAnsweredWords = 0,
      totalCorrect = 0,
      totalWrong = 0
    for (const c of chapterRecords) {
      const t = Number(c.time || c.totalTime || 0)
      if (isFinite(t) && t > 0) totalSec += t // 应用内 chapterRecords.time 单位：秒
      const wc = Number(c.wordCount || c.wordNumber || 20)
      totalAnsweredWords += wc
      totalCorrect += Number(c.correctCount || 0)
      totalWrong += Number(c.wrongCount || 0)
    }
    stats.totalMinutes = Math.round((totalSec / 60) * 10) / 10
    stats.chapters = chapterRecords
    if (totalSec > 0 && totalAnsweredWords > 0) {
      stats.wpm = Math.round(totalAnsweredWords / (totalSec / 60))
    }
    const answered = totalCorrect + totalWrong
    stats.accuracy = answered > 0 ? Math.round((totalCorrect / answered) * 1000) / 10 : null
    stats.answeredWords = totalAnsweredWords
    stats.correctCount = totalCorrect
    stats.wrongCountTotal = totalWrong
    // v8：v7 起练习页不再写 chapterRecords，练习时长 / WPM / 准确率改由 wordRecords 的按键计时估算
    if (wordRecords.length) {
      let ms = 0,
        letters = 0,
        errs = 0
      for (const r of wordRecords) {
        const timing = Array.isArray(r.timing) ? r.timing : []
        for (const t of timing) {
          if (isFinite(t) && t > 0) ms += t
        }
        letters += String(r.word || '').length
        const mis = r.mistakes && typeof r.mistakes === 'object' ? r.mistakes : {}
        for (const arr of Object.values(mis)) errs += Array.isArray(arr) ? arr.length : 1
      }
      if (ms > 0) {
        stats.totalMinutes = Math.round((ms / 60000) * 10) / 10
        stats.wpm = Math.round(wordRecords.length / (ms / 60000))
      }
      if (!stats.totalMinutes) stats.totalMinutes = 0
      if (letters > 0) stats.accuracy = Math.round((letters / (letters + errs)) * 1000) / 10
    }
    // 错词去重
    const wrongMap = new Map()
    for (const r of wordRecords) {
      const wc = Number(r.wrongCount || r.errorCount || 0)
      if (wc <= 0) continue
      const key = `${r.word}|${r.dict}|${r.chapter}`
      const prev = wrongMap.get(key)
      if (!prev || prev.wrongCount < wc) {
        wrongMap.set(key, {
          word: String(r.word || ''),
          wrongCount: wc,
          dict: String(r.dict || ''),
          chapter: String(r.chapter || ''),
          timeStamp: normTs(r.timeStamp),
        })
      }
    }
    stats.wrongWords = [...wrongMap.values()].sort((a, b) => b.wrongCount - a.wrongCount)
    // v8.1 学习报告：掌握度分布 + 未来 7 天到期
    const buckets = { short: 0, mid: 0, long: 0 }
    const dueDays = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      dueDays.push({ date: dayKey(d.getTime()), count: 0 })
    }
    const shadow = { count: 0, adaptiveSum: 0, actualSum: 0 }
    const nowTs = Date.now()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const dueNowList = []
    const newCountMap = {}
    let todayNew = 0
    for (const m of memoryRecords) {
      if (!m) continue
      const st = Number(m.stage) || 0
      if (st <= 2) buckets.short += 1
      else if (st <= 5) buckets.mid += 1
      else buckets.long += 1
      const created = Number(m.createdAt) || 0
      if (created >= startOfToday.getTime()) todayNew += 1
      if (created) {
        const ck = dayKey(created)
        newCountMap[ck] = (newCountMap[ck] || 0) + 1
      }
      const due = Number(m.due) || 0
      if (due) {
        const k = dayKey(due)
        const row = dueDays.find((x) => x.date === k)
        if (row) row.count += 1
        if (due <= nowTs) dueNowList.push(m)
      }
      const shadowDays = Number(m.shadowInterval) || 0
      if (shadowDays > 0) {
        shadow.count += 1
        shadow.adaptiveSum += shadowDays
        shadow.actualSum += Number(m.interval) || 0
      }
    }
    shadow.avgAdaptive = shadow.count ? shadow.adaptiveSum / shadow.count : 0
    shadow.avgActual = shadow.count ? shadow.actualSum / shadow.count : 0
    dueNowList.sort((a, b) => (Number(a.due) || 0) - (Number(b.due) || 0))
    stats.todayNew = todayNew
    stats.memory = {
      learned: memoryRecords.length,
      buckets,
      dueDays,
      shadow,
      dueNow: dueNowList.length,
      dueList: dueNowList.slice(0, 200).map((m) => ({
        word: String(m.word || ''),
        trans: Array.isArray(m.trans) ? m.trans : [],
        phone: String(m.phone || ''),
        dict: String(m.dict || ''),
        stage: Number(m.stage) || 0,
        due: Number(m.due) || 0,
        interval: Number(m.interval) || 0,
      })),
    }
    // v9.1：14 天周历（周几/日期/点击明细）+ 近 30 天趋势（新学/复习）
    const baseDay = new Date()
    baseDay.setHours(0, 0, 0, 0)
    const heatDays = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(baseDay)
      d.setDate(d.getDate() - i)
      const k = dayKey(d.getTime())
      const set = dayWordsMap[k]
      heatDays.push({ date: k, weekday: d.getDay(), count: set ? set.size : 0, words: set ? Array.from(set).slice(0, 10) : [] })
    }
    const trend = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(baseDay)
      d.setDate(d.getDate() - i)
      const k = dayKey(d.getTime())
      const set = dayWordsMap[k]
      trend.push({ date: k, practiced: set ? set.size : 0, fresh: newCountMap[k] || 0 })
    }
    stats.heatDays = heatDays
    stats.trend = trend
    // v9.3：自动进阶状态（由页面 localStorage 持久化，数据页只读展示）
    try {
      const st = JSON.parse(localStorage.getItem('qzAutoLevelState') || 'null') || {}
      const c = st.cached || {}
      stats.autoLevel = {
        levelId: String(st.levelId || ''),
        name: String(c.name || ''),
        total: Number(c.total) || 0,
        seen: Number(c.seen) || 0,
        mastered: Number(c.mastered) || 0,
        suspended: Number(c.suspendedCount) || 0,
        due: dueNowList.length,
        newRatio: Number.isFinite(Number(c.newRatio)) ? Number(c.newRatio) : null,
        updatedAt: Number(c.updatedAt) || 0,
      }
    } catch {
      stats.autoLevel = null
    }
    stats.at = Date.now()
    return stats
  }

  async function pushStats() {
    try {
      const s = appStats && appStats.today === TODAY() && Date.now() - (appStats.at || 0) < 30000 ? appStats : await collectStats()
      appStats = s
      api.sendStats({ date: s.today, words: s.words, goal: s.goal, streak: s.streak, ratio: s.ratio })
      // v9.15（dsh，M5-010）：删除对已隐藏悬浮球/今日条（#qz-chip-text / #qz-badge）的每 60 秒 DOM 写入
    } catch (e) {
      console.warn('[QZ] pushStats', e)
    }
  }

  // ---------------------------------------------------------------- 自定义词库
  function parseCSV(text) {
    const rows = []
    let row = [],
      field = '',
      inQuote = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i++
          } else inQuote = false
        } else field += c
      } else if (c === '"') inQuote = true
      else if (c === ',') {
        row.push(field)
        field = ''
      } else if (c === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      } else if (c === '\r') {
        /* skip */
      } else field += c
    }
    if (field.length || row.length) {
      row.push(field)
      rows.push(row)
    }
    return rows.filter((r) => r.some((f) => String(f).trim() !== ''))
  }
  function normalizeWordEntry(name, trans) {
    const w = String(name == null ? '' : name).trim()
    if (!w) return null
    let t = trans
    if (Array.isArray(t)) t = t.join('；')
    return { name: w, trans: String(t == null ? '' : t).trim() }
  }
  function parseImportText(text, ext) {
    const out = []
    const push = (n, t) => {
      const e = normalizeWordEntry(n, t)
      if (e) out.push(e)
    }
    if (ext === 'json') {
      let data
      try {
        data = JSON.parse(text)
      } catch (e) {
        throw new Error('JSON 解析失败: ' + e.message)
      }
      const arr = Array.isArray(data) ? data : Array.isArray(data.words) ? data.words : Array.isArray(data.dict) ? data.dict : []
      if (!arr.length) throw new Error('JSON 中未找到单词数组')
      for (const it of arr) {
        if (typeof it === 'string') push(it, '')
        else if (Array.isArray(it)) push(it[0], it[1] || it[2] || '')
        else if (it && typeof it === 'object')
          push(
            it.name || it.word || it.term || it.en || it.english,
            it.trans || it.translation || it.meaning || it.cn || it.chinese || it.translate || '',
          )
      }
    } else if (ext === 'csv') {
      const rows = parseCSV(text)
      if (!rows.length) throw new Error('CSV 为空')
      let start = 0
      const first = rows[0].map((x) => String(x).trim().toLowerCase())
      if (first.includes('word') || first.includes('单词') || first.includes('name') || first.includes('单词名')) start = 1
      for (let i = start; i < rows.length; i++) push(rows[i][0], rows[i][1])
    } else {
      // txt: 每行 "word" 或 "word\t释义" / "word,释义"
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        const s = line.trim()
        if (!s || s.startsWith('#')) continue
        let parts = s.split('\t')
        if (parts.length < 2) {
          const idx = s.indexOf(',')
          if (idx > 0 && idx < s.length - 1) parts = [s.slice(0, idx), s.slice(idx + 1)]
          else parts = [s]
        }
        push(parts[0], parts.slice(1).join(' '))
      }
    }
    // 去重（按 name 小写）
    const seen = new Set()
    return out.filter((e) => {
      const k = e.name.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  // ---------------------------------------------------------------- CSV
  function csvEscape(v) {
    const s = String(v == null ? '' : v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  function toCSV(header, rows) {
    return '\ufeff' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
  }
  function tsText(ts) {
    if (!ts) return ''
    try {
      return new Date(ts).toLocaleString('zh-CN')
    } catch {
      return ''
    }
  }

  // ---------------------------------------------------------------- 覆盖层（词卡 / 悬停提示 / toast）
  // v11：增强面板的整页 UI 已迁到 React 设置面板，这里只保留「页面内浮层」这一份 UI。
  const host = document.createElement('div')
  host.id = 'qz-enhance-host'
  host.style.cssText = 'position:fixed;z-index:2147483000;right:0;bottom:0;width:0;height:0;'
  const shadow = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  const OVERLAY_CSS = `
  :host { all: initial; --qz-bg:#fff; --qz-surface:#f8fafc; --qz-border:#e2e8f0; --qz-text:#334155;
    --qz-text-strong:#1e293b; --qz-muted:#94a3b8; --qz-accent:#818cf8; --qz-accent-soft:rgba(129,140,248,.12);
    --qz-track:#e2e8f0; --qz-shadow:0 10px 30px rgba(15,23,42,.10); }
  :host(.qz-dark) { --qz-bg:#1e293b; --qz-surface:#243244; --qz-border:#334155; --qz-text:#e2e8f0;
    --qz-text-strong:#f1f5f9; --qz-muted:#94a3b8; --qz-accent:#a5b4fc; --qz-accent-soft:rgba(129,140,248,.18);
    --qz-track:#334155; --qz-shadow:0 14px 34px rgba(2,6,23,.45); }
  *, *::before, *::after { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif; }
  button { outline: none; }
  button:focus-visible { outline: 2px solid var(--qz-accent); outline-offset: 2px; }

  .toast-wrap { position: fixed; right: 22px; bottom: 130px; display: flex; flex-direction: column; gap: 8px; z-index: 2147483002; }
  .toast { max-width: 340px; padding: 9px 13px; border-radius: 8px; background: var(--qz-bg); color: var(--qz-text);
    border: 1px solid var(--qz-border); box-shadow: 0 8px 22px rgba(15,23,42,.14); font-size: 12.5px; line-height: 1.55; }

  .qz-tooltip { position: fixed; z-index: 2147483003; max-width: 320px; padding: 7px 10px; border-radius: 8px;
    background: var(--qz-bg); color: var(--qz-text); border: 1px solid var(--qz-border);
    box-shadow: 0 8px 22px rgba(15,23,42,.14); font-size: 12.5px; line-height: 1.55;
    pointer-events: none; opacity: 0; transition: opacity .12s; }
  .qz-tooltip.show { opacity: 1; }
  .qz-tooltip .tw { margin-bottom: 2px; font-weight: 700; color: var(--qz-text-strong); }
  .qz-tooltip .ts { margin-top: 3px; font-size: 10px; color: var(--qz-muted); }
  .qz-tooltip .toff { font-size: 10.5px; color: #b45309; }

  .wordcard-mask { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center;
    justify-content: center; background: rgba(15,23,42,.28); }
  .wordcard { width: 660px; max-width: calc(100vw - 40px); max-height: calc(100vh - 80px); overflow: auto;
    padding: 20px 22px; border-radius: 14px; background: var(--qz-bg); color: var(--qz-text);
    border: 1px solid var(--qz-border); box-shadow: var(--qz-shadow); }
  .wordcard::-webkit-scrollbar { width: 8px; }
  .wordcard::-webkit-scrollbar-thumb { background: var(--qz-border); border-radius: 4px; }
  .wc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .wc-word { font-size: 30px; font-weight: 700; color: var(--qz-text-strong); letter-spacing: .5px; word-break: break-word; }
  .wc-ph { margin-top: 2px; font-size: 13px; color: var(--qz-muted); }
  .wc-src { margin-top: 4px; font-size: 10.5px; color: var(--qz-muted); }
  .wc-badge { display: inline-block; margin-right: 4px; padding: 2px 8px; border-radius: 999px;
    background: var(--qz-accent-soft); color: var(--qz-accent); font-size: 10px; }
  .wc-sec { margin-top: 14px; }
  .wc-sec h5 { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .05em; color: var(--qz-muted); }
  .wc-zh { font-size: 14px; line-height: 1.7; color: var(--qz-text); }
  .wc-zh .src { margin-left: 4px; font-size: 10px; color: var(--qz-muted); }
  .wc-def { margin-bottom: 5px; font-size: 12.5px; line-height: 1.6; color: var(--qz-text); }
  .wc-def b { font-weight: 600; color: var(--qz-accent); }
  .wc-ex { padding: 9px 11px; margin-bottom: 8px; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 8px; }
  .wc-ex .sen { font-size: 13.5px; line-height: 1.8; color: var(--qz-text); }
  .wc-ex .tr { margin-top: 5px; font-size: 12px; line-height: 1.6; color: var(--qz-text); white-space: pre-wrap; }
  .wc-ex .tr.loading { color: var(--qz-muted); }
  .wc-w { padding: 0 1px; border-radius: 3px; cursor: pointer; }
  .wc-w:hover { background: var(--qz-accent-soft); color: var(--qz-text-strong); }
  .wc-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
  .wc-syn { display: flex; flex-wrap: wrap; gap: 5px; }
  .wc-syn span { padding: 2px 7px; border-radius: 6px; background: var(--qz-surface); border: 1px solid var(--qz-border);
    font-size: 11.5px; color: var(--qz-text); }
  .wc-close { background: none; border: none; color: var(--qz-muted); font-size: 18px; cursor: pointer; padding: 4px; }
  .wc-close:hover { color: var(--qz-text); }
  .wc-offline { margin-top: 10px; padding: 6px 10px; border-radius: 8px; font-size: 11.5px;
    background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; }
  :host(.qz-dark) .wc-offline { background: rgba(180,83,9,.18); border-color: rgba(252,211,77,.4); color: #fcd34d; }
  .wc-loading { padding: 18px 0; text-align: center; font-size: 12.5px; color: var(--qz-muted); }

  .btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 11px;
    border-radius: 8px; border: 1px solid var(--qz-border); background: var(--qz-bg); color: var(--qz-text);
    font-size: 12px; font-weight: 500; cursor: pointer; transition: .15s; }
  .btn:hover { border-color: var(--qz-accent); color: var(--qz-accent); }
  .btn.primary { background: var(--qz-accent); border-color: var(--qz-accent); color: #fff; }
  .btn.sm { height: 24px; padding: 0 8px; font-size: 11px; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .muted { font-size: 11.5px; color: var(--qz-muted); }
  `
  const styleEl = document.createElement('style')
  styleEl.textContent = OVERLAY_CSS
  shadow.appendChild(styleEl)

  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div id="qz-wordcard-root"></div>
    <div class="qz-tooltip" id="qz-tooltip"></div>
    <div class="toast-wrap" id="qz-toasts"></div>
  `
  shadow.appendChild(wrap)

  const $ = (sel) => shadow.querySelector(sel)

  function toast(msg, ms = 2600) {
    const box = $('#qz-toasts')
    if (!box) return
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = msg
    box.appendChild(el)
    setTimeout(() => {
      try {
        el.remove()
      } catch {
        /* ignore */
      }
    }, ms)
  }

  // ---------------------------------------------------------------- 主题（页面级，非面板）
  function isDark() {
    return document.documentElement.classList.contains('dark')
  }
  function syncOverlayTheme() {
    host.classList.toggle('qz-dark', isDark())
  }
  function applyTheme() {
    const html = document.documentElement
    if (typeof settings.darkMode === 'boolean') html.classList.toggle('dark', settings.darkMode)
    ;['indigo', 'emerald', 'rose', 'amber', 'sky', 'violet'].forEach((t) =>
      html.classList.toggle('qz-accent-' + t, (settings.theme || 'indigo') === t),
    )
    ;['mono', 'serif', 'round'].forEach((f) => html.classList.toggle('qz-font-' + f, settings.fontFamily === f))
    syncOverlayTheme()
  }

  // 主进程事件：迷你模式 / 设置变更（打开设置由 React 直接监听 enhance:event）
  api.onEvent((payload) => {
    if (!payload) return
    if (payload.type === 'mini') {
      document.body.classList.toggle('qz-mini', !!payload.value)
      settings.miniMode = !!payload.value
    } else if (payload.type === 'settings' && payload.value) {
      const wasDark = isDark()
      settings = { ...settings, ...payload.value }
      if (wasDark !== isDark()) applyTheme()
      else syncOverlayTheme()
    }
  })

  let currentDictId = ''
  function getCurrentDictId() {
    try {
      const raw = localStorage.getItem('currentDict')
      if (raw) {
        let v = raw
        try {
          const j = JSON.parse(raw)
          if (typeof j === 'string') v = j
          else if (j && typeof j === 'object') v = j.id || j.dict || j.value || ''
        } catch {
          /* 非 JSON，原样使用 */
        }
        currentDictId = String(v || '')
          .replace(/^"|"$/g, '')
          .slice(0, 80)
      }
    } catch {
      /* ignore */
    }
    return currentDictId
  }
  const pronUrl = (w) => 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(w || '').trim()) + '&type=2'
  function playPron(w, silent) {
    const word = String(w || '').trim()
    if (!word) return
    try {
      const a = new Audio(pronUrl(word))
      a.volume = 1
      a.play().catch(() => {
        if (!silent) toast('发音播放失败（可能被网络或音频策略拦截）')
      })
    } catch (e) {
      if (!silent) toast('发音播放失败')
    }
  }
  let hoverTimer = null,
    hoverHideTimer = null
  const hoverCache = new Map()
  function tipBox() {
    return $('#qz-tooltip')
  }
  function hideTooltip() {
    const el = tipBox()
    if (!el) return
    el.classList.remove('show')
  }
  function showTooltip(word, text, rect, opts = {}) {
    const el = tipBox()
    if (!el) return
    el.innerHTML = `<div class="tw">${esc(word)}</div><div class="tt">${esc(text)}</div>${
      opts.offline ? '<div class="toff">离线 / 缓存</div>' : ''
    }<div class="ts">点击单词可发音</div>`
    el.classList.add('show')
    const elRect = el.getBoundingClientRect()
    let x = rect.left
    let y = rect.top - elRect.height - 8
    if (y < 8) y = rect.bottom + 8
    if (x + elRect.width > window.innerWidth - 8) x = window.innerWidth - elRect.width - 8
    if (x < 8) x = 8
    if (y + elRect.height > window.innerHeight - 8) y = window.innerHeight - elRect.height - 8
    el.style.left = x + 'px'
    el.style.top = y + 'px'
  }
  function splitWordsHTML(sentence) {
    const s = String(sentence || '')
    let out = '',
      last = 0
    const re = /[A-Za-z][A-Za-z'’-]*/g
    let m
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index))
      out += `<span class="wc-w" data-w="${esc(m[0])}">${esc(m[0])}</span>`
      last = m.index + m[0].length
    }
    return out + esc(s.slice(last))
  }
  const wordCard = { word: '', data: null, transCache: new Map() }
  function closeWordCard() {
    const root = $('#qz-wordcard-root')
    if (root) root.innerHTML = ''
    wordCard.data = null
    hideTooltip()
  }
  async function openWordCard(rawWord) {
    const word = String(rawWord || '').trim()
    if (!word) return toast('请输入单词或短语')
    wordCard.word = word
    wordCard.data = null
    wordCard.transCache = new Map()
    const root = $('#qz-wordcard-root')
    root.innerHTML = `<div class="wordcard-mask" id="wc-mask"><div class="wordcard">
      <div class="wc-head"><div><div class="wc-word">${esc(
        word,
      )}</div><div class="wc-ph" id="wc-ph"></div><div class="wc-src" id="wc-src"></div></div>
        <button class="wc-close" id="wc-close" title="关闭">✕</button></div>
      <div id="wc-body"><div class="wc-loading">查询中…</div></div></div></div>`
    $('#wc-mask').addEventListener('click', (e) => {
      if (e.target.id === 'wc-mask') closeWordCard()
    })
    $('#wc-close').addEventListener('click', closeWordCard)
    let r
    try {
      r = await api.freeLookup(word, getCurrentDictId())
    } catch (e) {
      r = { ok: false, error: String(e.message || e) }
    }
    if (!r || !r.ok) {
      $('#wc-body').innerHTML = `<div class="wc-loading">${esc((r && r.error) || '未找到释义')}</div>
        <div class="wc-actions"><button class="btn sm ghost" id="wc-retry">重试</button></div>`
      const btn = $('#wc-retry')
      if (btn) btn.addEventListener('click', () => openWordCard(word))
      if (r && r.offline)
        $('#wc-body').insertAdjacentHTML('afterbegin', '<div class="wc-offline">当前处于离线模式或网络不可用，仅显示本地词库/缓存。</div>')
      return
    }
    wordCard.data = r
    renderWordCard(r)
  }
  function renderWordCard(r) {
    const ph = $('#wc-ph'),
      src = $('#wc-src'),
      body = $('#wc-body')
    if (!body) return
    const phones = []
    if (r.usphone) phones.push('美 [' + r.usphone + ']')
    if (r.ukphone) phones.push('英 [' + r.ukphone + ']')
    if (!phones.length && r.phonetic) phones.push(r.phonetic)
    if (ph) ph.textContent = phones.join('  ') || ''
    if (src) {
      const badges = (r.sources || []).map((s) => `<span class="wc-badge">${esc(s)}</span>`).join('')
      src.innerHTML =
        (badges || '') + (r.cached ? '<span class="wc-badge">缓存</span>' : '') + (r.offline ? '<span class="wc-badge">离线</span>' : '')
    }
    let html = ''
    if (r.offline) html += '<div class="wc-offline">离线 / 网络受限：仅显示本地词库与缓存结果。</div>'
    if (r.zhLines && r.zhLines.length) {
      html +=
        '<div class="wc-sec"><h5>中文释义</h5><div class="wc-zh">' +
        r.zhLines.map((x) => `${esc(x.text)}<span class="src">[${esc(x.source || '')}]</span>`).join('<br>') +
        '</div></div>'
    }
    if (r.defs && r.defs.length) {
      html +=
        '<div class="wc-sec"><h5>英文释义</h5><div>' +
        r.defs.map((d) => `<div class="wc-def"><b>${esc(d.pos || '')}</b> ${esc(d.def || '')}</div>`).join('') +
        '</div></div>'
    }
    if (r.examples && r.examples.length) {
      const exSrc = r.examplesSource === '本地例句库' ? ' · 原句来自本地例句库' : ''
      html +=
        '<div class="wc-sec"><h5>例句' +
        exSrc +
        '</h5>' +
        r.examples
          .map(
            (ex, i) => `<div class="wc-ex"><div class="sen">${splitWordsHTML(ex)}</div>
          <div class="wc-actions"><button class="btn sm ghost" data-tr="${i}">翻译整句</button>
          <span class="muted" style="font-size:10.5px">整句翻译由 MyMemory 提供（免 Key）</span></div>
          <div class="tr" id="wc-tr-${i}"></div></div>`,
          )
          .join('') +
        '</div>'
    } else {
      html += '<div class="wc-sec"><div class="muted">暂无英文例句（dictionaryapi 未收录该词，或当前为离线模式）。</div></div>'
    }
    if (r.synonyms && r.synonyms.length) {
      html +=
        '<div class="wc-sec"><h5>同义词</h5><div class="wc-syn">' +
        r.synonyms.map((s) => `<span data-syn="${esc(s)}">${esc(s)}</span>`).join('') +
        '</div></div>'
    }
    html += `<div class="wc-actions" style="margin-top:16px">
      <button class="btn primary sm" id="wc-pron">🔊 发音</button>
      <button class="btn sm ghost" id="wc-copy">复制单词</button>
    </div>`
    body.innerHTML = html
    // 绑定：例句单词 hover + 点击发音
    body.querySelectorAll('.wc-w').forEach((sp) => {
      const w = sp.dataset.w
      sp.addEventListener('mouseenter', () => {
        if (hoverTimer) clearTimeout(hoverTimer)
        const rect = sp.getBoundingClientRect()
        hoverTimer = setTimeout(async () => {
          hoverTimer = null
          const key = w.toLowerCase()
          if (hoverCache.has(key)) {
            showTooltip(w, hoverCache.get(key), rect)
            return
          }
          showTooltip(w, '查询中…', rect)
          let text = '',
            offline = false
          try {
            const hr = await api.freeHover(w, getCurrentDictId())
            if (hr && hr.ok && hr.text) {
              text = hr.text
              hoverCache.set(key, text)
            } else if (hr && hr.offline) offline = true
          } catch {
            offline = true
          }
          showTooltip(w, text || (offline ? '离线：暂无缓存释义' : '暂无该词释义'), rect, { offline })
        }, 300)
      })
      sp.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer)
          hoverTimer = null
        }
        if (hoverHideTimer) clearTimeout(hoverHideTimer)
        hoverHideTimer = setTimeout(hideTooltip, 120)
      })
      sp.addEventListener('click', () => playPron(w))
    })
    // 绑定：翻译整句
    body.querySelectorAll('[data-tr]').forEach((btn) => {
      btn.addEventListener('click', () => translateExample(Number(btn.dataset.tr), btn))
    })
    // 绑定：同义词点击查词
    body.querySelectorAll('[data-syn]').forEach((el) => {
      el.addEventListener('click', () => openWordCard(el.dataset.syn))
    })
    const pron = $('#wc-pron')
    if (pron) pron.addEventListener('click', () => playPron(r.word || wordCard.word))
    const copy = $('#wc-copy')
    if (copy)
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(r.word || wordCard.word)
          toast('已复制：' + (r.word || wordCard.word))
        } catch {
          toast('复制失败')
        }
      })
  }
  async function translateExample(idx, btn) {
    if (!wordCard.data) return
    const tr = $('#wc-tr-' + idx)
    const sentence = (wordCard.data.examples || [])[idx]
    if (!tr || !sentence) return
    if (tr.dataset.open === '1') {
      tr.dataset.open = '0'
      tr.textContent = ''
      tr.classList.remove('loading')
      btn.textContent = '翻译整句'
      return
    }
    if (wordCard.transCache.has(idx)) {
      tr.textContent = wordCard.transCache.get(idx)
      tr.dataset.open = '1'
      btn.textContent = '收起翻译'
      return
    }
    tr.className = 'tr loading'
    tr.textContent = '翻译中…'
    btn.disabled = true
    try {
      const r = await api.freeTranslate(sentence)
      if (r && r.ok) {
        const shown = r.text + (r.source && r.source !== 'cache' ? '  — ' + r.source : '')
        wordCard.transCache.set(idx, shown)
        tr.className = 'tr'
        tr.textContent = shown
        tr.dataset.open = '1'
        btn.textContent = '收起翻译'
      } else {
        tr.className = 'tr'
        tr.textContent = (r && r.error) || '翻译失败'
        toast((r && r.error) || '翻译失败')
      }
    } catch (e) {
      tr.className = 'tr'
      tr.textContent = '翻译失败：' + (e.message || e)
    } finally {
      btn.disabled = false
    }
  }

  // ---------------------------------------------------------------- 无头运行时（设置面板唯一入口）
  let builtinDicts = []
  async function loadBuiltinDicts() {
    if (builtinDicts.length) return builtinDicts
    try {
      const r = await api.dictList()
      builtinDicts = (r && r.dicts) || []
    } catch {
      builtinDicts = []
    }
    return builtinDicts
  }
  async function currentDict() {
    const id = getCurrentDictId()
    if (!id) return null
    await loadBuiltinDicts()
    return builtinDicts.find((d) => d.id === id) || null
  }
  async function recordDictRecent(file) {
    try {
      const recent = { ...(settings.dictRecent || {}) }
      recent[file] = Date.now()
      const keys = Object.keys(recent)
        .sort((a, b) => recent[b] - recent[a])
        .slice(0, 50)
      const trimmed = {}
      for (const k of keys) trimmed[k] = recent[k]
      settings = await api.updateSettings({ dictRecent: trimmed })
    } catch {
      /* ignore */
    }
  }
  async function toggleDictFavorite(file) {
    const arr = Array.isArray(settings.dictFavorites) ? settings.dictFavorites.slice() : []
    const i = arr.indexOf(file)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(file)
    settings = await api.updateSettings({ dictFavorites: arr })
    toast(i >= 0 ? '已取消收藏' : '已收藏')
    return arr
  }
  async function setCurrentDict(entry) {
    if (!entry) return false
    if (getCurrentDictId() === entry.id) return toast('已经是当前词库')
    if (!entry.id) {
      toast('该词库缺少 id，请在「词库」页手动选择', 4200)
      try {
        location.hash = '#/gallery'
      } catch {
        /* ignore */
      }
      return false
    }
    try {
      localStorage.setItem('currentDict', JSON.stringify(entry.id))
      localStorage.setItem('learningMode', JSON.stringify('manual'))
      localStorage.setItem('currentChapter', '0')
      try {
        localStorage.removeItem('reviewModeInfo')
      } catch {
        /* ignore */
      }
      await recordDictRecent(entry.file)
      toast('已切换为「' + entry.name + '」，正在重载…')
      setTimeout(() => {
        try {
          location.reload()
        } catch {
          /* ignore */
        }
      }, 500)
      return true
    } catch (e) {
      toast('切换失败：' + (e.message || e))
      return false
    }
  }

  async function startDueReview() {
    try {
      const s = await collectStats()
      const list = (s.memory && s.memory.dueList) || []
      if (!list.length) return toast('暂无到期词')
      const words = list.slice(0, 100).map((m) => ({
        name: m.word,
        trans: Array.isArray(m.trans) ? m.trans : [],
        usphone: m.phone || '',
        ukphone: m.phone || '',
        dict: m.dict,
      }))
      localStorage.setItem('qzDueReviewWords', JSON.stringify(words))
      toast('已准备 ' + words.length + ' 个到期词，正在进入复习…')
      try {
        location.hash = '#/'
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          location.reload()
        } catch {
          /* ignore */
        }
      }, 350)
      return true
    } catch (e) {
      toast('开始复习失败: ' + (e.message || e))
      return false
    }
  }

  async function reevaluateLevel() {
    try {
      if (!window.confirm('重新评估会按当前学习记录重新定位级别（可能回退），确定继续？')) return
      localStorage.setItem('qzReevaluateLevel', '1')
      toast('正在重新评估级别…', 2400)
      setTimeout(() => {
        try {
          location.reload()
        } catch {
          /* ignore */
        }
      }, 300)
    } catch (e) {
      toast('重新评估失败: ' + (e.message || e))
    }
  }
  async function resumeSuspended() {
    try {
      const st = JSON.parse(localStorage.getItem('qzAutoLevelState') || 'null') || {}
      const n = Array.isArray(st.suspended) ? st.suspended.length : 0
      if (!n) return toast('暂无待攻克词')
      if (!window.confirm('恢复 ' + n + ' 个待攻克词并清空 Skip 计数？')) return
      st.suspended = []
      st.skipped = {}
      localStorage.setItem('qzAutoLevelState', JSON.stringify(st))
      toast('已恢复，正在重载…', 2400)
      setTimeout(() => {
        try {
          location.reload()
        } catch {
          /* ignore */
        }
      }, 400)
    } catch (e) {
      toast('恢复失败: ' + (e.message || e))
    }
  }

  async function exportAll() {
    try {
      toast('正在收集数据…')
      const snap = await collectBackupSnapshot()
      if (TEST_HOOKS && window.__QZ_TEST_EXPORT__) {
        window.__QZ_EXPORT_LAST__ = JSON.stringify(snap)
        toast('测试导出已就绪（' + String(window.__QZ_EXPORT_LAST__.length) + ' 字节）')
        return
      }
      const r = await api.exportJSON('qwerty-全量数据-' + TODAY() + '.json', JSON.stringify(snap, null, 2))
      if (r && r.ok) toast('已导出：' + r.path, 4200)
      else if (r && r.canceled) toast('已取消')
      else toast('导出失败: ' + ((r && r.error) || '未知'))
    } catch (e) {
      toast('导出失败: ' + (e.message || e))
    }
  }

  async function importAll() {
    try {
      const testHook = TEST_HOOKS && !!window.__QZ_IMPORT_TEXT__
      const res = testHook ? { ok: true, text: String(window.__QZ_IMPORT_TEXT__), path: 'test-hook' } : await api.importJSON()
      try {
        delete window.__QZ_IMPORT_TEXT__
      } catch {
        /* ignore */
      }
      if (!res || !res.ok) {
        if (!(res && res.canceled)) toast('读取失败: ' + ((res && res.error) || '未知'))
        return
      }
      let data = null
      try {
        data = JSON.parse(res.text)
      } catch {
        return toast('JSON 解析失败')
      }
      if (!data || !data.recordDb) return toast('不是有效的全量数据文件')
      if (!testHook && !window.confirm('导入会覆盖当前全部学习数据（会先自动备份一份），确定继续？')) return
      toast('正在备份当前数据…')
      const backup = await api.backupNow()
      if (!(backup && backup.ok) && !testHook) {
        if (!window.confirm('自动备份失败，仍要继续导入？')) return
      }
      toast('正在导入…')
      let db = null
      try {
        db = await idbOpen('RecordDB')
        const stores = Array.from(db.objectStoreNames || [])
        for (const store of stores) {
          const rows = data.recordDb[store]
          if (!Array.isArray(rows)) continue
          await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            try {
              os.clear()
            } catch {
              /* ignore */
            }
            for (const row of rows) {
              try {
                os.put(row)
              } catch {
                /* ignore */
              }
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error || new Error('write ' + store))
            tx.onabort = () => reject(tx.error || new Error('abort ' + store))
          })
        }
      } finally {
        try {
          if (db) db.close()
        } catch {
          /* ignore */
        }
      }
      if (Array.isArray(data.customDicts) && data.customDicts.length) {
        let pdb = null
        try {
          pdb = await idbOpen('QwertyPlusDB', 3, (d) => {
            if (!d.objectStoreNames.contains('dicts')) d.createObjectStore('dicts', { keyPath: 'name' })
          })
          await new Promise((resolve, reject) => {
            const tx = pdb.transaction('dicts', 'readwrite')
            const os = tx.objectStore('dicts')
            try {
              os.clear()
            } catch {
              /* ignore */
            }
            for (const row of data.customDicts) {
              try {
                os.put(row)
              } catch {
                /* ignore */
              }
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error || new Error('custom dict import'))
          })
        } finally {
          try {
            if (pdb) pdb.close()
          } catch {
            /* ignore */
          }
        }
      }
      const lsFailed = []
      if (data.localStorage && typeof data.localStorage === 'object') {
        const skip = new Set(['reviewModeInfo'])
        for (const k of Object.keys(data.localStorage)) {
          const v = data.localStorage[k]
          if (skip.has(k) || typeof v !== 'string') continue
          try {
            localStorage.setItem(k, v)
          } catch {
            lsFailed.push(k)
          }
        }
        try {
          if (typeof data.localStorage.qzCustomDict === 'string') {
            const ok = localStorage.getItem('qzCustomDict') === data.localStorage.qzCustomDict
            if (!ok && lsFailed.indexOf('qzCustomDict') < 0) lsFailed.push('qzCustomDict')
          }
        } catch {
          /* ignore */
        }
      }
      try {
        localStorage.removeItem('reviewModeInfo')
      } catch {
        /* ignore */
      }
      if (data.settings && typeof data.settings === 'object') {
        try {
          await api.updateSettings(data.settings)
        } catch {
          /* ignore */
        }
      }
      if (lsFailed.length) {
        toast(
          '导入完成，但 ' +
            lsFailed.length +
            ' 项本地配置未写入（可能超出 localStorage 配额）：' +
            lsFailed.slice(0, 5).join('、') +
            (lsFailed.length > 5 ? ' …' : '') +
            '，6 秒后重载…',
          6000,
        )
        setTimeout(() => {
          try {
            location.reload()
          } catch {
            /* ignore */
          }
        }, 6200)
      } else {
        toast('导入完成，正在重载…')
        setTimeout(() => {
          try {
            location.reload()
          } catch {
            /* ignore */
          }
        }, 700)
      }
    } catch (e) {
      toast('导入失败: ' + (e.message || e))
    }
  }

  async function exportWrongCsv() {
    try {
      const s = await collectStats()
      if (!s || !s.wrongWords.length) return toast('没有错词数据可导出')
      const rows = s.wrongWords.map((w) => [w.word, w.wrongCount, w.dict, w.chapter, tsText(w.timeStamp)])
      const csv = toCSV(['单词', '错误次数', '词典', '章节', '最后练习时间'], rows)
      const r = await api.saveCSV('qwerty-错词-' + TODAY() + '.csv', csv)
      if (r && r.ok) toast('已保存：' + r.path, 4200)
      else toast('导出失败: ' + ((r && r.error) || '未知'))
    } catch (e) {
      toast('导出失败: ' + (e.message || e))
    }
  }
  async function exportRecordsCsv() {
    try {
      const { memoryRecords } = await readRecordInsights()
      if (!memoryRecords.length) return toast('还没有记忆曲线记录可导出')
      memoryRecords.sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0))
      const rows = memoryRecords.map((r) => [
        r.word || '',
        r.dict || '',
        Array.isArray(r.trans) ? r.trans.join(' / ') : r.trans || '',
        r.stage != null ? r.stage : '',
        r.interval != null ? r.interval : '',
        r.due ? tsText(r.due) : '',
        r.correct || 0,
        r.wrong || 0,
        r.slow || 0,
        r.lastSeen ? tsText(r.lastSeen) : '',
      ])
      const csv = toCSV(['单词', '词库', '释义', '阶段', '间隔(天)', '到期时间', '正确', '错误', '慢词', '最后作答'], rows)
      const r = await api.saveCSV('qwerty-记忆曲线-' + TODAY() + '.csv', csv)
      if (r && r.ok) toast('已保存：' + r.path, 4200)
      else toast('导出失败: ' + ((r && r.error) || '未知'))
    } catch (e) {
      toast('导出失败: ' + (e.message || e))
    }
  }

  // 慢词 / 错误键：与旧面板同一套算法，只是返回数据而不是写 DOM
  async function collectInsights() {
    const { wordRecords } = await readRecordInsights()
    const charStats = new Map()
    const wordStats = new Map()
    const normKey = (ch) => {
      const s = String(ch || '')
      if (!s) return ''
      if (s === ' ') return ' '
      const up = s.toUpperCase()
      return up.length === 1 ? up : s
    }
    for (const r of wordRecords) {
      const word = String(r.word || '')
      const letters = [...word]
      const timing = Array.isArray(r.timing) ? r.timing : []
      let totalMs = 0
      letters.forEach((ch, i) => {
        const k = normKey(ch)
        if (!k) return
        const rec = charStats.get(k) || { hits: 0, errors: 0, delaySum: 0, delayN: 0 }
        rec.hits += 1
        const d = timing[i - 1]
        if (isFinite(d) && d > 0) {
          rec.delaySum += d
          rec.delayN += 1
          totalMs += d
        }
        charStats.set(k, rec)
      })
      const mis = r.mistakes && typeof r.mistakes === 'object' ? r.mistakes : {}
      for (const [idx, wrongs] of Object.entries(mis)) {
        const ch = letters[Number(idx)]
        if (!ch) continue
        const k = normKey(ch)
        if (!k) continue
        const rec = charStats.get(k) || { hits: 0, errors: 0, delaySum: 0, delayN: 0 }
        rec.errors += Array.isArray(wrongs) ? wrongs.length : 1
        charStats.set(k, rec)
      }
      if (word) {
        const prev = wordStats.get(word) || { word, totalMs: 0, n: 0 }
        prev.totalMs += totalMs
        prev.n += 1
        wordStats.set(word, prev)
      }
    }
    const slow = [...wordStats.values()]
      .filter((w) => w.n > 0 && w.totalMs > 0)
      .sort((a, b) => b.totalMs / b.n - a.totalMs / a.n)
      .slice(0, 10)
      .map((w) => ({ word: w.word, ms: Math.round(w.totalMs / w.n), times: w.n }))
    const errKeys = [...charStats.entries()]
      .filter(([, rec]) => rec.errors > 0)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 10)
      .map(([k, rec]) => ({ key: k, errors: rec.errors, rate: rec.hits ? Math.round((rec.errors / rec.hits) * 100) : 0 }))
    return { slow, errKeys }
  }

  // ---------------------------------------------------------------- 自定义词库
  async function withPlusDB(fn) {
    const db = await getPlusDB()
    if (!db) throw new Error('本地数据库不可用')
    try {
      return await fn(db)
    } finally {
      try {
        db.close()
      } catch {
        /* ignore */
      }
    }
  }
  async function listCustomDicts() {
    try {
      return await withPlusDB(async (db) => {
        const rows = await idbAll(db, 'dicts')
        return rows.map((r) => ({
          name: String(r.name || ''),
          count: Array.isArray(r.words) ? r.words.length : 0,
          createdAt: Number(r.createdAt) || 0,
        }))
      })
    } catch {
      return []
    }
  }
  async function importCustomDict(text, ext, name) {
    const words = parseImportText(text, ext)
    if (!words.length) throw new Error('未解析到有效单词')
    await withPlusDB((db) => idbPut(db, 'dicts', { name, words, createdAt: Date.now() }))
    toast('导入成功：' + name + '（' + words.length + ' 词）')
    return { name, count: words.length }
  }
  async function removeCustomDict(name) {
    await withPlusDB((db) => idbDelete(db, 'dicts', name))
    toast('已删除「' + name + '」')
  }
  async function startCustomMemory(name) {
    const rows = await withPlusDB((db) => idbAll(db, 'dicts'))
    const d = rows.find((x) => x.name === name)
    if (!d || !Array.isArray(d.words) || !d.words.length) return toast('词库为空')
    const words = d.words
      .filter((w) => w && w.name)
      .map((w) => ({
        name: String(w.name),
        trans: Array.isArray(w.trans) ? w.trans : w.trans ? [String(w.trans)] : [],
        usphone: w.usphone || '',
        ukphone: w.ukphone || '',
      }))
    try {
      localStorage.setItem('qzCustomDict', JSON.stringify({ name, words }))
      localStorage.setItem('learningMode', JSON.stringify('custom'))
    } catch (e) {
      return toast('写入失败：' + (e.message || e))
    }
    toast('已切换为自定义词库「' + name + '」，正在进入记忆曲线…', 3000)
    setTimeout(() => {
      try {
        location.reload()
      } catch {
        /* ignore */
      }
    }, 600)
  }

  // 设置面板唯一入口
  window.qzRuntime = {
    collectStats,
    collectInsights,
    lookupWord: (word) => openWordCard(word),
    startDueReview,
    reevaluateLevel,
    resumeSuspended,
    exportAll,
    importAll,
    exportWrongCsv,
    exportRecordsCsv,
    setCurrentDict,
    toggleDictFavorite,
    currentDict,
    listCustomDicts,
    importCustomDict,
    removeCustomDict,
    startCustomMemory,
    toast,
  }

  // ---------------------------------------------------------------- 键音 B9
  let audioCtx = null
  document.addEventListener(
    'keydown',
    (e) => {
      if (!settings.keySound) return
      const tag = (e.target && e.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      if (!/^[a-zA-Z0-9 ,.;'\-]$/.test(e.key || '')) return
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        if (audioCtx.state === 'suspended') audioCtx.resume()
        const t = audioCtx.currentTime
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(1500 + Math.random() * 500, t)
        gain.gain.setValueAtTime((settings.keySoundVolume == null ? 0.25 : settings.keySoundVolume) * 0.08, t)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(t)
        osc.stop(t + 0.04)
      } catch {
        /* ignore */
      }
    },
    true,
  )

  // ---------------------------------------------------------------- 初始化
  async function init() {
    try {
      const s = await api.getSettings()
      if (s) settings = s
    } catch {
      /* ignore */
    }
    applyTheme()
    if (settings.miniMode) document.body.classList.add('qz-mini')
    try {
      new MutationObserver(syncOverlayTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    } catch {
      /* ignore */
    }
    await pushStats()
    setInterval(pushStats, 60000)
    loadBuiltinDicts().catch(() => {})
    console.log('[QZ-ENHANCE] runtime ready, version', APP_VERSION)
  }
  init()

  // 词卡 Esc 关闭（原来由面板的 Esc 处理顺带完成）
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      const root = $('#qz-wordcard-root')
      if (root && root.innerHTML) {
        closeWordCard()
        e.stopPropagation()
      }
    },
    true,
  )

  if (api.onBackupRequest) api.onBackupRequest(handleBackupRequest)

  api.onClipboardWord((word) => {
    toast('剪贴板查词: ' + word, 3000)
  })
})()
