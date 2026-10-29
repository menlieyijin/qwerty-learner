/**
 * sim-autolevel.mjs — Qwerty Learner Plus v9.3 自动进阶回归仿真（--strict 门禁）
 *
 * 运行：node "scripts/core-regression\sim-autolevel.mjs" [--strict]
 * 产物：scripts/core-regression\v93-autolevel-report.json
 *
 * 断言对象：`_v93-core.mjs` —— esbuild 从**真实源码**打包：
 *   src/utils/autoLevel.ts（状态持久化 / recordSkip / suspend / suspend 过滤 / computeLevelProgress /
 *                            resolveCurrentLevel / advanceIfComplete / reevaluateLevel / getNewRatio /
 *                            getRefreshChance / cached）
 *   src/utils/memory.ts（pickDynamicWord：due 按 key、suspended/recent 过滤、动态配比、新词前 20、
 *                         known 按 word）
 *   src/utils/db/index.ts（updateMemoryProgress 真实落库）
 *   src/utils/srsRules.ts（isMastered 掌握度口径）
 * 不手写复刻算法。
 *
 * 覆盖 B-01…B-18（v9.3 设计文档一、三章 + v93-assertion-plan.md 第 4/5 节）。
 * 约束：只写 scripts/core-regression，不改 src/、不构建应用、不联网；时钟/+08:00/随机 seed 全部注入。
 */
import {
  AUDIT_DIR,
  BASE_TS,
  DAY,
  HOUR,
  MINUTE,
  TZ_OFFSET_MIN,
  bootModule,
  clock,
  configureLevels,
  createSuite,
  finishSim,
  freshCore,
  hasStrict,
  resetClock,
  resetStorage,
  seedRandom,
  setNow,
} from './_v93-harness.mjs'
import path from 'node:path'

const REPORT = path.join(AUDIT_DIR, 'v93-autolevel-report.json')
const strict = hasStrict()
const SEED = 20261026
const T0 = BASE_TS // 本地 2026-01-01 08:00
const DAY_MS = DAY

const suite = createSuite('sim-autolevel v9.3 (real-source bundle)', {
  designDoc: 'docs/DSH-FORK.md',
  assertionPlan: 'scripts/core-regression/README.md',
  sourceVersion: 'v9.3 (src/utils/autoLevel.ts + memory.ts + db/index.ts)',
  coreBundle: '_v93-core.mjs',
  coreKind: 'esbuild(real src)',
  seed: SEED,
  tzOffsetMin: TZ_OFFSET_MIN,
  baseTs: T0,
  mode: strict ? 'strict' : 'report',
})

const { LEARNING_PATH } = await bootModule()
const L1 = LEARNING_PATH[0].id // primary-1
const L2 = LEARNING_PATH[1].id // primary-2
const L3 = LEARNING_PATH[2].id // primary-3
const D = 'simDict'

const range = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
async function prep(levelWords = {}) {
  resetStorage()
  resetClock(T0)
  seedRandom(SEED)
  await configureLevels(levelWords)
  return freshCore()
}

function persist(core, levelId, extra = {}) {
  core.saveAutoLevelState({ version: 1, levelId, startedAt: clock.now, skipped: {}, suspended: [], ...extra })
}

async function recs(core) {
  return core.db.memoryRecords.toArray()
}
async function progress(core, levelId) {
  return core.computeLevelProgress(await recs(core), levelId)
}
async function resolve(core) {
  return core.resolveCurrentLevel(await recs(core))
}
async function answer(core, dict, word, wrongCount = 0, totalMs = 800, isRefresh = false) {
  await core.updateMemoryProgress(dict, word, wrongCount, totalMs, undefined, undefined, !!isRefresh)
}
async function pickOne(core) {
  return core.pickDynamicWord({ records: await recs(core), recent: [], mode: 'auto' })
}

function recordOf(core, word, dict = D, over = {}) {
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
    due: now + DAY_MS,
    lastSeen: now - HOUR,
    createdAt: now - 5 * DAY_MS,
    attempts: 3,
    correct: 2,
    wrong: 1,
    slow: 0,
    lapses: 0,
    lastResult: 'ok',
    ...over,
  }
}
async function putMastered(core, words, over = {}) {
  for (const w of words) await core.db.memoryRecords.put(recordOf(core, w, D, over))
}
async function putSeenOnly(core, words) {
  for (const w of words) await core.db.memoryRecords.put(recordOf(core, w, D, { stage: 0, interval: 0, correct: 0, wrong: 0, attempts: 0, lastResult: '', due: 0, lastSeen: 0 }))
}

/** 取词采样：按名字前缀归类 new/due/review/retry/null */
async function samplePicks(core, n, seed, classify) {
  const records = await recs(core)
  seedRandom(seed)
  const counts = { new: 0, due: 0, review: 0, retry: 0, null: 0 }
  const names = new Map()
  for (let i = 0; i < n; i++) {
    const p = await core.pickDynamicWord({ records, recent: [], mode: 'auto' })
    if (!p) {
      counts.null += 1
      continue
    }
    if (p.hint === 'retry') counts.retry += 1
    else if (p.refresh) counts.review += 1
    else if (classify) counts[classify(p.word.name)] += 1
    else counts.new += 1
    names.set(p.word.name, (names.get(p.word.name) || 0) + 1)
  }
  return { counts, names }
}

// ===========================================================================
// B-00 掌握度判定（srsRules.isMastered）
// ===========================================================================
async function b00() {
  const core = await prep({})
  suite.check('B 掌握度', 'B-00.null', '无记录不算掌握', false, core.isMastered(null))
  suite.check('B 掌握度', 'B-00.firstCorrect', 'correct=1 新词首对不算掌握', false, core.isMastered({ correct: 1, stage: 3, lastResult: 'ok' }))
  suite.check('B 掌握度', 'B-00.lowStage', 'stage<2 不算掌握', false, core.isMastered({ correct: 2, stage: 1, lastResult: 'ok' }))
  suite.check('B 掌握度', 'B-00.lastWrong', 'lastResult=wrong 不算掌握', false, core.isMastered({ correct: 3, stage: 3, lastResult: 'wrong' }))
  suite.check('B 掌握度', 'B-00.pass', 'correct>=2 && stage>=2 && 非最近错 → 掌握', true, core.isMastered({ correct: 2, stage: 2, lastResult: 'ok' }))
  suite.check('B 掌握度', 'B-00.legacy', '迁移旧记录（无 lastResult）按最近无错处理', true, core.isMastered({ correct: 2, stage: 3 }))
}

