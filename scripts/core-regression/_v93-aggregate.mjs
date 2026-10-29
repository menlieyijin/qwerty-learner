#!/usr/bin/env node
/**
 * v9.3 回归门禁结果聚合：读取 srs-sim.mjs / sim-autolevel.mjs 的 --strict 报告，
 * 写 scripts/core-regression\v93-regression-result.json（断言总数/通过/失败/关键数字/口径差异）。
 *
 * 运行：node "scripts/core-regression\_v93-aggregate.mjs"
 * 前置：node srs-sim.mjs --strict && node sim-autolevel.mjs --strict
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const AUDIT = import.meta.dirname
const SRC = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(AUDIT, 'v93-regression-result.json')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) : null)

const srs = readJson(path.join(AUDIT, 'v93-srs-report.json'))
const auto = readJson(path.join(AUDIT, 'v93-autolevel-report.json'))
const detPath = path.join(AUDIT, 'v93-determinism.json')
const det = fs.existsSync(detPath) ? readJson(detPath) : null

const totals = {
  assertions: srs.total + auto.total,
  passed: srs.passed + auto.passed,
  failed: srs.failed + auto.failed,
}

const sourceFiles = {
  'src/utils/srsRules.ts': sha256(path.join(SRC, 'src/utils/srsRules.ts')),
  'src/utils/autoLevel.ts': sha256(path.join(SRC, 'src/utils/autoLevel.ts')),
  'src/utils/memory.ts': sha256(path.join(SRC, 'src/utils/memory.ts')),
  'src/utils/db/index.ts': sha256(path.join(SRC, 'src/utils/db/index.ts')),
  'src/utils/memoryLadder.ts': sha256(path.join(SRC, 'src/utils/memoryLadder.ts')),
  'src/utils/memoryKey.ts': sha256(path.join(SRC, 'src/utils/memoryKey.ts')),
  'src/utils/memoryCache.ts': sha256(path.join(SRC, 'src/utils/memoryCache.ts')),
  'src/utils/sessionRequeue.ts': sha256(path.join(SRC, 'src/utils/sessionRequeue.ts')),
  'src/utils/learningPath.ts': sha256(path.join(SRC, 'src/utils/learningPath.ts')),
}

const findings = [
  {
    id: 'B-07a-migrate-path',
    severity: 'info/口径',
    title: '无持久化状态时的首次迁移反推仍按“第一个有未学词的级别”跳过“全 seen 未掌握”级别',
    detail:
      'autoLevel.reevaluateLevel(migrate=true) 以 unseen>0 为停止条件；当某级 20 词都有记录但 stage=0/correct=0（seen 100%、mastered 0）时，迁移反推会直接落到下一级。' +
      '这与 v93-assertion-plan B-07a“不得整级跳过”的字面口径不一致；设计文档第一章明确迁移用“旧逻辑首次反推”，故按源码行为记录，未改 src。',
    assertion: 'sim-autolevel B-07a.migrateNote（当前断言源码实际行为：levelId 变为 primary-2）',
    suggestion: '若要求“全 seen 未掌握不得跳过”，需在 reevaluateLevel(migrate=true) 停止条件中加入 mastered 判定（Lead 决策）。',
  },
  {
    id: 'B-09-dynamic-ratio',
    severity: 'info/口径',
    title: '清债过程中新词占比会随 due 下降而回升，`≤5%` 只适用于 due 恒为 300 的固定配比假设',
    detail:
      'pickDynamicWord 每次按当前 dueCount 重算 newRatio/refreshChance：due=300 时 newRatio=0.02、refreshChance=0；' +
      '但每答对一个到期词 dueCount 就下降，跌破 300 后 newRatio 升到 0.1、跌破 100 后 0.2 且 refreshChance=0.03。' +
      '实测 due=300→0 清债共约 320 词次，新词约 5~6%、出现少量 review 取词，仍满足“≤360 词次清空”的硬门禁。',
    assertion: 'sim-autolevel B-09（cleared=300 / within≤360 / newRatio≤10% / refresh 仅在 due≤100 后出现）',
    suggestion: 'v93-assertion-plan B-09 的“新词≤5%、refresh=0”建议改为“清债≤360 词次 + 高债务阶段配比”。源码动态配比符合设计第三章第 3 条，无需修改。',
  },
  {
    id: 'B-18-cached-due',
    severity: 'info/口径',
    title: '取词 due 池按 memoryKey 计（同词不同词库各 1 条），但 cached.due（顶栏/数据页展示）按 word 去重',
    detail:
      'memory.pickDynamicWord 的 dueByKey 用 rec.key 去重（符合设计“due 用 key”）；autoLevel.countDueWords 用 normalizeWordName 去重（供 cached.due 展示）。' +
      '跨词库同名到期词会显示 1 而实际取词池有 2；不影响升级与取词正确性，仅展示口径差异。',
    assertion: 'sim-autolevel B-18.cachedDueNote（cached.due=1，due 取词池=2，两库均被抽到）',
    suggestion: '若要求展示与取词一致，可把 countDueWords 改为按 key 去重（Lead 决策，未改 src）。',
  },
]

const report = {
  meta: {
    designDoc: 'docs/DSH-FORK.md',
    assertionPlan: 'scripts/core-regression/README.md',
    sourceVersion: 'v9.7（工作副本 .，分支 dsh-local-v8；含 DATA-009 deferMemoryDue 精确 ≥N×24h 修复）',
    generatedAt: new Date().toISOString(),
    seed: srs.meta.seed,
    tzOffsetMin: srs.meta.tzOffsetMin,
    tzVerified: srs.meta.tzVerified,
    baseTs: srs.meta.baseTs,
    coreKind: 'esbuild 打包真实 src（非手写复刻）',
    coreBundle: '_v93-core.mjs',
    buildScript: 'scripts/core-regression\\_v93-build-core.mjs',
    harness: 'scripts/core-regression\\_v93-harness.mjs',
    sourceFiles,
    gateCommands: ['node "scripts/core-regression\\srs-sim.mjs" --strict', 'node "scripts/core-regression\\sim-autolevel.mjs" --strict'],
    note: '仿真核心由 esbuild 从真实源码打包（dexie/react/jotai/store/record 用 Node stub 替代，learningPath 真实但 fetch 注入词库），固定 seed=20261026、注入时钟、固定 +08:00；不 import TS、不改 src。',
  },
  srs: {
    exitCode: srs.failed === 0 ? 0 : 1,
    total: srs.total,
    passed: srs.passed,
    failed: srs.failed,
    byGroup: srs.byGroup,
    failures: srs.failures,
    report: 'scripts/core-regression\\v93-srs-report.json',
  },
  autoLevel: {
    exitCode: auto.failed === 0 ? 0 : 1,
    total: auto.total,
    passed: auto.passed,
    failed: auto.failed,
    byGroup: auto.byGroup,
    failures: auto.failures,
    report: 'scripts/core-regression\\v93-autolevel-report.json',
  },
  totals,
  keyNumbers: {
    srs: {
      firstWrongLapses: 0,
      matureSingleWrongStage: '6→4（降 2 档）',
      matureDoubleWrongStage: '6→0',
      dayGranularityDue: '本地自然日 00:00（23:30+1天档 = 30 分钟）',
      skipDefer: 'Skip 后 due = now + N×24h（精确毫秒，≥1 天；v9.7/DATA-009 修复，不再是次日 00:00）',
      clockRollbackAdvance: 'stage 3→4（不再永远 early-ok）',
      migrationSpreadWindow: '14 天（hash 稳定可复现）',
      leechThresholdLapses: 4,
      skipSuspendThreshold: 3,
    },
    autoLevel: {
      levelCompletion: 'seen 100% 且 mastered/required ≥ 0.9（required = total - suspended）',
      allWrongMastered: 0,
      thresholdBoundary: '18/20=90% 升级；17/20=85% 不升',
      dueRatio: { 0: 1.0, 10: 0.4, 50: 0.2, 200: 0.1, 300: 0.02, 301: 0.02 },
      refreshChance: { 0: 0.12, 10: 0.12, 50: 0.03, 200: 0, 300: 0, 301: 0 },
      due300Clear: { picks: '≈320（≤360）', newWordRatio: '≈5~6%（动态配比，见 findings）', refresh: '仅在 due≤100 后出现' },
      newWordOrder: '仅本级 unseen 文件顺序前 20 个随机；跨词库同词按 word 去重',
      loadFailure: "error='load-failed'，不判完成、不推进 levelId",
    },
  },
  findings,
  determinism: det
    ? { pass: det.pass, results: det.results, report: 'v93-determinism.json', command: 'node "scripts/core-regression\\_v93-determinism-check.mjs"' }
    : { pass: null, note: '未运行 _v93-determinism-check.mjs' },
  gate: {
    pass: totals.failed === 0 && srs.failed === 0 && auto.failed === 0 && (!det || det.pass === true),
    strictExitCodes: { srs: srs.failed === 0 ? 0 : 1, autoLevel: auto.failed === 0 ? 0 : 1 },
    command: 'node "scripts/core-regression\\srs-sim.mjs" --strict && node "scripts/core-regression\\sim-autolevel.mjs" --strict',
  },
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({
  out: OUT,
  totals: report.totals,
  srsByGroup: report.srs.byGroup,
  autoByGroup: report.autoLevel.byGroup,
  gate: report.gate,
}, null, 2))
process.exit(report.gate.pass ? 0 : 1)
