import { TypingContext, TypingStateActionType } from '../../store'
import type { TypingState } from '../../store/type'
import PrevAndNextWord from '../PrevAndNextWord'
import Progress from '../Progress'
import Phonetic from './components/Phonetic'
import Translation from './components/Translation'
import WordComponent from './components/Word'
import { usePrefetchPronunciationSound } from '@/hooks/usePronunciation'
import { isReviewModeAtom, isShowPrevAndNextWordAtom, loopWordConfigAtom, phoneticConfigAtom, reviewModeInfoAtom } from '@/store'
import type { Word, WordWithIndex } from '@/typings'
import { getLearningSummary } from '@/utils/memory'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

export default function WordPanel({
  onNeedNextWord,
}: {
  onNeedNextWord?: (answered: Word) => Promise<WordWithIndex | null>
}) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const phoneticConfig = useAtomValue(phoneticConfigAtom)
  const isShowPrevAndNextWord = useAtomValue(isShowPrevAndNextWordAtom)
  const [wordComponentKey, setWordComponentKey] = useState(0)
  const [currentWordExerciseCount, setCurrentWordExerciseCount] = useState(0)
  const { times: loopWordTimes } = useAtomValue(loopWordConfigAtom)
  const currentWord = state.chapterData.words[state.chapterData.index]
  const nextWord = state.chapterData.words[state.chapterData.index + 1] as Word | undefined
  // v8.5：开始/暂停页概览（今日新学、到期复习、累计）
  const [summary, setSummary] = useState<{ learned: number; due: number; todayNew: number } | null>(null)

  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)

  useEffect(() => {
    let cancelled = false
    getLearningSummary()
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state.chapterData.index, state.isTyping])

  const prevIndex = useMemo(() => {
    const newIndex = state.chapterData.index - 1
    return newIndex < 0 ? 0 : newIndex
  }, [state.chapterData.index])
  const nextIndex = useMemo(() => {
    const newIndex = state.chapterData.index + 1
    return newIndex > state.chapterData.words.length - 1 ? state.chapterData.words.length - 1 : newIndex
  }, [state.chapterData.index, state.chapterData.words.length])

  usePrefetchPronunciationSound(nextWord?.name)

  const reloadCurrentWordComponent = useCallback(() => {
    setWordComponentKey((old) => old + 1)
  }, [])

  const updateReviewRecord = useCallback(
    (state: TypingState) => {
      setReviewModeInfo((old) => ({
        ...old,
        reviewRecord: old.reviewRecord ? { ...old.reviewRecord, index: state.chapterData.index } : undefined,
      }))
    },
    [setReviewModeInfo],
  )

  const onFinish = useCallback(async () => {
    // 单曲循环：同一个词重复练习
    if (currentWordExerciseCount < loopWordTimes - 1) {
      setCurrentWordExerciseCount((old) => old + 1)
      dispatch({ type: TypingStateActionType.LOOP_CURRENT_WORD })
      reloadCurrentWordComponent()
      return
    }
    setCurrentWordExerciseCount(0)
    const isLast = state.chapterData.index >= state.chapterData.words.length - 1
    // v7 动态出词：最后一个词练完时，基于最新记忆曲线数据实时取下一个词
    if (isLast && !isReviewMode && onNeedNextWord && currentWord) {
      const next = await onNeedNextWord(currentWord)
      if (next) {
        dispatch({ type: TypingStateActionType.PUSH_WORD, payload: next })
        dispatch({ type: TypingStateActionType.NEXT_WORD })
        reloadCurrentWordComponent()
        return
      }
    }
    if (!isLast) {
      if (isReviewMode) {
        dispatch({
          type: TypingStateActionType.NEXT_WORD,
          payload: {
            updateReviewRecord,
          },
        })
      } else {
        dispatch({ type: TypingStateActionType.NEXT_WORD })
      }
      return
    }
    // 用户完成当前章节（错题复习模式）
    dispatch({ type: TypingStateActionType.FINISH_CHAPTER })
    if (isReviewMode) {
      setReviewModeInfo((old) => ({ ...old, reviewRecord: old.reviewRecord ? { ...old.reviewRecord, isFinished: true } : undefined }))
    }
  }, [
    state.chapterData.index,
    state.chapterData.words.length,
    currentWord,
    currentWordExerciseCount,
    loopWordTimes,
    dispatch,
    reloadCurrentWordComponent,
    isReviewMode,
    updateReviewRecord,
    setReviewModeInfo,
    onNeedNextWord,
  ])

  const onSkipWord = useCallback(
    (type: 'prev' | 'next') => {
      if (type === 'prev') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: prevIndex })
      }

      if (type === 'next') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: nextIndex })
      }
    },
    [dispatch, prevIndex, nextIndex],
  )

  useHotkeys(
    'Ctrl + Shift + ArrowLeft',
    (e) => {
      e.preventDefault()
      onSkipWord('prev')
    },
    { preventDefault: true },
  )

  useHotkeys(
    'Ctrl + Shift + ArrowRight',
    (e) => {
      e.preventDefault()
      onSkipWord('next')
    },
    { preventDefault: true },
  )
  const [isShowTranslation, setIsHoveringTranslation] = useState(false)

  const handleShowTranslation = useCallback((checked: boolean) => {
    setIsHoveringTranslation(checked)
  }, [])

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(false)
    },
    { enableOnFormTags: true, keyup: true, preventDefault: true },
    [],
  )

  const shouldShowTranslation = useMemo(() => {
    return isShowTranslation || state.isTransVisible
  }, [isShowTranslation, state.isTransVisible])

  const fullTrans = useMemo(() => (currentWord?.trans || []).join('；'), [currentWord])
  // 简洁模式：只显示第一条释义，过长截断（悬停可看完整释义）
  const conciseTrans = useMemo(() => {
    const first = String((currentWord?.trans || [])[0] || '').split(/[；;，,]/)[0]?.trim() || ''
    return first.length > 30 ? first.slice(0, 30) + '…' : first
  }, [currentWord])

  return (
    <div className="container flex h-full w-full flex-col items-center justify-center">
      <div className="container flex h-24 w-full shrink-0 grow-0 justify-between px-12 pt-10">
        {isShowPrevAndNextWord && state.isTyping && (
          <>
            <PrevAndNextWord type="prev" />
            <PrevAndNextWord type="next" />
          </>
        )}
      </div>
      <div className="container flex flex-grow flex-col items-center justify-center">
        {currentWord && (
          <div className="relative flex w-full justify-center">
            {!state.isTyping && (
              <div className="absolute flex h-full w-full justify-center">
                <div className="z-10 flex w-full flex-col items-center justify-center backdrop-blur-sm">
                  <p className="w-full select-none text-center text-xl text-gray-600 dark:text-gray-50">
                    按任意键{state.timerData.time ? '继续' : '开始'}
                  </p>
                  {summary && (
                    <p className="mt-2 w-full select-none text-center text-xs text-gray-500 dark:text-gray-400">
                      今日已学 {summary.todayNew} · 到期复习 {summary.due} · 累计 {summary.learned}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="relative">
              <WordComponent word={currentWord} onFinish={onFinish} key={wordComponentKey} />
              {phoneticConfig.isOpen && <Phonetic word={currentWord} />}
              {conciseTrans && (
                <Translation
                  trans={conciseTrans}
                  title={fullTrans}
                  showTrans={shouldShowTranslation}
                  onMouseEnter={() => handleShowTranslation(true)}
                  onMouseLeave={() => handleShowTranslation(false)}
                />
              )}
              {currentWord.hint && (
                <p
                  className={`mt-1 text-center text-xs font-medium ${
                    currentWord.hint === 'retry' ? 'text-amber-500 dark:text-amber-400' : 'text-sky-500 dark:text-sky-400'
                  }`}
                >
                  {currentWord.hint === 'retry' ? '再练一次' : '随机回顾'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {isReviewMode && <Progress className={`mb-10 mt-auto ${state.isTyping ? 'opacity-100' : 'opacity-0'}`} />}
    </div>
  )
}