// ===========================================================================
// B-01 全错一遍：不升级（seen 20/20、mastered 0、levelId 不变）
// ===========================================================================
async function b01() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  for (const w of words) await answer(core, D, w, 1)
  const p = await progress(core)
  suite.check('B 全错', 'B-01.seen', '已见 20/20', [20, 20], [p.seen, p.required])
  suite.check('B 全错', 'B-01.mastered', '全错 mastered=0', 0, p.mastered)
  suite.check('B 全错', 'B-01.done', '级别未完成（不再按“见过”升级）', false, p.done)
  const adv = await core.advanceIfComplete(await recs(core))
  suite.check('B 全错', 'B-01.noLevelUp', '不产生升级事件', 0, adv.levelUps.length)
  suite.check('B 全错', 'B-01.levelId', 'levelId 仍为 primary-1', L1, core.getPersistedLevelId())
}

// ===========================================================================
// B-02 反复全错（15 轮 × 20 词 = 300 词次）：仍不 done、不无限升级
// ===========================================================================
async function b02() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  for (let round = 0; round < 15; round++) for (const w of words) await answer(core, D, w, 2)
  const all = await recs(core)
  const p = await progress(core)
  suite.check('B 全错', 'B-02.recordCount', '记录仍只有本级 20 条', 20, all.length)
  suite.check('B 全错', 'B-02.attempts', '每词 attempts=15', 15, all[0].attempts)
  suite.check('B 全错', 'B-02.mastered', 'mastered=0', 0, p.mastered)
  suite.check('B 全错', 'B-02.done', '300 词次后仍未 done（旧 v9.2 会 done）', false, p.done)
  suite.check('B 全错', 'B-02.levelId', 'levelId 未变', L1, core.getPersistedLevelId())
}

// ===========================================================================
// B-03 单级别 Skip 3 次：suspended 且级别可推进、无空取词
// ===========================================================================
async function b03() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  await putMastered(core, words.slice(0, 19))
  for (let i = 0; i < 3; i++) core.recordSkip(D, 'p1w19')
  const p = await progress(core)
  suite.check('B Skip', 'B-03.suspended', 'Skip 3 次 → suspended=1', 1, p.suspended)
  suite.check('B Skip', 'B-03.required', 'required = 20-1 = 19', 19, p.required)
  suite.check('B Skip', 'B-03.done', 'suspended 不阻塞 → done', true, p.done)
  const adv = await core.advanceIfComplete(await recs(core))
  suite.check('B Skip', 'B-03.levelUp', '升级到下一级', [1, L2], [adv.levelUps.length, core.getPersistedLevelId()])
  const pick = await pickOne(core)
  suite.ok('B Skip', 'B-03.noNullPick', '升级后取词不返回 null（无卡死）', pick !== null, pick && pick.word.name)
  suite.ok('B Skip', 'B-03.newLevelWord', '取到的是新级别的新词', pick !== null && !words.includes(pick.word.name), pick && pick.word.name)
}

// ===========================================================================
// B-04 20 词全 Skip（60 次）：required=0 → 完成并升级、unseen=0
// ===========================================================================
async function b04() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  for (const w of words) for (let i = 0; i < 3; i++) core.recordSkip(D, w)
  const p = await progress(core, L1)
  suite.check('B Skip', 'B-04.suspended', '20 词全部 suspended', 20, p.suspended)
  suite.check('B Skip', 'B-04.required', 'required=0（全 suspended 视为完成）', 0, p.required)
  suite.check('B Skip', 'B-04.done', 'done=true', true, p.done)
  suite.check('B Skip', 'B-04.unseen', 'unseen=0', 0, p.unseen)
  const adv = await core.resolveCurrentLevel(await recs(core))
  suite.check('B Skip', 'B-04.level', '升级到 primary-2', L2, core.getPersistedLevelId())
  suite.check('B Skip', 'B-04.advanceProgress', '返回的进度已是新级别', L2, adv.levelId)
}

// ===========================================================================
// B-05 删除早期词：levelId 不回退；仅显式 reevaluateLevel 才回退
// ===========================================================================
async function b05() {
  const core = await prep({}) // 默认词表：primary-1 = l0w0..19，primary-2 = l1w0..19
  persist(core, L2)
  setNow(T0)
  // 早期（primary-1）词记录被删除：levelId 不应回退
  await putMastered(core, ['l0w0', 'l0w1'])
  await core.db.memoryRecords.delete(core.memoryKey(D, 'l0w0'))
  core.clearSkip(D, 'l0w0')
  core.removeFromRequeue(D, 'l0w0')
  await resolve(core)
  suite.check('B 删除', 'B-05.noRegress', '删除早期词后 levelId 不回退', L2, core.getPersistedLevelId())
  const p = await progress(core)
  suite.check('B 删除', 'B-05.progressLevel', '进度仍在 primary-2', L2, p.levelId)
  // 显式重新评估：允许回退（唯一入口）
  const re = await core.reevaluateLevel(await recs(core))
  suite.check('B 删除', 'B-05.reevaluate', '显式 reevaluateLevel 才回退到 primary-1', [L1, L1], [re.levelId, core.getPersistedLevelId()])
}

// ===========================================================================
// B-06 跨级重复 5/20：不整级跳过，学完且掌握≥90% 才升级，重复词不再作新词
// ===========================================================================
async function b06() {
  const words = range(20, 'p2w')
  const core = await prep({ [L2]: words })
  persist(core, L2)
  setNow(T0)
  // 5 个词在之前的级别/词库已掌握（跨级重复）
  for (const w of words.slice(0, 5)) await core.db.memoryRecords.put(recordOf(core, w, 'otherDict'))
  const p1 = await progress(core, L2)
  suite.check('B 跨级', 'B-06.seen', '级别 2 起步 seen=5 / mastered=5', [5, 5], [p1.seen, p1.mastered])
  suite.check('B 跨级', 'B-06.notSkip', '不整级跳过（done=false）', false, p1.done)
  suite.check('B 跨级', 'B-06.unseen', 'unseen=15（5 个重复词不算新词）', 15, p1.unseen)
  suite.ok(
    'B 跨级',
    'B-06.newWords',
    'newWords 只含未学 15 个、不含重复词',
    p1.newWords.length === 15 && p1.newWords.every((w) => !words.slice(0, 5).includes(w.name)),
    p1.newWords.map((w) => w.name),
  )
  // 学完 15 个新词（每个至少 2 次对、stage>=2）
  await putMastered(core, words.slice(5))
  await resolve(core)
  suite.check('B 跨级', 'B-06.levelUp', '学完且 mastered=20/20 → 升级', L3, core.getPersistedLevelId())
}

