/**
 * srs-sim.mjs — Qwerty Learner Plus v9.3 SRS / 记忆曲线回归仿真（--strict 门禁）
 *
 * 运行：node "scripts/core-regression\srs-sim.mjs" [--strict]
 * 产物：scripts/core-regression\report-srs.json
 *
 * 特点：断言对象是 `core.mjs` —— 由 build-core.mjs 用 esbuild 从**真实源码**打包
 *   src/utils/srsRules.ts / db/index.ts(updateMemoryProgress,deferMemoryDue) / memory.ts(迁移,pickDynamicWord)
 *   / autoLevel.ts(recordSkip,suspendWord,clearSkip,defer...) 而来，不含任何手写复刻，避免"复刻漂移"。
 *
 * 覆盖：A-01…A-14（v9.3 期望）+ S-01…S-11（设计文档第二章）。
 * 约束：只写 scripts/core-regression，不改 src/、不构建应用、不联网；时钟/+08:00 时区/随机 seed 全部注入。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  AUDIT_DIR,
  BASE_TS,
  DAY,
  HOUR,
  MINUTE,
  TZ_OFFSET_MIN,
  clock,
  configureLevels,
  createSuite,
  finishSim,
  freshCore,
  hasStrict,
  localMidnight,
  localTs,
  resetClock,
  resetStorage,
  seedRandom,
  setNow,
  storage,
} from './harness.mjs'

const SRC = path.resolve(import.meta.dirname, '../..')
const SRC_UTILS = path.join(SRC, 'src', 'utils')
const REPORT = path.join(AUDIT_DIR, 'report-srs.json')
const strict = hasStrict()

const D = 'simDict'
const T0 = BASE_TS // 本地 2026-01-01 08:00:00 (+08:00)
const suite = createSuite('srs-sim v9.3 (real-source bundle)', {
  designDoc: 'docs/DSH-FORK.md',
  assertionPlan: 'scripts/core-regression/README.md',
  sourceVersion: 'v9.3 (src/utils/srsRules.ts + db/index.ts + memory.ts)',
  coreBundle: 'core.mjs',
  coreKind: 'esbuild(real src)',
  seed: 20261026,
  tzOffsetMin: TZ_OFFSET_MIN,
  baseTs: T0,
  mode: strict ? 'strict' : 'report',
})

await configureLevels({})

function baseRecord(core, dict, word, over = {}) {
  const now = clock.now
  return {
    key: core.memoryKey(dict, word),
    word,
    dict,
    trans: [`${word} 的释义`],
    phone: '',
    stage: 3,
    interval: 1,
    ease: 2.5,
    due: now + DAY,
    lastSeen: now - 3 * HOUR,
    createdAt: now - 10 * DAY,
    attempts: 3,
    correct: 2,
    wrong: 1,
    slow: 0,
    lapses: 0,
    lastResult: 'ok',
    ...over,
  }
}

async function put(core, rec) {
  await core.db.memoryRecords.put(rec)
  return rec
}
async function get(core, dict, word) {
  return core.db.memoryRecords.get(core.memoryKey(dict, word))
}
function persistLevel(core, levelId) {
  core.saveAutoLevelState({ version: 1, levelId, startedAt: clock.now, skipped: {}, suspended: [] })
}
async function newScenario() {
  resetStorage()
  resetClock(T0)
  seedRandom(20261026)
  return freshCore()
}

// ===========================================================================
// A 组：旧场景 v9.3 期望
// ===========================================================================
async function a01() {
  const core = await newScenario()
  setNow(T0)
  await core.updateMemoryProgress(D, 'alpha', 0, 1200)
  const rec = await get(core, D, 'alpha')
  suite.check('A 新词/到期', 'A-01.stage', '新词首对 stage=3（1 天档）', 3, rec.stage)
  suite.check('A 新词/到期', 'A-01.interval', '新词首对 interval=1 天', 1, rec.interval)
  suite.check('A 新词/到期', 'A-01.due', '日粒度 due：目标本地日 00:00', localTs(2026, 1, 2, 0), rec.due)
  suite.check('A 新词/到期', 'A-01.dueMidnight', 'due 恰为本地 00:00', true, rec.due === localMidnight(rec.due))
  suite.check('A 新词/到期', 'A-01.lapses', '新词首对 lapses 不增加', 0, rec.lapses)
  suite.check('A 新词/到期', 'A-01.lastResult', 'lastResult=ok', 'ok', rec.lastResult)
  suite.check('A 新词/到期', 'A-01.count', 'attempts/correct/wrong = 1/1/0', [1, 1, 0], [rec.attempts, rec.correct, rec.wrong])
}

async function a02() {
  const core = await newScenario()
  setNow(T0)
  await core.updateMemoryProgress(D, 'beta', 1, 1200)
  const rec = await get(core, D, 'beta')
  suite.check('A 新词/到期', 'A-02.stage', '新词首错 stage=0（10 分钟档）', 0, rec.stage)
  suite.check('A 新词/到期', 'A-02.interval', '首错 interval=10min', 10 / 1440, rec.interval)
  suite.check('A 新词/到期', 'A-02.due', '首错 due=now+10min', T0 + 10 * MINUTE, rec.due)
  suite.check('A 新词/到期', 'A-02.lapses', '新词首错 lapses 仍为 0（v9.3）', 0, rec.lapses)
  suite.check('A 新词/到期', 'A-02.wrong', 'wrong+1', 1, rec.wrong)
  suite.check('A 新词/到期', 'A-02.lastResult', 'lastResult=wrong', 'wrong', rec.lastResult)
}

async function a03() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'gamma', { stage: 3, interval: 1, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 'gamma', 0, 800)
  const rec = await get(core, D, 'gamma')
  suite.check('A 新词/到期', 'A-03.stage', '到期答对 stage 3→4', 4, rec.stage)
  suite.check('A 新词/到期', 'A-03.interval', 'interval=ladderDays(4)=2 天', 2, rec.interval)
  suite.check('A 新词/到期', 'A-03.due', '日粒度 due=本地 1/3 00:00', localTs(2026, 1, 3, 0), rec.due)
  suite.check('A 新词/到期', 'A-03.lastResult', 'lastResult=ok', 'ok', rec.lastResult)
}

async function a04() {
  const core = await newScenario()
  setNow(T0)
  const due = T0 + HOUR
  await put(core, baseRecord(core, D, 'delta', { stage: 3, due }))
  await core.updateMemoryProgress(D, 'delta', 0, 800)
  const rec = await get(core, D, 'delta')
  suite.check('A 循环/回看', 'A-04.stage', '未到期答对不升档', 3, rec.stage)
  suite.check('A 循环/回看', 'A-04.due', '未到期答对 due 不变', due, rec.due)
  suite.check('A 循环/回看', 'A-04.lastResult', 'lastResult=early-ok', 'early-ok', rec.lastResult)
  suite.check('A 循环/回看', 'A-04.correct', 'correct 仍 +1', 3, rec.correct)
}

async function a05() {
  const core = await newScenario()
  setNow(T0)
  const due = T0 + 10 * DAY
  await put(core, baseRecord(core, D, 'epsilon', { stage: 3, due }))
  await core.updateMemoryProgress(D, 'epsilon', 0, 900, undefined, undefined, true)
  const rec = await get(core, D, 'epsilon')
  suite.check('A refresh', 'A-05.stage', 'refresh-ok 不升档', 3, rec.stage)
  suite.check('A refresh', 'A-05.due', 'refresh-ok 不改变 due', due, rec.due)
  suite.check('A refresh', 'A-05.lastResult', 'lastResult=refresh-ok', 'refresh-ok', rec.lastResult)
  suite.check('A refresh', 'A-05.correct', 'refresh-ok correct+1', 3, rec.correct)
}

async function a06() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'zeta', { stage: 5, interval: 4, due: T0 + 10 * DAY, correct: 5, wrong: 1, lapses: 0, ease: 2.5 }))
  await core.updateMemoryProgress(D, 'zeta', 1, 900, undefined, undefined, true)
  const rec = await get(core, D, 'zeta')
  suite.check('A refresh', 'A-06.stage', 'mature 单错降 2 档：5→3（不归零）', 3, rec.stage)
  suite.check('A refresh', 'A-06.lapses', 'mature 单错 lapses+1', 1, rec.lapses)
  suite.check('A refresh', 'A-06.ease', 'ease=2.3', 2.3, rec.ease)
  suite.check('A refresh', 'A-06.due', 'due 按新档重算（1 天档=本地 1/2 00:00）', localTs(2026, 1, 2, 0), rec.due)
  suite.check('A refresh', 'A-06.lastResult', 'lastResult=refresh-wrong', 'refresh-wrong', rec.lastResult)
}

async function a07a08() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'eta', { stage: 4, interval: 2, due: T0 + 2 * DAY }))
  await core.updateMemoryProgress(D, 'eta', 0, 500)
  await core.updateMemoryProgress(D, 'eta', 0, 500)
  const rec = await get(core, D, 'eta')
  suite.check('A 循环/回看', 'A-07.stage', '循环重复答对不升档', 4, rec.stage)
  suite.check('A 循环/回看', 'A-08.due', '循环重复答对 due 不变', T0 + 2 * DAY, rec.due)
  suite.check('A 循环/回看', 'A-08.lastResult', 'lastResult=early-ok', 'early-ok', rec.lastResult)
}

async function a09() {
  const core = await newScenario()
  setNow(T0)
  await core.updateMemoryProgress(D, 'theta', 1, 700)
  const rec = await get(core, D, 'theta')
  suite.check('A 口径', 'A-09.lapses', '首错 lapses=0（旧失败点已修）', 0, rec.lapses)
  suite.check('A 口径', 'A-09.wrong', '首错 wrong=1', 1, rec.wrong)
}

async function a10() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'iota', { stage: 2, interval: 0.5, correct: 2, due: T0 + 5 * DAY }))
  await core.updateMemoryProgress(D, 'iota', 0, 7000, undefined, undefined, true)
  const rec = await get(core, D, 'iota')
  suite.check('A 口径', 'A-10.slow', 'refresh-ok 且 totalMs>6000 → slow+1（旧失败点已修）', 1, rec.slow)
  suite.check('A 口径', 'A-10.stage', 'refresh-ok 不升档', 2, rec.stage)
}

async function a11() {
  const core = await newScenario()
  setNow(T0)
  await core.updateMemoryProgress(D, 'kappa', 1, 500) // 新词答错 → stage0 / 10min
  core.recordSkip(D, 'kappa') // 用户 Skip：不写记忆记录
  setNow(T0 + 10 * MINUTE + 1)
  await core.updateMemoryProgress(D, 'kappa', 0, 600) // 到期答对，isRefresh 缺省 false
  const rec = await get(core, D, 'kappa')
  suite.check('A refresh 残留', 'A-11.lastResult', 'Skip 后到期答对=ok，不被误判 refresh-*', 'ok', rec.lastResult)
  suite.check('A refresh 残留', 'A-11.stage', 'Skip 后到期答对升到 stage1', 1, rec.stage)
  suite.check('A refresh 残留', 'A-11.due', 'due=now+30min', T0 + 40 * MINUTE + 1, rec.due)
}

async function a12() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'lambda', { stage: 0, interval: 10 / 1440, due: T0 - MINUTE, lastResult: 'wrong' }))
  await core.updateMemoryProgress(D, 'lambda', 0, 900)
  const rec = await get(core, D, 'lambda')
  suite.check('A 口径', 'A-12.stage', '错后到期答对 stage=1', 1, rec.stage)
  suite.check('A 口径', 'A-12.due', 'due=now+30min', T0 + 30 * MINUTE, rec.due)
}

async function a13() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 'mu', { stage: 11, interval: 240, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 'mu', 0, 900)
  const rec = await get(core, D, 'mu')
  suite.check('A 封顶', 'A-13.stage', '封顶 stage 仍为 11', 11, rec.stage)
  suite.check('A 封顶', 'A-13.interval', '封顶 interval=240 天', 240, rec.interval)
  suite.check('A 封顶', 'A-13.dueMidnight', '封顶 due 为本地 00:00（日粒度）', true, rec.due === localMidnight(rec.due))
  suite.ok('A 封顶', 'A-13.dueRange', '封顶 due ∈ [now+239d, now+241d]', rec.due >= T0 + 239 * DAY && rec.due <= T0 + 241 * DAY, rec.due)
}

async function a14() {
  const core = await newScenario()
  setNow(T0)
  await core.updateMemoryProgress(D, 'nu', 1, 300)
  setNow(T0 + 10 * MINUTE + 1)
  await core.updateMemoryProgress(D, 'nu', 0, 300)
  setNow(T0 + 40 * MINUTE + 2)
  await core.updateMemoryProgress(D, 'nu', 0, 300)
  await core.updateMemoryProgress(D, 'nu', 0, 300) // early-ok
  const rec = await get(core, D, 'nu')
  suite.check('A 不变式', 'A-14.invariant', 'attempts = correct + wrong', rec.attempts, rec.correct + rec.wrong)
  suite.check('A 不变式', 'A-14.counts', 'attempts/correct/wrong = 4/3/1', [4, 3, 1], [rec.attempts, rec.correct, rec.wrong])
}

// ===========================================================================
// S 组：v9.3 新增
// ===========================================================================
async function s01() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's01', { stage: 6, interval: 4, correct: 5, wrong: 1, lapses: 1, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 's01', 1, 900)
  const rec = await get(core, D, 's01')
  suite.check('S mature 降档', 'S-01.stage', 'stage6 单错 → stage4（降 2 档，不归零）', 4, rec.stage)
  suite.check('S mature 降档', 'S-01.lapses', 'lapses 1→2', 2, rec.lapses)
  suite.check('S mature 降档', 'S-01.due', 'due=computeDue(now, ladderDays(4)=2d)', localTs(2026, 1, 3, 0), rec.due)
  suite.check('S mature 降档', 'S-01.lastResult', 'lastResult=wrong', 'wrong', rec.lastResult)
}

async function s02() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's02', { stage: 6, interval: 4, correct: 5, wrong: 1, lapses: 1, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 's02', 2, 900)
  const rec = await get(core, D, 's02')
  suite.check('S mature 降档', 'S-02.stage', 'stage6 wrongCount=2 → stage0', 0, rec.stage)
  suite.check('S mature 降档', 'S-02.due', 'due=now+10min', T0 + 10 * MINUTE, rec.due)
  suite.check('S mature 降档', 'S-02.lapses', 'lapses+1=2', 2, rec.lapses)
}

async function s03() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's03', { stage: 2, interval: 0.5, correct: 2, wrong: 1, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 's03', 1, 900)
  const rec = await get(core, D, 's03')
  suite.check('S mature 降档', 'S-03.stage', 'stage2 单错 → stage0', 0, rec.stage)
  suite.check('S mature 降档', 'S-03.lapses', '非 mature 不计 lapse', 0, rec.lapses)
  suite.check('S mature 降档', 'S-03.ease', 'ease 2.5→2.3', 2.3, rec.ease)
}

async function s04() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's04', { stage: 3, interval: 1, correct: 2, lastSeen: T0 + 3 * DAY, due: T0 + 5 * DAY }))
  await core.updateMemoryProgress(D, 's04', 0, 900)
  const rec = await get(core, D, 's04')
  suite.check('S 时钟回拨', 'S-04.stage', '回拨后答对按到期升档 3→4', 4, rec.stage)
  suite.check('S 时钟回拨', 'S-04.lastResult', '不再早退 early-ok', 'ok', rec.lastResult)
  suite.check('S 时钟回拨', 'S-04.due', 'due 校正后按新档重算', localTs(2026, 1, 3, 0), rec.due)
}

async function s05() {
  const core = await newScenario()
  const night = localTs(2026, 1, 5, 23, 30)
  suite.check('S 日粒度', 'S-05.1d', '23:30 + 1 天档 → 次日 00:00', localTs(2026, 1, 6, 0), core.computeDue(night, 1))
  suite.check('S 日粒度', 'S-05.1dDelta', '仅约 30 分钟（非 24h）', 30 * MINUTE, core.computeDue(night, 1) - night)
  for (const [id, days, delta] of [
    ['S-05.10min', 10 / 1440, 10 * MINUTE],
    ['S-05.30min', 30 / 1440, 30 * MINUTE],
    ['S-05.12h', 0.5, 12 * HOUR],
  ]) {
    suite.check('S 日粒度', id, `${id} 保持精确毫秒`, delta, core.computeDue(T0, days) - T0)
  }
  suite.check('S 日粒度', 'S-05.month', '1/31 23:30 + 1 天 → 2/1 00:00', localTs(2026, 2, 1, 0), core.computeDue(localTs(2026, 1, 31, 23, 30), 1))
  suite.check('S 日粒度', 'S-05.year', '12/31 23:30 + 1 天 → 2027/1/1 00:00', localTs(2027, 1, 1, 0), core.computeDue(localTs(2026, 12, 31, 23, 30), 1))
  suite.check('S 日粒度', 'S-05.zero', 'interval=0 → now', T0, core.computeDue(T0, 0))
  suite.check('S 日粒度', 'S-05.nan', 'interval=NaN → now', T0, core.computeDue(T0, NaN))
}

async function s06() {
  const t = T0
  const mkRows = () => {
    const rows = []
    for (let i = 0; i < 6; i++) {
      rows.push({ word: `mig${i}`, dict: D, timeStamp: Math.floor((t - 20 * DAY - i * HOUR) / 1000), timing: i === 0 ? [7000] : [1000], wrongCount: 0 })
    }
    rows.push({ word: 'migWrong2', dict: D, timeStamp: Math.floor((t - 20 * DAY) / 1000), timing: [1000], wrongCount: 2 })
    rows.push({ word: 'migWrong3', dict: D, timeStamp: Math.floor((t - 20 * DAY) / 1000), timing: [1000], wrongCount: 3 })
    rows.push({ word: 'migFresh', dict: D, timeStamp: Math.floor((t - HOUR) / 1000), timing: [1000], wrongCount: 0 })
    return rows
  }

  resetStorage()
  resetClock(t)
  let core = await freshCore()
  const rows = mkRows()
  for (const r of rows) await core.db.wordRecords.add(r)
  await core.ensureMemoryMigrated()
  const recs = await core.db.memoryRecords.toArray()
  const byWord = new Map(recs.map((r) => [r.word, r]))
  suite.check('S 迁移', 'S-06.count', '迁移记录数 = 去重词数', 9, recs.length)
  const expired = recs.filter((r) => r.word.startsWith('mig') && r.word !== 'migFresh')
  suite.ok('S 迁移', 'S-06.window', '过期词 due 摊到 [now, now+14d)', expired.every((r) => r.due >= t && r.due < t + 14 * DAY), expired.map((r) => `${r.word}:${((r.due - t) / DAY).toFixed(2)}d`))
  const spread = new Set(expired.map((r) => Math.floor((r.due - t) / DAY)))
  suite.ok('S 迁移', 'S-06.spread', '摊平日期有分散（≥3 个不同天）', spread.size >= 3, spread.size)
  suite.check('S 迁移', 'S-06.freshDue', '未过期词 due = lastSeen + interval（不被摊平）', t - HOUR + DAY, byWord.get('migFresh').due)
  suite.check('S 迁移', 'S-06.stage0', 'wrong=0 → stage3', 3, byWord.get('mig0').stage)
  suite.check('S 迁移', 'S-06.stage2', 'wrong=2 → stage2', 2, byWord.get('migWrong2').stage)
  suite.check('S 迁移', 'S-06.stage1', 'wrong=3 → stage1', 1, byWord.get('migWrong3').stage)
  suite.check('S 迁移', 'S-06.slow', 'timing>6s 的历史词补 slow=1', 1, byWord.get('mig0').slow)
  suite.check('S 迁移', 'S-06.slow0', 'timing<=6s 的历史词 slow=0', 0, byWord.get('mig1').slow)
  suite.check('S 迁移', 'S-06.marker', '迁移成功写 marker', true, !!storage.getItem(core.MEMORY_MIGRATED_KEY))

  const dueA = new Map(recs.map((r) => [r.key, r.due]))
  resetStorage()
  resetClock(t)
  core = await freshCore()
  for (const r of rows) await core.db.wordRecords.add(r)
  await core.ensureMemoryMigrated()
  const recs2 = await core.db.memoryRecords.toArray()
  suite.check('S 迁移', 'S-06.stableHash', '相同数据迁移 due 完全可复现', dueA, new Map(recs2.map((r) => [r.key, r.due])))

  // Case B：已有 memoryRecords → 不覆盖（只补 marker）
  resetStorage()
  resetClock(t)
  core = await freshCore()
  await put(core, baseRecord(core, D, 'mig0', { stage: 5, interval: 4, due: t + 9 * DAY, correct: 8, wrong: 0 }))
  for (const r of rows) await core.db.wordRecords.add(r)
  await core.ensureMemoryMigrated()
  suite.check('S 迁移', 'S-06.noOverwrite', '已有记录不被迁移覆盖', 1, (await core.db.memoryRecords.toArray()).length)
  suite.check('S 迁移', 'S-06.noOverwriteDue', '已有记录 due 保持原值', t + 9 * DAY, (await get(core, D, 'mig0')).due)
  suite.check('S 迁移', 'S-06.existingMarker', '已有数据时补写 marker', true, !!storage.getItem(core.MEMORY_MIGRATED_KEY))

  // Case C：marker 在而 DB 空 → 重迁
  resetStorage()
  resetClock(t)
  core = await freshCore()
  storage.setItem(core.MEMORY_MIGRATED_KEY, String(t))
  for (const r of rows) await core.db.wordRecords.add(r)
  await core.ensureMemoryMigrated()
  suite.check('S 迁移', 'S-06.remigrate', 'marker 在而 DB 空 → 重新迁移', 9, (await core.db.memoryRecords.toArray()).length)

  // Case D：wordRecords 空 → 不写 marker、不产生记录
  resetStorage()
  resetClock(t)
  core = await freshCore()
  await core.ensureMemoryMigrated()
  suite.check('S 迁移', 'S-06.emptyNoMarker', 'wordRecords 空 → 不写 marker', null, storage.getItem(core.MEMORY_MIGRATED_KEY))
  suite.check('S 迁移', 'S-06.emptyCount', 'wordRecords 空 → 无记录', 0, (await core.db.memoryRecords.toArray()).length)
}

async function s07() {
  // ---- S-07.a：08:00 Skip → due 精确 = now + 24h（DATA-009：不是次日 00:00） ----
  const core = await newScenario()
  setNow(T0)
  const rec0 = await put(core, baseRecord(core, D, 's07', { stage: 3, due: T0 - HOUR, lastResult: 'ok' }))
  const skip1 = core.recordSkip(D, 's07')
  await core.deferMemoryDue(D, 's07', 1)
  const rec = await get(core, D, 's07')
  suite.check('S 复习 Skip', 'S-07.skipCount', 'Skip 计数 +1', 1, skip1.count)
  suite.check('S 复习 Skip', 'S-07.due', '复习 Skip 后 due 精确顺延 24h（T0+DAY，不是次日 00:00）', T0 + DAY, rec.due)
  suite.check('S 复习 Skip', 'S-07.dueExact24h', 'due - now 严格等于 24h（毫秒级精确）', DAY, rec.due - T0)
  suite.ok('S 复习 Skip', 'S-07.dueNotImmediate', 'due 不再立即出现（> now）', rec.due > T0, rec.due)
  suite.check('S 复习 Skip', 'S-07.noRecordChange', 'Skip 不改 stage/尝试数', [rec0.stage, rec0.attempts], [rec.stage, rec.attempts])
  core.recordSkip(D, 's07')
  const skip3 = core.recordSkip(D, 's07')
  suite.check('S 复习 Skip', 'S-07.suspend', 'Skip 3 次 → suspended=true', true, skip3.suspended)
  suite.ok('S 复习 Skip', 'S-07.suspendList', 'suspended 列表包含该 key', core.getSuspendedKeys().includes(core.memoryKey(D, 's07')), core.getSuspendedKeys())

  // ---- S-07.b：23:50 边界 + 重复 Skip（旧实现 23:50 → 次日 00:00 只隔 10 分钟） ----
  {
    const lateCore = await newScenario()
    const late = localTs(2026, 1, 1, 23, 50)
    setNow(late)
    await put(lateCore, baseRecord(lateCore, D, 's07late', { stage: 3, due: late - MINUTE }))
    await lateCore.deferMemoryDue(D, 's07late', 1)
    const r1 = await get(lateCore, D, 's07late')
    const due1 = r1.due // 快照：stub 的 get 返回同一对象引用，defer 会原地改 due
    suite.check('S 复习 Skip', 'S-07.boundary2350', '23:50 Skip → due=23:50+24h（不是次日 00:00 的 10 分钟后）', late + DAY, due1)

    const next = localTs(2026, 1, 2, 0, 5)
    setNow(next)
    await lateCore.deferMemoryDue(D, 's07late', 1)
    const r2 = await get(lateCore, D, 's07late')
    suite.check(
      'S 复习 Skip',
      'S-07.repeatSkip',
      '重复 Skip：按本次 now 再保证 24h、继续延后且单调不回退（delta/fromNow/monotonic）',
      { delta: 15 * MINUTE, fromNow: DAY, monotonic: true },
      { delta: r2.due - due1, fromNow: r2.due - next, monotonic: r2.due >= due1 },
    )
  }

  // ---- S-07.c：原 due 更远时保留更远（Math.max 不缩短） ----
  {
    const farCore = await newScenario()
    setNow(T0)
    const far = T0 + 10 * DAY
    await put(farCore, baseRecord(farCore, D, 's07far', { stage: 3, due: far }))
    await farCore.deferMemoryDue(D, 's07far', 1)
    const rf = await get(farCore, D, 's07far')
    suite.check('S 复习 Skip', 'S-07.longDuePreserved', '原 due 更远时保留更远（只延后不缩短）', far, rf.due)
  }

  // ---- S-07.d：内存缓存与 DB 一致（upsertMemoryCache 生效） ----
  {
    const cacheCore = await newScenario()
    setNow(T0)
    await put(cacheCore, baseRecord(cacheCore, D, 's07cache', { stage: 3, due: T0 - HOUR }))
    await cacheCore.getMemoryRecords() // prime 内存缓存
    await cacheCore.deferMemoryDue(D, 's07cache', 1)
    const cached = (await cacheCore.getMemoryRecords()).find((r) => r.word === 's07cache')
    const fromDb = await get(cacheCore, D, 's07cache')
    suite.check(
      'S 复习 Skip',
      'S-07.cacheUpdated',
      'defer 后内存缓存与 DB 的 due 同步为 now+24h（不是旧 due）',
      [T0 + DAY, T0 + DAY],
      [cached && cached.due, fromDb && fromDb.due],
    )
  }
}

async function s08() {
  const core = await newScenario()
  setNow(T0)
  persistLevel(core, 'primary-1')
  await put(core, baseRecord(core, D, 'leech', { stage: 4, interval: 2, correct: 5, wrong: 2, lapses: 3, due: T0 - MINUTE }))
  await put(core, baseRecord(core, D, 'other', { stage: 3, correct: 3, due: T0 - MINUTE }))
  await core.updateMemoryProgress(D, 'leech', 1, 900)
  const rec = await get(core, D, 'leech')
  const key = core.memoryKey(D, 'leech')
  suite.check('S leech', 'S-08.lapses', 'lapses 3→4', 4, rec.lapses)
  suite.ok('S leech', 'S-08.suspended', 'lapses>=4 → 自动挂起（待攻克）', core.getSuspendedKeys().includes(key), core.getSuspendedKeys())
  suite.check('S leech', 'S-08.isSuspended', 'isSuspended 为真', true, core.isSuspended(D, 'leech'))
  const recs = await core.db.memoryRecords.toArray()
  const picked = new Set()
  for (let i = 0; i < 300; i++) {
    const p = await core.pickDynamicWord({ records: recs, recent: [], mode: 'auto' })
    if (p) picked.add(p.word.name)
  }
  suite.ok('S leech', 'S-08.notPicked', 'suspended 词不再出现在取词结果中', !picked.has('leech'), Array.from(picked).slice(0, 10))
  suite.ok('S leech', 'S-08.othersPicked', '非 suspended 词仍可抽出', picked.size > 0, picked.size)
  suite.check('S leech', 'S-08.resume', 'resumeWord 可恢复', true, core.resumeWord(D, 'leech'))
  suite.check('S leech', 'S-08.resumedKey', '恢复后 suspended 列表移除', false, core.getSuspendedKeys().includes(key))
  suite.check('S leech', 'S-08.resumedSkip', '恢复后 skip 计数清零', undefined, core.loadAutoLevelState().skipped[key])
}

async function s09() {
  const core = await newScenario()
  setNow(T0)
  core.pushWrongWordRequeue(D, 'gone')
  suite.check('S 删除清理', 'S-09.requeue', '错词进入会话重练队列', 1, core.getSessionRequeueCount())
  suite.check('S 删除清理', 'S-09.notYet', '间隔未到不立即重现', null, core.takeRequeueWord())
  core.removeFromRequeue(D, 'gone')
  suite.check('S 删除清理', 'S-09.removed', '删除后队列清空', 0, core.getSessionRequeueCount())
  let pulledBack = null
  for (let i = 0; i < 3; i++) {
    const w = core.takeRequeueWord()
    if (w) pulledBack = w
  }
  suite.check('S 删除清理', 'S-09.noPullBack', '删除后旧队列不会把词拉回', null, pulledBack)
  core.recordSkip(D, 'gone')
  core.recordSkip(D, 'gone')
  const skip3 = core.recordSkip(D, 'gone')
  suite.check('S 删除清理', 'S-09.skip3', 'Skip 3 次后 suspended', true, skip3.suspended)
  core.clearSkip(D, 'gone')
  suite.check('S 删除清理', 'S-09.cleared', '删除路径 clearSkip 后 skip/suspended 均清空', [undefined, false], [
    core.loadAutoLevelState().skipped[core.memoryKey(D, 'gone')],
    core.getSuspendedKeys().includes(core.memoryKey(D, 'gone')),
  ])
}

async function s10() {
  suite.check('S refresh 显式', 'S-10.fileRemoved', 'src/utils/refreshMarker.ts 已删除', false, fs.existsSync(path.join(SRC_UTILS, 'refreshMarker.ts')))
  const dbSrc = fs.readFileSync(path.join(SRC_UTILS, 'db', 'index.ts'), 'utf8')
  const memorySrc = fs.readFileSync(path.join(SRC_UTILS, 'memory.ts'), 'utf8')
  suite.check('S refresh 显式', 'S-10.noMarkerDb', 'db/index.ts 不引用 refreshMarker 全局标记', false, /refreshMarker|markRefresh/.test(dbSrc))
  suite.check('S refresh 显式', 'S-10.noMarkerMemory', 'memory.ts 不引用 refreshMarker 全局标记', false, /refreshMarker|markRefresh/.test(memorySrc))
  suite.check('S refresh 显式', 'S-10.explicitParam', 'updateMemoryProgress 有显式 isRefreshRequested 参数', true, /isRefreshRequested/.test(dbSrc))

  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's10', { stage: 2, interval: 0.5, due: T0 - MINUTE, correct: 2, wrong: 1 }))
  core.recordSkip(D, 's10')
  await core.updateMemoryProgress(D, 's10', 0, 800)
  const rec = await get(core, D, 's10')
  suite.check('S refresh 显式', 'S-10.endToEnd', 'Skip 后到期答对 = 正常升档 ok', ['ok', 3], [rec.lastResult, rec.stage])
}

async function s11() {
  const core = await newScenario()
  setNow(T0)
  await put(core, baseRecord(core, D, 's11', { stage: 3, interval: 1, due: T0 - MINUTE, ease: 2.5 }))
  await core.updateMemoryProgress(D, 's11', 0, 4000)
  const rec = await get(core, D, 's11')
  suite.check('S 影子调度', 'S-11.ease', '答对 ease 2.5→2.6', 2.6, rec.ease)
  suite.ok('S 影子调度', 'S-11.shadow', 'shadow 字段已写入（仅观测）', typeof rec.shadowInterval === 'number' && typeof rec.shadowDue === 'number', { shadowInterval: rec.shadowInterval, shadowDue: rec.shadowDue })
  suite.check('S 影子调度', 'S-11.dueUnaffected', 'due 只由 stage 档位决定，不受 ease/shadow 影响', localTs(2026, 1, 3, 0), rec.due)
}

// ===========================================================================
const scenarios = [
  a01, a02, a03, a04, a05, a06, a07a08, a09, a10, a11, a12, a13, a14,
  s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11,
]
for (const run of scenarios) {
  try {
    await run()
  } catch (e) {
    suite.fail('SCENARIO', `${run.name}.exception`, `场景抛错：${e && e.message}`, 'no throw', String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e))
  }
}

const exitCode = finishSim(suite, REPORT, {
  strict,
  extra: {
    tzVerified: -new Date(T0).getTimezoneOffset() === TZ_OFFSET_MIN,
    tzOffsetActualMin: -new Date(T0).getTimezoneOffset(),
  },
})
process.exit(exitCode)
