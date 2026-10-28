import type { TypingState, UserInputLog } from './type'
import type { WordWithIndex } from '@/typings'
import type { LetterMistakes } from '@/utils/db/record'
// v9.9（Batch6）：原来这里有一行 `import '@/utils/db/review-record'` 的纯副作用 import（上游遗留），
// 该模块已随 Gallery 详情死集群删除，且本文件从未使用它的任何导出。
import { mergeLetterMistake } from '@/utils/db/utils'
import shuffle from '@/utils/shuffle'
import { createContext } from 'react'
import type { MutableRefObject } from 'react'

export const initialState: TypingState = {
  chapterData: {
    words: [],
    index: 0,
    wordCount: 0,
    correctCount: 0,
    wrongCount: 0,
    wordRecordIds: [],
    userInputLogs: [],
  },
  timerData: {
    time: 0,
    accuracy: 0,
    wpm: 0,
  },
  isTyping: false,
  isFinished: false,
  isShowSkip: false,
  isTransVisible: true,
  isLoopSingleWord: false,
  isSavingRecord: false,
}

export const initialUserInputLog: UserInputLog = {
  index: 0,
  correctCount: 0,
  wrongCount: 0,
  LetterMistakes: {},
}

export enum TypingStateActionType {
  SETUP_CHAPTER = 'SETUP_CHAPTER',
  PUSH_WORD = 'PUSH_WORD',
  SET_IS_SKIP = 'SET_IS_SKIP',
  SET_IS_TYPING = 'SET_IS_TYPING',
  TOGGLE_IS_TYPING = 'TOGGLE_IS_TYPING',
  REPORT_WRONG_WORD = 'REPORT_WRONG_WORD',
  REPORT_CORRECT_WORD = 'REPORT_CORRECT_WORD',
  // v9.1：整词完成时一次性上报按键统计，替代每个字母 dispatch 一次（减少整树重渲染）
  REPORT_WORD_RESULT = 'REPORT_WORD_RESULT',
  NEXT_WORD = 'NEXT_WORD',
  LOOP_CURRENT_WORD = 'LOOP_CURRENT_WORD',
  FINISH_CHAPTER = 'FINISH_CHAPTER',
  INCREASE_WRONG_WORD = 'INCREASE_WRONG_WORD',
  SKIP_WORD = 'SKIP_WORD',
  SKIP_2_WORD_INDEX = 'SKIP_2_WORD_INDEX',
  REPEAT_CHAPTER = 'REPEAT_CHAPTER',
  NEXT_CHAPTER = 'NEXT_CHAPTER',
  TOGGLE_WORD_VISIBLE = 'TOGGLE_WORD_VISIBLE',
  TOGGLE_TRANS_VISIBLE = 'TOGGLE_TRANS_VISIBLE',
  TICK_TIMER = 'TICK_TIMER',
  ADD_WORD_RECORD_ID = 'ADD_WORD_RECORD_ID',
  SET_IS_SAVING_RECORD = 'SET_IS_SAVING_RECORD',
  SET_IS_LOOP_SINGLE_WORD = 'SET_IS_LOOP_SINGLE_WORD',
  TOGGLE_IS_LOOP_SINGLE_WORD = 'TOGGLE_IS_LOOP_SINGLE_WORD',
  SET_REVISION_INDEX = 'SET_REVISION_INDEX',
}