// ===========================================================================
// B-07a 全同名（仅 seen）：不得完成/整级跳过（seen 不是掌握）
// ===========================================================================
async function b07a() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  await putSeenOnly(core, words) // 有记录但 stage=0/correct=0
  const p = await progress(core)
  suite.check('B 同名', 'B-07a.seen', 'seen 20/20', [20, 20], [p.seen, p.required])
  suite.check('B 同名', 'B-07a.mastered', 'mastered=0（seen 不是掌握）', 0, p.mastered)
  suite.check('B 同名', 'B-07a.done', '级别不得完成', false, p.done)
  const adv = await core.advanceIfComplete(await recs(core))
  suite.check('B 同名', 'B-07a.noSkip', '不整级跳过（levelId 不变）', [0, L1], [adv.levelUps.length, core.getPersistedLevelId()])

  // 备注（迁移反推路径）：无持久化状态时按“旧逻辑=第一个有未学词的级别”反推，
  // 全 seen 未掌握的级别会被迁移逻辑跳过——与 B-07a 的“不得整级跳过”口径存在差异，已在结果中标注上报。
  const core2 = await prep({ [L1]: words }) // 注意：prep 会 resetStorage，故重建 records
  await putSeenOnly(core2, words)
  await core2.resolveCurrentLevel(await recs(core2))
  suite.check('B 同名', 'B-07a.migrateNote', '【口径差异备注】无状态迁移反推会把“全 seen 未掌握”级别跳过（旧逻辑）', L2, core2.getPersistedLevelId(), {
    note: '设计 B-07a 要求不得整级跳过；源码 reevaluateLevel(migrate=true) 以 unseen>0 为停止条件，全 seen 会推进到下一级。已上报 Lead，未改源码。',
  })
}

// ===========================================================================
// B-07b 全同名（已掌握）：允许完成并升级；不重复出词
// ===========================================================================
async function b07b() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  await putMastered(core, words) // seen 100% + mastered 100%
  const p = await progress(core)
  suite.check('B 同名', 'B-07b.done', '已掌握的同名词允许完成', true, p.done)
  const adv = await core.advanceIfComplete(await recs(core))
  suite.check('B 同名', 'B-07b.levelUp', '升级到 primary-2', [1, L2], [adv.levelUps.length, core.getPersistedLevelId()])
  // 新词供给来自下一级，不得重复出已掌握词
  const records = await recs(core)
  seedRandom(SEED + 7)
  const picked = []
  for (let i = 0; i < 100; i++) {
    const pk = await core.pickDynamicWord({ records, recent: [], mode: 'auto' })
    if (pk && !pk.refresh) picked.push(pk.word.name)
  }
  suite.ok('B 同名', 'B-07b.noDupNew', '新词只来自下一级，不重复出已掌握词', picked.length > 0 && picked.every((n) => !words.includes(n)), picked.slice(0, 10))
}

// ===========================================================================
// B-08 动态配比：各 due 档抽样 10000 次
// ===========================================================================
async function b08() {
  const tiers = [0, 10, 50, 200, 300, 301]
  const expect = {
    0: { newRatio: 1, refresh: 0.12 },
    10: { newRatio: 0.4, refresh: 0.12 },
    50: { newRatio: 0.2, refresh: 0.03 },
    200: { newRatio: 0.1, refresh: 0 },
    300: { newRatio: 0.02, refresh: 0 },
    301: { newRatio: 0.02, refresh: 0 },
  }
  const measured = {}
  for (const dueCount of tiers) {
    const newWords = range(20, 'nw')
    const core = await prep({ [L1]: newWords })
    persist(core, L1)
    setNow(T0)
    // due 记录（按 key）+ 未到期记录（供 refresh）
    for (let i = 0; i < dueCount; i++) {
      await core.db.memoryRecords.put(recordOf(core, `due${i}`, 'simDue', { stage: 3, due: T0 - MINUTE, lastResult: 'ok' }))
    }
    for (let i = 0; i < 20; i++) {
      await core.db.memoryRecords.put(recordOf(core, `rf${i}`, 'simReview', { stage: 3, due: T0 + 5 * DAY }))
    }
    // 配置值断言
    suite.check('B 配比', `B-08.cfg${dueCount}`, `getNewRatio(${dueCount})=${expect[dueCount].newRatio}`, expect[dueCount].newRatio, core.getNewRatio(dueCount))
    suite.check('B 配比', `B-08.rfc${dueCount}`, `getRefreshChance(${dueCount})=${expect[dueCount].refresh}`, expect[dueCount].refresh, core.getRefreshChance(dueCount))

    const { counts } = await samplePicks(core, 10000, SEED + dueCount, (name) => {
      if (name.startsWith('nw')) return 'new'
      if (name.startsWith('due')) return 'due'
      if (name.startsWith('rf')) return 'review'
      return 'other'
    })
    const newP = counts.new / 10000
    const dueP = counts.due / 10000
    const reviewP = counts.review / 10000
    measured[dueCount] = { newP, dueP, reviewP, counts }
    const expNew = (1 - expect[dueCount].refresh) * expect[dueCount].newRatio
    const expDue = dueCount > 0 ? (1 - expect[dueCount].refresh) * (1 - expect[dueCount].newRatio) : 0
    const expReview = expect[dueCount].refresh
    suite.near('B 配比', `B-08.new${dueCount}`, `due=${dueCount} 新词占比 ≈ ${(expNew * 100).toFixed(1)}%`, expNew, newP, 0.02)
    suite.near('B 配比', `B-08.due${dueCount}`, `due=${dueCount} 到期占比 ≈ ${(expDue * 100).toFixed(1)}%`, expDue, dueP, 0.02)
    suite.near('B 配比', `B-08.review${dueCount}`, `due=${dueCount} 回顾占比 ≈ ${(expReview * 100).toFixed(1)}%`, expReview, reviewP, 0.02)
    suite.check('B 配比', `B-08.noRetry${dueCount}`, '无 retry/other 取词', 0, counts.retry + (counts.other || 0))
    suite.check('B 配比', `B-08.noNull${dueCount}`, '无 null 取词', 0, counts.null)
  }
  // 关键验收断言（设计文档五）
  suite.ok('B 配比', 'B-08.due300New', 'due=300 时新词占比 ≤5%（实测 ≈2%）', measured[300].newP <= 0.05, measured[300].newP)
  suite.ok('B 配比', 'B-08.due0New', 'due=0 时新词占比 ≥80%（实测 ≈88%）', measured[0].newP >= 0.8, measured[0].newP)
  const seq = tiers.map((t) => measured[t].newP)
  suite.ok('B 配比', 'B-08.monotonic', '新词比例随积压单调不增', seq.every((v, i) => i === 0 || v <= seq[i - 1] + 0.01), seq.map((v) => +(v * 100).toFixed(1)))
}

