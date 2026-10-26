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
(function () {
  'use strict';
  const api = window.qwertyEnhance;
  if (!api) {
    console.warn('[QZ-ENHANCE] window.qwertyEnhance 不存在，增强 UI 跳过');
    return;
  }
  if (window.__QZ_PANEL_HOST__) return;
  window.__QZ_PANEL_HOST__ = true;

  // ---------------------------------------------------------------- 工具函数
  const TODAY = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const normTs = (v) => {
    const n = Number(v) || 0;
    if (n <= 0) return 0;
    if (n < 1e12) return n * 1000; // 秒 → 毫秒
    if (n > 1e15) return Math.floor(n / 1000); // 微秒 → 毫秒
    return n;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const nowIso = () => new Date().toISOString();
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // v9.2：版本号单一来源——主进程在注入脚本前设置 window.__QZ_VERSION__（来自 package.json）
  // v9.4（SHELL-010）：不再保留硬编码版本兜底；v9.4（SHELL-008）：测试钩子仅测试环境开放
  const APP_VERSION = (typeof window !== 'undefined' && window.__QZ_VERSION__) || 'unknown';
  const APP_VERSION_SHORT = APP_VERSION.replace('1.0.0-enhanced-', '');
  const TEST_HOOKS = typeof window !== 'undefined' && window.__QZ_TEST_HOOKS__ === true;

  let settings = { version: APP_VERSION, dailyGoal: 30, theme: 'indigo', panelAppearance: 'auto', dictFavorites: [], dictRecent: {}, fontFamily: 'default', opacity: 1, zoom: 1, pomodoroFocus: 25, pomodoroBreak: 5, keySound: false, keySoundVolume: 0.25, clipboardWatch: false, onlineLookup: true, aiExperimental: false, pronCache: false, closeToTray: true, alwaysOnTop: false, miniMode: false, todayStats: {} };
  let appStats = null; // 缓存统计
  let panelOpen = false;

  // v5：词库更新文件请求层覆盖（若 preload 的早期注入不可用，这里在面板注入时兜底）
  (function installDictFetchPatch() {
    try {
      if (window.__QZ_DICT_PATCH__) return;
      window.__QZ_DICT_PATCH__ = true;
      const orig = window.fetch ? window.fetch.bind(window) : null;
      if (!orig) return;
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const m = /(?:^|\/)dicts\/([^/?#]+\.json)(?:[?#]|$)/.exec(url);
          if (m && api.dictOverride) {
            return api.dictOverride(m[1]).then((has) => (
              has ? orig('qzcache://dict/' + encodeURIComponent(m[1]), init) : orig(input, init)
            )).catch(() => orig(input, init));
          }
        } catch { /* ignore */ }
        return orig(input, init);
      };
    } catch { /* ignore */ }
  })();

  // ---------------------------------------------------------------- IndexedDB
  function idbOpen(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      req.onupgradeneeded = (e) => { try { upgrade && upgrade(req.result, e); } catch (err) { reject(err); } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed: ' + name));
      req.onblocked = () => reject(new Error('indexedDB blocked: ' + name));
    });
  }
  function idbAll(db, store) {
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(store)) return resolve([]);
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }
  function idbPut(db, store, value) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  }
  function idbGetAll(db, store) { return idbAll(db, store); }
  function idbDelete(db, store, key) {
    return new Promise((resolve) => {
      try { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = resolve; tx.onerror = resolve; } catch { resolve(); }
    });
  }

  // 只读应用数据库：读完立即关闭连接，避免阻塞应用自身的 Dexie 版本升级
  async function readAppRecords() {
    let db = null;
    try {
      db = await idbOpen('RecordDB');
      const wordRecords = await idbAll(db, 'wordRecords');
      const chapterRecords = await idbAll(db, 'chapterRecords');
      const memoryRecords = await idbAll(db, 'memoryRecords');
      return { wordRecords, chapterRecords, memoryRecords };
    } catch {
      return { wordRecords: [], chapterRecords: [], memoryRecords: [] };
    } finally {
      try { if (db) db.close(); } catch { /* ignore */ }
    }
  }

  // v8：一次读取官方学习数据（wordRecords + memoryRecords），供数据页统一使用
  async function readRecordInsights() {
    let db = null;
    try {
      db = await idbOpen('RecordDB');
      const wordRecords = await idbAll(db, 'wordRecords');
      const memoryRecords = await idbAll(db, 'memoryRecords');
      return { wordRecords, memoryRecords };
    } catch {
      return { wordRecords: [], memoryRecords: [] };
    } finally {
      try { if (db) db.close(); } catch { /* ignore */ }
    }
  }

  let plusDBPromise = null;
  function getPlusDB() {
    if (!plusDBPromise) {
      plusDBPromise = idbOpen('QwertyPlusDB', 3, (db) => {
        if (!db.objectStoreNames.contains('dicts')) db.createObjectStore('dicts', { keyPath: 'name' });

      }).catch((e) => { console.warn('[QZ] plus db:', e); return null; });
    }
    return plusDBPromise;
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
    };
    // RecordDB：遍历全部 object store（只读打开，读完立即关闭，避免阻塞应用自身 Dexie 升级）
    let db = null;
    try {
      db = await idbOpen('RecordDB');
      const stores = Array.from(db.objectStoreNames || []);
      for (const store of stores) {
        snap.recordDb[store] = await idbAll(db, store);
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot RecordDB:', e);
    } finally {
      try { if (db) db.close(); } catch { /* ignore */ }
    }
    // QwertyPlusDB.dicts：库不存在时跳过（用 databases() 探测，避免只读操作顺手建空库）
    try {
      let exists = true;
      if (indexedDB.databases) {
        const list = await indexedDB.databases();
        exists = list.some((d) => d && d.name === 'QwertyPlusDB');
      }
      if (exists) {
        let pdb = null;
        try {
          pdb = await idbOpen('QwertyPlusDB');
          if (pdb.objectStoreNames.contains('dicts')) snap.customDicts = await idbAll(pdb, 'dicts');
        } finally {
          try { if (pdb) pdb.close(); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot QwertyPlusDB:', e);
    }
    // localStorage 全量（含 qzCustomDict / state 等，原样保留字符串，可能较大）
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k == null) continue;
        snap.localStorage[k] = localStorage.getItem(k);
      }
    } catch (e) {
      console.warn('[QZ] backup snapshot localStorage:', e);
    }
    // 主进程设置（只读快照）
    try { snap.settings = await api.getSettings(); } catch { snap.settings = {}; }
    return snap;
  }
  function handleBackupRequest() {
    collectBackupSnapshot()
      .then((snap) => {
        let text = null;
        try { text = JSON.stringify(snap); } catch (e) { console.warn('[QZ] backup snapshot stringify:', e); return null; }
        return api.writeBackupSnapshot(text);
      })
      .catch((e) => console.warn('[QZ] backup snapshot:', e));
  }

  // ---------------------------------------------------------------- 统计
  async function collectStats() {
    const stats = {
      today: TODAY(), words: 0, goal: settings.dailyGoal || 30, streak: 0, ratio: 0,
      heat: [], totalWords: 0, wrongCount: 0, wrongWords: [], records: [], chapters: [],
      totalMinutes: 0, wpm: 0, practiceCount: 0, source: 'none',
    };
    const dbData = await readAppRecords();
    let wordRecords = dbData.wordRecords;
    const chapterRecords = dbData.chapterRecords;
    const memoryRecords = dbData.memoryRecords || [];
    if (wordRecords.length || chapterRecords.length) stats.source = 'RecordDB';
    // 兼容：若 RecordDB 为空，尝试读 localStorage.state 里的旧记录
    if (!wordRecords.length) {
      try {
        const raw = localStorage.getItem('state');
        if (raw) {
          const st = JSON.parse(raw);
          const maybe = st.wordRecords || (st.state && st.state.wordRecords);
          if (Array.isArray(maybe)) { wordRecords = maybe; stats.source = 'localStorage'; }
        }
      } catch { /* ignore */ }
    }
    const daySet = new Set();
    const todayWords = new Set();
    const seenWords = new Set();
    const heatMap = {};
    const dayWordsMap = {};
    for (const r of wordRecords) {
      const ts = normTs(r.timeStamp || r.timestamp || r.ts || 0);
      if (!ts) continue;
      const k = dayKey(ts);
      daySet.add(k);
      heatMap[k] = (heatMap[k] || 0) + 1;
      const w = String(r.word || '').trim();
      if (!w) continue;
      seenWords.add(w);
      if (k === stats.today) todayWords.add(w);
      if (!dayWordsMap[k]) dayWordsMap[k] = new Set();
      dayWordsMap[k].add(w);
      const wc = Number(r.wrongCount || r.errorCount || 0);
      if (wc > 0) stats.wrongCount += 1;
    }
    stats.words = todayWords.size;
    stats.totalWords = seenWords.size;
    stats.heat = Object.entries(heatMap).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14).map(([d, n]) => ({ date: d, count: n }));
    // 连续打卡
    let cursor = new Date();
    if (!daySet.has(stats.today)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      const k = dayKey(cursor.getTime());
      if (daySet.has(k)) { streak++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    stats.streak = streak;
    stats.ratio = stats.goal > 0 ? clamp(stats.words / stats.goal, 0, 1) : 0;
    // 章节记录（练习时长 / WPM / 正确率）
    let totalSec = 0, totalAnsweredWords = 0, totalCorrect = 0, totalWrong = 0;
    for (const c of chapterRecords) {
      const t = Number(c.time || c.totalTime || 0);
      if (isFinite(t) && t > 0) totalSec += t; // 应用内 chapterRecords.time 单位：秒
      const wc = Number(c.wordCount || c.wordNumber || 20);
      totalAnsweredWords += wc;
      totalCorrect += Number(c.correctCount || 0);
      totalWrong += Number(c.wrongCount || 0);
    }
    stats.totalMinutes = Math.round(totalSec / 60 * 10) / 10;
    stats.chapters = chapterRecords;
    if (totalSec > 0 && totalAnsweredWords > 0) {
      stats.wpm = Math.round(totalAnsweredWords / (totalSec / 60));
    }
    const answered = totalCorrect + totalWrong;
    stats.accuracy = answered > 0 ? Math.round((totalCorrect / answered) * 1000) / 10 : null;
    stats.answeredWords = totalAnsweredWords;
    stats.correctCount = totalCorrect;
    stats.wrongCountTotal = totalWrong;
    // v8：v7 起练习页不再写 chapterRecords，练习时长 / WPM / 准确率改由 wordRecords 的按键计时估算
    if (wordRecords.length) {
      let ms = 0, letters = 0, errs = 0;
      for (const r of wordRecords) {
        const timing = Array.isArray(r.timing) ? r.timing : [];
        for (const t of timing) { if (isFinite(t) && t > 0) ms += t; }
        letters += String(r.word || '').length;
        const mis = r.mistakes && typeof r.mistakes === 'object' ? r.mistakes : {};
        for (const arr of Object.values(mis)) errs += Array.isArray(arr) ? arr.length : 1;
      }
      if (ms > 0) {
        stats.totalMinutes = Math.round((ms / 60000) * 10) / 10;
        stats.wpm = Math.round(wordRecords.length / (ms / 60000));
      }
      if (!stats.totalMinutes) stats.totalMinutes = 0;
      if (letters > 0) stats.accuracy = Math.round((letters / (letters + errs)) * 1000) / 10;
    }
    // 错词去重
    const wrongMap = new Map();
    for (const r of wordRecords) {
      const wc = Number(r.wrongCount || r.errorCount || 0);
      if (wc <= 0) continue;
      const key = `${r.word}|${r.dict}|${r.chapter}`;
      const prev = wrongMap.get(key);
      if (!prev || prev.wrongCount < wc) {
        wrongMap.set(key, {
          word: String(r.word || ''), wrongCount: wc, dict: String(r.dict || ''), chapter: String(r.chapter || ''),
          timeStamp: normTs(r.timeStamp),
        });
      }
    }
    stats.wrongWords = [...wrongMap.values()].sort((a, b) => b.wrongCount - a.wrongCount);
    // v8.1 学习报告：掌握度分布 + 未来 7 天到期
    const buckets = { short: 0, mid: 0, long: 0 };
    const dueDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      dueDays.push({ date: dayKey(d.getTime()), count: 0 });
    }
    const shadow = { count: 0, adaptiveSum: 0, actualSum: 0 };
    const nowTs = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const dueNowList = [];
    const newCountMap = {};
    let todayNew = 0;
    for (const m of memoryRecords) {
      if (!m) continue;
      const st = Number(m.stage) || 0;
      if (st <= 2) buckets.short += 1;
      else if (st <= 5) buckets.mid += 1;
      else buckets.long += 1;
      const created = Number(m.createdAt) || 0;
      if (created >= startOfToday.getTime()) todayNew += 1;
      if (created) { const ck = dayKey(created); newCountMap[ck] = (newCountMap[ck] || 0) + 1; }
      const due = Number(m.due) || 0;
      if (due) {
        const k = dayKey(due);
        const row = dueDays.find((x) => x.date === k);
        if (row) row.count += 1;
        if (due <= nowTs) dueNowList.push(m);
      }
      const shadowDays = Number(m.shadowInterval) || 0;
      if (shadowDays > 0) {
        shadow.count += 1;
        shadow.adaptiveSum += shadowDays;
        shadow.actualSum += Number(m.interval) || 0;
      }
    }
    shadow.avgAdaptive = shadow.count ? shadow.adaptiveSum / shadow.count : 0;
    shadow.avgActual = shadow.count ? shadow.actualSum / shadow.count : 0;
    dueNowList.sort((a, b) => (Number(a.due) || 0) - (Number(b.due) || 0));
    stats.todayNew = todayNew;
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
    };
    // v9.1：14 天周历（周几/日期/点击明细）+ 近 30 天趋势（新学/复习）
    const baseDay = new Date(); baseDay.setHours(0, 0, 0, 0);
    const heatDays = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(baseDay); d.setDate(d.getDate() - i);
      const k = dayKey(d.getTime());
      const set = dayWordsMap[k];
      heatDays.push({ date: k, weekday: d.getDay(), count: set ? set.size : 0, words: set ? Array.from(set).slice(0, 10) : [] });
    }
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(baseDay); d.setDate(d.getDate() - i);
      const k = dayKey(d.getTime());
      const set = dayWordsMap[k];
      trend.push({ date: k, practiced: set ? set.size : 0, fresh: newCountMap[k] || 0 });
    }
    stats.heatDays = heatDays;
    stats.trend = trend;
    // v9.3：自动进阶状态（由页面 localStorage 持久化，数据页只读展示）
    try {
      const st = JSON.parse(localStorage.getItem('qzAutoLevelState') || 'null') || {};
      const c = st.cached || {};
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
      };
    } catch { stats.autoLevel = null; }
    stats.at = Date.now();
    return stats;
  }

  async function pushStats() {
    try {
      const s = appStats && appStats.today === TODAY() && Date.now() - (appStats.at || 0) < 30000 ? appStats : await collectStats();
      appStats = s;
      api.sendStats({ date: s.today, words: s.words, goal: s.goal, streak: s.streak, ratio: s.ratio });
      const chip = shadow.getElementById('qz-chip-text');
      if (chip) chip.textContent = `今日 ${s.words}/${s.goal} · 连续 ${s.streak} 天`;
      const badge = shadow.getElementById('qz-badge');
      if (badge) badge.style.display = s.words > 0 ? 'block' : 'none';
      if (panelOpen) renderStatsToPanel(s);
    } catch (e) { console.warn('[QZ] pushStats', e); }
  }

  // ---------------------------------------------------------------- 自定义词库
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
        } else field += c;
      } else if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
  }
  function normalizeWordEntry(name, trans) {
    const w = String(name == null ? '' : name).trim();
    if (!w) return null;
    let t = trans;
    if (Array.isArray(t)) t = t.join('；');
    return { name: w, trans: String(t == null ? '' : t).trim() };
  }
  function parseImportText(text, ext) {
    const out = [];
    const push = (n, t) => { const e = normalizeWordEntry(n, t); if (e) out.push(e); };
    if (ext === 'json') {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('JSON 解析失败: ' + e.message); }
      const arr = Array.isArray(data) ? data : (Array.isArray(data.words) ? data.words : (Array.isArray(data.dict) ? data.dict : []));
      if (!arr.length) throw new Error('JSON 中未找到单词数组');
      for (const it of arr) {
        if (typeof it === 'string') push(it, '');
        else if (Array.isArray(it)) push(it[0], it[1] || it[2] || '');
        else if (it && typeof it === 'object') push(it.name || it.word || it.term || it.en || it.english, it.trans || it.translation || it.meaning || it.cn || it.chinese || it.translate || '');
      }
    } else if (ext === 'csv') {
      const rows = parseCSV(text);
      if (!rows.length) throw new Error('CSV 为空');
      let start = 0;
      const first = rows[0].map((x) => String(x).trim().toLowerCase());
      if (first.includes('word') || first.includes('单词') || first.includes('name') || first.includes('单词名')) start = 1;
      for (let i = start; i < rows.length; i++) push(rows[i][0], rows[i][1]);
    } else {
      // txt: 每行 "word" 或 "word\t释义" / "word,释义"
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        let parts = s.split('\t');
        if (parts.length < 2) {
          const idx = s.indexOf(',');
          if (idx > 0 && idx < s.length - 1) parts = [s.slice(0, idx), s.slice(idx + 1)];
          else parts = [s];
        }
        push(parts[0], parts.slice(1).join(' '));
      }
    }
    // 去重（按 name 小写）
    const seen = new Set();
    return out.filter((e) => { const k = e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------------------------------------------------------------- CSV
  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows) {
    return '\ufeff' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  }
  function tsText(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('zh-CN'); } catch { return ''; }
  }

  // ---------------------------------------------------------------- Shadow DOM UI
  const host = document.createElement('div');
  host.id = 'qz-enhance-host';
  host.style.cssText = 'position:fixed;z-index:2147483000;right:0;bottom:0;width:0;height:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const PANEL_CSS = `