export type TypingStateAction =
  | { type: TypingStateActionType.SETUP_CHAPTER; payload: { words: WordWithIndex[]; shouldShuffle: boolean; initialIndex?: number } }
  | { type: TypingStateActionType.PUSH_WORD; payload: WordWithIndex }
  | { type: TypingStateActionType.SET_IS_SKIP; payload: boolean }
  | { type: TypingStateActionType.SET_IS_TYPING; payload: boolean }
  | { type: TypingStateActionType.TOGGLE_IS_TYPING }
  | { type: TypingStateActionType.REPORT_WRONG_WORD; payload: { letterMistake: LetterMistakes } }
  | { type: TypingStateActionType.REPORT_CORRECT_WORD }
  | {
      type: TypingStateActionType.REPORT_WORD_RESULT
      // v9.4：payload.index 显式指定结算的单词下标（未完成结算发生在切词/切库之后，不能再用 state.index）
      payload: { index?: number; correctCount: number; wrongCount: number; letterMistake: LetterMistakes }
    }
  | {
      type: TypingStateActionType.NEXT_WORD
      payload?: {
        updateReviewRecord?: (state: TypingState) => void
      }
    }
  | { type: TypingStateActionType.LOOP_CURRENT_WORD }
  | { type: TypingStateActionType.FINISH_CHAPTER }
  | { type: TypingStateActionType.SKIP_WORD; payload?: { finishIfLast?: boolean } }
  | { type: TypingStateActionType.SKIP_2_WORD_INDEX; newIndex: number; payload?: { finishIfLast?: boolean } }
  | { type: TypingStateActionType.REPEAT_CHAPTER; shouldShuffle: boolean }
  | { type: TypingStateActionType.NEXT_CHAPTER }
  | { type: TypingStateActionType.TOGGLE_TRANS_VISIBLE }
  | { type: TypingStateActionType.TICK_TIMER; addTime?: number }
  | { type: TypingStateActionType.ADD_WORD_RECORD_ID; payload: number }
  | { type: TypingStateActionType.SET_IS_SAVING_RECORD; payload: boolean }
  | { type: TypingStateActionType.SET_IS_LOOP_SINGLE_WORD; payload: boolean }
  | { type: TypingStateActionType.TOGGLE_IS_LOOP_SINGLE_WORD }

export type Dispatch = (action: TypingStateAction) => void

