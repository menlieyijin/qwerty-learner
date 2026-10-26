import type { WordUpdateAction } from '../InputHandler'
import InputHandler from '../InputHandler'
import Letter from './Letter'
import Notation from './Notation'
import { TipAlert } from './TipAlert'
import { hasUntypableChar, normalizeDisplayWord } from './displayWord'
import style from './index.module.css'
import { initialWordState } from './type'
import type { WordState } from './type'
import Tooltip from '@/components/Tooltip'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import { EXPLICIT_SPACE } from '@/constants'
import useKeySounds from '@/hooks/useKeySounds'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import {
  currentChapterAtom,
  currentDictInfoAtom,
  isIgnoreCaseAtom,
  isShowAnswerOnHoverAtom,
  isTextSelectableAtom,
  pronunciationIsOpenAtom,
  wordDictationConfigAtom,
} from '@/store'
import type { Word } from '@/typings'
import { CTRL, getUtcStringForMixpanel } from '@/utils'
import type { LetterMistakes } from '@/utils/db/record'
import { useSaveWordRecord } from '@/utils/db'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useImmer } from 'use-immer'

const vowelLetters = ['A', 'E', 'I', 'O', 'U']

type AttemptMeta = {
  index: number
  name: string
  dict?: string
  trans: string[]
  phone: string
  isRefresh: boolean
  // 已上报给 reducer 的按键数（增量上报，保证重复结算幂等）
  reportedCorrect: number
  reportedWrong: number
  // 每个下标已上报的错误字母数（mergeLetterMistake 是拼接语义，必须只发增量）
  mistakeLens: Record<number, number>
  // 本次作答的词记录是否已落库（避免暂停/跳过/切词/卸载重复写）
  persisted: boolean
  // 是否已被父级「放弃式结算」（persist=true）过
  settled: boolean
}

const createAttemptMeta = (index: number, word: Word): AttemptMeta => ({
  index,
  name: word.name,
  dict: word.dict,
  trans: Array.isArray(word.trans) ? word.trans : word.trans ? [String(word.trans)] : [],
  phone: word.usphone || word.ukphone || '',
  isRefresh: !!word.refresh,
  reportedCorrect: 0,
  reportedWrong: 0,
  mistakeLens: {},
  persisted: false,
  settled: false,
})

