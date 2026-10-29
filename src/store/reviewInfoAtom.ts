import { safeStorage } from './storage'
import { REVIEW_MODE_INFO_STORAGE_KEY } from '@/constants'
import type { ReviewRecord } from '@/utils/db/record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

type TReviewInfoAtomData = {
  isReviewMode: boolean
  reviewRecord: ReviewRecord | undefined
  /** v9.0：复习来源。wrong=官方错题本回顾；due=记忆曲线到期复习 */
  reviewKind?: 'wrong' | 'due'
}

export function reviewInfoAtom(initialValue: TReviewInfoAtomData) {
  // M6-003：整份复习词表每次翻词都会重写，配额满时必须只告警不抛错（键名/序列化不变）
  // v9.12（M2-011）：键名改由 `@/constants` 的常量提供，与 data-export 导入后的清理共用同一来源
  const storageAtom = atomWithStorage(REVIEW_MODE_INFO_STORAGE_KEY, initialValue, safeStorage<TReviewInfoAtomData>())

  return atom(
    (get) => {
      return get(storageAtom)
    },
    (get, set, updater: TReviewInfoAtomData | ((oldValue: TReviewInfoAtomData) => TReviewInfoAtomData)) => {
      const newValue = typeof updater === 'function' ? updater(get(storageAtom)) : updater

      // v9.9（Batch6）：原先这里还会 putWordReviewRecord() 把复习进度写进 IndexedDB reviewRecords 表，
      // 但唯一读取方 Gallery-N/ReviewDetail 已随死集群删除（全局错题本与「错题复习」走本 atom 的
      // localStorage 持久化，不依赖该表），故一并去掉这条只写不读的持久化。
      set(storageAtom, newValue)
    },
  )
}
