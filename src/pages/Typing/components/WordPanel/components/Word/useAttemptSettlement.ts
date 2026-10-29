import type { WordState } from './type'
import { TypingStateActionType } from '@/pages/Typing/store'
import type { TypingStateAction } from '@/pages/Typing/store'
import type { Word } from '@/typings'
import type { LetterMistakes } from '@/utils/db/record'
import { normalizeTrans } from '@/utils/trans'
import type { Dispatch, MutableRefObject } from 'react'
import { useCallback, useRef } from 'react'

/**
 * 一次作答的结算元数据（v10.3，dsh：从 `Word/index.tsx` 抽出）。
 *
 * 为什么要单独记这些计数：`wordState` 里的统计是**词内累计值**，而 chapterData 需要**增量**。
 * 每次上报后把「已上报值」记在 meta 里，就能保证 flushStats 可重复调用而不会重复累加（幂等）。
 */
export type AttemptMeta = {
  index: number
  name: string
  dict?: string
  trans: string[]
  phone: string
  isRefresh: boolean
  /** 已上报给 reducer 的按键数（增量上报，保证重复结算幂等） */
  reportedCorrect: number
  reportedWrong: number
  /** 每个下标已上报的错误字母数（mergeLetterMistake 是拼接语义，必须只发增量） */
  mistakeLens: Record<number, number>
  /** 本次作答的词记录是否已落库（避免暂停/跳过/切词/卸载重复写） */
  persisted: boolean
  /** 是否已被父级「放弃式结算」（persist=true）过 */
  settled: boolean
}

export const createAttemptMeta = (index: number, word: Word): AttemptMeta => ({
  index,
  name: word.name,
  dict: word.dict,
  trans: normalizeTrans(word.trans),
  phone: word.usphone || word.ukphone || '',
  isRefresh: !!word.refresh,
  reportedCorrect: 0,
  reportedWrong: 0,
  mistakeLens: {},
  persisted: false,
  settled: false,
})

type SaveWordRecordPayload = {
  word: string
  dict?: string
  trans?: string[]
  phone?: string
  wrongCount: number
  letterTimeArray: number[]
  letterMistake: LetterMistakes
  isRefresh?: boolean
}

type UseAttemptSettlementArgs = {
  word: Word
  /** 当前词在 chapterData 里的下标（换词时需要重置 meta） */
  index: number
  dispatch: Dispatch<TypingStateAction>
  saveWordRecord: (payload: SaveWordRecordPayload) => Promise<unknown>
  /** 组件持有、每次渲染同步更新的最新词状态引用 */
  wordStateRef: MutableRefObject<WordState>
}

/**
 * 作答结算：增量上报（flush）+ 一次性落库（persist）+ 组合入口（settle）。
 *
 * 三个函数的语义（与抽取前逐字一致）：
 * - `flushStats()`：把自上次上报以来新增的按键/错字**增量**写进 chapterData，可重复调用（幂等）；
 * - `persistOnce()`：把本次作答写入词记录，每个 attempt 只写一次，返回 Promise 供父级保序；
 * - `settleAttempt({persist})`：先 flush；`persist: true` 时再落库。
 */
export function useAttemptSettlement({ word, index, dispatch, saveWordRecord, wordStateRef }: UseAttemptSettlementArgs) {
  const attemptRef = useRef<AttemptMeta>(createAttemptMeta(index, word))
  // 已发起的落库 Promise（父级 Skip 需要 await 它，保证 deferMemoryDue 在写记录之后执行）
  const persistPromiseRef = useRef<Promise<void> | null>(null)

  /** 换词时重置本次作答的 meta（原来在组件的换词 effect 里直接赋值） */
  const resetAttempt = useCallback((nextIndex: number, nextWord: Word) => {
    attemptRef.current = createAttemptMeta(nextIndex, nextWord)
  }, [])

  const flushStats = useCallback(() => {
    const meta = attemptRef.current
    const ws = wordStateRef.current
    const deltaCorrect = ws.correctCount - meta.reportedCorrect
    const deltaWrong = ws.wrongCount - meta.reportedWrong
    const deltaMistake: LetterMistakes = {}
    for (const key of Object.keys(ws.letterMistake)) {
      const idx = Number(key)
      const arr = ws.letterMistake[idx] || []
      const already = meta.mistakeLens[idx] ?? 0
      if (arr.length > already) deltaMistake[idx] = arr.slice(already)
      meta.mistakeLens[idx] = arr.length
    }
    meta.reportedCorrect = ws.correctCount
    meta.reportedWrong = ws.wrongCount
    if (deltaCorrect === 0 && deltaWrong === 0 && Object.keys(deltaMistake).length === 0) return
    dispatch({
      type: TypingStateActionType.REPORT_WORD_RESULT,
      payload: { index: meta.index, correctCount: deltaCorrect, wrongCount: deltaWrong, letterMistake: deltaMistake },
    })
  }, [dispatch, wordStateRef])

  const persistOnce = useCallback((): Promise<void> | undefined => {
    const meta = attemptRef.current
    if (meta.persisted) return persistPromiseRef.current ?? undefined
    meta.persisted = true
    const ws = wordStateRef.current
    dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: true })
    persistPromiseRef.current = saveWordRecord({
      word: meta.name,
      dict: meta.dict,
      trans: meta.trans,
      phone: meta.phone,
      wrongCount: ws.wrongCount,
      letterTimeArray: ws.letterTimeArray,
      letterMistake: ws.letterMistake,
      // v9.3：显式传递本次作答是否为回顾/重练，避免全局 refresh 标记残留
      isRefresh: meta.isRefresh,
    }).catch((e) => {
      console.error('save word record failed', e)
    }) as Promise<void>
    return persistPromiseRef.current
  }, [dispatch, saveWordRecord, wordStateRef])

  const settleAttempt = useCallback(
    (options: { persist?: boolean } = {}): Promise<void> | undefined => {
      const meta = attemptRef.current
      const ws = wordStateRef.current
      flushStats()
      if (!options.persist) return undefined
      let pending = persistPromiseRef.current ?? undefined
      if (!meta.persisted && (ws.correctCount + ws.wrongCount > 0 || ws.hasMadeInputWrong)) {
        pending = persistOnce() ?? pending
      }
      meta.settled = true
      return pending
    },
    [flushStats, persistOnce, wordStateRef],
  )

  return { attemptRef, persistPromiseRef, flushStats, persistOnce, settleAttempt, resetAttempt }
}