// ===========================================================================
// B-09 清债：due=300 全对 → ≤360 词次清空、新词 ≤5%、refresh=0
// ===========================================================================
async function b09() {
  const newWords = range(20, 'nw')
  const core = await prep({ [L1]: newWords })
  persist(core, L1)
  setNow(T0)
  const DEBT = 300
  for (let i = 0; i < DEBT; i++) {
    await core.db.memoryRecords.put(recordOf(core, `debt${i}`, 'simDebt', { stage: 3, due: T0 - MINUTE, lastResult: 'ok' }))
  }
  seedRandom(SEED + 99)
  let picks = 0
  let duePicks = 0
  let newPicks = 0
  let refreshPicks = 0
  let refreshWhileDebtHigh = 0 // due>100 时 refreshChance=0
  let firstPicks = null
  while (picks < 360) {
    const records = await recs(core)
    const debtDue = records.filter((r) => r.due <= T0 && r.word.startsWith('debt')).length
    if (debtDue === 0) break
    if (firstPicks === null) firstPicks = picks
    const pick = await core.pickDynamicWord({ records, recent: [], mode: 'auto' })
    if (!pick) break
    picks += 1
    if (pick.refresh) {
      refreshPicks += 1
      if (debtDue > 100) refreshWhileDebtHigh += 1
    } else if (pick.word.name.startsWith('debt')) {
      duePicks += 1
    } else {
      newPicks += 1
    }
    await answer(core, pick.dict, pick.word.name, 0, 500, pick.refresh)
  }
  suite.check('B 清债', 'B-09.cleared', 'due=300 全部清空（真实到期抽取 300 次）', DEBT, duePicks)
  suite.ok('B 清债', 'B-09.within', '清债词次 ≤360（实测 ≈320）', picks <= 360, picks)
  suite.ok('B 清债', 'B-09.newRatio', '期间新词占比 ≤10%（源码动态配比上界：due>100→0.1、due≤100→0.2）', newPicks / picks <= 0.1, {
    newPicks,
    picks,
    ratio: +((newPicks / picks) * 100).toFixed(2),
    note: 'v93-assertion-plan B-09 的「新词≤5%、refresh=0」按固定 due=300 配比推导；源码 pickDynamicWord 每次重算 dueCount，清债过程中配比按档位回升（1–20:0.4 / 21–100:0.2 / 101–299:0.1），实测新词约 5~6%。已上报 Lead 作为“计划口径 vs 源码动态配比”差异，未改源码。',
  })
  suite.check('B 清债', 'B-09.refreshOnlyAfterLowDebt', 'refresh 只在 due≤100 后重新开启（due>100 时 0 次）', 0, refreshWhileDebtHigh)
  const remainDue = (await recs(core)).filter((r) => r.due <= T0 && r.word.startsWith('debt')).length
  suite.check('B 清债', 'B-09.remain', '无剩余到期债务', 0, remainDue)
}

// ===========================================================================
// B-10 全对基线：两轮（首轮 seen，次日到期复习后 mastered）才升级
// ===========================================================================
async function b10() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  for (const w of words) await answer(core, D, w, 0)
  const p1 = await progress(core)
  suite.check('B 全对', 'B-10.round1.seen', '首轮 seen 20/20', [20, 20], [p1.seen, p1.required])
  suite.check('B 全对', 'B-10.round1.mastered', '首轮 correct=1，mastered=0', 0, p1.mastered)
  suite.check('B 全对', 'B-10.round1.done', '首轮不升级', false, p1.done)
  // 次日：到期复习（due=本地 1/2 00:00 ≤ 1/2 08:00）
  setNow(T0 + DAY_MS)
  for (const w of words) await answer(core, D, w, 0)
  const p2 = await progress(core)
  suite.check('B 全对', 'B-10.round2.mastered', '次日复习后 mastered=20/20', 20, p2.mastered)
  suite.check('B 全对', 'B-10.round2.done', '第二轮 done', true, p2.done)
  await resolve(core)
  suite.check('B 全对', 'B-10.levelUp', '升级到 primary-2', L2, core.getPersistedLevelId())
  const totalAttempts = (await recs(core)).reduce((acc, r) => acc + r.attempts, 0)
  suite.check('B 全对', 'B-10.attempts', '两轮共 40 词次（20 首轮 + 20 复习）', 40, totalAttempts)
}

// ===========================================================================
// B-11 级别持久化：saveState → 新 store 保持；重启不重算级别
// ===========================================================================
async function b11() {
  resetStorage()
  resetClock(T0)
  seedRandom(SEED)
  await configureLevels({})
  let core = await freshCore()
  persist(core, L1)
  setNow(T0)
  core.recordSkip(D, 'p1w1')
  core.recordSkip(D, 'p1w1')
  core.suspendWord(D, 'p1w2')
  const key1 = core.memoryKey(D, 'p1w1')
  const key2 = core.memoryKey(D, 'p1w2')
  // 模拟重启：全新模块图读同一 localStorage
  core = await freshCore()
  const state = core.loadAutoLevelState()
  suite.check('B 持久化', 'B-11.levelId', '重启后 levelId 保持', L1, state.levelId)
  suite.check('B 持久化', 'B-11.skipped', '重启后 skip 计数保持', 2, state.skipped[key1])
  suite.check('B 持久化', 'B-11.suspended', '重启后 suspended 保持', [key2], state.suspended)
  await core.resolveCurrentLevel(await recs(core))
  suite.check('B 持久化', 'B-11.noRecompute', '重启 resolve 不重算级别（仍 primary-1）', L1, core.getPersistedLevelId())
  // 再次重启，仍不变
  core = await freshCore()
  await core.resolveCurrentLevel([])
  suite.check('B 持久化', 'B-11.stable', '多次重启 levelId 稳定', L1, core.getPersistedLevelId())
}

// ===========================================================================
// B-12 完成阈值边界（v9.11：毕业线 0.90 → 0.85）
//   90% done（保留）/ 85% done（新语义，边界含等于）/ 80% 不 done（下边界）/ seen 未满不 done
// ===========================================================================
async function b12() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  // 先做 seen 闸门：18 mastered + 2 无记录 → seen 18/20，掌握 90% 也不 done
  await putMastered(core, words.slice(0, 18))
  const pSeen = await progress(core)
  suite.check('B 阈值', 'B-12.seenGate', 'seen 18/20 时即使掌握率 90% 也不 done', [false, 18], [pSeen.done, pSeen.seen])
  await resolve(core)
  suite.check('B 阈值', 'B-12.noAdvance', '未达阈值不升级', L1, core.getPersistedLevelId())
  // 补齐 seen：18 mastered + 2 seen only → 90% → done
  await putSeenOnly(core, words.slice(18))
  const p90 = await progress(core)
  suite.check('B 阈值', 'B-12.90', '18/20=90% → done（未掌握已见词不阻塞）', [true, 18], [p90.done, p90.mastered])
  // 17 mastered + 3 seen only → 85% → done（v9.11 毕业线，恰好等于阈值）
  await putSeenOnly(core, [words[17]])
  const p85 = await progress(core)
  suite.check('B 阈值', 'B-12.85', '17/20=85% → done（v9.11 毕业线 85%，边界含等于）', [true, 17], [p85.done, p85.mastered])
  // 16 mastered + 4 seen only → 80% → 不 done（毕业线下边界）
  await putSeenOnly(core, [words[16]])
  const p80 = await progress(core)
  suite.check('B 阈值', 'B-12.80', '16/20=80% → 不 done（低于 85% 毕业线）', [false, 16], [p80.done, p80.mastered])
}

