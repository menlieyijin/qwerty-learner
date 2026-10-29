/**
 * v9.3 仿真公共 harness：固定时区 / 固定时钟 / 可复现随机 / localStorage & fetch 注入 / 断言与报告。
 *
 * 设计要点：
 * - 仿真对象是 `_v93-core.mjs`（由 _v93-build-core.mjs 从 **真实 src** esbuild 打包，见该脚本注释），
 *   本文件只负责提供浏览器环境替身，不复制/改写任何算法。
 * - 每个场景通过 `freshCore()` 动态 import 带 cache-busting 查询串的 bundle 副本，
 *   等价于「新进程/应用重启」：Dexie 内存表、词表缓存、requeue 队列、迁移标记 promise 全部重置。
 * - 本地时区固定 Asia/Shanghai（+08:00，无夏令时），并在 meta 中断言 timezoneOffset === -480。
 * - 随机数固定 seed（mulberry32），保证 --strict 可重复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const AUDIT_DIR = import.meta.dirname
export const CORE_PATH = path.join(AUDIT_DIR, '_v93-core.mjs')

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
/** 仿真本地时区（分钟）：+08:00 */
export const TZ_OFFSET_MIN = 480
/** 固定仿真纪元：2026-01-01T00:00:00Z = 本地 +08:00 的 08:00:00 */
export const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0)
export const FIXED_SEED = 20261026

// ---------------------------------------------------------------------------
// 固定时区（必须在任何 Date 计算前生效；Windows 下运行时改 TZ 可能不生效，故做断言）
// ---------------------------------------------------------------------------
process.env.TZ = 'Asia/Shanghai'

// ---------------------------------------------------------------------------
// 可注入时钟：整个进程统一覆盖 Date.now()
// ---------------------------------------------------------------------------
export const clock = { now: BASE_TS }
const realDateNow = Date.now.bind(Date)
Date.now = () => clock.now

export function setNow(ts) {
  clock.now = ts
  return clock.now
}
export function advanceBy(ms) {
  clock.now += ms
  return clock.now
}
export function resetClock(ts = BASE_TS) {
  clock.now = ts
  return clock.now
}

/** 当前本地时区偏移（分钟，+08:00 时为 480） */
export function localTzOffsetMin(ts = clock.now) {
  return -new Date(ts).getTimezoneOffset()
}

/** 本地时间戳（给定本地 年月日 时分秒，返回 epoch ms），仅用于构造测试时刻 */
export function localTs(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
  return new Date(y, mo - 1, d, h, mi, s, ms).getTime()
}

/** 本地自然日 00:00 的 epoch ms */
export function localMidnight(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ---------------------------------------------------------------------------
// 可复现随机（mulberry32）
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const realRandom = Math.random.bind(Math)
const rng = { fn: realRandom }
Math.random = () => rng.fn()
export function seedRandom(seed = FIXED_SEED) {
  rng.fn = mulberry32(seed)
  return rng.fn
}
export function unseedRandom() {
  rng.fn = realRandom
}

// ---------------------------------------------------------------------------
// localStorage 注入（内存实现；支持多实例 = 多 profile / 导入恢复）
// ---------------------------------------------------------------------------
export function createLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    _map: map,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => {
      map.set(String(k), String(v))
    },
    removeItem: (k) => {
      map.delete(String(k))
    },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
    /** 仿真辅助：快照/恢复（模拟导出-导入） */
    snapshot: () => Object.fromEntries(map),
    restore: (snap) => {
      map.clear()
      for (const [k, v] of Object.entries(snap || {})) map.set(k, v)
    },
    keys: () => Array.from(map.keys()),
  }
}

export const storage = createLocalStorage()
globalThis.localStorage = storage

