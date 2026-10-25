import { autoLevelInfoAtom, currentDictInfoAtom, learningModeAtom, reviewModeInfoAtom } from '@/store'
import type { Word, WordWithIndex } from '@/typings/index'
import { ensureMemoryMigrated, getMemoryRecords, normalizeWordName, pickDynamicWord } from '@/utils/memory'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'

export type UseWordListResult = {
  words: WordWithIndex[]
  isLoading: boolean
  error: Error | undefined
  nextWord: (answered?: Word) => Promise<WordWithIndex | null>
}

function toIndexWord(word: Word, dict?: string, index = 0): WordWithIndex {
  let trans: string[]
  if (Array.isArray(word.trans)) trans = word.trans.filter((item) => typeof item === 'string')
  else if (word.trans == null) trans = []
  else trans = [String(word.trans)]
  return { ...word, trans, dict: dict || word.dict, index }
}

/**
 * v7 动态出词：
 * - 不预生成词表；每次答完当前词后，根据最新记忆曲线数据动态选取下一个词；
 * - 自动进阶模式下按小学→初中→高中→四六级顺序，挑选当前水平的未学词；
 * - 跨词库按单词去重；到期词与未到期词随机回顾混合。
 */
export function useWordList(): UseWordListResult {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const learningMode = useAtomValue(learningModeAtom)
  const { isReviewMode, reviewRecord } = useAtomValue(reviewModeInfoAtom)
  const setLevelInfo = useSetAtom(autoLevelInfoAtom)
  const [words, setWords] = useState<WordWithIndex[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error] = useState<Error | undefined>(undefined)
  const recentRef = useRef<string[]>([])
  const manualWordsRef = useRef<Word[] | null>(null)
  const reviewWords = reviewRecord?.words

  useEffect(() => {
    let cancelled = false
    recentRef.current = []
    if (isReviewMode) {
      setWords((reviewWords ?? []).map((w) => toIndexWord(w)))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setWords([])
    setLevelInfo(null)
    ;(async () => {
      try {
        await ensureMemoryMigrated()
        let manualWords: Word[] | undefined
        if (learningMode === 'manual') {
          try {
            manualWords = (await wordListFetcher(currentDictInfo.url)).map((w) => toIndexWord(w))
            manualWordsRef.current = manualWords
          } catch (e) {
            console.error('load manual dict failed', e)
          }
        } else {
          manualWordsRef.current = null
        }
        const records = await getMemoryRecords()
        const pick = await pickDynamicWord({
          records,
          recent: [],
          mode: learningMode,
          manualDict: currentDictInfo.id,
          manualWords,
        })
        if (cancelled) return
        if (pick) {
          setWords([toIndexWord(pick.word, pick.dict)])
          setLevelInfo(pick.level)
        } else {
          setWords([])
          setLevelInfo(null)
        }
      } catch (e) {
        console.error('initial word failed', e)
        if (!cancelled) setWords([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewMode, reviewWords, learningMode, currentDictInfo.id])

  const nextWord = useCallback(
    async (answered?: Word): Promise<WordWithIndex | null> => {
      if (answered) {
        const n = normalizeWordName(answered.name)
        const list = recentRef.current.filter((x) => x !== n)
        list.push(n)
        recentRef.current = list.slice(-12)
      }
      try {
        await ensureMemoryMigrated()
        const records = await getMemoryRecords()
        let manualWords = manualWordsRef.current
        if (learningMode === 'manual' && !manualWords) {
          try {
            manualWords = (await wordListFetcher(currentDictInfo.url)).map((w) => toIndexWord(w))
            manualWordsRef.current = manualWords
          } catch { /* ignore */ }
        }
        const pick = await pickDynamicWord({
          records,
          recent: recentRef.current,
          mode: learningMode,
          manualDict: currentDictInfo.id,
          manualWords: manualWords || undefined,
        })
        if (!pick) {
          setLevelInfo(null)
          return null
        }
        setLevelInfo(pick.level)
        return toIndexWord(pick.word, pick.dict)
      } catch (e) {
        console.error('next word failed', e)
        return null
      }
    },
    [currentDictInfo.id, learningMode, setLevelInfo],
  )

  return { words, isLoading, error, nextWord }
}