/* v4 简约风：浅色为默认，:host(.qz-dark) 为深色（中性 slate，无紫黑玻璃感） */
  :host { all: initial; }
  :host {
    --qz-bg: #ffffff;
    --qz-surface: #f8fafc;
    --qz-surface-2: #f1f5f9;
    --qz-border: #e2e8f0;
    --qz-border-strong: #cbd5e1;
    --qz-text: #334155;
    --qz-text-strong: #1e293b;
    --qz-muted: #94a3b8;
    --qz-accent: #818cf8;
    --qz-accent-soft: rgba(129, 140, 248, 0.12);
    --qz-track: #e2e8f0;
    --qz-input-bg: #ffffff;
    --qz-mask: rgba(15, 23, 42, 0.28);
    --qz-shadow: 0 10px 30px rgba(15, 23, 42, 0.10);
    --qz-fab-bg: rgba(255, 255, 255, 0.92);
  }
  :host(.qz-dark) {
    --qz-bg: #1e293b;
    --qz-surface: #243244;
    --qz-surface-2: #2b3a4e;
    --qz-border: #334155;
    --qz-border-strong: #475569;
    --qz-text: #e2e8f0;
    --qz-text-strong: #f1f5f9;
    --qz-muted: #94a3b8;
    --qz-accent: #a5b4fc;
    --qz-accent-soft: rgba(129, 140, 248, 0.18);
    --qz-track: #334155;
    --qz-input-bg: #0f172a;
    --qz-mask: rgba(2, 6, 23, 0.55);
    --qz-shadow: 0 14px 34px rgba(2, 6, 23, 0.45);
    --qz-fab-bg: rgba(30, 41, 59, 0.92);
  }
  button { outline: none; }
  button:focus-visible { outline: 2px solid var(--qz-accent); outline-offset: 2px; }
  * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif; }

  /* ---------- 悬浮入口：v7 已改为顶栏「工具」入口，隐藏旧 Q+ 悬浮球 ---------- */
  .fab { display: none !important; }
  .chip { display: none !important; }
  .fab .dot { display: none; }

  /* ---------- 工具页（全屏，替代旧悬浮小窗） ---------- */
  .panel { position: fixed; inset: 0; right: auto; bottom: auto; width: 100%; max-width: none;
    max-height: none; background: var(--qz-bg); color: var(--qz-text);
    border-radius: 0; border: none; box-shadow: none;
    display: none; flex-direction: column; overflow: hidden; font-size: 13px; }
  .panel.open { display: flex; }
  .panel.mini { width: 100%; bottom: auto; }
  .ph { flex: 0 0 56px; height: 56px; display: flex; align-items: center; justify-content: space-between;
    padding: 0 28px; background: var(--qz-bg); border-bottom: 1px solid var(--qz-border); }
  .ph .t { font-size: 15px; font-weight: 600; color: var(--qz-text-strong); letter-spacing: .2px; }
  .ph .t small { font-weight: 400; font-size: 11px; color: var(--qz-muted); margin-left: 8px; }
  .ph .x { background: none; border: none; color: var(--qz-muted); font-size: 16px; line-height: 1;
    padding: 5px; border-radius: 6px; cursor: pointer; }
  .ph .x:hover { color: var(--qz-text); background: var(--qz-accent-soft); }
  .tabs { flex-shrink: 0; display: flex; gap: 2px; padding: 0 28px; background: var(--qz-bg); border-bottom: 1px solid var(--qz-border); }
  .tabs button { position: relative; background: none; border: none; color: var(--qz-muted);
    padding: 9px 8px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 0; }
  .tabs button:hover { color: var(--qz-text); }
  .tabs button.active { color: var(--qz-text-strong); }
  .tabs button.active::after { content: ''; position: absolute; left: 6px; right: 6px; bottom: -1px;
    height: 2px; background: var(--qz-accent); border-radius: 2px 2px 0 0; }
  .body { flex: 1; min-height: 0; width: 100%; max-width: 1080px; margin: 0 auto; overflow-y: auto; padding: 22px 28px 40px; }
  .body::-webkit-scrollbar { width: 8px; }
  .body::-webkit-scrollbar-thumb { background: var(--qz-border); border-radius: 4px; }
  .tabpane { display: none; } .tabpane.active { display: block; }
  .sec { margin-bottom: 18px; }
  .sec h4 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .05em; color: var(--qz-muted); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px;
    padding: 7px 10px; margin-bottom: 6px; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 8px; }
  .row .lbl { font-size: 13px; color: var(--qz-text); }
  .row .desc { font-size: 11px; color: var(--qz-muted); margin-top: 2px; line-height: 1.45; }
  .switch { position: relative; width: 36px; height: 20px; flex: 0 0 auto; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: var(--qz-track); border-radius: 999px; cursor: pointer; transition: .18s; }
  .slider:before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px;
    background: #fff; border-radius: 50%; box-shadow: 0 1px 2px rgba(15, 23, 42, .2); transition: .18s; }
  .switch input:checked + .slider { background: var(--qz-accent); }
  .switch input:checked + .slider:before { transform: translateX(16px); }
  .range { display: flex; align-items: center; gap: 10px; }
  .range input[type=range] { flex: 1; height: 18px; accent-color: var(--qz-accent); }
  .range .val { width: 48px; text-align: right; font-size: 11.5px; color: var(--qz-muted); font-variant-numeric: tabular-nums; }
  .btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 12px;
    border-radius: 8px; border: 1px solid var(--qz-border); background: var(--qz-bg);
    color: var(--qz-text); font-size: 12.5px; font-weight: 500; cursor: pointer; transition: .15s; }
  .btn:hover { border-color: var(--qz-accent); color: var(--qz-accent); }
  .btn.primary { background: var(--qz-accent); border-color: var(--qz-accent); color: #fff; }
  .btn.primary:hover { color: #fff; filter: brightness(.96); }
  .btn.ghost { background: transparent; }
  .btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .input { width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--qz-border);
    background: var(--qz-input-bg); color: var(--qz-text); font-size: 12.5px; outline: none; }
  .input:focus { border-color: var(--qz-accent); box-shadow: 0 0 0 2px var(--qz-accent-soft); }
  .input::placeholder { color: var(--qz-muted); }
  select.input { height: 32px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat { padding: 10px 6px; text-align: center; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 8px; }
  .stat .n { font-size: 19px; font-weight: 700; color: var(--qz-text-strong); font-variant-numeric: tabular-nums; }
  .stat .k { font-size: 10.5px; color: var(--qz-muted); margin-top: 3px; }
  .bar { height: 6px; margin: 8px 0 5px; background: var(--qz-track); border-radius: 999px; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--qz-accent); border-radius: 999px; transition: width .4s; }
  .heat { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; margin-top: 6px; }
  .heat .cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    background: var(--qz-track); border-radius: 5px; font-size: 10px; color: var(--qz-muted); }
  .muted { color: var(--qz-muted); font-size: 11.5px; line-height: 1.65; }
  .kbd { display: inline-block; padding: 1px 5px; border: 1px solid var(--qz-border); border-radius: 4px;
    background: var(--qz-surface); color: var(--qz-text); font-family: Consolas, monospace; font-size: 11px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--qz-surface);
    border: 1px solid var(--qz-border); color: var(--qz-muted); font-size: 10.5px; }
  .item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px;
    margin-bottom: 6px; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 8px; }
  .item .nm { font-size: 12.5px; color: var(--qz-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .cnt { font-size: 11px; color: var(--qz-muted); }
  .flex { display: flex; gap: 8px; align-items: center; }
  .grow { flex: 1; }
  .hidden { display: none !important; }
  .hint { padding: 8px 10px; margin-bottom: 10px; border-radius: 8px; background: var(--qz-accent-soft);
    border: 1px solid rgba(129, 140, 248, .35); color: var(--qz-text); font-size: 11.5px; line-height: 1.6; }
  .ai-out { display: none; }
  .pomo { text-align: center; padding: 4px 0 2px; }
  .pomo .clock { font-size: 40px; font-weight: 700; color: var(--qz-text-strong); font-variant-numeric: tabular-nums; }
  .pomo .mode { font-size: 12px; color: var(--qz-muted); margin-top: 2px; }
  .ring { width: 120px; height: 120px; margin: 12px auto; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; background: var(--qz-track); }
  .ring > div { width: 102px; height: 102px; border-radius: 50%; background: var(--qz-bg);
    display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ring .t { font-size: 25px; font-weight: 700; color: var(--qz-text-strong); font-variant-numeric: tabular-nums; }
  .ring .s { margin-top: 2px; font-size: 10.5px; color: var(--qz-muted); }
  .toast-wrap { position: fixed; right: 22px; bottom: 130px; display: flex; flex-direction: column; gap: 8px; z-index: 2147483002; }
  .toast { max-width: 340px; padding: 9px 13px; border-radius: 8px; background: var(--qz-bg);
    color: var(--qz-text); border: 1px solid var(--qz-border); font-size: 12.5px; box-shadow: 0 8px 22px rgba(15, 23, 42, .12); }
  .wordcard-mask { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center;
    justify-content: center; background: var(--qz-mask); }
  .wordcard { width: 660px; max-width: calc(100vw - 40px); max-height: calc(100vh - 80px); overflow: auto;
    padding: 18px 20px; border-radius: 12px; background: var(--qz-bg); color: var(--qz-text);
    border: 1px solid var(--qz-border); box-shadow: var(--qz-shadow); }
  .wordcard::-webkit-scrollbar { width: 8px; }
  .wordcard::-webkit-scrollbar-thumb { background: var(--qz-border); border-radius: 4px; }
  .wc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .wc-word { font-size: 30px; font-weight: 700; color: var(--qz-text-strong); letter-spacing: .5px; word-break: break-word; }
  .wc-ph { margin-top: 2px; font-size: 13px; color: var(--qz-muted); }
  .wc-src { margin-top: 4px; font-size: 10.5px; color: var(--qz-muted); }
  .wc-badge { display: inline-block; margin-right: 4px; padding: 2px 8px; border-radius: 999px;
    background: var(--qz-surface); border: 1px solid var(--qz-border); color: var(--qz-muted); font-size: 10px; }
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
    color: var(--qz-text); font-size: 11px; cursor: pointer; }
  .wc-syn span:hover { border-color: var(--qz-accent); color: var(--qz-accent); }
  .wc-close { background: none; border: none; color: var(--qz-muted); font-size: 18px; cursor: pointer; padding: 4px; }
  .wc-close:hover { color: var(--qz-text); }
  .wc-offline { margin-top: 10px; padding: 6px 10px; border-radius: 8px; font-size: 11.5px;
    background: #fffbeb; border: 1px solid #fcd34d; color: #b45309; }
  :host(.qz-dark) .wc-offline { background: rgba(180, 83, 9, .18); border-color: rgba(252, 211, 77, .4); color: #fcd34d; }
  .wc-loading { padding: 18px 0; text-align: center; font-size: 12.5px; color: var(--qz-muted); }
  .qz-tooltip { position: fixed; z-index: 2147483003; max-width: 340px; padding: 8px 11px;
    border-radius: 8px; background: var(--qz-bg); color: var(--qz-text); border: 1px solid var(--qz-border);
    box-shadow: 0 8px 22px rgba(15, 23, 42, .14); font-size: 12.5px; line-height: 1.55;
    pointer-events: none; opacity: 0; transition: opacity .12s; }
  .qz-tooltip.show { opacity: 1; }
  .qz-tooltip .tw { margin-bottom: 2px; font-weight: 700; color: var(--qz-text-strong); }
  .qz-tooltip .ts { margin-top: 3px; font-size: 10px; color: var(--qz-muted); }
  .qz-tooltip .toff { font-size: 10.5px; color: #b45309; }
  .wb-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px;
    margin-bottom: 5px; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 8px; font-size: 12px; }
  .wb-item .nm { color: var(--qz-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wb-item .c { flex: 0 0 auto; font-size: 11px; color: var(--qz-muted); }
  .kb-heat { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
  .kb-row { display: flex; gap: 5px; justify-content: center; }
  .kb-key { width: 32px; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
    background: var(--qz-track); border: 1px solid var(--qz-border); color: var(--qz-muted);
    font-size: 11px; font-weight: 600; cursor: default; }
  .kb-key.wide { width: 110px; }
  .kb-key.has-err { color: #fff; }
  .kb-key .n { margin-left: 1px; font-size: 9px; opacity: .9; }
  .kb-tip { margin-top: 6px; font-size: 10.5px; color: var(--qz-muted); }
  .list-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 9px;
    margin-bottom: 4px; background: var(--qz-surface); border: 1px solid var(--qz-border); border-radius: 6px; font-size: 11.5px; }
  .list-row .k { color: var(--qz-text); }
  .list-row .v { font-size: 11px; color: var(--qz-muted); }

  /* —— v5：词库管理 / 在线更新 / 发音预缓存 —— */
  .dict-toolbar { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center; }
  .dict-toolbar .input { flex:1; min-width:150px; width:auto; }
  .dict-row { display:flex; align-items:center; gap:8px; padding:6px 9px; background:var(--qz-surface);
    border:1px solid var(--qz-border); border-radius:8px; margin-bottom:5px; font-size:12px; }
  .dict-row .star { flex:0 0 auto; background:none; border:none; cursor:pointer; color:var(--qz-muted); font-size:14px; padding:0 2px; line-height:1; }
  .dict-row .star.on { color:#f59e0b; }
  .dict-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--qz-text); font-weight:500; }
  .dict-row .meta { flex:0 0 auto; color:var(--qz-muted); font-size:10.5px; white-space:nowrap; }
  .dict-row .cur { flex:0 0 auto; color:var(--qz-accent); border:1px solid var(--qz-accent); border-radius:999px; padding:0 6px; font-size:10px; }
  .dict-more { text-align:center; margin:6px 0; }
  .upd-row { display:flex; align-items:center; gap:8px; padding:5px 9px; border:1px solid var(--qz-border);
    border-radius:7px; margin-bottom:4px; font-size:11.5px; background:var(--qz-surface); }
  .upd-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--qz-text); }
  .upd-row .tag-new { color:var(--qz-accent); }
  .upd-row .tag-upd { color:#b45309; }
  .upd-row .sz { color:var(--qz-muted); font-size:10.5px; }
  .progress { height:6px; margin:6px 0; background:var(--qz-track); border-radius:999px; overflow:hidden; }
  .progress > i { display:block; height:100%; width:0%; background:var(--qz-accent); border-radius:999px; transition:width .25s; }
  .pc-line { display:flex; justify-content:space-between; gap:8px; font-size:11.5px; color:var(--qz-muted); }
  .pc-fail { max-height:72px; overflow:auto; margin-top:4px; color:#b45309; font-size:10.5px; line-height:1.5; white-space:pre-wrap; }

`;
  const styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  shadow.appendChild(styleEl);

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="fab" id="qz-fab" title="Qwerty Plus 增强面板 (Ctrl+Alt+Q 显隐窗口)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7h9"/><circle cx="16.5" cy="7" r="2"/><path d="M18.5 7H20"/>
        <path d="M4 17h5"/><circle cx="11.5" cy="17" r="2"/><path d="M13.5 17H20"/>
      </svg>
      <span class="dot" id="qz-badge" style="display:none"></span>
    </button>
    <div class="chip" id="qz-chip" title="点击打开增强面板"><span id="qz-chip-text">今日 0/30 · 连续 0 天</span></div>
    <div class="panel" id="qz-panel">
      <div class="ph">
        <div class="t">增强工具 <small>Qwerty Plus ${APP_VERSION_SHORT}</small></div>
        <button class="x" id="qz-close" title="关闭">✕</button>
      </div>
      <div class="tabs">
        <button data-tab="general" class="active">常规</button>
        <button data-tab="data">数据</button>
        <button data-tab="dict">词库</button>
        <button data-tab="tools">工具</button>
        <button data-tab="about">关于</button>
      </div>
      <div class="body">
        <!-- 常规 -->
        <div class="tabpane active" id="tab-general">
          <div class="sec">
            <h4>窗口与系统</h4>
            <div class="row"><div><div class="lbl">窗口置顶</div><div class="desc">A1 · 始终显示在其他程序之上</div></div>
              <label class="switch"><input type="checkbox" id="sw-top"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">迷你模式</div><div class="desc">A3 · 窄条窗口，只留练习内容 <span class="kbd">Ctrl+Alt+M</span></div></div>
              <label class="switch"><input type="checkbox" id="sw-mini"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">关闭窗口时最小化到托盘</div><div class="desc">A4 · 托盘图标单击可恢复窗口</div></div>
              <label class="switch"><input type="checkbox" id="sw-tray"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">开机自动启动</div><div class="desc">A5 · 登录 Windows 后自动运行</div></div>
              <label class="switch"><input type="checkbox" id="sw-autostart"><span class="slider"></span></label></div>
            <div class="row"><div class="grow"><div class="lbl">窗口透明度</div><div class="desc">A6 · 0.3 全透明边缘 ~ 1.0 不透明</div>
              <div class="range"><input type="range" id="rg-opacity" min="0.3" max="1" step="0.05"><span class="val" id="v-opacity">100%</span></div></div></div>
            <div class="row"><div class="grow"><div class="lbl">页面缩放</div><div class="desc">A6 · 0.6 ~ 1.6 倍</div>
              <div class="range"><input type="range" id="rg-zoom" min="0.6" max="1.6" step="0.05"><span class="val" id="v-zoom">100%</span></div></div></div>
          </div>
          <div class="sec">
            <h4>学习增强</h4>
            <div class="row"><div><div class="lbl">剪贴板查词</div><div class="desc">B5 · 复制英文单词后右下角弹出小窗（免费释义）</div></div>
              <label class="switch"><input type="checkbox" id="sw-clip"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">在线释义 / 整句翻译</div><div class="desc">免 Key：本地词库 + 有道 + dictionaryapi + MyMemory；失败自动降级离线</div></div>
              <label class="switch"><input type="checkbox" id="sw-online"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">AI 增强（实验，预留）</div><div class="desc">可选实验开关，默认关；当前版本无 AI 后端，不影响免费释义，无需任何 Key</div></div>
              <label class="switch"><input type="checkbox" id="sw-aiexp"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">发音缓存</div><div class="desc">B7 · 有道发音音频本地缓存（实验性）</div></div>
              <label class="switch"><input type="checkbox" id="sw-pron"><span class="slider"></span></label></div>
            <div class="row"><div><div class="lbl">机械键盘键音</div><div class="desc">B9 · 打字时播放轻键音</div></div>
              <label class="switch"><input type="checkbox" id="sw-keysound"><span class="slider"></span></label></div>
            <div class="row"><div class="grow"><div class="lbl">键音音量</div><div class="range"><input type="range" id="rg-keyvol" min="0" max="1" step="0.05"><span class="val" id="v-keyvol">25%</span></div></div></div>
          </div>
          <div class="sec">
            <h4>外观</h4>
            <div class="row"><div><div class="lbl">面板外观</div><div class="desc">v4 · 默认自动：跟随应用的浅色/深色；也可固定浅色或深色</div></div>
              <select class="input" id="sel-appearance" style="width:150px">
                <option value="auto">自动（默认）</option><option value="light">浅色</option><option value="dark">深色</option>
              </select></div>
            <div class="row"><div><div class="lbl">强调色</div><div class="desc">B9 · 覆盖页面 indigo 主题色</div></div>
              <select class="input" id="sel-theme" style="width:150px">
                <option value="indigo">靛蓝（默认）</option><option value="emerald">翡翠绿</option>
                <option value="rose">玫瑰红</option><option value="amber">琥珀黄</option>
                <option value="sky">天空蓝</option><option value="violet">紫罗兰</option>
              </select></div>
            <div class="row"><div><div class="lbl">单词字体</div><div class="desc">B9 · 只影响练习区大号单词</div></div>
              <select class="input" id="sel-font" style="width:150px">
                <option value="default">默认</option><option value="mono">等宽</option>
                <option value="serif">衬线</option><option value="round">圆体</option>
              </select></div>
            <div class="row"><div><div class="lbl">深色模式</div><div class="desc">B9 · 切换页面暗色主题</div></div>
              <label class="switch"><input type="checkbox" id="sw-dark"><span class="slider"></span></label></div>
          </div>
          <div class="sec">
            <h4>快捷键</h4>
            <div class="muted">
              <span class="kbd">Ctrl+Alt+Q</span> 显示 / 隐藏主窗口 · <span class="kbd">Ctrl+Alt+M</span> 迷你模式<br>
              托盘图标：左键显示/隐藏，右键菜单含进度、备份、退出。
            </div>
          </div>
        </div>

        <!-- 数据 -->
        <div class="tabpane" id="tab-data">
          <div class="hint">数据源：应用自身 IndexedDB（RecordDB），只读不改。错词、键位、慢词、时长均来自官方练习记录；从未练习时显示 0。</div>
          <div class="sec">
            <h4>每日目标与连续打卡</h4>
            <div class="flex" style="margin-bottom:10px">
              <div class="grow"><input class="input" id="in-goal" type="number" min="5" max="500" step="5"></div>
              <button class="btn primary" id="btn-save-goal">保存目标</button>
            </div>
            <div class="bar"><i id="bar-goal" style="width:0%"></i></div>
            <div class="muted" id="lbl-goal">今日 0 / 30 词</div>
            <div class="grid4" style="margin-top:12px">
              <div class="stat"><div class="n" id="st-streak">0</div><div class="k">连续打卡(天)</div></div>
              <div class="stat"><div class="n" id="st-total">0</div><div class="k">累计单词</div></div>
              <div class="stat"><div class="n" id="st-wrong">0</div><div class="k">错词种类</div></div>
              <div class="stat"><div class="n" id="st-acc">-</div><div class="k">准确率</div></div>
              <div class="stat"><div class="n" id="st-wpm">0</div><div class="k">估算 WPM</div></div>
              <div class="stat"><div class="n" id="st-min">0</div><div class="k">练习时长(分)</div></div>
            </div>
          </div>
          <div class="sec">
            <h4>近 14 天练习（周历）</h4>
            <div id="heat-box"></div>
            <div class="muted" id="heat-detail" style="margin-top:6px">点击某天查看当天练过的词</div>
            <div class="muted" style="margin-top:6px" id="lbl-source"></div>
          </div>
          <div class="sec">
            <h4>近 30 天练习趋势（新学 / 复习）</h4>
            <div id="trend-box" style="display:flex;gap:3px;align-items:flex-end;height:84px"></div>
            <div class="muted" style="margin-top:6px">深色=当天新学词，浅色=当天复习/重练词（按单词去重）。</div>
          </div>
          <div class="sec">
            <h4>学习报告（记忆曲线）</h4>
            <div class="grid4">
              <div class="stat"><div class="n" id="rp-learned">0</div><div class="k">已学单词</div></div>
              <div class="stat"><div class="n" id="rp-short">0</div><div class="k">短期记忆(≤2档)</div></div>
              <div class="stat"><div class="n" id="rp-mid">0</div><div class="k">巩固中(3~5档)</div></div>
              <div class="stat"><div class="n" id="rp-long">0</div><div class="k">长期记忆(≥6档)</div></div>
            </div>
            <div class="muted" style="margin-top:12px" id="rp-due">未来 7 天到期：-</div>
            <div class="muted" style="margin-top:6px" id="rp-shadow">影子调度：尚未记录（自适应算法并行计算中，暂不启用）</div>
          </div>
          <div class="sec">
            <h4>自动进阶（v9.3）</h4>
            <div class="grid4">
              <div class="stat"><div class="n" id="al-level">-</div><div class="k">当前级别</div></div>
              <div class="stat"><div class="n" id="al-mastered">0</div><div class="k">已掌握</div></div>
              <div class="stat"><div class="n" id="al-seen">0</div><div class="k">已见</div></div>
              <div class="stat"><div class="n" id="al-suspended">0</div><div class="k">待攻克</div></div>
            </div>
            <div class="muted" id="al-detail" style="margin-top:10px">-</div>
            <div class="btns" style="margin-top:8px">
              <button class="btn ghost" id="btn-auto-reeval">重新评估级别</button>
              <button class="btn ghost" id="btn-auto-resume">恢复全部待攻克</button>
            </div>
            <div class="muted" style="margin-top:8px">升级条件：本级已见 100%（待攻克除外）+ 掌握 ≥90%；Skip ≥3 次的词进入「待攻克」，不阻塞升级。重新评估是唯一允许级别回退的入口。</div>
          </div>
          <div class="sec">
            <h4>到期复习（v9.0）</h4>
            <div class="muted" id="due-summary">已到期 0 词 · 未来 7 天 -</div>
            <div id="due-bars" style="display:flex;gap:6px;align-items:flex-end;height:74px;margin-top:10px"></div>
            <div id="due-list" class="muted" style="margin-top:8px">暂无到期词</div>
            <div class="btns" style="margin-top:8px">
              <button class="btn primary" id="btn-due-start" disabled>开始到期复习</button>
              <button class="btn ghost" id="btn-due-refresh">刷新</button>
            </div>
            <div class="muted" style="margin-top:8px">到期词按记忆曲线自动排队；开始后进入复习模式，答对推进档位、答错回到 10 分钟档，并按每个词的原词库写回。</div>
          </div>
          <div class="sec">
            <h4>全量数据导出 / 导入（v9.0）</h4>
            <div class="btns">
              <button class="btn" id="btn-export-all">导出全量数据 JSON</button>
              <button class="btn" id="btn-import-all">导入全量数据…</button>
            </div>
            <div class="muted" style="margin-top:8px">JSON 含：设置 + 记忆曲线/练习记录/章节记录 + 自定义词库 + localStorage。导入会先自动备份当前数据，再覆盖学习数据并重载。</div>
          </div>
          <div class="sec">
            <h4>导出 CSV（快速保存，无需手选路径）</h4>
            <div class="btns">
              <button class="btn" id="btn-csv-wrong">导出错词 CSV</button>
              <button class="btn" id="btn-csv-records">导出练习记录 CSV</button>
              <button class="btn ghost" id="btn-refresh">刷新统计</button>
              <button class="btn ghost" id="btn-open-exports">打开导出目录</button>
            </div>
            <div class="muted" style="margin-top:8px">一键保存到「文档\\QwertyLearnerPlus\\exports」。错词表：单词/错误次数/词库/最后时间；记录表：记忆曲线（单词/词库/阶段/间隔/到期/正确/错误）。</div>
          </div>
          <div class="sec">
            <h4>错词 Top 10（来自 RecordDB）</h4>
            <div class="muted" id="wb-stat" style="margin-bottom:8px">暂无错词。错题由官方「错题本」统一管理，本页只读展示。</div>
            <div id="wb-list"></div>
            <div class="btns" style="margin-top:8px">
              <button class="btn sm primary" id="btn-wb-open-error">打开官方错题本</button>
              <button class="btn sm" id="btn-wb-export">导出错词 CSV</button>
            </div>
          </div>
          <div class="sec">
            <h4>键位热力图（来自 RecordDB）</h4>
            <div class="kb-heat" id="kb-heat"></div>
            <div class="kb-tip" id="kb-tip">颜色越红=该键错误率越高；悬停查看错误数/出现次数/平均用时。数据来自官方练习记录（wordRecords），只读。</div>
          </div>
          <div class="sec">
            <h4>慢词 Top 10 / 错误键 Top 10</h4>
            <div class="grid2">
              <div>
                <div class="muted" style="margin-bottom:5px">慢词榜（按平均作答耗时）</div>
                <div id="slow-list"><div class="muted">暂无数据</div></div>
              </div>
              <div>
                <div class="muted" style="margin-bottom:5px">错误键榜（按错误次数）</div>
                <div id="errkey-list"><div class="muted">暂无数据</div></div>
              </div>
            </div>
          </div>
          <div class="sec">
            <h4>用户数据备份（A7）</h4>
            <div class="btns">
              <button class="btn primary" id="btn-backup">立即备份</button>
              <button class="btn ghost" id="btn-open-backup">打开备份目录</button>
            </div>
            <div class="muted" style="margin-top:8px">自动备份每天一次（IndexedDB + Local Storage + Preferences），保留最近 7 份，位置：%APPDATA%\\qwerty-learner-plus\\backups。</div>
          </div>
        </div>

        <!-- 词库 -->
        <div class="tabpane" id="tab-dict">
          <div class="sec">
            <h4>内置词库管理（v5 · 搜索 / 收藏 / 最近 / 分类）</h4>
            <div class="hint">385 个内置词库：显示名称、词数、启发式分类（CET / 考研 / 雅思 / 托福 / GRE / 编程 / 其他）与当前词库标记。<br>
              「设为当前」直接写入官方 localStorage（currentDict / learningMode=manual）后重载，可靠且不依赖弹层；仅当词库缺少 id 时才回退官方画廊自动化。</div>
            <div class="flex" style="margin-bottom:8px">
              <input class="input grow" id="dict-search" placeholder="搜索词库（中英文/文件名）">
              <button class="btn sm ghost" id="dict-reset-filter">重置</button>
            </div>
            <div class="dict-toolbar">
              <select class="input" id="dict-mode" style="width:110px"><option value="all">全部</option><option value="fav">收藏</option><option value="recent">最近</option></select>
              <select class="input" id="dict-cat" style="width:130px">
                <option value="all">全部分类</option><option>CET</option><option>考研</option><option>雅思</option><option>托福</option><option>GRE</option><option>编程</option><option>其他</option>
              </select>
              <span class="muted" id="dict-count">-</span>
            </div>
            <div id="dict-builtin-list"><div class="muted">加载中…</div></div>
            <div class="dict-more"><button class="btn sm ghost hidden" id="dict-more">显示更多</button></div>
            <div class="muted" id="dict-note" style="margin-top:6px"></div>
          </div>
          <div class="sec">
            <h4>在线更新词库（GitHub 官方仓库）</h4>
            <div class="btns">
              <button class="btn sm" id="btn-dict-update-check">检查更新</button>
              <button class="btn sm ghost" id="btn-dict-update-dir">打开更新目录</button>
              <button class="btn sm ghost" id="btn-dict-update-clear">清空已下载更新</button>
              <button class="btn sm ghost" id="btn-dict-relaunch">重启应用</button>
            </div>
            <div class="muted" id="dict-update-info" style="margin-top:8px">点击「检查更新」会比较本地与 GitHub 官方词库（名称 + 大小/SHA 哈希）；只在你点下载后才下载单个文件，不会自动全量下载。</div>
            <div class="muted hidden" id="dict-update-downloaded" style="margin-top:6px"></div>
            <div class="progress hidden" id="dict-upd-progress-wrap"><i id="dict-upd-progress"></i></div>
            <div id="dict-update-list"></div>
            <div class="muted" style="margin-top:6px">更新文件保存在 %APPDATA%\\qwerty-learner-plus\\dicts-update\\，插件请求层会优先使用；删除该目录或点「清空已下载更新」即可回滚。</div>
          </div>
          <div class="sec">
            <h4>导入自定义词库（B6）</h4>
            <div class="hint">支持 CSV（word,释义）、JSON（[{"name":"word","trans":"释义"}]）、TXT（每行 单词 或 单词&lt;Tab&gt;释义）。导入后可在「我的自定义词库」点「记忆曲线」进入主练习流程。</div>
            <input type="file" id="file-dict" accept=".csv,.json,.txt" class="input">
            <div class="flex" style="margin-top:8px">
              <input class="input grow" id="in-dict-name" placeholder="词库名称（留空则用文件名）">
              <button class="btn primary" id="btn-import">导入</button>
            </div>
            <div class="muted" id="lbl-import" style="margin-top:6px"></div>
          </div>
          <div class="sec">
            <h4>我的自定义词库</h4>
            <div id="dict-list"><div class="muted">暂无，先导入一个词库。</div></div>
          </div>

        </div>

        <!-- 工具 -->
        <div class="tabpane" id="tab-tools">
          <div class="sec">
            <h4>番茄钟（B8）</h4>
            <div class="pomo">
              <div class="ring" id="pomo-ring"><div><div class="t" id="pomo-time">25:00</div><div class="s" id="pomo-mode">专注</div></div></div>
              <div class="flex" style="justify-content:center;margin-top:4px">
                <button class="btn primary" id="pomo-start">开始</button>
                <button class="btn ghost" id="pomo-reset">重置</button>
                <button class="btn ghost" id="pomo-skip">跳过</button>
              </div>
              <div class="flex" style="justify-content:center;margin-top:10px">
                <span class="muted">专注</span><input class="input" id="pomo-focus" type="number" min="5" max="90" style="width:70px">
                <span class="muted">分钟 · 休息</span><input class="input" id="pomo-break" type="number" min="1" max="30" style="width:70px">
                <span class="muted">分钟</span>
              </div>
              <div class="muted" style="margin-top:8px">今日完成 <b id="pomo-count">0</b> 个专注段 · 结束时桌面通知提醒</div>
            </div>
          </div>
          <div class="sec">
            <h4>免费释义 / 整句翻译（B4' · 免 Key）</h4>
            <div class="hint">查词卡片：中文释义（本地词库 + 有道）、音标、英文释义/词性、例句、同义词、发音。<br>
              每条例句可点「翻译整句」；例句中单词悬停约 0.3 秒显示该词单独翻译，点击单词可发音。全部无需任何 API Key。</div>
            <div class="flex" style="margin-bottom:8px">
              <input class="input grow" id="in-word" placeholder="输入单词/短语，回车查询（例：serendipity）">
              <button class="btn primary" id="btn-word-lookup">查询释义</button>
            </div>
            <div class="row"><div class="grow"><div class="lbl">释义缓存</div><div class="desc" id="free-cache-stat">-</div></div>
              <button class="btn sm ghost" id="btn-free-clear">清空缓存</button></div>
            <div class="row"><div class="grow"><div class="lbl">ECDICT 离线词典（预留）</div><div class="desc">约 80MB，下载后完全离线查词；当前版本未启用，在线免费释义已可用</div></div>
              <button class="btn sm ghost" id="btn-ecdict" disabled>暂未提供</button></div>
          </div>
          <div class="sec">
            <h4>发音预缓存（v5 · 当前词库）</h4>
            <div class="hint">从有道下载当前词库单词的发音到本地缓存（与查词发音共用），只补缺失、可续传；并发 4、失败自动重试 1 次。<br>
              默认不会全量下载超大词库——建议填写「本次上限」或分次进行。</div>
            <div class="row"><div class="grow"><div class="lbl">目标词库</div><div class="desc" id="pc-dict">-</div></div></div>
            <div class="flex" style="margin-bottom:8px;flex-wrap:wrap">
              <select class="input" id="pc-type" style="width:100px"><option value="us">美音</option><option value="uk">英音</option></select>
              <input class="input" id="pc-limit" type="number" min="0" max="50000" placeholder="本次上限（留空=全部）" style="width:190px">
              <button class="btn sm primary" id="pc-start">开始</button>
              <button class="btn sm" id="pc-pause">暂停</button>
              <button class="btn sm" id="pc-resume">继续</button>
              <button class="btn sm ghost" id="pc-cancel">取消</button>
            </div>
            <div class="progress" id="pc-bar-wrap"><i id="pc-bar"></i></div>
            <div class="pc-line"><span id="pc-status">未开始</span><span id="pc-cache">-</span></div>
            <div class="muted" id="pc-est" style="margin-top:4px">-</div>
            <div class="pc-fail" id="pc-fail"></div>
          </div>
          <div class="sec">
            <h4>发音缓存（B7）</h4>
            <div class="row"><div><div class="lbl">缓存统计</div><div class="desc" id="pron-stat">-</div></div>
              <button class="btn sm ghost" id="btn-pron-clear">清空缓存</button></div>
            <div class="muted">拦截 https://dict.youdao.com/dictvoice 音频并落盘到 %APPDATA%\\qwerty-learner-plus\\cache\\audio，二次播放离线可用。若发音异常请关闭此开关。</div>
          </div>
          <div class="sec">
            <h4>文件位置</h4>
            <div class="btns">
              <button class="btn ghost" id="btn-open-plus">插件数据目录</button>
              <button class="btn ghost" id="btn-open-log">错误日志目录</button>
              <button class="btn ghost" id="btn-open-data">用户数据目录(只读)</button>
            </div>
          </div>
        </div>

        <!-- 关于 -->
        <div class="tabpane" id="tab-about">
          <div class="sec">
            <h4>Qwerty Learner Plus</h4>
            <div class="muted">
              版本：<b>${APP_VERSION}（随机出词 + 艾宾浩斯记忆曲线 + 错词当场重现 + 数据收口 + 错误分类提示 + 逻辑备份快照 + 到期复习中心 + 全量导入导出；无章节、无每日上限）</b><br>
              基于官方 Qwerty Learner 源码（commit 1182426）自行构建：练习页不再有章节选择，直接按记忆曲线随机出词；官方打字/默写/音标/音效/错题本/数据统计/词库画廊/设置等功能全部保留；v1~v6 中仍适用的增强功能收纳到顶栏「工具」全屏页。本地魔改由 dsh 完成，不跟随官方更新。
            </div>
          </div>
          <div class="sec">
            <h4>功能清单</h4>
            <div class="muted">
              A 层：置顶 · 全局快捷键 · 迷你模式 · 托盘 · 开机自启 · 透明度/缩放 · 每日备份 · 错误日志 · 托盘进度<br>
              B 层：每日目标/打卡 · CSV 快速导出 · 统计热力图 · 自定义词库 · 番茄钟 · 主题/字体/键音 · 免费释义/整句翻译 · 剪贴板查词 · 发音缓存<br>
              数据页：错词 Top 10 · 键位热力图 · 慢词榜 · 错误键榜（只读 RecordDB）<br>
              v7 记忆曲线：当前词库整本作为词池、无章节；到期复习词与未学词随机混排；艾宾浩斯间隔阶梯（10 分钟 → 1 天 → 4 天 → 15 天 …）；答错回到 10 分钟档；一批练完自动续批、无需重新按键；没有每日新词上限，随时背随时退；旧版学习记录自动导入<br>
              v8 复习增强：答错的词在本次练习内隔 3 个词强制再练一次（同一词最多 2 次），答对只刷新记忆、不延长间隔；随机回顾词会标注「随机回顾」，错词重练会标注「再练一次」<br>
              v8.1 数据收口：数据页的错词/键位/慢词/时长统一读官方 RecordDB；新增学习报告（掌握度分布 + 未来 7 天到期）<br>
              v8.2 错误提示：打错时按「漏字 / 重复 / 大小写 / 错字」在单词下方提示正确字母约 1.8 秒<br>
              v8.3 影子调度：按正确率 / ease / 慢词比例并行计算自适应间隔并记录到 memoryRecords（暂不启用，数据页可看对比）<br>
              v8.4 自定义词库进主流程：「工具 → 词库 → 我的自定义词库 → 记忆曲线」即可按记忆曲线练习自己的词表（记录命名空间 custom:名称；官方错题本对自定义词只显示单词与错误次数）<br>
              v8.7 视觉：开始页概览改为 14px、数字加粗、到期数高亮；错误提示 15px；「再练一次 / 随机回顾」改为徽标<br>
              v8.8 清理：移除旧 v6 记忆曲线/插件练习/键位统计死代码（约 860 行）；面板只保留 常规 / 数据 / 词库 / 工具 / 关于<br>
              v8.9 壳加固：IPC 来源白名单 · 导航/外链守卫 · 权限默认拒绝（仅放行剪贴板写）· 崩溃 reload 限流 · 日志按日轮转保留 14 天 · 备份新增 data.json 逻辑快照（RecordDB/自定义词库/localStorage/设置）· 统计上报去重 · 剪贴板轮询按需启动<br>
              v9.0 学习闭环：到期复习中心（未来 7 天柱状图 + 到期词列表 + 一键复习，按原词库写回）· 开始页「到期复习」可点直达 · 今日练习/新学口径统一 · 自定义词库在官方错题本回退记忆曲线释义 · 全量数据导出/导入 JSON（导入前自动备份）· 暂停时补写 chapterRecord<br>
              v5 词库层：内置 385 词库搜索/收藏/最近/分类 + 设为当前 · GitHub 官方词库在线更新（逐个下载、SHA 比对、可回滚）· 当前词库发音预缓存（美/英音、续传、暂停/继续/取消、失败重试）
            </div>
          </div>
          <div class="sec">
            <h4>已知限制</h4>
            <div class="muted">
              · 统计/导出依赖应用自身 IndexedDB（RecordDB），字段随官方版本变化可能缺失；<br>
              · 免费释义/整句翻译依赖有道 suggest、dictionaryapi.dev、MyMemory 等公共接口，需联网；接口限流或断网时自动降级为本地词库 + 缓存，并标注“离线”；<br>
              · 逐词悬停释义优先用缓存，其次在线查短释义，长句/生僻词可能暂无结果；<br>
              · ECDICT 离线词典为预留功能，当前版本未提供下载；<br>
              · 发音缓存为实验功能，个别网络环境下可能影响发音，可在"常规"页关闭；<br>
              · 迷你模式依靠 CSS 隐藏页面头部，官方页面结构若大改可能失效；<br>
              · 自定义词库：「记忆曲线」按钮进入主练习流程（记录命名空间 custom:名称）；v9.0 起官方错题本会回退显示记忆曲线里的释义（若练习/导入时已存 trans）。<br>
              · v8 数据收口：错词/键位/慢词/时长均只读官方 RecordDB（wordRecords/memoryRecords），旧插件练习数据不再写入也不迁移显示；<br>
              · WPM 与练习时长按按键间隔估算（不含读题停顿），仅供参考；键位延迟为相邻按键的近似间隔。<br>
              · 词库「设为当前」v9.1 起直接写官方 localStorage（currentDict/learningMode）并重载；仅少数缺少 id 的异常词库仍回退官方画廊自动化。<br>
              · 在线更新只下载你点击的单个词库文件；更新文件通过请求层覆盖生效，重启应用/切换词库后最可靠；删除 dicts-update 目录即回滚。<br>
              · 发音预缓存会按词库词数下载音频（单条约 14KB），大词库（上万词）请使用「本次上限」或分次进行；仅写入本机缓存，不修改词库/应用数据。
            </div>
          </div>
          <div class="sec">
            <h4>快捷键</h4>
            <div class="muted">
              <span class="kbd">Ctrl+Alt+Q</span> 显示/隐藏窗口<br>
              <span class="kbd">Ctrl+Alt+M</span> 迷你模式开关<br>
              面板内：Esc 关闭面板，Ctrl+Enter 开始/暂停番茄钟
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="qz-wordcard-root"></div>
    <div class="qz-tooltip" id="qz-tooltip"></div>
    <div class="toast-wrap" id="qz-toasts"></div>
  `;
  shadow.appendChild(wrap);

  const $ = (sel) => shadow.querySelector(sel);
  const fab = $('#qz-fab'), panel = $('#qz-panel'), chip = $('#qz-chip');

  function toast(msg, ms = 2600) {
    const box = $('#qz-toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch { /* ignore */ } }, ms);
  }

  // ---------------------------------------------------------------- 面板显示/隐藏
  function openPanel(tab) {
    panelOpen = true;
    panel.classList.add('open');
    syncControls();
    if (tab) switchTab(tab);
    setTimeout(() => { const first = panel.querySelector('.tabs button.active'); first && first.focus && first.focus(); }, 30);
  }
  function closePanel() { panelOpen = false; panel.classList.remove('open'); }
  fab.addEventListener('click', () => { panelOpen ? closePanel() : openPanel(); });
  chip.addEventListener('click', () => openPanel('data'));
  window.addEventListener('qz-open-enhance', (e) => {
    const tab = e && e.detail && e.detail.tab;
    if (!panelOpen) openPanel(tab || 'general');
    else if (tab) switchTab(tab);
  });
  // v9.3：自动进阶升级事件（页面侧 dispatch）→ 轻提示 + 数据页刷新
  window.addEventListener('qz-auto-level-up', (e) => {
    const detail = e && e.detail;
    if (detail && detail.name) {
      toast(`自动进阶：升级到「${detail.name}」`, 4200);
      if (panelOpen) refreshStatsUI();
    }
  });
  $('#qz-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) { closePanel(); e.stopPropagation(); }
  }, true);

  function switchTab(name) {
    shadow.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    shadow.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'data') refreshStatsUI();
    if (name === 'dict') { refreshDictManager(); refreshDictUI(); refreshUpdateInfo(); }
    if (name === 'tools') refreshToolsUI();
  }
  shadow.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // ---------------------------------------------------------------- 设置绑定
  const bindToggle = (id, key, after) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', async () => {
      const v = !!el.checked;
      try {
        settings = await api.updateSettings({ [key]: v });
        if (after) after(v);
        toast(`${labelOf(key)}：${v ? '开' : '关'}`);
        syncControls();
      } catch (e) { toast('设置失败: ' + (e.message || e)); }
    });
  };
  const labelOf = (k) => ({ alwaysOnTop: '窗口置顶', miniMode: '迷你模式', closeToTray: '关闭进托盘', autoStart: '开机自启', clipboardWatch: '剪贴板查词', onlineLookup: '在线释义/整句翻译', aiExperimental: 'AI 增强（实验）', pronCache: '发音缓存', keySound: '键音' }[k] || k);

  bindToggle('sw-top', 'alwaysOnTop');
  bindToggle('sw-mini', 'miniMode');
  bindToggle('sw-tray', 'closeToTray');
  bindToggle('sw-autostart', 'autoStart');
  bindToggle('sw-clip', 'clipboardWatch');
  bindToggle('sw-online', 'onlineLookup', (v) => toast(v ? '已开启在线释义（免 Key）' : '已切换为离线模式：仅用本地词库/缓存'));
  bindToggle('sw-aiexp', 'aiExperimental');
  bindToggle('sw-pron', 'pronCache');
  bindToggle('sw-keysound', 'keySound');
  bindToggle('sw-dark', 'darkMode', (v) => applyTheme());

  $('#rg-opacity').addEventListener('input', () => {
    const v = Number($('#rg-opacity').value);
    $('#v-opacity').textContent = Math.round(v * 100) + '%';
  });
  $('#rg-opacity').addEventListener('change', async () => {
    const v = Number($('#rg-opacity').value);
    settings = await api.updateSettings({ opacity: v });
    toast('透明度 ' + Math.round(v * 100) + '%');
  });
  $('#rg-zoom').addEventListener('input', () => {
    const v = Number($('#rg-zoom').value);
    $('#v-zoom').textContent = Math.round(v * 100) + '%';
  });
  $('#rg-zoom').addEventListener('change', async () => {
    const v = Number($('#rg-zoom').value);
    settings = await api.updateSettings({ zoom: v });
    toast('缩放 ' + Math.round(v * 100) + '%');
  });
  $('#rg-keyvol').addEventListener('input', () => {
    const v = Number($('#rg-keyvol').value);
    $('#v-keyvol').textContent = Math.round(v * 100) + '%';
    settings.keySoundVolume = v;
  });
  $('#rg-keyvol').addEventListener('change', async () => { settings = await api.updateSettings({ keySoundVolume: Number($('#rg-keyvol').value) }); });
  $('#sel-theme').addEventListener('change', async () => { settings = await api.updateSettings({ theme: $('#sel-theme').value }); applyTheme(); });
  $('#sel-font').addEventListener('change', async () => { settings = await api.updateSettings({ fontFamily: $('#sel-font').value }); applyTheme(); });
  $('#sel-appearance').addEventListener('change', async () => {
    settings = await api.updateSettings({ panelAppearance: $('#sel-appearance').value });
    applyPanelTheme();
    toast('面板外观：' + ({ auto: '自动', light: '浅色', dark: '深色' }[settings.panelAppearance] || '自动'));
  });

  function syncControls() {
    const set = (id, v) => { const el = $('#' + id); if (el) el.checked = !!v; };
    set('sw-top', settings.alwaysOnTop); set('sw-mini', settings.miniMode);
    set('sw-tray', settings.closeToTray); set('sw-autostart', settings.autoStart);
    set('sw-clip', settings.clipboardWatch); set('sw-online', settings.onlineLookup !== false); set('sw-aiexp', !!settings.aiExperimental);
    set('sw-pron', settings.pronCache); set('sw-keysound', settings.keySound);
    set('sw-dark', typeof settings.darkMode === 'boolean' ? settings.darkMode : isDark());
    $('#rg-opacity').value = settings.opacity || 1; $('#v-opacity').textContent = Math.round((settings.opacity || 1) * 100) + '%';
    $('#rg-zoom').value = settings.zoom || 1; $('#v-zoom').textContent = Math.round((settings.zoom || 1) * 100) + '%';
    $('#rg-keyvol').value = settings.keySoundVolume == null ? 0.25 : settings.keySoundVolume;
    $('#v-keyvol').textContent = Math.round(($('#rg-keyvol').value) * 100) + '%';
    if ($('#sel-theme')) $('#sel-theme').value = settings.theme || 'indigo';
    if ($('#sel-font')) $('#sel-font').value = settings.fontFamily || 'default';
    if ($('#sel-appearance')) $('#sel-appearance').value = settings.panelAppearance || 'auto';
  }

  function isDark() { return document.documentElement.classList.contains('dark'); }
  // v4：面板外观（浅色为默认；auto 跟随应用深浅色；深色用中性 slate，无紫黑玻璃感）
  function applyPanelTheme() {
    let dark;
    const mode = settings.panelAppearance || 'auto';
    if (mode === 'dark') dark = true;
    else if (mode === 'light') dark = false;
    else dark = document.documentElement.classList.contains('dark');
    host.classList.toggle('qz-dark', !!dark);
    if (panel) panel.classList.toggle('qz-dark', false); // 变量在 :host 上统一控制
  }
  function applyTheme() {
    const html = document.documentElement;
    // 深色模式：null = 跟随应用自身设置，不强行覆盖；只有用户显式开/关过才接管
    if (typeof settings.darkMode === 'boolean') html.classList.toggle('dark', settings.darkMode);
    ['indigo', 'emerald', 'rose', 'amber', 'sky', 'violet'].forEach((t) => html.classList.toggle('qz-accent-' + t, (settings.theme || 'indigo') === t));
    ['mono', 'serif', 'round'].forEach((f) => html.classList.toggle('qz-font-' + f, settings.fontFamily === f));
    applyPanelTheme();
  }

  // ---------------------------------------------------------------- 迷你模式事件
  api.onEvent((payload) => {
    if (!payload) return;
    if (payload.type === 'mini') {
      document.body.classList.toggle('qz-mini', !!payload.value);
      panel.classList.toggle('mini', !!payload.value);
      settings.miniMode = !!payload.value;
      syncControls();
    } else if (payload.type === 'open-panel') {
      openPanel('data');
    } else if (payload.type === 'settings' && payload.value) {
      const wasDark = isDark();
      settings = { ...settings, ...payload.value };
      syncControls();
      if (wasDark !== isDark()) applyTheme();
      else applyPanelTheme();
    }
  });

  // ---------------------------------------------------------------- v9.0 到期复习
  let dueSelectedDay = '';
  function renderAutoLevel(s) {
    const al = s && s.autoLevel;
    if (!$('#al-level')) return;
    if (!al || !al.levelId) {
      $('#al-level').textContent = '-';
      $('#al-mastered').textContent = '0';
      $('#al-seen').textContent = '0';
      $('#al-suspended').textContent = '0';
      $('#al-detail').textContent = '尚未初始化（开始自动进阶练习后生成；也可点「重新评估级别」）';
      return;
    }
    const effective = Math.max(1, (Number(al.total) || 0) - (Number(al.suspended) || 0));
    const ratio = Math.round(((Number(al.mastered) || 0) / effective) * 100);
    const debt = Number(al.due) || 0;
    $('#al-level').textContent = al.name || al.levelId;
    $('#al-mastered').textContent = fmtNum(al.mastered || 0);
    $('#al-seen').textContent = fmtNum(al.seen || 0);
    $('#al-suspended').textContent = fmtNum(al.suspended || 0);
    $('#al-detail').textContent =
      `有效词 ${effective} · 已见 ${fmtNum(al.seen || 0)} · 掌握 ${fmtNum(al.mastered || 0)}（${ratio}%）` +
      ` · 复习债 ${fmtNum(debt)} 词（按每天 100 词约 ${debt > 0 ? Math.ceil(debt / 100) : 0} 天）` +
      ` · 当前新词比例 ${al.newRatio == null ? '-' : Math.round(Number(al.newRatio) * 100) + '%'}` +
      (al.updatedAt ? ` · 更新于 ${new Date(al.updatedAt).toLocaleTimeString()}` : '');
  }
  function renderDueList(dueList) {
    const box = $('#due-list');
    if (!box) return;
    let list = dueList || [];
    if (dueSelectedDay) list = list.filter((d) => dayKey(d.due) === dueSelectedDay);
    if (!list.length) {
      box.innerHTML = dueSelectedDay ? '这一天没有到期词（再次点击柱状图可取消筛选）' : '暂无到期词，继续按节奏练习即可。';
      return;
    }
    const shown = list.slice(0, 12);
    box.innerHTML = shown.map((d) => {
      const trans = (d.trans || []).join('；').slice(0, 26);
      const when = d.due ? new Date(d.due) : null;
      const whenText = when
        ? `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
        : '';
      return `<div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px dashed var(--qz-track)">
        <b style="min-width:104px;color:var(--qz-text-strong)">${esc(d.word)}</b>
        <span style="flex:1;color:var(--qz-muted)">${esc(trans)}</span>
        <span style="color:var(--qz-muted);font-size:11px;white-space:nowrap">第${Number(d.stage) + 1}档 · ${whenText}</span>
      </div>`;
    }).join('') + (list.length > shown.length ? `<div style="margin-top:4px;color:var(--qz-muted)">还有 ${list.length - shown.length} 个到期词…</div>` : '');
  }
  function renderDueReview(mem) {
    const dueNow = (mem && Number(mem.dueNow)) || 0;
    const dueList = (mem && mem.dueList) || [];
    const dueDays = (mem && mem.dueDays) || [];
    const totalNext7 = dueDays.reduce((a, d) => a + (Number(d.count) || 0), 0);
    const summary = $('#due-summary');
    if (summary) summary.textContent = `已到期 ${dueNow} 词 · 未来 7 天共 ${totalNext7} 词`;
    const bars = $('#due-bars');
    if (bars) {
      const max = Math.max(1, ...dueDays.map((d) => Number(d.count) || 0), dueNow);
      bars.innerHTML = dueDays
        .map((d, i) => {
          const label = i === 0 ? '今天' : String(d.date).slice(5);
          const count = Number(d.count) || 0;
          const h = Math.max(3, Math.round(58 * (count / max)));
          const bg = dueSelectedDay === d.date ? 'var(--qz-accent)' : (i === 0 ? 'var(--qz-accent)' : 'rgba(129,140,248,.55)');
          const fw = dueSelectedDay === d.date ? '700' : '400';
          return `<button type="button" data-day="${d.date}" title="${d.date}：${count} 词到期" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:100%;background:none;border:0;padding:0;cursor:pointer;color:var(--qz-muted);font-size:11px;font-weight:${fw}">
            <span style="color:var(--qz-text)">${count || ''}</span>
            <i style="display:block;width:100%;height:${h}px;background:${bg};border-radius:4px 4px 0 0"></i>
            <span>${label}</span>
          </button>`;
        })
        .join('');
      const days = Array.from(bars.querySelectorAll('button[data-day]'));
      for (const b of days) {
        b.addEventListener('click', () => {
          dueSelectedDay = dueSelectedDay === b.dataset.day ? '' : b.dataset.day;
          renderDueReview(appStats ? appStats.memory : mem);
        });
      }
    }
    renderDueList(dueList);
    const startBtn = $('#btn-due-start');
    if (startBtn) {
      const n = Math.min(dueNow, 100);
      startBtn.disabled = n <= 0;
      startBtn.textContent = n > 0 ? `开始到期复习（${n}${dueNow > 100 ? ' +' : ''}）` : '暂无到期词';
    }
  }

  // ---------------------------------------------------------------- 统计 UI
  function renderStatsToPanel(s) {
    if (!s) return;
    $('#st-streak').textContent = fmtNum(s.streak);
    $('#st-total').textContent = fmtNum(s.totalWords);
    $('#st-wrong').textContent = fmtNum(s.wrongWords.length);
    $('#st-wpm').textContent = s.wpm ? fmtNum(s.wpm) : '-';
    $('#st-acc').textContent = (s.accuracy == null) ? '-' : s.accuracy + '%';
    $('#st-min').textContent = s.totalMinutes ? fmtNum(s.totalMinutes) : '0';
    $('#bar-goal').style.width = Math.round(s.ratio * 100) + '%';
    $('#lbl-goal').textContent = `今日练习 ${s.words} / ${s.goal} 词（新学 ${s.todayNew || 0}）· 完成 ${Math.round(s.ratio * 100)}% · 连续 ${s.streak} 天`;
    $('#lbl-source').textContent = '数据源: ' + (s.source === 'RecordDB' ? 'IndexedDB RecordDB' : (s.source === 'localStorage' ? 'localStorage 回退' : '暂无数据'));
    const box = $('#heat-box');
    const heatDays = s.heatDays || [];
    if (box) {
      const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
      const max = Math.max(1, ...heatDays.map((d) => d.count || 0));
      box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">` + heatDays.map((d) => {
        const n = d.count || 0;
        const alpha = n ? 0.22 + 0.78 * (n / max) : 0;
        const bg = n ? `rgba(129,140,248,${alpha.toFixed(2)})` : 'var(--qz-track)';
        const fg = (n / max > 0.55) ? '#fff' : 'var(--qz-text)';
        const mmdd = String(d.date).slice(5);
        return `<div data-heat-date="${d.date}" title="${d.date}：${n} 词" style="cursor:pointer;border-radius:8px;padding:6px 4px;text-align:center;background:${bg};color:${fg}">
          <div style="font-size:10px;opacity:.85">周${weekLabels[d.weekday] || ''} ${mmdd}</div>
          <div style="font-size:15px;font-weight:700;line-height:1.2">${n || '·'}</div>
        </div>`;
      }).join('') + `</div>`;
      box.querySelectorAll('[data-heat-date]').forEach((el) => el.addEventListener('click', () => {
        const day = heatDays.find((d) => d.date === el.dataset.heatDate);
        const detail = $('#heat-detail');
        if (detail && day) {
          detail.textContent = `${day.date}：${day.count} 词${day.words && day.words.length ? ' · ' + day.words.join(' / ') : ''}`;
        }
      }));
    }
    const trendBox = $('#trend-box');
    if (trendBox) {
      const trend = s.trend || [];
      const maxT = Math.max(1, ...trend.map((t) => t.practiced || 0));
      trendBox.innerHTML = trend.map((t) => {
        const total = Math.max(0, t.practiced || 0);
        const fresh = Math.min(total, t.fresh || 0);
        const review = Math.max(0, total - fresh);
        const h = (v) => Math.max(v > 0 ? 2 : 0, Math.round(58 * v / maxT));
        return `<div title="${t.date}：练习 ${total}（新学 ${fresh}）" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
          <i style="display:block;height:${h(review)}px;background:rgba(129,140,248,.38);border-radius:2px 2px 0 0"></i>
          <i style="display:block;height:${h(fresh)}px;background:var(--qz-accent);border-radius:2px 2px 0 0"></i>
        </div>`;
      }).join('');
    }
    if ($('#in-goal') && document.activeElement !== $('#in-goal')) $('#in-goal').value = s.goal;
    // v8.1：学习报告（掌握度分布 + 未来 7 天到期）
    const mem = s.memory || { learned: 0, buckets: { short: 0, mid: 0, long: 0 }, dueDays: [] };
    if ($('#rp-learned')) {
      $('#rp-learned').textContent = fmtNum(mem.learned || 0);
      $('#rp-short').textContent = fmtNum((mem.buckets && mem.buckets.short) || 0);
      $('#rp-mid').textContent = fmtNum((mem.buckets && mem.buckets.mid) || 0);
      $('#rp-long').textContent = fmtNum((mem.buckets && mem.buckets.long) || 0);
      const dueText = (mem.dueDays || []).map((d) => `${String(d.date).slice(5)} ${d.count}`).join(' · ');
      $('#rp-due').textContent = '未来 7 天到期：' + (dueText || '-');
      const sh = mem.shadow || { count: 0, avgAdaptive: 0, avgActual: 0 };
      const fmtDays = (d) => (Number(d) >= 1 ? `${Math.round(Number(d) * 10) / 10} 天` : `${Math.round(Number(d) * 1440)} 分钟`);
      $('#rp-shadow').textContent = sh.count
        ? `影子调度：已记录 ${sh.count} 条（自适应平均 ${fmtDays(sh.avgAdaptive)} vs 当前 ${fmtDays(sh.avgActual)}；暂不启用）`
        : '影子调度：尚未记录（自适应算法并行计算中，暂不启用）';
    }
    renderDueReview(mem);
    // v9.3：累计口径与开始页统一为 memoryRecords；自动进阶卡片
    if ($('#st-total')) $('#st-total').textContent = fmtNum(mem.learned || 0);
    renderAutoLevel(s);
  }
  async function refreshStatsUI() {
    try {
      const s = await collectStats(); appStats = s; renderStatsToPanel(s);
      refreshWrongbookUI();
      refreshKeyboardUI();
      return s;
    } catch (e) { console.warn('[QZ] stats', e); return null; }
  }
  $('#btn-save-goal').addEventListener('click', async () => {
    const v = clamp(parseInt($('#in-goal').value, 10) || 30, 5, 500);
    settings = await api.updateSettings({ dailyGoal: v });
    await refreshStatsUI();
    await pushStats();
    toast('每日目标已设为 ' + v + ' 词');
  });
  $('#btn-refresh').addEventListener('click', async () => { await refreshStatsUI(); await pushStats(); toast('统计已刷新'); });

  // v9.0 到期复习：从 appStats.memory.dueList 取到期词，写 localStorage 桥接后回到练习页重载
  $('#btn-due-refresh').addEventListener('click', async () => { dueSelectedDay = ''; await refreshStatsUI(); toast('到期队列已刷新'); });
  $('#btn-due-start').addEventListener('click', async () => {
    try {
      await refreshStatsUI();
      const mem = appStats && appStats.memory;
      const list = (mem && mem.dueList) || [];
      if (!list.length) return toast('暂无到期词');
      const words = list.slice(0, 100).map((m) => ({
        name: m.word,
        trans: Array.isArray(m.trans) ? m.trans : [],
        usphone: m.phone || '',
        ukphone: m.phone || '',
        dict: m.dict,
      }));
      localStorage.setItem('qzDueReviewWords', JSON.stringify(words));
      toast(`已准备 ${words.length} 个到期词，正在进入复习…`);
      try { closePanel(); } catch { /* ignore */ }
      try { location.hash = '#/'; } catch { /* ignore */ }
      setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 350);
    } catch (e) { toast('开始复习失败: ' + (e.message || e)); }
  });

  // v9.3 自动进阶：重新评估（唯一允许回退）/ 恢复全部待攻克
  $('#btn-auto-reeval').addEventListener('click', () => {
    try {
      if (!window.confirm('重新评估会按当前学习记录重新定位级别（可能回退），确定继续？')) return;
      localStorage.setItem('qzReevaluateLevel', '1');
      toast('正在重新评估级别…', 2400);
      setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 300);
    } catch (e) { toast('重新评估失败: ' + (e.message || e)); }
  });
  $('#btn-auto-resume').addEventListener('click', () => {
    try {
      const st = JSON.parse(localStorage.getItem('qzAutoLevelState') || 'null') || {};
      const n = Array.isArray(st.suspended) ? st.suspended.length : 0;
      if (!n) return toast('暂无待攻克词');
      if (!window.confirm(`恢复 ${n} 个待攻克词并清空 Skip 计数？`)) return;
      st.suspended = [];
      st.skipped = {};
      localStorage.setItem('qzAutoLevelState', JSON.stringify(st));
      toast('已恢复，正在重载…', 2400);
      setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 400);
    } catch (e) { toast('恢复失败: ' + (e.message || e)); }
  });

  // v9.0 全量数据导出 / 导入
  $('#btn-export-all').addEventListener('click', async () => {
    try {
      toast('正在收集数据…');
      const snap = await collectBackupSnapshot();
      // 测试钩子：跳过原生保存对话框，把 JSON 放到 window 供自动化校验（v9.4：仅 QZ_ALLOW_MULTI 测试环境开放）
      if (TEST_HOOKS && window.__QZ_TEST_EXPORT__) {
        window.__QZ_EXPORT_LAST__ = JSON.stringify(snap);
        toast('测试导出已就绪（' + String(window.__QZ_EXPORT_LAST__.length) + ' 字节）');
        return;
      }
      const r = await api.exportJSON(`qwerty-全量数据-${TODAY()}.json`, JSON.stringify(snap, null, 2));
      if (r && r.ok) toast('已导出：' + r.path, 4200);
      else if (r && r.canceled) toast('已取消');
      else toast('导出失败: ' + ((r && r.error) || '未知'));
    } catch (e) { toast('导出失败: ' + (e.message || e)); }
  });
  $('#btn-import-all').addEventListener('click', async () => {
    try {
      // 测试钩子：window.__QZ_IMPORT_TEXT__ 可由自动化测试注入，避免原生文件对话框/confirm 无法脚本化
      // v9.4（SHELL-008）：仅在 QZ_ALLOW_MULTI 测试环境（window.__QZ_TEST_HOOKS__=true）下生效，生产 asar 不会跳过任何确认
      const testHook = TEST_HOOKS && !!window.__QZ_IMPORT_TEXT__;
      const res = testHook
        ? { ok: true, text: String(window.__QZ_IMPORT_TEXT__), path: 'test-hook' }
        : await api.importJSON();
      try { delete window.__QZ_IMPORT_TEXT__; } catch { /* ignore */ }
      if (!res || !res.ok) { if (!(res && res.canceled)) toast('读取失败: ' + ((res && res.error) || '未知')); return; }
      let data = null;
      try { data = JSON.parse(res.text); } catch { return toast('JSON 解析失败'); }
      if (!data || !data.recordDb) return toast('不是有效的全量数据文件');
      if (!testHook && !window.confirm('导入会覆盖当前全部学习数据（会先自动备份一份），确定继续？')) return;
      toast('正在备份当前数据…');
      const backup = await api.backupNow();
      // v9.4：备份失败确认只保留一次（原实现同一条件重复两次，第一行是死代码）
      if (!(backup && backup.ok) && !testHook) { if (!window.confirm('自动备份失败，仍要继续导入？')) return; }
      toast('正在导入…');
      let db = null;
      try {
        db = await idbOpen('RecordDB');
        const stores = Array.from(db.objectStoreNames || []);
        for (const store of stores) {
          const rows = data.recordDb[store];
          if (!Array.isArray(rows)) continue;
          await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            try { os.clear(); } catch { /* ignore */ }
            for (const row of rows) { try { os.put(row); } catch { /* ignore */ } }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('write ' + store));
            tx.onabort = () => reject(tx.error || new Error('abort ' + store));
          });
        }
      } finally { try { if (db) db.close(); } catch { /* ignore */ } }
      if (Array.isArray(data.customDicts) && data.customDicts.length) {
        let pdb = null;
        try {
          pdb = await idbOpen('QwertyPlusDB', 3, (d) => { if (!d.objectStoreNames.contains('dicts')) d.createObjectStore('dicts', { keyPath: 'name' }); });
          await new Promise((resolve, reject) => {
            const tx = pdb.transaction('dicts', 'readwrite');
            const os = tx.objectStore('dicts');
            try { os.clear(); } catch { /* ignore */ }
            for (const row of data.customDicts) { try { os.put(row); } catch { /* ignore */ } }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('custom dict import'));
          });
        } finally { try { if (pdb) pdb.close(); } catch { /* ignore */ } }
      }
      if (data.localStorage && typeof data.localStorage === 'object') {
        const skip = new Set(['reviewModeInfo']);
        for (const k of Object.keys(data.localStorage)) {
          const v = data.localStorage[k];
          if (skip.has(k) || typeof v !== 'string') continue;
          try { localStorage.setItem(k, v); } catch { /* ignore */ }
        }
      }
      // v9.0：导入后清掉可能在进行的复习会话，避免重载后困在旧复习列表
      try { localStorage.removeItem('reviewModeInfo'); } catch { /* ignore */ }
      if (data.settings && typeof data.settings === 'object') {
        try { await api.updateSettings(data.settings); } catch { /* ignore */ }
      }
      toast('导入完成，正在重载…');
      setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 700);
    } catch (e) { toast('导入失败: ' + (e.message || e)); }
  });

  $('#btn-csv-wrong').addEventListener('click', async () => {
    try {
      const s = appStats || await refreshStatsUI();
      if (!s || !s.wrongWords.length) return toast('没有错词数据可导出');
      const rows = s.wrongWords.map((w) => [w.word, w.wrongCount, w.dict, w.chapter, tsText(w.timeStamp)]);
      const csv = toCSV(['单词', '错误次数', '词典', '章节', '最后练习时间'], rows);
      const r = await api.saveCSV('qwerty-错词-' + TODAY() + '.csv', csv);
      if (r && r.ok) toast('已保存：' + r.path + '（无需再选路径）', 4200); else toast('导出失败: ' + ((r && r.error) || '未知'));
    } catch (e) { toast('导出失败: ' + (e.message || e)); }
  });
  $('#btn-csv-records').addEventListener('click', async () => {
    try {
      const { memoryRecords } = await readRecordInsights();
      if (!memoryRecords.length) return toast('还没有记忆曲线记录可导出');
      memoryRecords.sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0));
      const rows = memoryRecords.map((r) => [
        r.word || '', r.dict || '',
        Array.isArray(r.trans) ? r.trans.join(' / ') : (r.trans || ''),
        r.stage != null ? r.stage : '', r.interval != null ? r.interval : '',
        r.due ? tsText(r.due) : '', r.correct || 0, r.wrong || 0, r.slow || 0,
        r.lastSeen ? tsText(r.lastSeen) : '',
      ]);
      const csv = toCSV(['单词', '词库', '释义', '阶段', '间隔(天)', '到期时间', '正确', '错误', '慢词', '最后作答'], rows);
      const r = await api.saveCSV('qwerty-记忆曲线-' + TODAY() + '.csv', csv);
      if (r && r.ok) toast('已保存：' + r.path + '（无需再选路径）', 4200); else toast('导出失败: ' + ((r && r.error) || '未知'));
    } catch (e) { toast('导出失败: ' + (e.message || e)); }
  });
  $('#btn-open-exports').addEventListener('click', () => api.openExports());

  // v8：错词 Top 10（只读 RecordDB；错题由官方错题本统一管理）
  async function refreshWrongbookUI() {
    const box = $('#wb-list'), stat = $('#wb-stat');
    if (!box || !stat) return;
    try { if (!appStats) appStats = await collectStats(); } catch { /* ignore */ }
    const all = (appStats && Array.isArray(appStats.wrongWords)) ? appStats.wrongWords : [];
    stat.textContent = all.length
      ? `共 ${all.length} 个错词（按错误次数排序前 10）· 全部错词见官方「错题本」`
      : '暂无错词。错题由官方「错题本」统一管理，本页只读展示。';
    box.innerHTML = all.slice(0, 10).map((w) => `<div class="wb-item"><span class="nm">${esc(w.word)}</span><span class="c">×${w.wrongCount}</span></div>`).join('');
  }
  $('#btn-wb-open-error').addEventListener('click', () => {
    closePanel();
    location.hash = '#/error-book';
  });
  $('#btn-wb-export').addEventListener('click', async () => {
    try {
      const s = appStats && appStats.today === TODAY() && Date.now() - (appStats.at || 0) < 30000 ? appStats : await collectStats();
      if (!s || !s.wrongWords.length) return toast('没有错词数据可导出');
      const rows = s.wrongWords.map((w) => [w.word, w.wrongCount, w.dict, tsText(w.timeStamp)]);
      const csv = toCSV(['单词', '错误次数', '词库', '最后练习时间'], rows);
      const r = await api.saveCSV('qwerty-错词-' + TODAY() + '.csv', csv);
      if (r && r.ok) toast('已保存：' + r.path, 4200); else toast('导出失败: ' + ((r && r.error) || '未知'));
    } catch (e) { toast('导出失败: ' + (e.message || e)); }
  });
  $('#btn-backup').addEventListener('click', async () => {
    toast('正在备份用户数据…', 4000);
    const r = await api.backupNow();
    if (r && r.ok) toast('备份完成：' + r.path + '（' + (r.copied || []).join(', ') + '）', 5000);
    else toast('备份失败: ' + ((r && r.error) || '未知'));
  });
  $('#btn-open-backup').addEventListener('click', () => api.openPath('backup'));

  // ---------------------------------------------------------------- v5：内置词库管理 / 在线更新
  let builtinDicts = [];
  let dictVisible = 60;
  let dictUpdates = [];
  let dictUpdateCheckText = '';
  function currentDictEntry() {
    const id = getCurrentDictId();
    if (!id) return null;
    return builtinDicts.find((d) => d.id === id) || null;
  }
  async function loadBuiltinDicts() {
    if (builtinDicts.length) return; // 会话内缓存，词库文件固定
    try {
      const r = await api.dictList();
      builtinDicts = (r && r.dicts) || [];
    } catch { builtinDicts = []; }
  }
  async function refreshDictManager(force) {
    const listEl = $('#dict-builtin-list');
    if (!listEl) return;
    if (!builtinDicts.length || force) {
      listEl.innerHTML = '<div class="muted">加载中…</div>';
      await loadBuiltinDicts();
    }
    renderDictManager();
  }
  function renderDictManager() {
    const listEl = $('#dict-builtin-list');
    if (!listEl) return;
    const fav = new Set(settings.dictFavorites || []);
    const recent = settings.dictRecent || {};
    const q = ($('#dict-search') ? $('#dict-search').value : '').trim().toLowerCase();
    const cat = $('#dict-cat') ? $('#dict-cat').value : 'all';
    const mode = $('#dict-mode') ? $('#dict-mode').value : 'all';
    const cur = currentDictEntry();
    let items = builtinDicts.slice();
    if (q) {
      items = items.filter((d) => [d.name, d.description, d.file, d.id, d.category, (d.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
    }
    if (cat !== 'all') items = items.filter((d) => d.category === cat);
    if (mode === 'fav') items = items.filter((d) => fav.has(d.file));
    if (mode === 'recent') items = items.filter((d) => recent[d.file]).sort((a, b) => (recent[b.file] || 0) - (recent[a.file] || 0));
    else items.sort((a, b) => {
      if (cur && a.file === cur.file) return -1;
      if (cur && b.file === cur.file) return 1;
      const fa = fav.has(a.file) ? 0 : 1, fb = fav.has(b.file) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh');
    });
    const shown = items.slice(0, dictVisible);
    if ($('#dict-count')) $('#dict-count').textContent = `共 ${builtinDicts.length} 个 · 匹配 ${items.length} 个 · 显示 ${shown.length}`;
    if ($('#dict-more')) $('#dict-more').classList.toggle('hidden', items.length <= dictVisible);
    if (!items.length) {
      listEl.innerHTML = '<div class="muted">没有匹配的词库。</div>';
      return;
    }
    listEl.innerHTML = shown.map((d) => {
      const isCur = cur && cur.file === d.file;
      const isFav = fav.has(d.file);
      const recentTs = recent[d.file];
      return `<div class="dict-row" data-file="${esc(d.file)}">
        <button class="star ${isFav ? 'on' : ''}" data-star="${esc(d.file)}" title="${isFav ? '取消收藏' : '收藏'}">${isFav ? '★' : '☆'}</button>
        <span class="nm" title="${esc(d.name)}${d.description ? ' · ' + esc(d.description) : ''}">${esc(d.name)}</span>
        ${isCur ? '<span class="cur">当前</span>' : ''}
        <span class="meta">${d.count ? d.count + ' 词' : '—'} · ${esc(d.category)}${d.size ? ' · ' + (d.size / 1024).toFixed(0) + 'KB' : ''}</span>
        <button class="btn sm ghost" data-set="${esc(d.file)}">设为当前</button>
      </div>`;
    }).join('');
    if (mode === 'recent' && !items.length) listEl.innerHTML = '<div class="muted">暂无最近使用记录（点击“设为当前”后会记录）。</div>';
    listEl.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => toggleDictFavorite(b.dataset.star)));
    listEl.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const d = builtinDicts.find((x) => x.file === b.dataset.set);
      if (d) setCurrentDict(d);
    }));
  }
  async function toggleDictFavorite(file) {
    try {
      const arr = Array.isArray(settings.dictFavorites) ? settings.dictFavorites.slice() : [];
      const i = arr.indexOf(file);
      if (i >= 0) arr.splice(i, 1); else arr.push(file);
      settings = await api.updateSettings({ dictFavorites: arr });
      renderDictManager();
      toast(i >= 0 ? '已取消收藏' : '已收藏');
    } catch (e) { toast('收藏失败：' + (e.message || e)); }
  }
  async function recordDictRecent(file) {
    try {
      const recent = { ...(settings.dictRecent || {}) };
      recent[file] = Date.now();
      const keys = Object.keys(recent).sort((a, b) => recent[b] - recent[a]).slice(0, 50);
      const trimmed = {};
      for (const k of keys) trimmed[k] = recent[k];
      settings = await api.updateSettings({ dictRecent: trimmed });
    } catch { /* ignore */ }
  }
  function findAppTrigger(keyword) {
    try {
      const els = [...document.querySelectorAll('button,[role="button"],div,span,a')];
      return els.find((el) => {
        if (el.offsetParent === null) return false;
        const t = (el.textContent || '').trim();
        const title = (el.getAttribute && el.getAttribute('title')) || '';
        return t === keyword || title === keyword || title.includes(keyword);
      });
    } catch { return null; }
  }
  async function trySwitchViaOfficialUI(entry) {
    const name = String(entry.name || '').trim();
    const clickWithPointer = (el) => {
      try {
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new MouseEvent('mousedown', o));
        el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
        el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, o, { buttons: 0 })));
        el.dispatchEvent(new MouseEvent('click', Object.assign({}, o, { buttons: 0 })));
      } catch (e) { try { el.click(); } catch { /* ignore */ } }
    };
    // 官方词库切换入口：导航栏词库名链接 → #/gallery 词库画廊
    try {
      if (!location.hash.includes('gallery')) {
        const link = document.querySelector('a[href="#/gallery"]');
        if (link) clickWithPointer(link); else location.hash = '#/gallery';
        await sleep(900);
      }
      if (!location.hash.includes('gallery')) { location.hash = '#/gallery'; await sleep(900); }
    } catch (e) { return { ok: false, error: '无法进入词库画廊: ' + (e.message || e) }; }
    const findCard = () => {
      const hs = [...document.querySelectorAll('h1')].filter((el) => el.offsetParent !== null);
      const h = hs.find((el) => (el.textContent || '').trim() === name);
      if (!h) return null;
      return h.closest('[class*="cursor-pointer"]') || h.parentElement;
    };
    let card = findCard();
    if (!card) {
      const catMap = { CET: '大学英语', '考研': '考研', '编程': 'Code', '雅思': '大学英语', '托福': '大学英语', GRE: '大学英语', '其他': '其他' };
      const wanted = catMap[entry.category] || '大学英语';
      const tabs = [...document.querySelectorAll('button,div,span,a')].filter((el) => el.offsetParent !== null
        && (el.textContent || '').trim() === wanted && /cursor-pointer|rounded|tab/i.test(String(el.className || '')));
      if (tabs.length) { clickWithPointer(tabs[tabs.length - 1]); await sleep(900); card = findCard(); }
    }
    if (!card) {
      // 子分类 chips（如 其他 → 高频词）；优先匹配标签/名称/描述，再遍历
      const mainTabs = new Set(['英语', '日语', '德语', '哈萨克语', '印尼语', 'Code', '大学英语', '考研', 'PET', '自考英语二', '其他']);
      const subEls = [...document.querySelectorAll('[class*="cursor-pointer"]')].filter((el) => {
        const t = (el.textContent || '').trim();
        return el.offsetParent !== null && t && t.length < 14 && /rounded/.test(String(el.className || '')) && !mainTabs.has(t);
      });
      const labels = [...new Set(subEls.map((el) => (el.textContent || '').trim()))];
      const prefer = labels.filter((l) => (entry.tags || []).includes(l) || (entry.name || '').includes(l) || (entry.description || '').includes(l));
      const ordered = [...prefer, ...labels.filter((l) => !prefer.includes(l))];
      for (const label of ordered) {
        const els = subEls.filter((el) => (el.textContent || '').trim() === label);
        if (!els.length) continue;
        clickWithPointer(els[els.length - 1]);
        await sleep(550);
        card = findCard();
        if (card) break;
      }
    }
    if (!card) {
      const allTabs = ['大学英语', '考研', 'PET', '自考英语二', '其他', 'Code', '日语', '德语', '哈萨克语', '印尼语', '英语'];
      for (const t of allTabs) {
        const tabs2 = [...document.querySelectorAll('button,div,span,a')].filter((el) => el.offsetParent !== null
          && (el.textContent || '').trim() === t && /cursor-pointer|rounded|tab/i.test(String(el.className || '')));
        if (!tabs2.length) continue;
        clickWithPointer(tabs2[tabs2.length - 1]);
        await sleep(700);
        card = findCard();
        if (card) break;
      }
    }
    if (!card) {
      for (let i = 0; i < 8 && !card; i++) { window.scrollBy(0, 1200); await sleep(260); card = findCard(); }
    }
    if (!card) return { ok: false, error: '词库画廊中未找到「' + name + '」' };
    try { card.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
    await sleep(200);
    clickWithPointer(card);
    await sleep(800);
    // 官方会弹出章节选择对话框（Radix Dialog），点「第 1 章」开始该词库
    let dlg = document.querySelector('[role="dialog"]');
    if (dlg) {
      const chapterEls = [...dlg.querySelectorAll('div,button,span,a')].filter((el) => el.offsetParent !== null
        && /^第\s*1\s*章/.test((el.textContent || '').trim()));
      if (chapterEls.length) {
        clickWithPointer(chapterEls[chapterEls.length - 1]);
        await sleep(1400);
      } else {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch { /* ignore */ }
        return { ok: false, error: '章节选择对话框未出现「第 1 章」' };
      }
    }
    await sleep(600);
    const cur = getCurrentDictId();
    if (entry.id && cur === entry.id) { try { window.scrollTo(0, 0); } catch { /* ignore */ } return { ok: true }; }
    await sleep(1000);
    const cur2 = getCurrentDictId();
    if (entry.id && cur2 === entry.id) { try { window.scrollTo(0, 0); } catch { /* ignore */ } return { ok: true }; }
    return { ok: false, error: '点击章节后未检测到切换（当前: ' + (cur2 || '未知') + '）' };
  }

  function isUnsafeSwitch(entry) {
    // 官方画廊卡片依赖静态 metadata.length；个别词库（如 Google 10000，length=1）数据异常，
    // 点击其画廊卡片会触发官方组件 TypeError 导致页面空白，因此跳过自动点击。
    if (!entry) return false;
    const metaLen = Number(entry.metaLength) || 0;
    const real = Number(entry.count) || 0;
    return !!(metaLen > 0 && real > 0 && metaLen < real * 0.1);
  }
  async function setCurrentDict(entry) {
    if (!entry) return;
    if (currentDictEntry() && currentDictEntry().file === entry.file) return toast('已经是当前词库');
    // v9.1：直接写官方 localStorage 状态（currentDict / learningMode / currentChapter）后重载，
    // 不再依赖官方画廊弹层的 DOM 自动化（该方式对个别词库会白屏/失败）。
    if (entry.id) {
      try {
        localStorage.setItem('currentDict', JSON.stringify(entry.id));
        localStorage.setItem('learningMode', JSON.stringify('manual'));
        localStorage.setItem('currentChapter', '0');
        try { localStorage.removeItem('reviewModeInfo'); } catch { /* ignore */ }
        await recordDictRecent(entry.file);
        toast('已切换为「' + entry.name + '」，正在重载…', 2600);
        if ($('#dict-note')) $('#dict-note').textContent = '已写入官方 currentDict=' + entry.id + '（learningMode=manual），重载后生效。';
        setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 500);
        return;
      } catch (e) {
        toast('切换失败：' + (e.message || e));
        return;
      }
    }
    await setCurrentDictViaUI(entry);
  }
  // 兼容回退：词库缺少 id 时仍走官方画廊自动化（旧路径）
  async function setCurrentDictViaUI(entry) {
    if (!entry) return;
    if (isUnsafeSwitch(entry)) {
      try { const link = document.querySelector('a[href="#/gallery"]'); if (link) link.click(); } catch { /* ignore */ }
      const msg = '「' + entry.name + '」在官方画廊中的卡片数据异常（点击可能导致页面空白），已跳过自动切换；可尝试在官方画廊手动选择，或重启应用后保持当前词库。';
      toast(msg, 8000);
      if ($('#dict-note')) $('#dict-note').textContent = '注意：' + msg;
      return;
    }
    toast('正在尝试切换词库…', 1800);
    const r = await trySwitchViaOfficialUI(entry);
    if (r && r.ok) {
      await recordDictRecent(entry.file);
      renderDictManager();
      toast('已切换为「' + entry.name + '」');
      refreshPrecacheUI();
    } else {
      try { const trg = findAppTrigger('词典切换'); if (trg) trg.click(); } catch { /* ignore */ }
      const msg = '自动切换受限：' + ((r && r.error) || '未找到可点击项') + '；已打开官方「词典切换」，请手动选择「' + entry.name + '」。';
      toast(msg, 6000);
      if ($('#dict-note')) $('#dict-note').textContent = '注意：' + msg;
    }
  }
  // —— 在线更新（逐个手动下载）——
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    return Math.max(0, Math.round(n / 1024)) + 'KB';
  }
  async function checkDictUpdatesUI() {
    const btn = $('#btn-dict-update-check');
    if (btn) btn.disabled = true;
    if ($('#dict-update-info')) $('#dict-update-info').textContent = '正在从 GitHub 检查更新…（比较名称 + 大小/SHA）';
    try {
      const r = await api.dictCheckUpdates();
      if (!r || !r.ok) {
        if ($('#dict-update-info')) $('#dict-update-info').textContent = '检查失败：' + ((r && r.error) || '未知错误');
        return;
      }
      dictUpdates = r.changes || [];
      dictUpdateCheckText = `远端 ${r.remoteTotal} 个词库 · 新增 ${r.newCount} · 有更新 ${r.updatedCount}`;
      if ($('#dict-update-info')) $('#dict-update-info').textContent = dictUpdateCheckText + (dictUpdates.length ? '（只在你点「下载」后才下载对应文件）' : '');
      renderUpdateList();
    } catch (e) {
      if ($('#dict-update-info')) $('#dict-update-info').textContent = '检查失败：' + (e.message || e);
    } finally { if (btn) btn.disabled = false; }
  }
  function renderUpdateList() {
    const box = $('#dict-update-list');
    if (!box) return;
    if (!dictUpdates.length) {
      box.innerHTML = '<div class="muted">没有发现新增或有更新的词库。</div>';
      return;
    }
    const shown = dictUpdates.slice(0, 100);
    box.innerHTML = shown.map((c, i) => `<div class="upd-row">
      <span class="${c.status === 'new' ? 'tag-new' : 'tag-upd'}">${c.status === 'new' ? '新增' : '更新'}</span>
      <span class="nm" title="${esc(c.name)}">${esc(c.name)}</span>
      <span class="sz">${fmtSize(c.remoteSize)}</span>
      <button class="btn sm" data-dl="${i}">下载</button></div>`).join('') +
      (dictUpdates.length > 100 ? `<div class="muted">仅显示前 100 条，共 ${dictUpdates.length} 条</div>` : '');
    box.querySelectorAll('[data-dl]').forEach((btn) => btn.addEventListener('click', () => downloadOneUpdate(Number(btn.dataset.dl), btn)));
  }
  async function downloadOneUpdate(i, btn) {
    const c = dictUpdates[i];
    if (!c || dictUpdating) return;
    dictUpdating = true;
    btn.disabled = true;
    btn.textContent = '下载中…';
    const wrap = $('#dict-upd-progress-wrap'), bar = $('#dict-upd-progress');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.style.width = '35%';
    try {
      const r = await api.dictDownloadUpdate(c.name, c.downloadUrl);
      if (bar) bar.style.width = '100%';
      if (r && r.ok) {
        btn.textContent = '已下载';
        btn.classList.add('primary');
        toast(`已下载 ${c.name}（${fmtSize(r.size)}，来源 ${String(r.url).includes('jsdelivr') ? 'jsdelivr' : 'raw.githubusercontent'}）`, 4500);
        await refreshUpdateInfo();
      } else {
        btn.disabled = false;
        btn.textContent = '重试';
        toast('下载失败：' + ((r && r.error) || '未知'));
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '重试';
      toast('下载失败：' + (e.message || e));
    } finally {
      dictUpdating = false;
      if (bar) setTimeout(() => { bar.style.width = '0%'; if (wrap) wrap.classList.add('hidden'); }, 800);
    }
  }
  async function refreshUpdateInfo() {
    const el = $('#dict-update-downloaded');
    if (!el) return;
    try {
      const r = await api.dictUpdateInfo();
      if (r && r.ok && r.files.length) {
        el.textContent = '已下载更新 ' + r.files.length + ' 个：' + r.files.slice(0, 6).map((f) => f.file.replace(/\.json$/i, '')).join('、') + (r.files.length > 6 ? ' …' : '') + '（重启应用或切换词库后生效）';
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    } catch { /* ignore */ }
  }
  if ($('#dict-search')) $('#dict-search').addEventListener('input', () => { dictVisible = 60; renderDictManager(); });
  if ($('#dict-mode')) $('#dict-mode').addEventListener('change', () => { dictVisible = 60; renderDictManager(); });
  if ($('#dict-cat')) $('#dict-cat').addEventListener('change', () => { dictVisible = 60; renderDictManager(); });
  if ($('#dict-reset-filter')) $('#dict-reset-filter').addEventListener('click', () => {
    if ($('#dict-search')) $('#dict-search').value = '';
    if ($('#dict-mode')) $('#dict-mode').value = 'all';
    if ($('#dict-cat')) $('#dict-cat').value = 'all';
    dictVisible = 60;
    renderDictManager();
  });
  if ($('#dict-more')) $('#dict-more').addEventListener('click', () => { dictVisible += 80; renderDictManager(); });
  if ($('#btn-dict-update-check')) $('#btn-dict-update-check').addEventListener('click', checkDictUpdatesUI);
  if ($('#btn-dict-update-dir')) $('#btn-dict-update-dir').addEventListener('click', () => api.dictOpenUpdateDir());
  if ($('#btn-dict-update-clear')) $('#btn-dict-update-clear').addEventListener('click', async () => {
    if (!confirm('确定清空已下载的词库更新文件？（恢复到 asar 内置版本，不影响应用数据）')) return;
    const r = await api.dictClearUpdates();
    toast(r && r.ok ? '已清空更新文件' : '清空失败');
    dictUpdates = [];
    renderUpdateList();
    refreshUpdateInfo();
  });
  if ($('#btn-dict-relaunch')) $('#btn-dict-relaunch').addEventListener('click', async () => {
    if (!confirm('重启应用使更新文件生效？')) return;
    await api.relaunchApp();
  });

  // ---------------------------------------------------------------- 自定义词库 UI
  let dictCache = [];
  async function refreshDictUI() {
    try {
      const db = await getPlusDB();
      dictCache = db ? await idbAll(db, 'dicts') : [];
    } catch { dictCache = []; }
    const box = $('#dict-list');
    if (!box) return;
    if (!dictCache.length) { box.innerHTML = '<div class="muted">暂无，先导入一个词库。</div>'; return; }
    box.innerHTML = dictCache.map((d) => `
      <div class="item">
        <div class="grow"><div class="nm">${esc(d.name)}</div><div class="cnt">${fmtNum((d.words || []).length)} 词 · ${tsText(d.createdAt)}</div></div>
        <button class="btn sm primary" data-memory="${esc(d.name)}">记忆曲线</button>
        <button class="btn sm ghost" data-export="${esc(d.name)}">导出</button>
        <button class="btn sm ghost" data-del="${esc(d.name)}">删除</button>
      </div>`).join('');
    box.querySelectorAll('[data-memory]').forEach((b) => b.addEventListener('click', () => startCustomMemory(b.dataset.memory)));
    box.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportDict(b.dataset.export)));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('确定删除词库「' + b.dataset.del + '」？')) return;
      const db = await getPlusDB();
      if (db) await idbDelete(db, 'dicts', b.dataset.del);
      await refreshDictUI();
      toast('已删除');
    }));
  }
  async function exportDict(name) {
    const d = dictCache.find((x) => x.name === name);
    if (!d) return;
    const r = await api.exportJSON(`qwerty-词库-${name}.json`, JSON.stringify(d.words, null, 2));
    if (r && r.ok) toast('已导出到 ' + r.path);
  }
  // v8.4：把插件导入的自定义词库交给主练习流程（记忆曲线），通过 localStorage 桥接后重载
  async function startCustomMemory(name) {
    const d = dictCache.find((x) => x.name === name);
    if (!d || !Array.isArray(d.words) || !d.words.length) return toast('词库为空');
    const words = d.words
      .filter((w) => w && w.name)
      .map((w) => ({
        name: String(w.name),
        trans: Array.isArray(w.trans) ? w.trans : (w.trans ? [String(w.trans)] : []),
        usphone: w.usphone || '',
        ukphone: w.ukphone || '',
      }));
    try {
      localStorage.setItem('qzCustomDict', JSON.stringify({ name, words }));
      localStorage.setItem('learningMode', JSON.stringify('custom'));
    } catch (e) { return toast('写入失败：' + (e.message || e)); }
    toast('已切换为自定义词库「' + name + '」，正在进入记忆曲线…', 3000);
    closePanel();
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 600);
  }
  $('#btn-import').addEventListener('click', async () => {
    const fileInput = $('#file-dict');
    const f = fileInput.files && fileInput.files[0];
    if (!f) return toast('请先选择文件');
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'json', 'txt'].includes(ext)) return toast('仅支持 CSV / JSON / TXT');
    try {
      const text = await f.text();
      const words = parseImportText(text, ext);
      if (!words.length) return toast('未解析到有效单词');
      const name = ($('#in-dict-name').value || '').trim() || f.name.replace(/\.[^.]+$/, '');
      const db = await getPlusDB();
      if (!db) return toast('本地数据库不可用');
      await idbPut(db, 'dicts', { name, words, createdAt: Date.now() });
      $('#lbl-import').textContent = `已导入「${name}」：${words.length} 个词。`;
      fileInput.value = '';
      await refreshDictUI();
      toast(`导入成功：${name}（${words.length} 词）`);
    } catch (e) { toast('导入失败: ' + (e.message || e)); }
  });

  // v8：键位热力图 / 慢词 / 错误键全部改由 RecordDB.wordRecords 计算（只读）
  async function refreshKeyboardUI() {
    const heat = $('#kb-heat');
    if (!heat) return;
    const { wordRecords } = await readRecordInsights();
    const charStats = new Map(); // key -> { hits, errors, delaySum, delayN }
    const wordStats = new Map(); // word -> { word, totalMs, n }
    const normKey = (ch) => {
      const s = String(ch || '');
      if (!s) return '';
      if (s === ' ') return ' ';
      const up = s.toUpperCase();
      return up.length === 1 ? up : s;
    };
    for (const r of wordRecords) {
      const word = String(r.word || '');
      const letters = [...word];
      const timing = Array.isArray(r.timing) ? r.timing : [];
      let totalMs = 0;
      letters.forEach((ch, i) => {
        const k = normKey(ch);
        if (!k) return;
        const rec = charStats.get(k) || { hits: 0, errors: 0, delaySum: 0, delayN: 0 };
        rec.hits += 1;
        const d = timing[i - 1];
        if (isFinite(d) && d > 0) { rec.delaySum += d; rec.delayN += 1; totalMs += d; }
        charStats.set(k, rec);
      });
      const mis = r.mistakes && typeof r.mistakes === 'object' ? r.mistakes : {};
      for (const [idx, wrongs] of Object.entries(mis)) {
        const ch = letters[Number(idx)];
        if (!ch) continue;
        const k = normKey(ch);
        if (!k) continue;
        const rec = charStats.get(k) || { hits: 0, errors: 0, delaySum: 0, delayN: 0 };
        rec.errors += Array.isArray(wrongs) ? wrongs.length : 1;
        charStats.set(k, rec);
      }
      if (word) {
        const prev = wordStats.get(word) || { word, totalMs: 0, n: 0 };
        prev.totalMs += totalMs;
        prev.n += 1;
        wordStats.set(word, prev);
      }
    }
    const rowDefs = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL;', 'ZXCVBNM,./'];
    heat.innerHTML = rowDefs.map((row) => `<div class="kb-row">${[...row].map((ch) => {
      const rec = charStats.get(ch) || { hits: 0, errors: 0, delaySum: 0, delayN: 0 };
      const rate = rec.hits ? rec.errors / rec.hits : 0;
      const avgDelay = rec.delayN ? Math.round(rec.delaySum / rec.delayN) : 0;
      const bg = rec.errors ? `rgba(129,140,248,${(0.25 + 0.65 * Math.min(1, rate * 2)).toFixed(2)})` : (rec.hits ? 'rgba(148,163,184,.18)' : 'var(--qz-track)');
      const tip = `${ch} · 错误 ${rec.errors}/${rec.hits}${avgDelay ? ` · 平均 ${avgDelay}ms` : ''}`;
      return `<div class="kb-key${rec.errors ? ' has-err' : ''}" style="background:${bg}" title="${esc(tip)}">${esc(ch)}${rec.errors ? `<span class="n">${rec.errors}</span>` : ''}</div>`;
    }).join('')}</div>`).join('') + '<div class="kb-row"><div class="kb-key wide" title="空格键（来自 RecordDB）">空格</div></div>';

    const slow = [...wordStats.values()].filter((w) => w.n > 0 && w.totalMs > 0).sort((a, b) => b.totalMs / b.n - a.totalMs / a.n).slice(0, 10);
    const slowEl = $('#slow-list');
    if (slowEl) {
      slowEl.innerHTML = slow.length
        ? slow.map((w) => `<div class="list-row"><span class="k">${esc(w.word)}</span><span class="v">${Math.round(w.totalMs / w.n)} ms · ${w.n} 次</span></div>`).join('')
        : '<div class="muted">暂无数据（先练习）</div>';
    }
    const errKeys = [...charStats.entries()].filter(([, rec]) => rec.errors > 0).sort((a, b) => b[1].errors - a[1].errors).slice(0, 10);
    const errEl = $('#errkey-list');
    if (errEl) {
      errEl.innerHTML = errKeys.length
        ? errKeys.map(([k, rec]) => `<div class="list-row"><span class="k">${esc(k)}</span><span class="v">错 ${rec.errors} · 错误率 ${rec.hits ? Math.round((rec.errors / rec.hits) * 100) : 0}%</span></div>`).join('')
        : '<div class="muted">暂无错误键数据</div>';
    }
  }
  // ---------------------------------------------------------------- 番茄钟
  const pomo = {
    mode: 'focus', running: false, remain: (settings.pomodoroFocus || 25) * 60,
    total: (settings.pomodoroFocus || 25) * 60, timer: null, today: TODAY(), count: 0,
  };
  function pomoFormat(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function pomoRender() {
    const timeEl = $('#pomo-time'), modeEl = $('#pomo-mode'), ring = $('#pomo-ring');
    if (!timeEl) return;
    timeEl.textContent = pomoFormat(pomo.remain);
    modeEl.textContent = pomo.mode === 'focus' ? '专注' : '休息';
    const pct = pomo.total > 0 ? 1 - pomo.remain / pomo.total : 0;
    const deg = Math.round(pct * 360);
    ring.style.background = `conic-gradient(var(--qz-accent, #818cf8) ${deg}deg, var(--qz-track, #e2e8f0) ${deg}deg)`;
    $('#pomo-count').textContent = pomo.count;
    const btn = $('#pomo-start');
    if (btn) btn.textContent = pomo.running ? '暂停' : '开始';
  }
  function pomoTick() {
    if (!pomo.running) return;
    pomo.remain = Math.max(0, pomo.remain - 1);
    pomoRender();
    if (pomo.remain <= 0) {
      pomo.running = false;
      if (pomo.mode === 'focus') {
        pomo.count++;
        api.notify('🍅 专注结束', '休息 ' + (settings.pomodoroBreak || 5) + ' 分钟吧！');
        pomo.mode = 'break'; pomo.total = (settings.pomodoroBreak || 5) * 60; pomo.remain = pomo.total;
      } else {
        api.notify('☕ 休息结束', '开始下一个专注段吧！');
        pomo.mode = 'focus'; pomo.total = (settings.pomodoroFocus || 25) * 60; pomo.remain = pomo.total;
      }
      pomoRender();
    }
  }
  function pomoStart() {
    if (pomo.running) { pomo.running = false; clearInterval(pomo.timer); pomoRender(); return; }
    pomo.running = true;
    pomo.timer = setInterval(pomoTick, 1000);
    pomoRender();
  }
  $('#pomo-start').addEventListener('click', pomoStart);
  $('#pomo-reset').addEventListener('click', () => {
    pomo.running = false; clearInterval(pomo.timer);
    pomo.mode = 'focus'; pomo.total = (settings.pomodoroFocus || 25) * 60; pomo.remain = pomo.total; pomoRender();
  });
  $('#pomo-skip').addEventListener('click', () => { pomo.remain = 0; pomoTick(); });
  $('#pomo-focus').addEventListener('change', async () => {
    const v = clamp(parseInt($('#pomo-focus').value, 10) || 25, 5, 90);
    settings = await api.updateSettings({ pomodoroFocus: v });
    if (pomo.mode === 'focus' && !pomo.running) { pomo.total = v * 60; pomo.remain = v * 60; pomoRender(); }
  });
  $('#pomo-break').addEventListener('change', async () => {
    const v = clamp(parseInt($('#pomo-break').value, 10) || 5, 1, 30);
    settings = await api.updateSettings({ pomodoroBreak: v });
    if (pomo.mode === 'break' && !pomo.running) { pomo.total = v * 60; pomo.remain = v * 60; pomoRender(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter' && panelOpen) { e.preventDefault(); pomoStart(); }
  });

  // ---------------------------------------------------------------- 免费释义 / 整句翻译 / 逐词悬停
  let currentDictId = '';
  function getCurrentDictId() {
    try {
      const raw = localStorage.getItem('currentDict');
      if (raw) {
        let v = raw;
        try {
          const j = JSON.parse(raw);
          if (typeof j === 'string') v = j;
          else if (j && typeof j === 'object') v = j.id || j.dict || j.value || '';
        } catch { /* 非 JSON，原样使用 */ }
        currentDictId = String(v || '').replace(/^"|"$/g, '').slice(0, 80);
      }
    } catch { /* ignore */ }
    return currentDictId;
  }
  const pronUrl = (w) => 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(w || '').trim()) + '&type=2';
  function playPron(w, silent) {
    const word = String(w || '').trim();
    if (!word) return;
    try {
      const a = new Audio(pronUrl(word));
      a.volume = 1;
      a.play().catch(() => { if (!silent) toast('发音播放失败（可能被网络或音频策略拦截）'); });
    } catch (e) { if (!silent) toast('发音播放失败'); }
  }
  let hoverTimer = null, hoverHideTimer = null;
  const hoverCache = new Map();
  function tipBox() { return $('#qz-tooltip'); }
  function hideTooltip() {
    const el = tipBox();
    if (!el) return;
    el.classList.remove('show');
  }
  function showTooltip(word, text, rect, opts = {}) {
    const el = tipBox();
    if (!el) return;
    el.innerHTML = `<div class="tw">${esc(word)}</div><div class="tt">${esc(text)}</div>${opts.offline ? '<div class="toff">离线 / 缓存</div>' : ''}<div class="ts">点击单词可发音</div>`;
    el.classList.add('show');
    const elRect = el.getBoundingClientRect();
    let x = rect.left;
    let y = rect.top - elRect.height - 8;
    if (y < 8) y = rect.bottom + 8;
    if (x + elRect.width > window.innerWidth - 8) x = window.innerWidth - elRect.width - 8;
    if (x < 8) x = 8;
    if (y + elRect.height > window.innerHeight - 8) y = window.innerHeight - elRect.height - 8;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  function splitWordsHTML(sentence) {
    const s = String(sentence || '');
    let out = '', last = 0;
    const re = /[A-Za-z][A-Za-z'’-]*/g;
    let m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      out += `<span class="wc-w" data-w="${esc(m[0])}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }
  const wordCard = { word: '', data: null, transCache: new Map() };
  function closeWordCard() {
    const root = $('#qz-wordcard-root');
    if (root) root.innerHTML = '';
    wordCard.data = null;
    hideTooltip();
  }
  async function openWordCard(rawWord) {
    const word = String(rawWord || '').trim();
    if (!word) return toast('请输入单词或短语');
    wordCard.word = word;
    wordCard.data = null;
    wordCard.transCache = new Map();
    const root = $('#qz-wordcard-root');
    root.innerHTML = `<div class="wordcard-mask" id="wc-mask"><div class="wordcard">
      <div class="wc-head"><div><div class="wc-word">${esc(word)}</div><div class="wc-ph" id="wc-ph"></div><div class="wc-src" id="wc-src"></div></div>
        <button class="wc-close" id="wc-close" title="关闭">✕</button></div>
      <div id="wc-body"><div class="wc-loading">查询中…（本地词库 + 有道 + dictionaryapi）</div></div></div></div>`;
    $('#wc-mask').addEventListener('click', (e) => { if (e.target.id === 'wc-mask') closeWordCard(); });
    $('#wc-close').addEventListener('click', closeWordCard);
    let r;
    try { r = await api.freeLookup(word, getCurrentDictId()); }
    catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (!r || !r.ok) {
      $('#wc-body').innerHTML = `<div class="wc-loading">${esc((r && r.error) || '未找到释义')}</div>
        <div class="wc-actions"><button class="btn sm ghost" id="wc-retry">重试</button></div>`;
      const btn = $('#wc-retry'); if (btn) btn.addEventListener('click', () => openWordCard(word));
      if (r && r.offline) $('#wc-body').insertAdjacentHTML('afterbegin', '<div class="wc-offline">当前处于离线模式或网络不可用，仅显示本地词库/缓存。</div>');
      return;
    }
    wordCard.data = r;
    renderWordCard(r);
  }
  function renderWordCard(r) {
    const ph = $('#wc-ph'), src = $('#wc-src'), body = $('#wc-body');
    if (!body) return;
    const phones = [];
    if (r.usphone) phones.push('美 [' + r.usphone + ']');
    if (r.ukphone) phones.push('英 [' + r.ukphone + ']');
    if (!phones.length && r.phonetic) phones.push(r.phonetic);
    if (ph) ph.textContent = phones.join('  ') || '';
    if (src) {
      const badges = (r.sources || []).map((s) => `<span class="wc-badge">${esc(s)}</span>`).join('');
      src.innerHTML = (badges || '') + (r.cached ? '<span class="wc-badge">缓存</span>' : '') + (r.offline ? '<span class="wc-badge">离线</span>' : '');
    }
    let html = '';
    if (r.offline) html += '<div class="wc-offline">离线 / 网络受限：仅显示本地词库与缓存结果。</div>';
    if (r.zhLines && r.zhLines.length) {
      html += '<div class="wc-sec"><h5>中文释义</h5><div class="wc-zh">' +
        r.zhLines.map((x) => `${esc(x.text)}<span class="src">[${esc(x.source || '')}]</span>`).join('<br>') + '</div></div>';
    }
    if (r.defs && r.defs.length) {
      html += '<div class="wc-sec"><h5>英文释义</h5><div>' +
        r.defs.map((d) => `<div class="wc-def"><b>${esc(d.pos || '')}</b> ${esc(d.def || '')}</div>`).join('') + '</div></div>';
    }
    if (r.examples && r.examples.length) {
      const exSrc = r.examplesSource === '本地例句库' ? ' · 原句来自本地例句库' : '';
      html += '<div class="wc-sec"><h5>例句（悬停单词看释义 · 点击发音）' + exSrc + '</h5>' +
        r.examples.map((ex, i) => `<div class="wc-ex"><div class="sen">${splitWordsHTML(ex)}</div>
          <div class="wc-actions"><button class="btn sm ghost" data-tr="${i}">翻译整句</button>
          <span class="muted" style="font-size:10.5px">整句翻译由 MyMemory 提供（免 Key）</span></div>
          <div class="tr" id="wc-tr-${i}"></div></div>`).join('') + '</div>';
    } else {
      html += '<div class="wc-sec"><div class="muted">暂无英文例句（dictionaryapi 未收录该词，或当前为离线模式）。</div></div>';
    }
    if (r.synonyms && r.synonyms.length) {
      html += '<div class="wc-sec"><h5>同义词</h5><div class="wc-syn">' +
        r.synonyms.map((s) => `<span data-syn="${esc(s)}">${esc(s)}</span>`).join('') + '</div></div>';
    }
    html += `<div class="wc-actions" style="margin-top:16px">
      <button class="btn primary sm" id="wc-pron">🔊 发音</button>
      <button class="btn sm ghost" id="wc-copy">复制单词</button>
      <span class="muted" style="font-size:10.5px">数据来源：本地词库 / 有道 suggest / dictionaryapi.dev / MyMemory，全部免 Key</span>
    </div>`;
    body.innerHTML = html;
    // 绑定：例句单词 hover + 点击发音
    body.querySelectorAll('.wc-w').forEach((sp) => {
      const w = sp.dataset.w;
      sp.addEventListener('mouseenter', () => {
        if (hoverTimer) clearTimeout(hoverTimer);
        const rect = sp.getBoundingClientRect();
        hoverTimer = setTimeout(async () => {
          hoverTimer = null;
          const key = w.toLowerCase();
          if (hoverCache.has(key)) { showTooltip(w, hoverCache.get(key), rect); return; }
          showTooltip(w, '查询中…', rect);
          let text = '', offline = false;
          try {
            const hr = await api.freeHover(w, getCurrentDictId());
            if (hr && hr.ok && hr.text) { text = hr.text; hoverCache.set(key, text); }
            else if (hr && hr.offline) offline = true;
          } catch { offline = true; }
          showTooltip(w, text || (offline ? '离线：暂无缓存释义' : '暂无该词释义'), rect, { offline });
        }, 300);
      });
      sp.addEventListener('mouseleave', () => {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (hoverHideTimer) clearTimeout(hoverHideTimer);
        hoverHideTimer = setTimeout(hideTooltip, 120);
      });
      sp.addEventListener('click', () => playPron(w));
    });
    // 绑定：翻译整句
    body.querySelectorAll('[data-tr]').forEach((btn) => {
      btn.addEventListener('click', () => translateExample(Number(btn.dataset.tr), btn));
    });
    // 绑定：同义词点击查词
    body.querySelectorAll('[data-syn]').forEach((el) => {
      el.addEventListener('click', () => openWordCard(el.dataset.syn));
    });
    const pron = $('#wc-pron'); if (pron) pron.addEventListener('click', () => playPron(r.word || wordCard.word));
    const copy = $('#wc-copy'); if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(r.word || wordCard.word); toast('已复制：' + (r.word || wordCard.word)); }
      catch { toast('复制失败'); }
    });
  }
  async function translateExample(idx, btn) {
    if (!wordCard.data) return;
    const tr = $('#wc-tr-' + idx);
    const sentence = (wordCard.data.examples || [])[idx];
    if (!tr || !sentence) return;
    if (tr.dataset.open === '1') {
      tr.dataset.open = '0';
      tr.textContent = '';
      tr.classList.remove('loading');
      btn.textContent = '翻译整句';
      return;
    }
    if (wordCard.transCache.has(idx)) {
      tr.textContent = wordCard.transCache.get(idx);
      tr.dataset.open = '1';
      btn.textContent = '收起翻译';
      return;
    }
    tr.className = 'tr loading';
    tr.textContent = '翻译中…';
    btn.disabled = true;
    try {
      const r = await api.freeTranslate(sentence);
      if (r && r.ok) {
        const shown = r.text + (r.source && r.source !== 'cache' ? '  — ' + r.source : '');
        wordCard.transCache.set(idx, shown);
        tr.className = 'tr';
        tr.textContent = shown;
        tr.dataset.open = '1';
        btn.textContent = '收起翻译';
      } else {
        tr.className = 'tr';
        tr.textContent = (r && r.error) || '翻译失败';
        toast((r && r.error) || '翻译失败');
      }
    } catch (e) {
      tr.className = 'tr';
      tr.textContent = '翻译失败：' + (e.message || e);
    } finally { btn.disabled = false; }
  }
  $('#btn-word-lookup').addEventListener('click', () => openWordCard($('#in-word').value));
  $('#in-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openWordCard($('#in-word').value); } });
  $('#btn-free-clear').addEventListener('click', async () => {
    const r = await api.freeClear();
    toast(r && r.ok ? '释义/翻译缓存已清空' : '清空失败');
    refreshToolsUI();
  });
  $('#btn-ecdict').addEventListener('click', async () => { const r = await api.freeEcdict(); toast((r && r.error) || '当前版本未启用 ECDICT'); });

  async function refreshToolsUI() {
    try {
      const st = await api.pronStats();
      $('#pron-stat').textContent = st && st.ok ? `${st.count} 个音频 · ${(st.bytes / 1048576).toFixed(1)} MB` : '不可用';
    } catch { /* ignore */ }
    try {
      const fs = await api.freeStats();
      $('#free-cache-stat').textContent = fs && fs.ok
        ? `单词 ${fs.words} 条 · 整句 ${fs.sentences} 条 · ${(fs.bytes / 1024).toFixed(0)} KB`
        : '不可用';
    } catch { /* ignore */ }
    try {
      const s = await api.getSettings();
      if (s) { settings = s; syncControls(); }
      $('#pomo-focus').value = settings.pomodoroFocus || 25;
      $('#pomo-break').value = settings.pomodoroBreak || 5;
    } catch { /* ignore */ }
    refreshPrecacheUI();
    pomoRender();
  }

  // ---------------------------------------------------------------- v5：发音预缓存（当前词库）
  let precacheState = null;
  async function refreshPrecacheUI() {
    const dictEl = $('#pc-dict');
    if (!dictEl) return;
    await loadBuiltinDicts();
    const entry = currentDictEntry();
    const cacheEl = $('#pc-cache'), estEl = $('#pc-est');
    try {
      const st = await api.pronStats();
      if (cacheEl) cacheEl.textContent = st && st.ok ? `已缓存 ${st.count} 个音频 · ${(st.bytes / 1048576).toFixed(1)} MB` : '缓存统计不可用';
    } catch { /* ignore */ }
    if (!entry) {
      dictEl.textContent = '未识别当前词库（请先在应用内选择词库）';
      if (estEl) estEl.textContent = '';
      renderPrecacheUI(precacheState);
      return;
    }
    dictEl.textContent = `${entry.name} · ${entry.count || '?'} 词 · ${entry.file}`;
    const limit = Math.max(0, Number($('#pc-limit') ? $('#pc-limit').value : 0) || 0);
    const count = limit > 0 ? Math.min(limit, entry.count || limit) : (entry.count || 0);
    if (estEl) estEl.textContent = `预计下载 ${count} 个音频 · 约 ${(count * 14 / 1024).toFixed(1)} MB（单条约 14KB，仅补缺失可续传）`;
    try {
      const s = await api.precacheStatus();
      if (s && s.ok) { precacheState = s; renderPrecacheUI(s); }
      else renderPrecacheUI(null);
    } catch { renderPrecacheUI(null); }
  }
  function renderPrecacheUI(s) {
    const bar = $('#pc-bar'), status = $('#pc-status'), failEl = $('#pc-fail');
    const btnStart = $('#pc-start'), btnPause = $('#pc-pause'), btnResume = $('#pc-resume'), btnCancel = $('#pc-cancel');
    if (!bar || !status) return;
    if (!s || !s.ok) {
      bar.style.width = '0%';
      status.textContent = '未开始';
      if (failEl) failEl.textContent = '';
      if (btnStart) btnStart.disabled = false;
      if (btnPause) btnPause.disabled = true;
      if (btnResume) btnResume.disabled = true;
      if (btnCancel) btnCancel.disabled = true;
      return;
    }
    const total = s.total || 0;
    const done = Math.min(total, s.done || 0);
    bar.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';
    let text = `${s.finished ? '已结束（' + (s.cancelled ? '取消' : '完成') + '）' : (s.paused ? '已暂停' : '进行中')}：${done}/${total} · 成功 ${s.okCount || 0} · 失败 ${s.failCount || 0} · 跳过已缓存 ${s.skipped || 0}`;
    if (s.dictFile) text += ` · ${s.dictFile.replace(/\.json$/i, '')}`;
    status.textContent = text;
    if (failEl) {
      failEl.textContent = (s.failures && s.failures.length)
        ? '失败示例：' + s.failures.slice(0, 8).map((f) => `${f.word}(${f.error})`).join('；')
        : '';
    }
    if (btnStart) btnStart.disabled = !s.finished;
    if (btnPause) btnPause.disabled = !(!s.finished && !s.paused);
    if (btnResume) btnResume.disabled = !(!s.finished && s.paused);
    if (btnCancel) btnCancel.disabled = !!s.finished;
  }
  api.onPrecacheProgress((p) => {
    precacheState = p;
    renderPrecacheUI(p);
    if (p && p.finished) {
      refreshPrecacheUI();
      if (p.failCount) toast(`发音预缓存结束：成功 ${p.okCount}，失败 ${p.failCount}`, 4500);
      else toast(`发音预缓存完成：${p.okCount} 个（跳过已缓存 ${p.skipped || 0} 个）`, 4500);
    }
  });
  if ($('#pc-start')) $('#pc-start').addEventListener('click', async () => {
    await loadBuiltinDicts();
    const entry = currentDictEntry();
    if (!entry) return toast('未识别当前词库，请先在应用内选择词库');
    const type = $('#pc-type') ? $('#pc-type').value : 'us';
    const limit = Number($('#pc-limit') ? $('#pc-limit').value : 0) || 0;
    const r = await api.precacheStart({ dictFile: entry.file, type, limit });
    if (!r || !r.ok) return toast('启动失败：' + ((r && r.error) || '未知'));
    if (r.total === 0) return toast(r.message || '所选范围已全部缓存');
    toast(`开始预缓存「${entry.name}」：${r.total} 个音频（跳过已缓存 ${r.skipped || 0}）`, 4500);
    precacheState = await api.precacheStatus();
    renderPrecacheUI(precacheState);
  });
  if ($('#pc-pause')) $('#pc-pause').addEventListener('click', async () => { const s = await api.precachePause(); if (s) { precacheState = s; renderPrecacheUI(s); } });
  if ($('#pc-resume')) $('#pc-resume').addEventListener('click', async () => {
    const s = await api.precacheResume();
    if (s && s.ok === false) toast(s.error || '无法继续');
    else { precacheState = s; renderPrecacheUI(s); }
  });
  if ($('#pc-cancel')) $('#pc-cancel').addEventListener('click', async () => { const s = await api.precacheCancel(); if (s) { precacheState = s; renderPrecacheUI(s); } });

  $('#btn-pron-clear').addEventListener('click', async () => {
    const r = await api.clearPronCache();
    toast(r && r.ok ? '发音缓存已清空' : '清空失败');
    refreshToolsUI();
  });
  $('#btn-open-plus').addEventListener('click', () => api.openPath('plus'));
  $('#btn-open-log').addEventListener('click', () => api.openPath('log'));
  $('#btn-open-data').addEventListener('click', () => api.openPath('data'));

  // ---------------------------------------------------------------- 键音 B9
  let audioCtx = null;
  document.addEventListener('keydown', (e) => {
    if (!settings.keySound) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (!/^[a-zA-Z0-9 ,.;'\-]$/.test(e.key || '')) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1500 + Math.random() * 500, t);
      gain.gain.setValueAtTime((settings.keySoundVolume == null ? 0.25 : settings.keySoundVolume) * 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.04);
    } catch { /* ignore */ }
  }, true);

  // ---------------------------------------------------------------- 初始化
  async function init() {
    try {
      const s = await api.getSettings();
      if (s) settings = s;
    } catch { /* ignore */ }
    applyTheme();
    syncControls();
    // v4：auto 外观跟随应用 html.dark 变化（含应用自身切换深色）
    try {
      new MutationObserver(() => {
        if ((settings.panelAppearance || 'auto') === 'auto') applyPanelTheme();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch { /* ignore */ }
    applyPanelTheme();
    if (settings.miniMode) { document.body.classList.add('qz-mini'); panel.classList.add('mini'); }
    // 上报一次进度（A9）
    await pushStats();
    setInterval(pushStats, 60000);
    // 预加载词库列表与面板数据
    refreshDictUI().catch(() => {});
    refreshWrongbookUI().catch(() => {});
    renderStatsToPanel(appStats || { today: TODAY(), words: 0, goal: settings.dailyGoal, streak: 0, ratio: 0, totalWords: 0, wrongWords: [], heat: [], source: 'none' });
    pomoRender();
    console.log('[QZ-ENHANCE] UI injected, version', settings.version || APP_VERSION);
  }
  init();

  // v8.9：主进程备份时收集逻辑快照（RecordDB 全 store + 自定义词库 + localStorage + 设置）
  if (api.onBackupRequest) api.onBackupRequest(handleBackupRequest);

  // 剪贴板查词在主窗口事件（小窗自己处理，这里仅提示）
  api.onClipboardWord((word) => {
    if (document.getElementById('qz-enhance-host')) {
      // 主窗口收到时给个提示（小窗已独立展示）
      toast('剪贴板查词: ' + word, 3000);
    }
  });
})();