// ---------------------------------------------------------------------------
// 词库注入：替代 learningPath.ts 里的 fetch('./dicts/<file>')
// ---------------------------------------------------------------------------
let bootModulePromise = null
/** 静态实例：只用于读取 LEARNING_PATH 常量/常量表，不参与场景断言 */
export function bootModule() {
  if (!bootModulePromise) bootModulePromise = import(pathToFileURL(CORE_PATH).href)
  return bootModulePromise
}

export const lexicon = {
  /** file -> Word[]；file 不存在则按 404 处理 */
  files: new Map(),
  /** 这些 file 明确抛错（模拟词库加载失败） */
  failFiles: new Set(),
}

export function clearLexicon() {
  lexicon.files.clear()
  lexicon.failFiles.clear()
}

/** 构造 Word 对象（字段与 learningPath.loadLevelWords 输出一致） */
export function makeWord(name, dict) {
  return { name, trans: [`${name} 的释义`], usphone: '', ukphone: '', ...(dict ? { dict } : {}) }
}

/** 预置一个词库文件的内容 */
export function setDictFile(file, names, { fail = false } = {}) {
  if (fail) {
    lexicon.failFiles.add(file)
    return
  }
  lexicon.failFiles.delete(file)
  lexicon.files.set(file, names.map((n) => makeWord(n)))
}

/**
 * 按级别配置词表：levelWords = { 'primary-1': ['a','b'], ..., __fail: ['primary-3'] }
 * 每个级别的 files[0] 承载词表，其余文件给空数组；未配置的级别默认 20 个本级唯一新词。
 */
export async function configureLevels(levelWords = {}) {
  const { LEARNING_PATH } = await bootModule()
  const failSet = new Set(levelWords.__fail || [])
  for (let i = 0; i < LEARNING_PATH.length; i++) {
    const level = LEARNING_PATH[i]
    const configured = levelWords[level.id]
    const names =
      Array.isArray(configured) && configured.length
        ? configured
        : Array.from({ length: 20 }, (_, j) => `l${i}w${j}`)
    level.files.forEach((file, idx) => {
      const isFail = failSet.has(level.id) || failSet.has(file)
      setDictFile(file, isFail ? [] : idx === 0 ? names : [], { fail: isFail })
    })
  }
  return LEARNING_PATH
}

// 真实 learningPath 调用的 fetch：'./dicts/xxx.json'
globalThis.fetch = async (url) => {
  const text = String(url)
  const file = text.split('/').pop()
  if (lexicon.failFiles.has(file)) {
    return { ok: false, status: 404, json: async () => [] }
  }
  if (!lexicon.files.has(file)) {
    return { ok: false, status: 404, json: async () => [] }
  }
  const list = lexicon.files.get(file)
  return { ok: true, status: 200, json: async () => list }
}

// ---------------------------------------------------------------------------
// 场景隔离：每次 freshCore() = 全新模块图（新 Dexie 内存表 / 新缓存 / 新迁移 promise）
// ---------------------------------------------------------------------------
let instanceSeq = 0
export async function freshCore() {
  instanceSeq += 1
  return import(`${pathToFileURL(CORE_PATH).href}?instance=${instanceSeq}`)
}
export function coreInstanceCount() {
  return instanceSeq
}

/** 清空全局存储（每场景开始时调用） */
export function resetStorage() {
  storage.clear()
  return storage
}

// ---------------------------------------------------------------------------
// 断言 / 报告
// ---------------------------------------------------------------------------
const EPS = 1e-6

export function deepEqual(a, b, tol = 0) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return Math.abs(a - b) <= Math.max(tol, EPS)
  }
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i], tol))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k], tol))
  }
  return false
}

