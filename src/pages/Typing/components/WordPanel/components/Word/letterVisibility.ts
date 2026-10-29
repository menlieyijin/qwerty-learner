import type { WordState } from './type'
import type { WordDictationType } from '@/typings'

export const vowelLetters = ['A', 'E', 'I', 'O', 'U']

export type LetterVisibilityInput = {
  /** 当前词的渲染状态（displayWord / letterStates / randomLetterVisible） */
  wordState: Pick<WordState, 'displayWord' | 'letterStates' | 'randomLetterVisible'>
  /** 默写（听写）配置：关闭时全部可见 */
  dictation: { isOpen: boolean; type: WordDictationType }
  /** 是否「悬停显示答案」且当前正在悬停 */
  showAnswerOnHover: boolean
  isHoveringWord: boolean
}

/**
 * 某个下标的字母是否显示（v10.1，dsh：从 `Word/index.tsx` 的 `getLetterVisible` 抽出为纯函数）。
 *
 * 规则逐条保留：
 * 1. 该位置已答对 → 显示；
 * 2. 开启「悬停显示答案」且正在悬停 → 全显示；
 * 3. 默写关闭 → 全显示；
 * 4. 默写开启时：hideAll 全隐藏；hideVowel 隐藏元音；hideConsonant 隐藏辅音；randomHide 用会话内随机表。
 */
export function isLetterVisible(index: number, input: LetterVisibilityInput): boolean {
  const { wordState, dictation, showAnswerOnHover, isHoveringWord } = input
  if (wordState.letterStates[index] === 'correct' || (showAnswerOnHover && isHoveringWord)) return true

  if (dictation.isOpen) {
    if (dictation.type === 'hideAll') return false

    const letter = wordState.displayWord[index]
    if (dictation.type === 'hideVowel') {
      return !vowelLetters.includes(letter.toUpperCase())
    }
    if (dictation.type === 'hideConsonant') {
      return vowelLetters.includes(letter.toUpperCase())
    }
    if (dictation.type === 'randomHide') {
      return !!wordState.randomLetterVisible[index]
    }
  }
  return true
}
