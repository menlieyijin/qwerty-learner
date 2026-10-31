import InputHandler from '../InputHandler'
import type { WordUpdateAction } from '../types'
import { TipAlert } from './TipAlert'
import { WordDisplay } from './WordDisplay'
import { charsMatch, hasUntypableChar, isSeparatorEquivalenceEnabled, normalizeDisplayWord } from './displayWord'
import { isLetterVisible } from './letterVisibility'
import { initialWordState } from './type'
import type { WordState } from './type'
import { useAttemptSettlement } from './useAttemptSettlement'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { EXPLICIT_SPACE } from '@/constants'
import useKeySounds from '@/hooks/useKeySounds'
import { useSaveWordRecord } from '@/pages/Typing/hooks/useSaveRecord'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { currentChapterAtom, currentDictInfoAtom, isIgnoreCaseAtom, isShowAnswerOnHoverAtom, wordDictationConfigAtom } from '@/store'
import type { Word } from '@/typings'
import { getUtcStringForMixpanel } from '@/utils/mixpanel'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useImmer } from 'use-immer'

export default function WordComponent({ word, onFinish }: { word: Word; onFinish: () => void }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch, settleRef } = useContext(TypingContext)!
  const [wordState, setWordState] = useImmer<WordState>(structuredClone(initialWordState))

  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const isIgnoreCase = useAtomValue(isIgnoreCaseAtom)
  const isShowAnswerOnHover = useAtomValue(isShowAnswerOnHoverAtom)
  const saveWordRecord = useSaveWordRecord()
  // const wordLogUploader = useMixPanelWordLogUploader(state)
  const [playKeySound, playBeepSound, playHintSound] = useKeySounds()
  const [isHoveringWord, setIsHoveringWord] = useState(false)
  const currentLanguage = useAtomValue(currentDictInfoAtom).language
  const currentLanguageCategory = useAtomValue(currentDictInfoAtom).languageCategory
  const currentChapter = useAtomValue(currentChapterAtom)
  // v9.10（TYP-013，dsh）：空格 / `-` / `/` 在同一位置互相等价（仅英/德拉丁词库，排除程序类词库）
  const allowSepEquiv = isSeparatorEquivalenceEnabled(currentLanguage, currentLanguageCategory)

  const [showTipAlert, setShowTipAlert] = useState(false)
  const [wrongHint, setWrongHint] = useState('')
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)

  // v9.4（TYP-006）：当前作答的「未完成结算」基础设施
  const wordStateRef = useRef(wordState)
  wordStateRef.current = wordState
  // v10.3（dsh）：结算逻辑（增量上报 / 一次性落库 / 组合入口）抽到 useAttemptSettlement
  const { flushStats, persistOnce, settleAttempt, resetAttempt } = useAttemptSettlement({
    word,
    index: state.chapterData.index,
    dispatch,
    saveWordRecord,
    wordStateRef,
  })
  // v9.4（TYP-009）：词已完成、下一词尚未挂载的窗口期内按下的键先缓存，切词后重放到新词，
  // 既不会误判成当前词的越界错误，也不会把「下一词的第一个键」吞掉。
  const pendingKeysRef = useRef<string[]>([])

  // v8.1：错误分类提示（漏字/重复/错字/大小写），显示约 1.8 秒
  // v9.14（dsh，M3-009）：同一错法拼出的 hint 字符串完全相同 → setWrongHint 命中 Object.is 相等不重渲染，
  // 依赖若只有 wrongHint 则 effect 不重跑、旧 timer 不清除，第二次提示只剩「第一次的剩余时间」。
  // wrongCount 每次出错 +1（换词归零）正好当 nonce，effect 体不变。
  useEffect(() => {
    if (!wrongHint) return
    const timer = setTimeout(() => setWrongHint(''), 1800)
    return () => clearTimeout(timer)
  }, [wrongHint, wordState.wrongCount])

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
    resetAttempt(state.chapterData.index, word)

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
    (index: number) =>
      isLetterVisible(index, {
        wordState,
        dictation: wordDictationConfig,
        showAnswerOnHover: isShowAnswerOnHover,
        isHoveringWord,
      }),
    [wordState, wordDictationConfig, isShowAnswerOnHover, isHoveringWord],
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
    // v9.14（dsh，M3-001）：校验上界必须夹到词长。原来上界用 inputLength，输入比词长多时（粘贴超长串 /
    // 换词窗口 pendingKeys 重放）会拿 displayWord[词长] === undefined 去比对，必然判成错字，并把越界下标
    // 写进 letterStates / letterMistake（数组被撑长、结果页导出成 "?"）。这里只校验到 min(词长, 输入长)。
    const wordLength = wordState.displayWord.length
    const from = Math.min(wordState.judgedLength, inputLength)
    const judgeEnd = Math.min(inputLength, wordLength)
    let mismatch = -1
    for (let i = from; i < judgeEnd; i++) {
      const inputChar = wordState.inputWord[i]
      const correctChar = wordState.displayWord[i]
      let isEqual = false
      if (inputChar != undefined && correctChar != undefined) {
        // v9.10（TYP-013，dsh）：分隔符等价（空格 / - / / 同一位置互换），只在英/德拉丁词库生效；
        // 其余词库（romaji 长音符、程序类词库）走原严格比较，语义不变。
        isEqual = allowSepEquiv
          ? charsMatch(inputChar, correctChar, isIgnoreCase)
          : isIgnoreCase
          ? inputChar.toLowerCase() === correctChar.toLowerCase()
          : inputChar === correctChar
      }
      if (!isEqual) {
        mismatch = i
        break
      }
    }

    // v9.14（dsh，M3-001）：词内字符全部匹配、但输入比词长多 → 超出部分是「多余/重复字符」，仍算一次错，
    // 但定位下标夹到词内最后一位（wordLength >= 1，上面的 displayWord.length === 0 已提前返回），
    // 因此 mismatch 恒落在 [0, 词长)，letterStates / letterMistake 永不越界。
    const hasExtraInput = mismatch === -1 && inputLength > wordLength
    if (hasExtraInput) mismatch = wordLength - 1

    if (mismatch === -1) {
      // 新增的输入全部正确
      // v9.14（dsh，M3-001）：judged 同样夹到词长；isNowFinished 保持原式（judged >= 词长 ⇔ 输入 >= 词长），
      // 非超长输入时 judged === inputLength，判定与音效逐字等价。
      const judged = Math.min(inputLength, wordLength)
      const isNowFinished = inputLength >= wordLength
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
    // v9.14（dsh，M3-001）：超长输入的「错字」是词外的那个字符（inputWord[词长]），不是夹位后的词内字符
    const typedChar = hasExtraInput ? wordState.inputWord[wordLength] || '' : wordState.inputWord[mismatch] || ''
    let hint = ''
    if (hasExtraInput) {
      // v9.14（dsh，M3-001）：沿用现有提示分类（漏字 / 重复 / 大小写 / 错字）的文案风格，
      // 超出词长的部分归入「重复输入」或「多输入」——原来这里 expectedChar 为空，hint 直接是空串，
      // 用户只听到蜂鸣却看不到任何说明。
      hint = typedChar && typedChar.toLowerCase() === expectedChar.toLowerCase() ? `重复输入了「${typedChar}」` : `多输入了「${typedChar}」`
    } else if (expectedChar) {
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
    // 依赖数组只保留 inputWord：判定是「增量结算」，每跑一次就会把 from..inputLength 的字符
    // 计成 correct + 推进 judgedLength。若把 currentLanguage / allowSepEquiv 加进依赖，每次 render
    // （切库时的 atom 变化、以及这些值的新引用）都会重跑本 effect，而 judgedLength 已等于
    // inputWord.length 时虽不再计数，但一旦 token 抖动导致 inputWord 相同而 effect 重跑，
    // 就会重复 playKeySound / 重复写 letterTimeArray，判定与音效都会失真。
    // 换词库必然伴随换词（word 变化 → displayWord 重置、judgedLength 归零），届时本 effect 自然重跑，
    // 因此 allowSepEquiv 的取值变化不需要单独触发判定。
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
      <WordDisplay
        word={word}
        wordState={wordState}
        currentLanguage={currentLanguage}
        currentLanguageCategory={currentLanguageCategory}
        onHoverChange={handleHoverWord}
        isLetterVisible={getLetterVisible}
        wordPronunciationIconRef={wordPronunciationIconRef}
        wrongHint={wrongHint}
      />
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