export function createSuite(simName, meta = {}) {
  const checks = []
  const groups = new Map()

  function record(group, id, label, expected, actual, pass, extra = {}) {
    const entry = { group, id, label, expected, actual, pass, ...extra }
    checks.push(entry)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(entry)
    return pass
  }

  function check(group, id, label, expected, actual, extra = {}) {
    const tol = extra.tol || 0
    const pass = deepEqual(expected, actual, tol)
    return record(group, id, label, expected, actual, pass, extra)
  }

  function near(group, id, label, expected, actual, tol, extra = {}) {
    const pass = Math.abs(Number(actual) - Number(expected)) <= tol
    return record(group, id, label, expected, actual, pass, { ...extra, tol })
  }

  function ok(group, id, label, cond, actual, extra = {}) {
    return record(group, id, label, true, cond ? true : actual, !!cond, extra)
  }

  function fail(group, id, label, expected, actual, extra = {}) {
    return record(group, id, label, expected, actual, false, extra)
  }

  return {
    simName,
    meta,
    checks,
    groups,
    check,
    near,
    ok,
    fail,
    /** 结果对象（写 JSON / 汇总用） */
    result(extra = {}) {
      const passed = checks.filter((c) => c.pass).length
      const failed = checks.length - passed
      const failures = checks
        .filter((c) => !c.pass)
        .map((c) => ({
          group: c.group,
          id: c.id,
          label: c.label,
          expected: c.expected,
          actual: c.actual,
          ...(c.note ? { note: c.note } : {}),
        }))
      const byGroup = {}
      for (const [g, list] of groups) {
        byGroup[g] = { total: list.length, passed: list.filter((c) => c.pass).length }
      }
      return {
        simName,
        meta,
        total: checks.length,
        passed,
        failed,
        byGroup,
        failures,
        assertions: checks,
        ...extra,
      }
    },
  }
}

/** 控制台输出 + 写报告 + 返回退出码（--strict 有失败即 1） */
export function finishSim(suite, reportFile, { strict, extra = {} } = {}) {
  const result = suite.result(extra)
  const failures = result.failures
  const lines = []
  lines.push('')
  lines.push(`== ${suite.simName} ==`)
  lines.push(`assertions: ${result.total}, passed: ${result.passed}, failed: ${result.failed}`)
  for (const [g, stat] of Object.entries(result.byGroup)) {
    lines.push(`  - ${g}: ${stat.passed}/${stat.total}`)
  }
  if (failures.length) {
    lines.push('')
    lines.push('FAILURES:')
    for (const f of failures) {
      lines.push(`  [${f.group}] ${f.id} ${f.label}`)
      lines.push(`      expected: ${JSON.stringify(f.expected)}`)
      lines.push(`      actual  : ${JSON.stringify(f.actual)}`)
      if (f.note) lines.push(`      note    : ${f.note}`)
    }
  } else {
    lines.push('ALL PASS')
  }
  console.log(lines.join('\n'))

  if (reportFile) {
    const payload = {
      ...result,
      assertions: result.assertions,
      generatedAt: new Date(realDateNow()).toISOString(),
      strict: !!strict,
      exitCode: failures.length ? 1 : 0,
      ...extra,
    }
    fs.writeFileSync(reportFile, JSON.stringify(payload, null, 2), 'utf8')
    console.log(`report: ${reportFile}`)
  }
  return failures.length ? 1 : 0
}

/** 解析 --strict */
export function hasStrict(argv = process.argv) {
  return argv.slice(2).includes('--strict')
}

/** 稳定快照：去掉无关字段，便于期望值断言 */
export function recSnap(rec, now) {
  return {
    stage: rec.stage,
    intervalMin: Math.round(rec.interval * 24 * 60 * 1000) / 1000,
    attempts: rec.attempts,
    correct: rec.correct,
    wrong: rec.wrong,
    lapses: rec.lapses,
    slow: rec.slow,
    lastResult: rec.lastResult,
    ease: Math.round(rec.ease * 100) / 100,
    due: rec.due,
    dueFromNowMin: Math.round((rec.due - now) / MINUTE * 1000) / 1000,
    dueLocalMidnight: localMidnight(rec.due) === rec.due,
  }
}

export { fs, path, realDateNow }
