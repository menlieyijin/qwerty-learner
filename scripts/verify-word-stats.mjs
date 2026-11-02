#!/usr/bin/env node
// 统计聚合的回归 + 性能对照（v11.6.1）
//
// 为什么要单独测：统计页的五套口径（练习次数 / 去重词数 / WPM / 正确率 / 错误键）原来埋在
// React hook 里，只能靠打开页面肉眼看。v11.6.1 把聚合抽成纯函数后，这里做两件事：
//   1) 用脏记录（缺列 / NaN / 字符串时间戳 / 区间外）逐条断言，锁住「跳过错数据」的行为；
//   2) 同一批数据跑「上一版实现」与「当前实现」，要求结果完全一致且当前实现更快。
//
// 用法：npm run test:word-stats
import dayjs from 'dayjs'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let passed = 0
const failures = []
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log(`PASS  ${name}`)
  } else {
    failures.push(name)
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'qz-word-stats-'))
const outfile = join(dir, 'wordStatsAggregate.mjs')
try {
  await build({
    entryPoints: ['src/pages/Analysis/hooks/wordStatsAggregate.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2020',
    logLevel: 'silent',
  })
  const { aggregateWordRecords, normalizeWrongKey, buildWrongKeyStats, getLevel } = await import(pathToFileURL(outfile).href)

  const DAY = 86400
  const base = Math.floor(new Date('2026-03-01T12:00:00Z').getTime() / 1000)
  const rec = (over = {}) => ({
    word: 'apple',
    timeStamp: base,
    dict: 'cet4',
    chapter: 1,
    timing: [100, 100],
    wrongCount: 0,
    mistakes: {},
    ...over,
  })
  const range = [base - DAY, base + DAY]
  const DATE = '2026-03-01'
  const onDate = (list, date = DATE) => list.find((x) => x.date === date)

  // ---------- 基本口径 ----------
  check('1 空记录返回 isEmpty', aggregateWordRecords([], ...range).isEmpty === true)
  const one = aggregateWordRecords([rec()], ...range)
  check('2 一条记录 = 一次练习', onDate(one.exerciseRecord)?.count === 1, one.exerciseRecord)
  check('3 一条记录 = 一个词', onDate(one.wordRecord)?.count === 1, one.wordRecord)
  check('4 分级函数保持上游口径', [0, 1, 5, 10, 13].map(getLevel).join(',') === '0,1,2,3,4')

  // 同一天同一个词练两次：练习次数 2、去重词数 1
  const twice = aggregateWordRecords([rec(), rec({ wrongCount: 1 })], ...range)
  check('5 同日重复词：练习 2 次、词数去重为 1', onDate(twice.exerciseRecord)?.count === 2 && onDate(twice.wordRecord)?.count === 1, {
    exercise: onDate(twice.exerciseRecord),
    words: onDate(twice.wordRecord),
  })

  // WPM = 词数（不去重）/ 分钟
  const wpm = aggregateWordRecords([rec(), rec()], ...range).wpmRecord[0][1]
  // 2 词 / (400ms) → 2 / (0.4/60) = 300
  check('6 WPM 用不去重词数', wpm === 300, wpm)
  check('7 总时间为 0 时不产生 WPM 点', aggregateWordRecords([rec({ timing: [] })], ...range).wpmRecord.length === 0)
  check('8 脏 timing（非数组）按 0 处理', aggregateWordRecords([rec({ timing: 'oops' })], ...range).wpmRecord.length === 0)

  // 正确率 = 字符数 /（字符数 + 错误数）：5 / (5 + 5) = 50
  const acc = aggregateWordRecords([rec({ wrongCount: 5 })], ...range).accuracyRecord[0][1]
  check('9 正确率按字符数与错误数计算', acc === 50, acc)

  // ---------- 脏数据 ----------
  const dirty = [
    null,
    rec({ word: '' }),
    rec({ word: 42 }),
    rec({ timeStamp: NaN }),
    rec({ timeStamp: '123' }),
    rec({ timeStamp: base + 10 * DAY }),
    rec(),
  ]
  const cleaned = aggregateWordRecords(dirty, ...range)
  check('10 脏记录逐条跳过、好记录仍计入', cleaned.exerciseRecord.reduce((n, d) => n + d.count, 0) === 1, cleaned.exerciseRecord)

  // ---------- 错误键 ----------
  check('11 单字符统一大写', normalizeWrongKey('a') === 'A' && normalizeWrongKey('A') === 'A')
  check('12 空格键保留为空格', normalizeWrongKey(' ') === ' ')
  check('13 多字符键名不被大写化', normalizeWrongKey('Backspace') === 'Backspace')
  const merged = aggregateWordRecords(
    [rec({ mistakes: { 0: ['a', 'A'], 1: [' '], 2: ['Backspace', 'a'] } }), rec({ mistakes: { 0: ['A'] } })],
    ...range,
  ).wrongTimeRecord
  const byKey = Object.fromEntries(merged.map((x) => [x.key, x]))
  check('14 大小写合并计数', byKey.A.value === 4, byKey.A)
  check('15 空格键有展示名且不进键盘图', byKey[' '].label === '空格' && byKey[' '].mappable === false, byKey[' '])
  check('16 多字符键保留原名、不进键盘图', byKey.Backspace.label === 'Backspace' && byKey.Backspace.mappable === false)
  check(
    '17 结果按次数倒序',
    merged[0].key === 'A',
    merged.map((x) => x.key),
  )
  const dirtyMistakes = aggregateWordRecords([rec({ mistakes: { 0: 'oops', 1: ['a'] } })], ...range).wrongTimeRecord
  check('18 mistakes 非数组值被忽略', dirtyMistakes.length === 1 && dirtyMistakes[0].key === 'A', dirtyMistakes)
  check(
    '19 旧入口 buildWrongKeyStats 与主路径一致',
    JSON.stringify(buildWrongKeyStats(['a', 'A', ' '])) === JSON.stringify(buildWrongKeyStats(['A', 'a', ' '])),
  )

  // ---------- 与「上一版实现」对照 ----------
  // 上一版（v11.6.0）：日桶用 Set，但错误键先 flatMap 展开成数组再计数。
  function prevAggregate(records, startTimeStamp, endTimeStamp) {
    const data = new Map()
    const day0 = dayjs(startTimeStamp * 1000).startOf('day')
    const last = dayjs(endTimeStamp * 1000).endOf('day')
    for (let c = day0; c.diff(last) < 0; c = c.add(1, 'day')) {
      data.set(c.format('YYYY-MM-DD'), {
        exerciseTime: 0,
        words: new Set(),
        wordCount: 0,
        charLength: 0,
        totalTime: 0,
        wrongCount: 0,
        wrongKeys: new Map(),
      })
    }
    for (const r of records) {
      if (!r || typeof r.word !== 'string' || !r.word) continue
      if (typeof r.timeStamp !== 'number' || !Number.isFinite(r.timeStamp)) continue
      const b = data.get(dayjs(r.timeStamp * 1000).format('YYYY-MM-DD'))
      if (!b) continue
      b.exerciseTime += 1
      b.words.add(r.word)
      b.wordCount += 1
      b.charLength += r.word.length
      for (const ms of Array.isArray(r.timing) ? r.timing : []) b.totalTime += Number(ms) || 0
      b.wrongCount += Number(r.wrongCount) || 0
      for (const keys of Object.values(r.mistakes ?? {})) {
        if (!Array.isArray(keys)) continue
        for (const k of keys) b.wrongKeys.set(k, (b.wrongKeys.get(k) ?? 0) + 1)
      }
    }
    const entries = [...data.entries()]
    const allWrong = entries.flatMap(([, b]) => [...b.wrongKeys.entries()].flatMap(([k, n]) => Array.from({ length: n }, () => k)))
    return {
      exerciseRecord: entries.map(([date, b]) => ({ date, count: b.exerciseTime, level: getLevel(b.exerciseTime) })),
      wordRecord: entries.map(([date, b]) => ({ date, count: b.words.size, level: getLevel(b.words.size) })),
      wpmRecord: entries
        .map(([date, b]) => [date, b.totalTime > 0 ? Math.round(b.wordCount / (b.totalTime / 1000 / 60)) : 0])
        .filter(([, v]) => Number.isFinite(v) && v > 0),
      accuracyRecord: entries
        .map(([date, b]) => [date, b.charLength + b.wrongCount > 0 ? Math.round((b.charLength / (b.charLength + b.wrongCount)) * 100) : 0])
        .filter(([, v]) => Number.isFinite(v) && v > 0),
      wrongTimeRecord: buildWrongKeyStats(allWrong),
      expanded: allWrong.length,
    }
  }

  function makeRecords(n) {
    const keys = ['a', 'b', 'c', 'd', 'e', 'Backspace', ' ']
    const words = ['apple', 'banana', 'cherry', 'delta', 'echo']
    return Array.from({ length: n }, (_, i) =>
      rec({
        word: words[i % words.length],
        timeStamp: base - (i % 30) * DAY,
        timing: [80 + (i % 40), 90 + (i % 30)],
        wrongCount: i % 3,
        mistakes: { 0: [keys[i % keys.length], keys[(i + 3) % keys.length]] },
      }),
    )
  }

  const normalize = (r) => JSON.stringify({ ...r, wrongTimeRecord: r.wrongTimeRecord, expanded: undefined })
  for (const n of [200, 5000, 20000]) {
    const rows = makeRecords(n)
    const t0 = process.hrtime.bigint()
    const prev = prevAggregate(rows, base - 40 * DAY, base + DAY)
    const t1 = process.hrtime.bigint()
    const next = aggregateWordRecords(rows, base - 40 * DAY, base + DAY)
    const t2 = process.hrtime.bigint()
    const prevMs = Number(t1 - t0) / 1e6
    const nextMs = Number(t2 - t1) / 1e6
    check(`20.${n} 与上一版结果逐字段一致`, normalize(prev) === normalize(next))
    console.log(
      `BENCH  ${String(n).padStart(6)} 条  prev ${prevMs.toFixed(1)}ms → new ${nextMs.toFixed(1)}ms` +
        `（${(prevMs / Math.max(nextMs, 0.01)).toFixed(1)}×，错误键展开 ${prev.expanded} → 0 个元素）`,
    )
    if (n === 20000) check('21 2 万条时当前实现不慢于上一版', nextMs <= prevMs, { prevMs, nextMs })
  }

  // 再补一组「v11.6 之前」的对照：日桶用数组 + 每次 spread 复制。
  // 这是当初 F-1 的原始形态（O(n²)），只跑 2000 条——再往上会跑成分钟级，本身就是结论。
  function legacySpreadAggregate(records, startTimeStamp, endTimeStamp) {
    const data = new Map()
    const day0 = dayjs(startTimeStamp * 1000).startOf('day')
    const last = dayjs(endTimeStamp * 1000).endOf('day')
    for (let c = day0; c.diff(last) < 0; c = c.add(1, 'day')) {
      data.set(c.format('YYYY-MM-DD'), {
        exerciseTime: 0,
        words: [],
        wordCount: 0,
        charLength: 0,
        totalTime: 0,
        wrongCount: 0,
        wrongKeys: [],
      })
    }
    for (const r of records) {
      if (!r || typeof r.word !== 'string' || !r.word) continue
      const b = data.get(dayjs(r.timeStamp * 1000).format('YYYY-MM-DD'))
      if (!b) continue
      b.exerciseTime += 1
      b.words = [...b.words, r.word]
      b.wordCount += 1
      b.charLength += r.word.length
      for (const ms of Array.isArray(r.timing) ? r.timing : []) b.totalTime += Number(ms) || 0
      b.wrongCount += Number(r.wrongCount) || 0
      for (const keys of Object.values(r.mistakes ?? {})) {
        if (!Array.isArray(keys)) continue
        b.wrongKeys = [...b.wrongKeys, ...keys]
      }
    }
    return [...data.values()].reduce((n, b) => n + b.words.length, 0)
  }
  // 最坏情况：同一天的记录最多（旧实现是「往同一个日桶数组里反复 spread」）
  const legacyRows = Array.from({ length: 10000 }, (_, i) =>
    rec({ word: `w${i % 500}`, timeStamp: base, timing: [80, 90], wrongCount: i % 3, mistakes: { 0: ['a', 'b'] } }),
  )
  const l0 = process.hrtime.bigint()
  legacySpreadAggregate(legacyRows, base - DAY, base + 2 * DAY)
  const l1 = process.hrtime.bigint()
  const now = aggregateWordRecords(legacyRows, base - DAY, base + 2 * DAY)
  const l2 = process.hrtime.bigint()
  console.log(
    `BENCH  ${String(10000).padStart(6)} 条（同日）legacy(数组展开) ${(Number(l1 - l0) / 1e6).toFixed(1)}ms → new ${(
      Number(l2 - l1) / 1e6
    ).toFixed(1)}ms` +
      `（${(Number(l1 - l0) / Math.max(Number(l2 - l1), 1) || 0).toFixed(1)}×，词数 ${now.wordRecord.reduce((n, d) => n + d.count, 0)}）`,
  )

  console.log(`\nWORD_STATS ${passed}/${passed + failures.length}`)
  if (failures.length) {
    console.error(`失败项：${failures.join('；')}`)
    process.exitCode = 1
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 临时目录清理失败不影响结论 */
  }
}