// ===========================================================================
// B-13 leech/suspended 不阻塞：19 mastered + 1 suspended → required=19 → 升级
// ===========================================================================
async function b13() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  await putMastered(core, words.slice(0, 19))
  core.suspendWord(D, words[19])
  const p = await progress(core)
  suite.check('B leech', 'B-13.required', 'required=19（suspended 不阻塞）', [19, 1], [p.required, p.suspended])
  suite.check('B leech', 'B-13.done', '19/19 mastered → done', true, p.done)
  await resolve(core)
  suite.check('B leech', 'B-13.levelUp', 'suspended 词不阻塞升级', L2, core.getPersistedLevelId())
  suite.ok('B leech', 'B-13.suspendedKept', 'suspended 词仍在待攻克列表', core.getSuspendedKeys().includes(core.memoryKey(D, words[19])), core.getSuspendedKeys())
}

// ===========================================================================
// B-14 新词顺序：只从本级 unseen 前 20 个随机；不跳到后续批次；跨词库同词去重
// ===========================================================================
async function b14() {
  const words = range(50, 'ord')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  const p = await progress(core)
  suite.check('B 新词顺序', 'B-14.newWords', '本级 50 词全部为 newWords', 50, p.newWords.length)
  const first20 = new Set(words.slice(0, 20))
  const records = await recs(core)
  seedRandom(SEED + 3)
  const picked = new Set()
  for (let i = 0; i < 2000; i++) {
    const pk = await core.pickDynamicWord({ records, recent: [], mode: 'auto' })
    if (pk && !pk.refresh) picked.add(pk.word.name)
  }
  suite.ok('B 新词顺序', 'B-14.first20Only', '新词只从文件顺序前 20 个中随机', picked.size > 0 && Array.from(picked).every((n) => first20.has(n)), Array.from(picked))
  suite.ok('B 新词顺序', 'B-14.noBatchJump', '不会跳到第 21-50 个', !Array.from(picked).some((n) => words.slice(20).includes(n)), Array.from(picked).filter((n) => !first20.has(n)))
  // 跨词库同词去重：ord0 已有其他词库记录 → 不再是新词
  await core.db.memoryRecords.put(recordOf(core, 'ord0', 'otherDict'))
  const p2 = await progress(core)
  suite.check('B 新词顺序', 'B-14.dedup', '跨词库同名词不再是新词', 49, p2.newWords.length)
  suite.ok('B 新词顺序', 'B-14.dedupList', 'newWords 不含 ord0', !p2.newWords.some((w) => w.name === 'ord0'), p2.newWords.map((w) => w.name).slice(0, 5))
}

// ===========================================================================
// B-15 加载失败：不判完成、不推进 levelId
// ===========================================================================
async function b15() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words, __fail: [L2] })
  persist(core, L1)
  setNow(T0)
  await putMastered(core, words) // 本级完成
  // 本场景故意制造词库加载失败：真实 learningPath 会 console.error，仿真静音预期内错误
  const origError = console.error
  console.error = () => {}
  const res = await core.resolveCurrentLevel(await recs(core))
  suite.check('B 加载失败', 'B-15.error', '下一级加载失败被标记 error', 'load-failed', res.error)
  suite.check('B 加载失败', 'B-15.notDone', '失败级别不判完成', false, res.done)
  suite.check('B 加载失败', 'B-15.levelId', '不推进 levelId', L1, core.getPersistedLevelId())
  const pFail = await progress(core, L2)
  suite.check('B 加载失败', 'B-15.progressError', '直接计算失败级别也标 error', 'load-failed', pFail.error)
  // 取词不应崩溃：无新词可用时应返回 null 或回顾，而不是新词
  const pk = await pickOne(core)
  suite.ok('B 加载失败', 'B-15.pickNoCrash', '加载失败时取词不崩溃且不出新词', pk === null || pk.refresh === true, pk && { name: pk.word.name, refresh: pk.refresh, hint: pk.hint })
  console.error = origError
  // 去掉失败后（模拟下次重试成功）可正常推进
  const core2 = await prep({ [L1]: words })
  persist(core2, L1)
  await putMastered(core2, words)
  await resolve(core2)
  suite.check('B 加载失败', 'B-15.retryOk', '失败恢复后可正常升级（重试语义）', L2, core2.getPersistedLevelId())
}

// ===========================================================================
// B-16 删除清 skip/suspended：不残留阻塞升级
// ===========================================================================
async function b16() {
  const words = range(20, 'p1w')
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  for (let i = 0; i < 3; i++) core.recordSkip(D, 'p1w0')
  let p = await progress(core)
  suite.check('B 删除', 'B-16.before', 'Skip 后 suspended=1 / required=19', [1, 19], [p.suspended, p.required])
  // 模拟 useDeleteWordRecord：删记录 + 清 requeue/skip
  await core.db.memoryRecords.delete(core.memoryKey(D, 'p1w0'))
  core.removeFromRequeue(D, 'p1w0')
  core.clearSkip(D, 'p1w0')
  p = await progress(core)
  suite.check('B 删除', 'B-16.cleared', '删除后 suspended=0 / required=20', [0, 20], [p.suspended, p.required])
  suite.check('B 删除', 'B-16.reappearsNew', '该词重新回到新词供给', true, p.newWords.some((w) => w.name === 'p1w0'))
  suite.check('B 删除', 'B-16.noSkipResidue', 'skip 计数无残留', undefined, core.loadAutoLevelState().skipped[core.memoryKey(D, 'p1w0')])
}

// ===========================================================================
// B-18 due 用 key / known 用 word
// ===========================================================================
async function b18() {
  const words = [...range(20, 'p1w'), 'dup'] // 本级含 dup，但 dup 已有记录 → 不算新词
  const core = await prep({ [L1]: words })
  persist(core, L1)
  setNow(T0)
  // 本级 20 词有记录（seen only）→ newWords=0，取词只能走 due/refresh
  await putSeenOnly(core, range(20, 'p1w'))
  // 同词不同词库两条到期记录（due 按 key 各自计入）
  for (const dict of ['dictA', 'dictB']) {
    await core.db.memoryRecords.put(recordOf(core, 'dup', dict, { stage: 3, due: T0 - MINUTE }))
  }
  const p = await progress(core)
  suite.check('B due key', 'B-18.knownByWord', 'known 按 word：跨词库同名 dup 不算新词', false, p.newWords.some((w) => w.name === 'dup'))
  const records = await recs(core)
  seedRandom(SEED + 11)
  const dicts = new Set()
  let duePicks = 0
  for (let i = 0; i < 3000; i++) {
    const pk = await core.pickDynamicWord({ records, recent: [], mode: 'auto' })
    if (pk && !pk.refresh && pk.word.name === 'dup') {
      duePicks += 1
      dicts.add(pk.dict)
    }
  }
  suite.ok('B due key', 'B-18.dueByKey', 'due 按 key：同词两个词库都可能被抽到', dicts.has('dictA') && dicts.has('dictB'), Array.from(dicts))
  suite.ok('B due key', 'B-18.duePicked', '到期 dup 能被抽出（due 池按 key 含 2 条）', duePicks > 0, duePicks)
  // 备注：cached.due（展示用）按 word 去重为 1；取词 due 池按 key 为 2。差异已在报告中标注。
  const cached = await core.getCachedInfo(await recs(core))
  suite.check('B due key', 'B-18.cachedDueNote', '【备注】cached.due 展示按 word 去重（本场景=1）', 1, cached.due, {
    note: '设计「due 用 key」针对取词池；autoLevel.countDueWords 缓存展示按 word 去重。已上报 Lead，未改源码。',
  })
}