export default function WordComponent({ word, onFinish }: { word: Word; onFinish: () => void }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch, settleRef } = useContext(TypingContext)!
  const [wordState, setWordState] = useImmer<WordState>(structuredClone(initialWordState))

  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const isTextSelectable = useAtomValue(isTextSelectableAtom)
  const isIgnoreCase = useAtomValue(isIgnoreCaseAtom)
  const isShowAnswerOnHover = useAtomValue(isShowAnswerOnHoverAtom)
  const saveWordRecord = useSaveWordRecord()
  // const wordLogUploader = useMixPanelWordLogUploader(state)
  const [playKeySound, playBeepSound, playHintSound] = useKeySounds()
  const pronunciationIsOpen = useAtomValue(pronunciationIsOpenAtom)
  const [isHoveringWord, setIsHoveringWord] = useState(false)
  const currentLanguage = useAtomValue(currentDictInfoAtom).language
  const currentLanguageCategory = useAtomValue(currentDictInfoAtom).languageCategory
  const currentChapter = useAtomValue(currentChapterAtom)

  const [showTipAlert, setShowTipAlert] = useState(false)
  const [wrongHint, setWrongHint] = useState('')
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)

  // v9.4（TYP-006）：当前作答的「未完成结算」基础设施
  const wordStateRef = useRef(wordState)
  wordStateRef.current = wordState
  const attemptRef = useRef<AttemptMeta>(createAttemptMeta(state.chapterData.index, word))
  // 已发起的落库 Promise（父级 Skip 需要 await 它，保证 deferMemoryDue 在写记录之后执行）
  const persistPromiseRef = useRef<Promise<void> | null>(null)
  // v9.4（TYP-009）：词已完成、下一词尚未挂载的窗口期内按下的键先缓存，切词后重放到新词，
  // 既不会误判成当前词的越界错误，也不会把「下一词的第一个键」吞掉。
  const pendingKeysRef = useRef<string[]>([])

  // v8.1：错误分类提示（漏字/重复/错字/大小写），显示约 1.8 秒
  useEffect(() => {
    if (!wrongHint) return
    const timer = setTimeout(() => setWrongHint(''), 1800)
    return () => clearTimeout(timer)
  }, [wrongHint])

  /** 把自上次上报以来新增的按键/错字增量写入 chapterData（可重复调用，幂等） */
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
  }, [dispatch])

  /** 落库当前作答（每个 attempt 只写一次）；返回落库 Promise 供父级 await 保序 */
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
    })
    return persistPromiseRef.current
  }, [dispatch, saveWordRecord])

  /**
   * 结算当前作答。
   * - persist=false：只把按键统计刷新进 chapterData（暂停/失焦用；词还没结束，不能写记忆曲线）
   * - persist=true：同时落库并标记本次作答已结算（Skip / 切词库 / 组件卸载用）
   * 返回 Promise 时，父级 await 后即可保证记录已落库（Skip 的 deferMemoryDue 必须在落库之后，避免被覆盖）。
   */
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
    [flushStats, persistOnce],
  )

  // 用 ref 转发，避免 settleAttempt 身份变化导致「卸载结算」effect 被反复清理/执行
  const settleFnRef = useRef(settleAttempt)
  settleFnRef.current = settleAttempt

  // 把结算能力注册给父级（Skip / 暂停 / 切库时调用）
  useEffect(() => {
    if (!settleRef) return
    settleRef.current = (options) => settleFnRef.current(options)
    return () => {
      if (settleRef.current) settleRef.current = null
    }
  }, [settleRef])

  // 组件卸载：把当前作答结算掉（导航离开 / 结束本章等），已落库的 attempt 会自动跳过
  useEffect(() => {
    return () => {
      pendingKeysRef.current = []
      settleFnRef.current({ persist: true })
    }
  }, [])

  // 暂停时丢弃「提前输入」缓存，避免恢复后莫名其妙多出字符
  useEffect(() => {
    if (!state.isTyping) pendingKeysRef.current = []
  }, [state.isTyping])

  useEffect(() => {
    // v9.4：切词前先把上一个词的作答结算掉（覆盖 SETUP_CHAPTER / REPEAT_CHAPTER / 直接换词）
    settleFnRef.current({ persist: true })
    // run only when word changes
    let headword = ''
    try {
      headword = normalizeDisplayWord(word.name)
    } catch (e) {
      console.error('word.name is not a string', word)
      headword = ''
    }

    const newWordState = structuredClone(initialWordState)
    newWordState.displayWord = headword
    newWordState.letterStates = new Array(headword.length).fill('normal')
    newWordState.startTime = getUtcStringForMixpanel()
    newWordState.randomLetterVisible = headword.split('').map(() => Math.random() > 0.4)
    setWordState(newWordState)
    attemptRef.current = createAttemptMeta(state.chapterData.index, word)

    // v9.4（TYP-009）：把上一词完成窗口期缓存的按键重放到新词，避免「下一词首键」被吞
    const pendingKeys = pendingKeysRef.current
    pendingKeysRef.current = []
    if (pendingKeys.length) {
      setWordState((state) => {
        for (const key of pendingKeys) {
          state.inputWord = state.inputWord + (key === ' ' ? EXPLICIT_SPACE : key)
        }
      })
    }

    // v9.4（TYP-004）：归一化后仍有键盘打不出的字符时，直接给出 Skip 入口，避免「死词」卡死
    if (currentLanguage !== 'code' && hasUntypableChar(headword)) {
      console.warn('[typing] 该词条含不可键入字符，已开放 Skip：', word.name)
      dispatch({ type: TypingStateActionType.SET_IS_SKIP, payload: true })
    }
    // state.chapterData.index 只在换词时读取一次，故意不放进依赖，避免每词重复重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, setWordState])

  const updateInput = useCallback(
    (updateAction: WordUpdateAction) => {
      switch (updateAction.type) {
        case 'add': {
          // v9.4（TYP-009）：词已完成时不清空按键，而是缓存到下一词（避免吞掉下一词首键）
          if (wordState.isFinished) {
            if (pendingKeysRef.current.length < 20) pendingKeysRef.current.push(updateAction.value)
            return
          }
          if (wordState.hasWrong) return
          // v9.4（TYP-010）：过滤键盘自动重复（按住键时浏览器会持续派发 keydown）
          const evt = updateAction.event
          if (evt && 'repeat' in evt && (evt as KeyboardEvent).repeat) return

          if (updateAction.value === ' ') {
            updateAction.event.preventDefault()
            setWordState((state) => {
              state.inputWord = state.inputWord + EXPLICIT_SPACE
            })
          } else {
            setWordState((state) => {
              state.inputWord = state.inputWord + updateAction.value
            })
          }
          break
        }

        default:
          console.warn('unknown update type', updateAction)
      }
    },
    [wordState.hasWrong, wordState.isFinished, setWordState],
  )

  const handleHoverWord = useCallback((checked: boolean) => {
    setIsHoveringWord(checked)
  }, [])

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(false)
    },
    { enableOnFormTags: true, preventDefault: true, keyup: true },
    [],
  )
  useHotkeys(
    'ctrl+j',
    () => {
      if (state.isTyping) {
        wordPronunciationIconRef.current?.play()
      }
    },
    [state.isTyping],
    { enableOnFormTags: true, preventDefault: true },
  )

  // AUDIO-004（v9.7 方案 C）：自动发音按“新词出现 / 开始练习”触发。
  // - 依赖业务键 `word.name` + `state.isTyping`，不再依赖 imperative handle 的函数身份（render 期快照）；
  // - 去掉 `inputWord.length === 0` 谓词：极速连打时被 pendingKeys 回放的首键可能让整个词一次都不播。
  // 子组件（usePronunciationSound）的 passive effect 先于本 effect 执行，ref 在 layout 期已指向新词元素。
  useEffect(() => {
    if (!state.isTyping) return
    wordPronunciationIconRef.current?.play?.()
  }, [word.name, state.isTyping])

  const getLetterVisible = useCallback(
    (index: number) => {
      if (wordState.letterStates[index] === 'correct' || (isShowAnswerOnHover && isHoveringWord)) return true

      if (wordDictationConfig.isOpen) {
        if (wordDictationConfig.type === 'hideAll') return false

        const letter = wordState.displayWord[index]
        if (wordDictationConfig.type === 'hideVowel') {
          return vowelLetters.includes(letter.toUpperCase()) ? false : true
        }
        if (wordDictationConfig.type === 'hideConsonant') {
          return vowelLetters.includes(letter.toUpperCase()) ? true : false
        }
        if (wordDictationConfig.type === 'randomHide') {
          return wordState.randomLetterVisible[index]
        }
      }
      return true
    },
    [
      isHoveringWord,
      isShowAnswerOnHover,
      wordDictationConfig.isOpen,
      wordDictationConfig.type,
      wordState.displayWord,
      wordState.letterStates,
      wordState.randomLetterVisible,
    ],
  )

  useEffect(() => {
    const inputLength = wordState.inputWord.length
    /**
     * TODO: 当用户输入错误时，会报错
     * Cannot update a component (`App`) while rendering a different component (`WordComponent`). To locate the bad setState() call inside `WordComponent`, follow the stack trace as described in https://reactjs.org/link/setstate-in-render
     * 目前不影响生产环境，猜测是因为开发环境下 react 会两次调用 useEffect 从而展示了这个 warning
     * 但这终究是一个 bug，需要修复
     */
    if (wordState.hasWrong || wordState.isFinished || inputLength === 0 || wordState.displayWord.length === 0) {
      return
    }

    // v9.4（TYP-003）：一次 input 事件可能带多个字符（粘贴/输入法上屏/移动端联想），
    // 这里从 judgedLength 开始逐个校验，而不是只看最后一个字符。
    const from = Math.min(wordState.judgedLength, inputLength)
    let mismatch = -1
    for (let i = from; i < inputLength; i++) {
      const inputChar = wordState.inputWord[i]
      const correctChar = wordState.displayWord[i]
      let isEqual = false
      if (inputChar != undefined && correctChar != undefined) {
        isEqual = isIgnoreCase ? inputChar.toLowerCase() === correctChar.toLowerCase() : inputChar === correctChar
      }
      if (!isEqual) {
        mismatch = i
        break
      }
    }

    if (mismatch === -1) {
      // 新增的输入全部正确
      const judged = inputLength
      const isNowFinished = inputLength >= wordState.displayWord.length
      if (judged > from) {
        setWordState((state) => {
          for (let i = from; i < judged; i++) {
            state.letterStates[i] = 'correct'
            state.letterTimeArray.push(Date.now())
            state.correctCount += 1
          }
          state.judgedLength = judged
        })
      }
      if (isNowFinished) {
        setWordState((state) => {
          state.isFinished = true
          state.endTime = getUtcStringForMixpanel()
        })
        playHintSound()
      } else if (judged > from) {
        playKeySound()
      }
      return
    }

    // 出错时：错误定位在 mismatch（而不是「整串最后一个字符」）
    playBeepSound()
    const expectedChar = wordState.displayWord[mismatch] || ''
    const nextChar = wordState.displayWord[mismatch + 1] || ''
    const prevChar = wordState.displayWord[mismatch - 1] || ''
    const typedChar = wordState.inputWord[mismatch] || ''
    let hint = ''
    if (expectedChar) {
      if (typedChar && nextChar && typedChar.toLowerCase() === nextChar.toLowerCase()) {
        hint = `漏掉了「${expectedChar}」`
      } else if (typedChar && prevChar && typedChar.toLowerCase() === prevChar.toLowerCase()) {
        hint = `重复输入了「${typedChar}」`
      } else if (typedChar && typedChar.toLowerCase() === expectedChar.toLowerCase()) {
        hint = `注意大小写：应为「${expectedChar}」`
      } else {
        hint = `应为「${expectedChar}」，你输入了「${typedChar}」`
      }
    }
    setWrongHint(hint)
    setWordState((state) => {
      state.letterStates[mismatch] = 'wrong'
      state.hasWrong = true
      state.hasMadeInputWrong = true
      state.wrongCount += 1
      state.letterTimeArray = []

      if (state.letterMistake[mismatch]) {
        state.letterMistake[mismatch].push(typedChar)
      } else {
        state.letterMistake[mismatch] = [typedChar]
      }
    })

    if (currentChapter === 0 && state.chapterData.index === 0 && wordState.wrongCount >= 3) {
      setShowTipAlert(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.inputWord])

  useEffect(() => {
    if (wordState.hasWrong) {
      const timer = setTimeout(() => {
        setWordState((state) => {
          state.inputWord = ''
          state.judgedLength = 0
          state.letterStates = new Array(state.displayWord.length).fill('normal')
          state.hasWrong = false
        })
      }, 300)

      return () => {
        clearTimeout(timer)
      }
    }
  }, [wordState.hasWrong, setWordState])

  useEffect(() => {
    if (!wordState.isFinished) return
    dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: true })
    // v9.4（TYP-006）：完成时同样走增量结算 + 单次落库（与未完成结算共用幂等逻辑）
    flushStats()
    persistOnce()
    // v9.4：不再等待 IndexedDB 落库再切词——原实现落库失败会让 onFinish 永不触发（词卡死），
    // 且等待期间的多余按键会被判错（TYP-009）。落库与本轮章节记录通过 isSavingRecord 保序。
    onFinish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.isFinished])

  useEffect(() => {
    if (wordState.wrongCount >= 4) {
      dispatch({ type: TypingStateActionType.SET_IS_SKIP, payload: true })
    }
  }, [wordState.wrongCount, dispatch])

  return (
    <>
      <InputHandler updateInput={updateInput} />
      <div
        lang={currentLanguageCategory !== 'code' ? currentLanguageCategory : 'en'}
        className="flex flex-col items-center justify-center pb-1 pt-4"
      >
        {['romaji', 'hapin'].includes(currentLanguage) && word.notation && <Notation notation={word.notation} />}
        <div
          className={`tooltip-info relative w-fit bg-transparent p-0 leading-normal shadow-none dark:bg-transparent ${
            wordDictationConfig.isOpen ? 'tooltip' : ''
          }`}
          data-tip="按 Tab 快捷键显示完整单词"
        >
          <div
            onMouseEnter={() => handleHoverWord(true)}
            onMouseLeave={() => handleHoverWord(false)}
            className={`flex items-center ${isTextSelectable && 'select-all'} justify-center ${wordState.hasWrong ? style.wrong : ''}`}
          >
            {wordState.displayWord.split('').map((t, index) => {
              return <Letter key={`${index}-${t}`} letter={t} visible={getLetterVisible(index)} state={wordState.letterStates[index]} />
            })}
          </div>
          {pronunciationIsOpen && (
            <div className="absolute -right-12 top-1/2 h-9 w-9 -translate-y-1/2 transform ">
              <Tooltip content={`快捷键${CTRL} + J`}>
                <WordPronunciationIcon word={word} lang={currentLanguage} ref={wordPronunciationIconRef} className="h-full w-full" />
              </Tooltip>
            </div>
          )}
        </div>
        {wrongHint && (
          <div className="mt-3 text-center text-[15px] font-medium leading-6 text-red-500 dark:text-red-400">{wrongHint}</div>
        )}
      </div>
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
