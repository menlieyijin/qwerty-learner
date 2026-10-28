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
import type { TypingSettleFn } from './store'
import Header from '@/components/Header'
import Tooltip from '@/components/Tooltip'
import FirstRunLevelPicker, { LearningStartButton } from '@/components/FirstRunLevelPicker'
import { DUE_REVIEW_WORDS_STORAGE_KEY } from '@/constants'
import { idDictionaryMap } from '@/resources/dictionary'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom, reviewModeInfoAtom } from '@/store'
import { IsDesktop, isLegal } from '@/utils'
import { recordSkip } from '@/utils/autoLevel'
import { removeFromRequeue } from '@/utils/sessionRequeue'
import { deferMemoryDue } from '@/utils/db'
import { useSaveChapterRecord } from '@/pages/Typing/hooks/useSaveRecord'
import { useMixPanelChapterLogUploader } from '@/utils/mixpanel'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useImmerReducer } from 'use-immer'

const App: React.FC = () => {
  const [state, dispatch] = useImmerReducer(typingReducer, structuredClone(initialState))
  const { words, isLoading, nextWord } = useWordList()

  const [currentDictId, setCurrentDictId] = useAtom(currentDictIdAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const chapterLogUploader = useMixPanelChapterLogUploader(state)
  const saveChapterRecord = useSaveChapterRecord()

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  // v8.9：词池耗尽提示（全部学会且暂无到期词 / 空词库），避免空白页
  const [noMoreWords, setNoMoreWords] = useState(false)

  // v9.4（TYP-006 / SRS-004）：Word 注册的「当前作答结算」回调 + Skip 在途锁（两条 skip 入口共享）
  const settleRef = useRef<TypingSettleFn | null>(null)
  const skipLockRef = useRef(false)

  // v9.0：增强面板「到期复习」通过 localStorage 桥接一批到期词；进入复习模式后按每个词自己的 dict 写回记忆曲线
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DUE_REVIEW_WORDS_STORAGE_KEY)
      if (!raw) return
      localStorage.removeItem(DUE_REVIEW_WORDS_STORAGE_KEY)
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
    // v9.14（dsh，M3-011）：原来 setTimeout 没有 cleanup，移动端 500ms 内切走路由仍会弹出阻塞式 alert
    if (IsDesktop()) return
    const timer = window.setTimeout(() => {
      alert(
        ' Qwerty Learner 目的为提高键盘工作者的英语输入效率，目前暂未适配移动端，希望您使用桌面端浏览器访问。如您使用的是 Ipad 等平板电脑设备，可以使用外接键盘使用本软件。',
      )
    }, 500)
    return () => window.clearTimeout(timer)
  }, [])

  // 当前词库不存在时重置为默认词库
  useEffect(() => {
    if (!(currentDictId in idDictionaryMap)) {
      setCurrentDictId('cet4')
    }
  }, [currentDictId, setCurrentDictId])

  const skipWord = useCallback(async () => {
    // v9.4（SRS-004）：Skip 在途锁——连点只算一次（WordPanel 的热键跳过共享这把锁）
    if (skipLockRef.current) return
    skipLockRef.current = true
    try {
      // v9.4（TYP-006）：跳过前先结算当前词（写出未完成的按键统计与词记录）
      await settleRef.current?.({ persist: true })
      // v9.3：Skip 也要落状态（skipCount/suspended），否则被跳过的词会永远 unseen、级别静默卡死
      const word = state.chapterData.words[state.chapterData.index]
      if (word) {
        const dict = word.dict || currentDictId
        try { recordSkip(dict, word.name) } catch { /* ignore */ }
        // v9.4（SRS-001）：跳过的词不要再从「错词当场重现」队列里回来（否则 Skip 后立刻又看到它）
        try { removeFromRequeue(dict, word.name) } catch { /* ignore */ }
        // v9.4（SRS-001）：非复习模式同样要顺延 due，否则「跳过的到期词」下一轮立刻又被抽中（连出 3 次）
        try { await deferMemoryDue(dict, word.name, 1) } catch { /* ignore */ }
      }
      // v8.9：动态出词时 Skip 要实时取下一个词；不把被跳过的词计入 recent（避免它更难再出现）
      if (!isReviewMode && nextWord) {
        const next = await nextWord()
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
    } finally {
      skipLockRef.current = false
    }
  }, [currentDictId, dispatch, isReviewMode, nextWord, state.chapterData.index, state.chapterData.words])

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

  // v9.4（TYP-006）：暂停/失焦时把当前词的按键统计刷新进 chapterData（词未完成，不写记忆曲线）
  useEffect(() => {
    if (state.isTyping) return
    void settleRef.current?.({ persist: false })
  }, [state.isTyping])

  useEffect(() => {
    if (!state.isTyping && !isLoading) {
      const onKeyDown = (e: KeyboardEvent) => {
        // v9.4：输入法组词期（isComposing / keyCode 229）与键盘自动重复不触发「按任意键开始」
        if (e.isComposing || e.keyCode === 229 || e.repeat) return
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

  // v9.0/v9.3：动态模式不会自然结束；暂停时写/更新一条会话级 chapterRecord（upsert，不再累加）
  const savedPartialRef = useRef(0)
  const sessionChapterIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (isReviewMode || state.isTyping) return
    const wordCount = state.chapterData.wordCount
    if (wordCount <= 0 || wordCount === savedPartialRef.current) return
    savedPartialRef.current = wordCount
    void saveChapterRecord(state, sessionChapterIdRef.current).then((id) => {
      if (id) sessionChapterIdRef.current = id
    })
  }, [state, state.isTyping, state.chapterData.wordCount, isReviewMode, saveChapterRecord])

  // 切换词库/进入复习/切换章节时开启新的会话记录
  // v9.12（M2-001）：加上 currentChapter —— 否则第 N 章的暂停行 id 会被第 N+1 章复用
  // （saveChapterRecord 的 update 会把 chapter 一起改成当前章号，等于改写上一章的快照）。
  useEffect(() => {
    sessionChapterIdRef.current = undefined
    savedPartialRef.current = 0
  }, [currentDictId, isReviewMode, currentChapter])

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
    <TypingContext.Provider value={{ state: state, dispatch, settleRef, skipLockRef }}>
      {state.isFinished && isReviewMode && <ResultScreen />}
      {/* v9.16（dsh，目标-2）：首启词汇水平起点选择卡（已选择/已推迟时不渲染） */}
      <FirstRunLevelPicker />
      <Layout>
        <Header>
          <DictButton />
          <PronunciationSwitcher />
          <Switcher />
          <EnhanceButton />
          {/* v9.16（dsh，目标-2）：学习路线起点入口（首启选择卡同款，可随时修改起点） */}
          <LearningStartButton />
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
                  词库已全部学完且暂时没有到期复习词；若自动进阶已走完 13 级，可到词库画廊选择其他词库继续，或稍后再来复习。
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