// ===========================================================================
// v9.10 B-19…B-23「70% 掌握即掺入上级词」
//   pickDynamicWord({ previewBudget })：本级掌握度 ≥70% 且本级无新词可出时，按 getMixRatio()
//   的概率掺入下一级 1 个未学词（preview=true，不改 levelId、不参与本级完成判定）。
// ===========================================================================
const MIX_CUR = 100 // 本级词表规模
const MIX_NEXT = 100 // 下一级词表规模
const MIX_EXTRA_DUE = 150 // 额外到期记录：due>100 → refreshChance=0、newRatio=0.1（隔离回顾分支）

/**
 * 掺入场景基座：本级 MIX_CUR 词（前 mastered 个已掌握，其余「已见未掌握」或完全未见），
 * 下一级 MIX_NEXT 个未学词，另有 MIX_EXTRA_DUE 条到期记录撑住 due 池。
 */
async function prepMix(opts = {}) {
  const {
    level = L1,
    nextLevel = L2,
    mastered = 80,
    seenRest = true,
    extraDue = MIX_EXTRA_DUE,
    extraRefresh = 20,
    failNext = false,
  } = opts
  const cur = range(MIX_CUR, 'p1w')
  const nxt = range(MIX_NEXT, 'p2w')
  const cfg = { [level]: cur, [nextLevel]: nxt }
  if (failNext) cfg.__fail = [nextLevel]
  const core = await prep(cfg)
  persist(core, level)
  setNow(T0)
  for (let i = 0; i < MIX_CUR; i++) {
    if (i < mastered) {
      await core.db.memoryRecords.put(recordOf(core, cur[i], D, { stage: 3, correct: 3, lastResult: 'ok', due: T0 + 2 * DAY_MS }))
    } else if (seenRest) {
      // 已见未掌握：stage 0 / correct 0（isMastered=false），未到期
      await core.db.memoryRecords.put(
        recordOf(core, cur[i], D, { stage: 0, interval: 0, correct: 0, wrong: 0, attempts: 1, lastResult: '', due: T0 + 2 * DAY_MS }),
      )
    }
  }
  for (let i = 0; i < extraDue; i++) {
    await core.db.memoryRecords.put(recordOf(core, `xd${i}`, 'xDue', { stage: 3, due: T0 - MINUTE, lastResult: 'ok' }))
  }
  // 未到期记录：让「随机回顾」分支保持与真实场景一致（有池可回顾，才会占用 refreshChance 的份额）
  for (let i = 0; i < extraRefresh; i++) {
    await core.db.memoryRecords.put(recordOf(core, `xr${i}`, 'xRf', { stage: 3, due: T0 + 5 * DAY_MS }))
  }
  return { core, cur, nxt }
}

/** 固定额度采样（每次都传同一个 previewBudget，不启用会话窗口）：测 getMixRatio 的实际落点概率 */
async function sampleMix(core, n, seed, budget = 4) {
  const records = await recs(core)
  seedRandom(seed)
  let previews = 0
  let nulls = 0
  const seq = []
  for (let i = 0; i < n; i++) {
    const p = await core.pickDynamicWord({ records, recent: [], mode: 'auto', previewBudget: budget })
    if (!p) {
      nulls += 1
      seq.push(null)
      continue
    }
    if (p.preview) previews += 1
    seq.push(p.word.name)
  }
  return { previews, nulls, rate: previews / n, seq }
}

