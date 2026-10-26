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
  const storageAtom = atomWithStorage('reviewModeInfo', initialValue)

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
