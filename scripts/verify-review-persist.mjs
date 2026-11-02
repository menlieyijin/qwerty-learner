#!/usr/bin/env node
// v11.6（F-7）：复习进度「会话 + 下标」拆分的纯函数回归。
//
// 背景：reviewModeInfo 原来整份词表存在一个 localStorage 键里，每翻一个词都要重新序列化全部单词。
// 拆分逻辑一旦出错，后果是「复习进度丢失 / 词表被写坏」，所以这里对拆分、合并、旧数据迁移做
// 直接断言（用 esbuild 把真实 TS 源码打成一个临时 ESM 再 import，不改 src）。
//
// 用法：npm run test:review-persist
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(join(process.cwd(), 'package.json'))
const REPO = resolve(import.meta.dirname, '..')
const SRC = join(REPO, 'src', 'store', 'reviewPersistence.ts')

let passed = 0
const failures = []
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS ${name}`)
  } else {
    failures.push(name)
    console.log(`FAIL ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'qz-review-'))
const outfile = join(dir, 'reviewPersistence.mjs')
try {
  require('esbuild').buildSync({
    entryPoints: [SRC],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    external: ['react'],
  })
  const mod = await import(pathToFileURL(outfile).href)
  const {
    splitReviewInfo,
    composeReviewInfo,
    isSameSession,
    planLegacyMigration,
    REVIEW_SESSION_STORAGE_KEY,
    REVIEW_INDEX_STORAGE_KEY,
    LEGACY_REVIEW_STORAGE_KEY,
  } = mod

  const words = [
    { name: 'apple', trans: ['n. 苹果'], usphone: 'ˈæpl', ukphone: 'ˈæpl' },
    { name: 'banana', trans: ['n. 香蕉'], usphone: 'bəˈnɑːnə', ukphone: 'bəˈnɑːnə' },
  ]
  const info = (index, extra = {}) => ({
    isReviewMode: true,
    reviewKind: 'wrong',
    reviewRecord: { dict: 'cet4', index, createTime: 1700000000, isFinished: false, words },
    ...extra,
  })

  // --- 键名（不能被改回旧键，否则升级用户的进度会丢） ---
  check('1 会话键名固定', REVIEW_SESSION_STORAGE_KEY === 'reviewModeInfo:session', REVIEW_SESSION_STORAGE_KEY)
  check('2 下标键名固定', REVIEW_INDEX_STORAGE_KEY === 'reviewModeInfo:index', REVIEW_INDEX_STORAGE_KEY)
  check('3 旧键名固定（迁移只删这个）', LEGACY_REVIEW_STORAGE_KEY === 'reviewModeInfo', LEGACY_REVIEW_STORAGE_KEY)

  // --- split ---
  const empty = splitReviewInfo(null)
  check('4 空值拆出空会话', empty.session === null && empty.index === 0, empty)
  check('5 非复习态拆出空会话', splitReviewInfo({ isReviewMode: false, reviewRecord: undefined }).session === null)
  const s1 = splitReviewInfo(info(3))
  check(
    '6 会话字段完整',
    s1.session.dict === 'cet4' && s1.session.createTime === 1700000000 && s1.session.reviewKind === 'wrong',
    s1.session,
  )
  check('7 词表按引用保留', s1.session.words === words)
  check('8 下标解析正确', s1.index === 3, s1.index)
  for (const bad of [-5, NaN, 'abc', undefined]) {
    check(`9 非法下标 ${String(bad)} 归零`, splitReviewInfo(info(bad)).index === 0, splitReviewInfo(info(bad)).index)
  }
  check(
    '10 词表非数组时不崩',
    splitReviewInfo({ isReviewMode: true, reviewRecord: { dict: 'x', index: 0, words: 'oops' } }).session.words.length === 0,
  )

  // --- compose ---
  const c1 = composeReviewInfo(s1.session, 7)
  check('11 合回后仍为复习态', c1.isReviewMode === true)
  check('12 合回后下标生效', c1.reviewRecord.index === 7, c1.reviewRecord.index)
  check('13 合回后词表不复制', c1.reviewRecord.words === words)
  check('14 无会话时合出非复习态', composeReviewInfo(null, 0).reviewRecord === undefined)
  check('15 词表为空时不返回幽灵会话', composeReviewInfo({ ...s1.session, words: [] }, 0).isReviewMode === false)
  check('16 合回时负下标归零', composeReviewInfo(s1.session, -2).reviewRecord.index === 0)

  // --- 往返 ---
  const back = splitReviewInfo(c1)
  check('17 往返后字段不变', back.index === 7 && back.session.dict === 'cet4' && back.session.isFinished === false, back.index)

  // --- 热路径判定：只有下标变化时必须判为「同一会话」，否则每次翻词都会重写词表 ---
  const composedA = composeReviewInfo(s1.session, 3)
  const composedB = composeReviewInfo(s1.session, 4)
  const splitA = splitReviewInfo(composedA)
  const splitB = splitReviewInfo(composedB)
  check('18 仅下标变化 → 同一会话（只写下标）', isSameSession(splitA.session, splitB.session) === true)
  check(
    '19 词表换新数组 → 不同会话（写词表）',
    isSameSession(splitA.session, splitReviewInfo(info(3, { reviewRecord: { ...info(3).reviewRecord, words: [...words] } })).session) ===
      false,
  )
  check('20 结束标记变化 → 不同会话', isSameSession(splitA.session, { ...splitA.session, isFinished: true }) === false)
  check('21 词库变化 → 不同会话', isSameSession(splitA.session, { ...splitA.session, dict: 'cet6' }) === false)
  check('22 两个空会话视为相同', isSameSession(null, null) === true)

  // --- 旧数据迁移 ---
  check('23 没有旧键 → 不迁移', planLegacyMigration(null, false) === null)
  const legacy = JSON.stringify({ isReviewMode: true, reviewKind: 'due', reviewRecord: { ...info(9).reviewRecord } })
  const plan = planLegacyMigration(legacy, false)
  check(
    '24 旧键迁移出会话与下标',
    plan && plan.session.dict === 'cet4' && plan.index === 9 && plan.removeLegacy === true,
    plan && plan.index,
  )
  const planNoOverwrite = planLegacyMigration(legacy, true)
  check('25 已有新数据时只删旧键、不覆盖', planNoOverwrite && planNoOverwrite.session === null && planNoOverwrite.removeLegacy === true)
  const planBroken = planLegacyMigration('{not json', false)
  check('26 旧键损坏时只删不抛错', planBroken && planBroken.session === null && planBroken.removeLegacy === true)
  const planIdle = planLegacyMigration(JSON.stringify({ isReviewMode: false, reviewRecord: undefined }), false)
  check('27 旧键是非复习态 → 迁移为空会话', planIdle && planIdle.session === null, planIdle && planIdle.session)

  console.log(`\nREVIEW_PERSIST ${passed}/${passed + failures.length}`)
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