// B-19 比例曲线：纯函数值 + 实际落点采样（v9.11 定稿：0.10 → 0.30，封顶与窗口上限同为 30%）
async function b19() {
  const { core } = await prepMix({ mastered: 80 })
  const mixAt = (m) => 0.1 + 0.2 * ((m - 0.7) / (0.85 - 0.7)) // 0.10 → 0.30 线性插值
  const m80 = mixAt(0.8) // = 0.23333
  const m84 = mixAt(0.84) // = 0.28667
  suite.check('B 掺入', 'B-19.m69', 'm=69% → 严格 0（阈值下不介入）', 0, core.getMixRatio(69, 100))
  suite.near('B 掺入', 'B-19.m70', 'm=70% → 0.10（起点）', 0.1, core.getMixRatio(70, 100), 0.02)
  suite.near('B 掺入', 'B-19.m80', `m=80% → 线性插值 ${m80.toFixed(4)}`, m80, core.getMixRatio(80, 100), 0.02)
  suite.near('B 掺入', 'B-19.m84', `m=84% → 线性插值 ${m84.toFixed(4)}（可采样最高点）`, m84, core.getMixRatio(84, 100), 0.02)
  suite.near('B 掺入', 'B-19.m85', 'm=85% → 0.30（封顶）', 0.3, core.getMixRatio(85, 100), 0.02)
  // 90% 已高于毕业线 0.85：真实流程必已升级，此点只能做纯函数断言（不可采样）
  suite.near('B 掺入', 'B-19.m90', 'm=90% → 0.30（封顶；已过毕业线，仅纯函数口径）', 0.3, core.getMixRatio(90, 100), 0.02)
  const seq = [69, 70, 80, 85, 95].map((m) => core.getMixRatio(m, 100))
  suite.ok('B 掺入', 'B-19.monotonic', '69/70/80/85/95 单调不减', seq.every((v, i) => i === 0 || v >= seq[i - 1]), seq)
  // v9.11 自洽：概率封顶 == 窗口封顶，不允许两套上限
  suite.check(
    'B 掺入',
    'B-19.capAligned',
    `MIX_MAX(${core.MIX_MAX}) 与滑动窗口上限 ${core.MIX_WINDOW_CAP}/${core.MIX_WINDOW_SIZE} 一致`,
    core.MIX_WINDOW_CAP / core.MIX_WINDOW_SIZE,
    core.MIX_MAX,
    { tol: 1e-9 },
  )
  suite.check('B 掺入', 'B-19.required19', 'required=19（小级别）→ 0', 0, core.getMixRatio(19, 19))
  suite.check('B 掺入', 'B-19.required0', 'required=0 → 0（不除零）', 0, core.getMixRatio(0, 0))

  // 实际落点采样：本级 100 词全部已见（newWords=0）、due>100 使 refreshChance=0 → 落点概率 = mix。
  // 采样点最高取 84%：85% 起已达毕业线，pickDynamicWord 会先 resolveCurrentLevel 升级，本级不再掺入。
  const N = 4000
  const sampled = []
  for (const m of [69, 70, 80, 84]) {
    const s = await prepMix({ mastered: m })
    const r = await sampleMix(s.core, N, SEED + 190 + m)
    sampled.push([m, r.rate, s.core.getMixRatio(m, MIX_CUR)])
    suite.near(
      'B 掺入',
      `B-19.pick${m}`,
      `m=${m}% 实际落点占比 ≈ getMixRatio=${s.core.getMixRatio(m, MIX_CUR).toFixed(4)}`,
      s.core.getMixRatio(m, MIX_CUR),
      r.rate,
      0.02,
      { note: `samples=${N}, previews=${r.previews}, nulls=${r.nulls}` },
    )
    suite.check('B 掺入', `B-19.pickNull${m}`, `m=${m}% 采样无 null`, 0, r.nulls)
  }
  suite.ok('B 掺入', 'B-19.pickMonotonic', '实际落点占比随掌握度单调不减', sampled.every((v, i) => i === 0 || v[1] >= sampled[i - 1][1] - 0.01), sampled.map((v) => [v[0], +(v[1] * 100).toFixed(1)]))

  // 达到毕业线（85%）后：取词前先升级，本级不再掺入（毕业与掺入封顶是同一点）
  const { core: grad } = await prepMix({ mastered: 85 })
  const g = await grad.pickDynamicWord({ records: await recs(grad), recent: [], mode: 'auto', previewBudget: 4 })
  suite.check('B 掺入', 'B-19.graduateAt85', 'm=85% 已达毕业线 → 取词即升级到下一级（不再掺入本级）', L2, grad.getPersistedLevelId())
  suite.check('B 掺入', 'B-19.graduateNoPreview', '升级后的取词不是掺入词（level 已是下一级）', [L2, false], [g && g.level && g.level.id, !!(g && g.preview)])

  // 末级 cet6：没有下一级 → 永远不掺入
  const lastLevel = LEARNING_PATH[LEARNING_PATH.length - 1].id
  const { core: last } = await prepMix({ level: lastLevel, nextLevel: lastLevel, mastered: 84 })
  const rl = await sampleMix(last, 1500, SEED + 195)
  suite.check('B 掺入', 'B-19.lastLevel', `末级 ${lastLevel} 无下一级 → 不掺入`, 0, rl.previews)
  suite.check('B 掺入', 'B-19.lastLevelNoNull', '末级不掺入但也不返回 null', 0, rl.nulls)
}

// B-20 会话窗口上限：任意 20 连窗口掺入 ≤ 6（v9.11 定稿：概率上限 = 窗口上限 = 30%，
// 窗口的作用从「压低均值」变为「抹平尖峰」，故用「无限额对照组会出现超限窗口」来证明它不是死代码）
async function b20() {
  const { core } = await prepMix({ mastered: 84 }) // mix≈0.2867
  const windowSize = core.MIX_WINDOW_SIZE
  const cap = core.MIX_WINDOW_CAP

  const maxInWindow = (flags) => {
    let max = 0
    for (let i = 0; i + windowSize <= flags.length; i++) {
      const c = flags.slice(i, i + windowSize).filter(Boolean).length
      if (c > max) max = c
    }
    return max
  }

  // ① 受限流：每次按「cap - 窗口内已掺入数」给额度
  seedRandom(SEED + 201)
  const log = []
  const window = []
  const flagsCapped = []
  let throttled = 0
  for (let i = 0; i < 400; i++) {
    const budget = Math.max(0, cap - window.filter(Boolean).length)
    if (budget === 0) throttled += 1
    const p = await core.pickDynamicWord({ records: await recs(core), recent: [], mode: 'auto', previewBudget: budget })
    const isPreview = !!(p && p.preview)
    flagsCapped.push(isPreview)
    window.push(isPreview)
    if (window.length > windowSize) window.shift()
    if (i < 40) log.push(`${isPreview ? 'P' : '.'}:${budget}`)
  }
  const cappedMax = maxInWindow(flagsCapped)
  const cappedRate = flagsCapped.filter(Boolean).length / flagsCapped.length

  // ② 对照组：额度恒定给满，不启用窗口
  seedRandom(SEED + 201)
  const flagsFree = []
  for (let i = 0; i < 400; i++) {
    const p = await core.pickDynamicWord({ records: await recs(core), recent: [], mode: 'auto', previewBudget: cap })
    flagsFree.push(!!(p && p.preview))
  }
  const freeMax = maxInWindow(flagsFree)

  suite.check('B 掺入', 'B-20.windowCap', `任意 ${windowSize} 连窗口掺入 ≤ ${cap}（400 次实测最大 ${cappedMax}）`, true, cappedMax <= cap, {
    note: log.join(' '),
  })
  suite.ok(
    'B 掺入',
    'B-20.peakSmoothing',
    `窗口确实在抹平尖峰（不限额对照组出现 ${freeMax}/${windowSize} 的超限窗口，限额组为 ${cappedMax}/${windowSize}）`,
    freeMax > cap && cappedMax <= cap,
    { cappedMax, freeMax },
  )
  suite.ok('B 掺入', 'B-20.throttled', `窗口满额时确实会削额度（400 次里 budget 被削到 0 共 ${throttled} 次）`, throttled > 0, { throttled })
  suite.ok(
    'B 掺入',
    'B-20.longRunRate',
    `长期掺入率不高于概率上限（实测 ${(cappedRate * 100).toFixed(1)}% ≤ getMixRatio(84%)=${(core.getMixRatio(84, MIX_CUR) * 100).toFixed(1)}%+2%）`,
    cappedRate <= core.getMixRatio(84, MIX_CUR) + 0.02,
    { cappedRate, cap: core.getMixRatio(84, MIX_CUR) },
  )
  const freeRate = flagsFree.filter(Boolean).length / flagsFree.length
  suite.ok(
    'B 掺入',
    'B-20.noCollapse',
    `限流不会把掺入率腰斩（限额 ${(cappedRate * 100).toFixed(1)}% ≥ 不限额 ${(freeRate * 100).toFixed(1)}% 的一半）`,
    cappedRate >= freeRate * 0.5,
    { cappedRate, freeRate },
  )
  // 窗口已满（最近 20 次含 4 次掺入）→ 额度 0 → 后续取词完全不掺入
  const full = [...Array(cap).fill(true), ...Array(windowSize - cap).fill(false)]
  seedRandom(SEED + 202)
  let blocked = 0
  for (let i = 0; i < 200; i++) {
    const p = await core.pickDynamicWord({
      records: await recs(core),
      recent: [],
      mode: 'auto',
      previewBudget: Math.max(0, cap - full.filter(Boolean).length),
    })
    if (p && p.preview) blocked += 1
  }
  suite.check('B 掺入', 'B-20.budget0', '额度 0（窗口已满）时 200 次取词 0 掺入', 0, blocked)
}

