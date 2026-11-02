import {
  LEGACY_REVIEW_STORAGE_KEY,
  REVIEW_INDEX_STORAGE_KEY,
  REVIEW_SESSION_STORAGE_KEY,
  composeReviewInfo,
  isSameSession,
  planLegacyMigration,
  splitReviewInfo,
} from './reviewPersistence'
import type { ReviewInfoValue, ReviewSession } from './reviewPersistence'
import { safeStorage } from './storage'
import type { ReviewRecord } from '@/utils/db/record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

type TReviewInfoAtomData = {
  isReviewMode: boolean
  reviewRecord: ReviewRecord | undefined
  /** v9.0：复习来源。wrong=官方错题本回顾；due=记忆曲线到期复习 */
  reviewKind?: 'wrong' | 'due'
}

/**
 * v11.6（F-7 根因）：「会话」与「翻页下标」分两个键存。
 *
 * 旧实现把整份词表放在一个 `atomWithStorage` 里，每翻一个词都要 `JSON.stringify` 全部单词并同步写盘：
 * 几百词的复习会话每次翻词几十 KB，配额紧张时整份写失败，连进度都保不住。
 * 现在翻词只写 `reviewModeInfo:index`（几十字节），词表只在开始/结束复习时写一次。
 *
 * 旧键 `reviewModeInfo` 在模块加载时迁移一次（见下方 migrateLegacyReviewStorage），迁移后删除，
 * 因此升级用户不会丢正在进行的复习进度。
 *
 * 键名常量与 data-export 的「导入后清理」共用同一来源（v9.12 / M2-011 的约定）。
 */
function migrateLegacyReviewStorage() {
  try {
    const legacy = window.localStorage.getItem(LEGACY_REVIEW_STORAGE_KEY)
    if (!legacy) return
    const hasNewData =
      window.localStorage.getItem(REVIEW_SESSION_STORAGE_KEY) !== null || window.localStorage.getItem(REVIEW_INDEX_STORAGE_KEY) !== null
    const plan = planLegacyMigration(legacy, hasNewData)
    if (!plan) return
    if (plan.session) window.localStorage.setItem(REVIEW_SESSION_STORAGE_KEY, JSON.stringify(plan.session))
    if (plan.session || !hasNewData) window.localStorage.setItem(REVIEW_INDEX_STORAGE_KEY, JSON.stringify(plan.index))
    window.localStorage.removeItem(LEGACY_REVIEW_STORAGE_KEY)
  } catch {
    // localStorage 不可用（隐私模式 / file:// 限制）时保持原样：不迁移也不影响本次会话
  }
}

migrateLegacyReviewStorage()

export function reviewInfoAtom(initialValue: TReviewInfoAtomData) {
  const sessionAtom = atomWithStorage<ReviewSession | null>(REVIEW_SESSION_STORAGE_KEY, null, safeStorage<ReviewSession | null>())
  const indexAtom = atomWithStorage<number>(REVIEW_INDEX_STORAGE_KEY, 0, safeStorage<number>())

  return atom(
    (get) => {
      const composed = composeReviewInfo(get(sessionAtom), get(indexAtom))
      // 没有会话时回落到调用方给的初始值（与拆分前一致）
      return (composed.reviewRecord ? composed : initialValue) as TReviewInfoAtomData
    },
    (get, set, updater: TReviewInfoAtomData | ((oldValue: TReviewInfoAtomData) => TReviewInfoAtomData)) => {
      const prev = composeReviewInfo(get(sessionAtom), get(indexAtom))
      const prevValue = (prev.reviewRecord ? prev : initialValue) as TReviewInfoAtomData
      const newValue = typeof updater === 'function' ? updater(prevValue) : updater
      const before = splitReviewInfo(prevValue as ReviewInfoValue)
      const after = splitReviewInfo(newValue as ReviewInfoValue)

      if (!after.session) {
        // 退出复习：两个键都清掉，下次进入不会有残影
        if (before.session) set(sessionAtom, null)
        if (before.index !== 0) set(indexAtom, 0)
        return
      }
      // 词表没变（翻词 / 标记结束）：只写下标，词表一个字节都不重写
      if (!isSameSession(before.session, after.session)) set(sessionAtom, after.session)
      if (before.index !== after.index) set(indexAtom, after.index)
    },
  )
}
