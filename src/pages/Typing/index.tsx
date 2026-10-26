import Layout from '../../components/Layout'
import { DictButton } from './components/DictButton'
import { EnhanceButton } from './components/EnhanceButton'
import PronunciationSwitcher from './components/PronunciationSwitcher'
import ResultScreen from './components/ResultScreen'
import StartButton from './components/StartButton'
import Switcher from './components/Switcher'
import WordPanel from './components/WordPanel'
import { useConfetti } from './hooks/useConfetti'
import { useWordList } from './hooks/useWordList'
import { TypingContext, TypingStateActionType, initialState, typingReducer } from './store'
import { DonateCard } from '@/components/DonateCard'
import Header from '@/components/Header'
import Tooltip from '@/components/Tooltip'
import { idDictionaryMap } from '@/resources/dictionary'
import { currentDictIdAtom, isReviewModeAtom, randomConfigAtom, reviewModeInfoAtom } from '@/store'
import { IsDesktop, isLegal } from '@/utils'
import { useSaveChapterRecord } from '@/utils/db'
import { useMixPanelChapterLogUploader } from '@/utils/mixpanel'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useImmerReducer } from 'use-immer'

const App: React.FC = () => {
  const [state, dispatch] = useImmerReducer(typingReducer, structuredClone(initialState))
  const { words, isLoading, nextWord } = useWordList()

  const [currentDictId, setCurrentDictId] = useAtom(currentDictIdAtom)
  const randomConfig = useAtomValue(randomConfigAtom)
  const chapterLogUploader = useMixPanelChapterLogUploader(state)
  const saveChapterRecord = useSaveChapterRecord()

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  // v8.9：词池耗尽提示（全部学会且暂无到期词 / 空词库），避免空白页
  const [noMoreWords, setNoMoreWords] = useState(false)

  // v9.0：增强面板「到期复习」通过 localStorage 桥接一批到期词；进入复习模式后按每个词自己的 dict 写回记忆曲线
  useEffect(() => {
    try {
      const raw = localStorage.getItem('qzDueReviewWords')
      if (!raw) return
      localStorage.removeItem('qzDueReviewWords')
      const words = JSON.parse(raw)
      if (Array.isArray(words) && words.length > 0) {
        setReviewModeInfo({
          isReviewMode: true,
          reviewKind: 'due',
          reviewRecord: { dict: 'due-review', index: 0, createTime: Date.now(), isFinished: false, words },
        })
      }
    } catch (e) {
      console.error('consume due review words failed', e)
    }
  }, [setReviewModeInfo])

  useEffect(() => {
    // 检测用户设备
    if (!IsDesktop()) {
      setTimeout(() => {
        alert(
          ' Qwerty Learner 目的为提高键盘工作者的英语输入效率，目前暂未适配移动端，希望您使用桌面端浏览器访问。如您使用的是 Ipad 等平板电脑设备，可以使用外接键盘使用本软件。',
        )
      }, 500)
    }
  }, [])

  // 当前词库不存在时重置为默认词库
  useEffect(() => {
    if (!(currentDictId in idDictionaryMap)) {
      setCurrentDictId('cet4')
    }
  }, [currentDictId, setCurrentDictId])

  const skipWord = useCallback(async () => {
    // v8.9：动态出词时 Skip 要实时取下一个词；之前直接 SKIP_WORD 会在末词进入空白完成态
    const word = state.chapterData.words[state.chapterData.index]
    if (!isReviewMode && nextWord) {
      const next = await nextWord(word)
      if (next) {
        setNoMoreWords(false)
        dispatch({ type: TypingStateActionType.PUSH_WORD, payload: next })
        dispatch({ type: TypingStateActionType.NEXT_WORD })
        return
      }
      setNoMoreWords(true)
      return
    }
    dispatch({ type: TypingStateActionType.SKIP_WORD, payload: { finishIfLast: isReviewMode } })
  }, [dispatch, isReviewMode, nextWord, state.chapterData.index, state.chapterData.words])

  // 开始/继续时缓存按键，等输入监听挂载后重放，避免「第一下按键」被吞掉
  const startBufferRef = useRef<string[]>([])

  useEffect(() => {
    if (!state.isTyping) return
    const buffer = startBufferRef.current
    if (!buffer.length) return
    startBufferRef.current = []
    const timers = buffer.map((key, i) =>
      window.setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      }, 20 * (i + 1)),
    )
    return () => timers.forEach((t) => clearTimeout(t))
  }, [state.isTyping])

  useEffect(() => {
    const onBlur = () => {
      // 首次打开时窗口可能尚未聚焦，不要立刻暂停；开始练习后再按失焦暂停
      if (state.chapterData.wordCount > 0) {
        dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
      }
    }
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('blur', onBlur)
    }
  }, [dispatch, state.chapterData.wordCount])

  useEffect(() => {
    if (!state.isTyping && !isLoading) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Enter' && (isLegal(e.key) || e.key === ' ') && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          startBufferRef.current.push(e.key)
          dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: true })
        }
      }
      window.addEventListener('keydown', onKeyDown)

      return () => window.removeEventListener('keydown', onKeyDown)
    }
  }, [state.isTyping, isLoading, dispatch])

  useEffect(() => {
    if (words.length > 0) {
      setNoMoreWords(false)
      const initialIndex = isReviewMode && reviewModeInfo.reviewRecord?.index ? reviewModeInfo.reviewRecord.index : 0
      dispatch({
        type: TypingStateActionType.SETUP_CHAPTER,
        payload: { words, shouldShuffle: false, initialIndex },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words])

  useEffect(() => {
    if (state.isFinished && !state.isSavingRecord) {
      chapterLogUploader()
      saveChapterRecord(state)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isFinished, state.isSavingRecord])

  // v9.0：动态模式不会自然结束；暂停时补一条会话级 chapterRecord，让官方统计的时长/WPM/正确率不再长期为空
  const savedPartialRef = useRef(0)
  useEffect(() => {
    if (isReviewMode || state.isTyping) return
    const wordCount = state.chapterData.wordCount
    if (wordCount <= 0 || wordCount === savedPartialRef.current) return
    savedPartialRef.current = wordCount
    saveChapterRecord(state)
  }, [state, state.isTyping, state.chapterData.wordCount, isReviewMode, saveChapterRecord])

  useEffect(() => {
    let intervalId: number
    if (state.isTyping) {
      intervalId = window.setInterval(() => {
        dispatch({ type: TypingStateActionType.TICK_TIMER })
      }, 1000)
    }
    return () => clearInterval(intervalId)
  }, [state.isTyping, dispatch])

  useConfetti(isReviewMode && state.isFinished)

  return (
    <TypingContext.Provider value={{ state: state, dispatch }}>
      {state.isFinished && isReviewMode && <DonateCard />}
      {state.isFinished && isReviewMode && <ResultScreen />}
      <Layout>
        <Header>
          <DictButton />
          <PronunciationSwitcher />
          <Switcher />
          <EnhanceButton />
          <StartButton isLoading={isLoading} />
          <Tooltip content="跳过该词">
            <button
              className={`${
                state.isShowSkip ? 'bg-orange-400' : 'invisible w-0 bg-gray-300 px-0 opacity-0'
              } my-btn-primary transition-all duration-300 `}
              onClick={skipWord}
            >
              Skip
            </button>
          </Tooltip>
        </Header>
        <div className="container mx-auto flex h-full flex-1 flex-col items-center justify-center pb-5">
          <div className="container flex flex-grow items-center justify-center">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center ">
                <div
                  className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid  border-indigo-400 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                  role="status"
                ></div>
              </div>
            ) : state.isFinished && !isReviewMode ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-xl text-gray-600 dark:text-gray-300">本轮练习结束</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  共 {state.chapterData.wordCount} 词 · 正确 {state.chapterData.correctCount} 键 · 错误 {state.chapterData.wrongCount} 键
                </p>
                <button className="my-btn-primary bg-indigo-500 hover:bg-indigo-400" onClick={() => window.location.reload()}>
                  重新开始
                </button>
              </div>
            ) : noMoreWords || (!state.isFinished && words.length === 0) ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-xl text-gray-600 dark:text-gray-300">当前没有可练习的词</p>
                <p className="max-w-lg text-sm text-gray-500 dark:text-gray-400">
                  词库已全部学完且暂时没有到期复习词；可换一个词库，或稍后再来复习。
                </p>
                <div className="flex gap-3">
                  <button className="my-btn-primary bg-indigo-500 hover:bg-indigo-400" onClick={() => window.location.reload()}>
                    刷新
                  </button>
                  <button
                    className="my-btn-primary bg-gray-400 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500"
                    onClick={() => {
                      window.location.hash = '#/gallery'
                    }}
                  >
                    打开词库
                  </button>
                </div>
              </div>
            ) : (
              !state.isFinished && (
                <WordPanel onNeedNextWord={isReviewMode ? undefined : nextWord} onNoMoreWords={() => setNoMoreWords(true)} />
              )
            )}
          </div>
        </div>
      </Layout>
    </TypingContext.Provider>
  )
}

export default App