export const typingReducer = (state: TypingState, action: TypingStateAction) => {
  switch (action.type) {
    case TypingStateActionType.SETUP_CHAPTER: {
      const newState = structuredClone(initialState)
      const words = action.payload.shouldShuffle ? shuffle(action.payload.words) : action.payload.words
      let initialIndex = action.payload.initialIndex ?? 0
      if (initialIndex >= words.length) {
        initialIndex = 0
      }
      newState.chapterData.index = initialIndex
      newState.chapterData.words = words
      newState.chapterData.userInputLogs = words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))

      return newState
    }
    case TypingStateActionType.PUSH_WORD: {
      const index = state.chapterData.words.length
      state.chapterData.words.push({ ...action.payload, index })
      state.chapterData.userInputLogs.push({ ...structuredClone(initialUserInputLog), index })
      break
    }
    case TypingStateActionType.SET_IS_SKIP:
      state.isShowSkip = action.payload
      break
    case TypingStateActionType.SET_IS_TYPING:
      state.isTyping = action.payload
      break

    case TypingStateActionType.TOGGLE_IS_TYPING:
      state.isTyping = !state.isTyping
      break
    case TypingStateActionType.REPORT_CORRECT_WORD: {
      state.chapterData.correctCount += 1

      const wordLog = state.chapterData.userInputLogs[state.chapterData.index]
      wordLog.correctCount += 1
      break
    }
    case TypingStateActionType.REPORT_WRONG_WORD: {
      state.chapterData.wrongCount += 1

      const letterMistake = action.payload.letterMistake
      const wordLog = state.chapterData.userInputLogs[state.chapterData.index]
      wordLog.wrongCount += 1
      wordLog.LetterMistakes = mergeLetterMistake(wordLog.LetterMistakes, letterMistake)
      break
    }
    case TypingStateActionType.REPORT_WORD_RESULT: {
      // v9.1：一个词完成时一次性累加，避免每敲一个字母就让整个练习页重渲染
      // v9.4：支持 index 显式指定（未完成结算 / 暂停结算发生在切词之后），并保持「增量」语义以便重复调用幂等
      const { correctCount = 0, wrongCount = 0, letterMistake } = action.payload
      const targetIndex = action.payload.index ?? state.chapterData.index
      state.chapterData.correctCount += correctCount
      state.chapterData.wrongCount += wrongCount
      const wordLog = state.chapterData.userInputLogs.find((log) => log.index === targetIndex)
      if (wordLog) {
        wordLog.correctCount += correctCount
        wordLog.wrongCount += wrongCount
        if (letterMistake) wordLog.LetterMistakes = mergeLetterMistake(wordLog.LetterMistakes, letterMistake)
      }
      break
    }
    case TypingStateActionType.NEXT_WORD: {
      state.chapterData.index += 1
      state.chapterData.wordCount += 1
      state.isShowSkip = false

      if (action?.payload?.updateReviewRecord) {
        action.payload.updateReviewRecord(state)
      }
      break
    }
    case TypingStateActionType.LOOP_CURRENT_WORD:
      state.isShowSkip = false
      state.chapterData.wordCount += 1
      break
    case TypingStateActionType.FINISH_CHAPTER:
      state.chapterData.wordCount += 1
      state.isTyping = false
      state.isFinished = true
      state.isShowSkip = false
      break
    case TypingStateActionType.SKIP_WORD: {
      const newIndex = state.chapterData.index + 1
      if (newIndex >= state.chapterData.words.length) {
        // v8.9：动态词表只有 1 个词，末词 Skip 不再直接进入「完成」空白页；
        // 非复习模式只暂停并保留当前词，复习模式才结束本轮（由调用方传 finishIfLast）
        state.isTyping = false
        if (action.payload?.finishIfLast) state.isFinished = true
      } else {
        state.chapterData.index = newIndex
      }
      state.isShowSkip = false
      break
    }
    case TypingStateActionType.SKIP_2_WORD_INDEX: {
      const newIndex = action.newIndex
      if (newIndex >= state.chapterData.words.length) {
        state.isTyping = false
        state.isShowSkip = false
        if (action.payload?.finishIfLast) state.isFinished = true
        else state.chapterData.index = Math.max(0, state.chapterData.words.length - 1)
      } else {
        state.chapterData.index = Math.max(0, newIndex)
      }
      break
    }
    case TypingStateActionType.REPEAT_CHAPTER: {
      const newState = structuredClone(initialState)
      newState.chapterData.userInputLogs = state.chapterData.words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))
      newState.isTyping = true
      newState.chapterData.words = action.shouldShuffle ? shuffle(state.chapterData.words) : state.chapterData.words
      newState.isTransVisible = state.isTransVisible
      return newState
    }
    case TypingStateActionType.NEXT_CHAPTER: {
      const newState = structuredClone(initialState)
      newState.chapterData.userInputLogs = state.chapterData.words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))
      newState.isTyping = true
      newState.isTransVisible = state.isTransVisible
      return newState
    }
    case TypingStateActionType.TOGGLE_TRANS_VISIBLE:
      state.isTransVisible = !state.isTransVisible
      break
    case TypingStateActionType.TICK_TIMER: {
      const increment = action.addTime === undefined ? 1 : action.addTime
      const newTime = state.timerData.time + increment
      const inputSum =
        state.chapterData.correctCount + state.chapterData.wrongCount === 0
          ? 1
          : state.chapterData.correctCount + state.chapterData.wrongCount

      state.timerData.time = newTime
      state.timerData.accuracy = Math.round((state.chapterData.correctCount / inputSum) * 100)
      // v9.14（dsh，M3-010）：整章在首个 tick 之前结束时 newTime 仍是 0，除零会算出 Infinity，
      // 结果页 / 分享图直接印出 "Infinity"。只在 time === 0 这一条边界上兜底为 0，其余路径逐字不变。
      state.timerData.wpm = newTime > 0 ? Math.round((state.chapterData.wordCount / newTime) * 60) : 0
      break
    }
    case TypingStateActionType.ADD_WORD_RECORD_ID: {
      state.chapterData.wordRecordIds.push(action.payload)
      break
    }
    case TypingStateActionType.SET_IS_SAVING_RECORD: {
      state.isSavingRecord = action.payload
      break
    }
    case TypingStateActionType.SET_IS_LOOP_SINGLE_WORD: {
      state.isLoopSingleWord = action.payload
      break
    }
    case TypingStateActionType.TOGGLE_IS_LOOP_SINGLE_WORD: {
      state.isLoopSingleWord = !state.isLoopSingleWord
      break
    }
    default: {
      return state
    }
  }
}

/**
 * v9.4（TYP-006/SRS-004）：当前单词「未完成结算」回调。
 * Word 组件把当前作答（按键统计 + 未落库的词记录）注册到这里，
 * 父级在 Skip / 暂停 / 切库 / 卸载时调用，保证不丢按键与错词。
 */
export type TypingSettleFn = (options?: { persist?: boolean }) => void | Promise<void>

export type TypingContextValue = {
  state: TypingState
  dispatch: Dispatch
  /** Word 注册的结算函数；persist=true 时同时落库（放弃该词时用） */
  settleRef?: MutableRefObject<TypingSettleFn | null>
  /** Skip 在途锁（SRS-004：连点只算一次），两条 skip 入口共享同一把锁 */
  skipLockRef?: MutableRefObject<boolean>
}

export const TypingContext = createContext<TypingContextValue | null>(null)
