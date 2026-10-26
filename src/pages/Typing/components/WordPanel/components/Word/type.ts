import type { LetterState } from './Letter'
import type { LetterMistakes } from '@/utils/db/record'

export type WordState = {
  displayWord: string
  inputWord: string
  // v9.4：已判定为正确的输入长度（支持一次 input 事件送多个字符时逐个校验，TYP-003）
  judgedLength: number
  letterStates: LetterState[]
  isFinished: boolean
  // 是否出现输入错误
  hasWrong: boolean
  // 记录是否已经出现过输入错误
  hasMadeInputWrong: boolean
  // 用户输入错误的次数
  wrongCount: number
  startTime: string
  endTime: string
  inputCount: number
  correctCount: number
  letterTimeArray: number[]
  letterMistake: LetterMistakes
  // 用于随机隐藏字母功能
  randomLetterVisible: boolean[]
}

export const initialWordState: WordState = {
  displayWord: '',
  inputWord: '',
  judgedLength: 0,
  letterStates: [],
  isFinished: false,
  hasWrong: false,
  hasMadeInputWrong: false,
  wrongCount: 0,
  startTime: '',
  endTime: '',
  inputCount: 0,
  correctCount: 0,
  letterTimeArray: [],
  letterMistake: {},
  randomLetterVisible: [],
}
