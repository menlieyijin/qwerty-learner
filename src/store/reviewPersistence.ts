import type { Word } from '@/typings'

/**
 * 复习会话的持久化形状（v11.6 / F-7）。
 *
 * 背景：原来整个 `reviewModeInfo`（含完整词表）放在**一个** key 里，每翻一个词
 * `setReviewModeInfo({...record, index})` 都会把几百个单词重新 `JSON.stringify` 并同步写 localStorage。
 * 词表越大写得越慢，配额满时还会整份写失败 —— 连「翻到第几个词」都留不下来。
 *
 * 现在拆成两个键：
 * - `session`：会话本身（词表、词库、创建时间、是否结束），只在开始/结束复习时写；
 * - `index`：当前下标，每次翻词只写几十个字节。
 *
 * 拆分/合并与旧数据迁移都放在这个纯函数模块里，方便在 Node 里直接回归（`npm run test:review-persist`）。
 */

/** 一个复习会话（不含翻页下标） */
export type ReviewSession = {
  isReviewMode: boolean
  reviewKind?: 'wrong' | 'due'
  dict: string
  createTime: number
  isFinished: boolean
  words: Word[]
}

/** `reviewModeInfoAtom` 对外的值，保持与拆分前完全一致 */
export type ReviewInfoValue = {
  isReviewMode: boolean
  reviewRecord?: {
    dict: string
    index: number
    createTime: number
    isFinished: boolean
    words: Word[]
  }
  reviewKind?: 'wrong' | 'due'
}

export type ReviewSnapshot = { session: ReviewSession | null; index: number }

export const EMPTY_REVIEW_INFO: ReviewInfoValue = { isReviewMode: false, reviewRecord: undefined }

/** 旧版单键存储（升级时迁移一次，迁移后删除） */
export const LEGACY_REVIEW_STORAGE_KEY = 'reviewModeInfo'
/** 会话键：只在开始/结束复习时写 */
export const REVIEW_SESSION_STORAGE_KEY = 'reviewModeInfo:session'
/** 下标键：每次翻词写一次（≈30B） */
export const REVIEW_INDEX_STORAGE_KEY = 'reviewModeInfo:index'

const toIndex = (value: unknown): number => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 把对外的 `reviewModeInfo` 值拆成「会话 + 下标」；非复习态返回 `{session:null,index:0}` */
export function splitReviewInfo(value: ReviewInfoValue | null | undefined): ReviewSnapshot {
  if (!value || !value.isReviewMode || !value.reviewRecord) return { session: null, index: 0 }
  const record = value.reviewRecord
  return {
    session: {
      isReviewMode: true,
      ...(value.reviewKind ? { reviewKind: value.reviewKind } : {}),
      dict: typeof record.dict === 'string' ? record.dict : '',
      createTime: Number.isFinite(Number(record.createTime)) ? Number(record.createTime) : 0,
      isFinished: !!record.isFinished,
      words: Array.isArray(record.words) ? record.words : [],
    },
    index: toIndex(record.index),
  }
}

/** 把「会话 + 下标」拼回对外的值；会话缺失/已退出复习时返回空值 */
export function composeReviewInfo(session: ReviewSession | null | undefined, index: number): ReviewInfoValue {
  if (!session || !session.isReviewMode || !Array.isArray(session.words) || session.words.length === 0) {
    return { isReviewMode: false, reviewRecord: undefined }
  }
  return {
    isReviewMode: true,
    ...(session.reviewKind ? { reviewKind: session.reviewKind } : {}),
    reviewRecord: {
      dict: session.dict,
      index: toIndex(index),
      createTime: session.createTime,
      isFinished: session.isFinished,
      words: session.words,
    },
  }
}

/**
 * 会话内容是否没变（只有下标/结束标记可能变）。
 * `words` 用**引用**比较：翻词时 `{...record, index}` 保留同一个数组，因此这里能 O(1) 判定，
 * 不需要每次翻词都深比较整份词表。
 */
export function isSameSession(a: ReviewSession | null | undefined, b: ReviewSession | null | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.isReviewMode === b.isReviewMode &&
    a.reviewKind === b.reviewKind &&
    a.dict === b.dict &&
    a.createTime === b.createTime &&
    a.isFinished === b.isFinished &&
    a.words === b.words
  )
}

/**
 * 旧版单键数据的迁移计划。
 *
 * @param legacyRaw localStorage 里的原始字符串（可能为 null）
 * @param hasNewData 新键是否已有数据（有则只清理旧键，不覆盖）
 * @returns 需要写入的会话/下标；`null` 表示无需迁移
 */
export function planLegacyMigration(
  legacyRaw: string | null,
  hasNewData: boolean,
): { session: ReviewSession | null; index: number; removeLegacy: true } | null {
  if (!legacyRaw) return null
  if (hasNewData) return { session: null, index: 0, removeLegacy: true }
  try {
    const parsed = JSON.parse(legacyRaw) as ReviewInfoValue
    const { session, index } = splitReviewInfo(parsed)
    return { session, index, removeLegacy: true }
  } catch {
    // 旧键被手工改坏：直接丢掉，不能让坏 JSON 卡住启动
    return { session: null, index: 0, removeLegacy: true }
  }
}
