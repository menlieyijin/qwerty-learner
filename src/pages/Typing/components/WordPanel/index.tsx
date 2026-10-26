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
  onNoMoreWords,
}: {
  onNeedNextWord?: (answered: Word) => Promise<WordWithIndex | null>
  onNoMoreWords?: () => void
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
  // v8.5：开始/暂停页概览（今日新学、到期复习、累计）；v9.0 增加今日练习并支持点到期数进复习
  const [summary, setSummary] = useState<{ learned: number; due: number; todayNew: number; todayPracticed: number } | null>(null)

  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)

  useEffect(() => {
    // v8.7：只在开始/暂停页需要概览，避免每换一个词就全表扫描 memoryRecords
    if (state.isTyping) return
    let cancelled = false
    getLearningSummary()
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state.isTyping])

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
      // v8.9：词池真的没有了（全部学会且无到期词）时交给外层显示提示，不再进入空白完成态
      onNoMoreWords?.()
      return
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
    onNoMoreWords,
  ])

  const onSkipWord = useCallback(
    async (type: 'prev' | 'next') => {
      if (type === 'prev') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: prevIndex })
        return
      }
      // v8.9：动态出词时「下一个」需要实时取词，不能只在已有词表里移动（末词会直接空白）
      if (!isReviewMode && onNeedNextWord && currentWord) {
        const next = await onNeedNextWord(currentWord)
        if (next) {
          dispatch({ type: TypingStateActionType.PUSH_WORD, payload: next })
          dispatch({ type: TypingStateActionType.NEXT_WORD })
          return
        }
        onNoMoreWords?.()
        return
      }
      dispatch({
        type: TypingStateActionType.SKIP_2_WORD_INDEX,
        newIndex: nextIndex,
        payload: { finishIfLast: isReviewMode },
      })
    },
    [dispatch, prevIndex, nextIndex, isReviewMode, onNeedNextWord, onNoMoreWords, currentWord],
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
                    <p className="mt-3 flex w-full select-none flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm font-medium leading-5 text-gray-600 dark:text-gray-300">
                      <span>
                        今日练习{' '}
                        <b className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{summary.todayPracticed.toLocaleString()}</b>
                      </span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>
                        新学{' '}
                        <b className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{summary.todayNew.toLocaleString()}</b>
                      </span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <button
                        type="button"
                        title="打开「数据」页，查看未来 7 天到期分布并可一键开始到期复习"
                        className="group inline-flex items-center gap-1 rounded-md px-1 transition-colors hover:bg-amber-50 dark:hover:bg-amber-500/10"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('qz-open-enhance', { detail: { tab: 'data' } }))
                        }}
                      >
                        到期复习{' '}
                        <b
                          className={`font-semibold tabular-nums ${
                            summary.due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'
                          }`}
                        >
                          {summary.due.toLocaleString()}
                        </b>
                        {summary.due > 0 && <span className="text-[11px] text-amber-600/80 group-hover:underline dark:text-amber-400/80">去复习 →</span>}
                      </button>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>
                        累计{' '}
                        <b className="font-semibold tabular-nums text-gray-800 dark:text-gray-100">{summary.learned.toLocaleString()}</b>
                      </span>
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
                <p className="mt-1.5 text-center">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[13px] font-medium leading-5 ${
                      currentWord.hint === 'retry'
                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                        : 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400'
                    }`}
                  >
                    {currentWord.hint === 'retry' ? '再练一次' : '随机回顾'}
                  </span>
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