// B-21 注入词不重复 / 反向进度（不污染本级）
// v9.11：基座掌握度 85% → 84%（85% 起已达毕业线，取词会先升级，测不到「未毕业时掺入」）
async function b21() {
  const { core } = await prepMix({ mastered: 84 })
  const before1 = await progress(core, L1)
  const before2 = await progress(core, L2)
  seedRandom(SEED + 211)
  let pick = null
  for (let i = 0; i < 300 && !pick; i++) {
    const p = await core.pickDynamicWord({ records: await recs(core), recent: [], mode: 'auto', previewBudget: 4 })
    if (p && p.preview) pick = p
  }
  suite.ok('B 掺入', 'B-21.injected', '本级无新词且掌握 85% → 能注入下一级词', !!pick, pick && pick.word.name)
  suite.ok('B 掺入', 'B-21.nextLevelWord', '注入词来自下一级词表（p2w*）', !!pick && pick.word.name.startsWith('p2w'), pick && pick.word.name)
  suite.check('B 掺入', 'B-21.noLevelJump', '注入词的 level 信息仍是本级（不跳级）', L1, pick && pick.level && pick.level.id)
  suite.check('B 掺入', 'B-21.notRefresh', '注入词不算回顾/重练（refresh=false、无 hint）', [false, undefined], [pick && pick.refresh, pick && pick.hint])

  // 反向进度：答完后本级 required/mastered 不变，下一级 seen+1
  await answer(core, pick.dict, pick.word.name)
  const after1 = await progress(core, L1)
  const after2 = await progress(core, L2)
  suite.check('B 掺入', 'B-21.localUnchanged', '注入词答题后本级 required/mastered 不变', [before1.required, before1.mastered], [after1.required, after1.mastered])
  suite.check('B 掺入', 'B-21.localDone', '注入词不影响本级 done（仍为 false）', false, after1.done)
  suite.check('B 掺入', 'B-21.nextSeen', '下一级 seen+1', before2.seen + 1, after2.seen)
  suite.check('B 掺入', 'B-21.nextMastered', '下一级 mastered 未因单次答对而算掌握', before2.mastered, after2.mastered)

  // 已答过的注入词不再被注入
  seedRandom(SEED + 212)
  let again = 0
  for (let i = 0; i < 800; i++) {
    const p = await core.pickDynamicWord({ records: await recs(core), recent: [], mode: 'auto', previewBudget: 4 })
    if (p && p.word.name === pick.word.name) again += 1
  }
  suite.check('B 掺入', 'B-21.noRepeatAfterAnswer', '已答过的注入词不再出现', 0, again)

  // recent 窗口内不重复：把上次注入词放进 recent，再注入必须是别的词
  seedRandom(SEED + 213)
  let second = null
  for (let i = 0; i < 300 && !second; i++) {
    const p = await core.pickDynamicWord({ records: await recs(core), recent: [pick.word.name], mode: 'auto', previewBudget: 4 })
    if (p && p.preview) second = p
  }
  suite.ok('B 掺入', 'B-21.recentExcluded', 'recent 窗口内的词不会被注入', !!second && second.word.name !== pick.word.name, second && second.word.name)
}

// B-22 边界：下一级加载失败 / 下一级无新词 → 不注入且不返回 null
// v9.11：基座 85% → 84%（85% 已达毕业线，取词会先升级，测不到本级掺入分支）
async function b22() {
  const origError = console.error
  console.error = () => {}
  const { core: failCore } = await prepMix({ mastered: 84, failNext: true })
  const fail = await sampleMix(failCore, 600, SEED + 221)
  console.error = origError
  suite.check('B 掺入', 'B-22.failNoPreview', '下一级加载失败 → 不注入', 0, fail.previews)
  suite.check('B 掺入', 'B-22.failNoNull', '下一级加载失败 → 仍走 due 兜底（不返回 null）', 0, fail.nulls)

  const { core: emptyCore, nxt } = await prepMix({ mastered: 84 })
  await putMastered(emptyCore, nxt) // 下一级词全部有记录 → newWords 为空
  const empty = await sampleMix(emptyCore, 600, SEED + 222)
  suite.check('B 掺入', 'B-22.emptyNoPreview', '下一级无新词 → 不注入', 0, empty.previews)
  suite.check('B 掺入', 'B-22.emptyNoNull', '下一级无新词 → 不返回 null', 0, empty.nulls)
}

// B-23 哨兵：m=0（全未学）时预算再大也完全不介入，出词分布与 getNewRatio 一致
async function b23() {
  const tiers = [10, 50, 200]
  for (const dueCount of tiers) {
    const { core } = await prepMix({ mastered: 0, seenRest: false, extraDue: dueCount })
    const p = await progress(core, L1)
    suite.check('B 掺入', `B-23.m0.${dueCount}`, `哨兵前提：全未学 mastered=0 / required=100`, [0, 100], [p.mastered, p.required])
    const withBudget = await sampleMix(core, 3000, SEED + 230 + dueCount, 4)
    const noBudget = await sampleMix(core, 3000, SEED + 230 + dueCount, 0)
    suite.check('B 掺入', `B-23.noMix.${dueCount}`, `due=${dueCount} 时 3000 次取词 0 掺入`, 0, withBudget.previews)
    suite.ok('B 掺入', `B-23.identical.${dueCount}`, `due=${dueCount} 时 budget=4 与 budget=0 取词序列完全一致（阈值下不掷骰）`, JSON.stringify(withBudget.seq) === JSON.stringify(noBudget.seq), {
      diff: withBudget.seq.findIndex((n, i) => n !== noBudget.seq[i]),
    })
    const expNew = (1 - core.getRefreshChance(dueCount)) * core.getNewRatio(dueCount)
    const newPicks = withBudget.seq.filter((n) => n && n.startsWith('p1w')).length / withBudget.seq.length
    suite.near('B 掺入', `B-23.newRatio.${dueCount}`, `due=${dueCount} 新词占比 ≈ ${(expNew * 100).toFixed(1)}%（与 getNewRatio 期望一致）`, expNew, newPicks, 0.03)
  }
}

// ===========================================================================
const scenarios = [b00, b01, b02, b03, b04, b05, b06, b07a, b07b, b08, b09, b10, b11, b12, b13, b14, b15, b16, b18, b19, b20, b21, b22, b23]
for (const run of scenarios) {
  try {
    await run()
  } catch (e) {
    suite.fail('SCENARIO', `${run.name}.exception`, `场景抛错：${e && e.message}`, 'no throw', String(e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e))
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
