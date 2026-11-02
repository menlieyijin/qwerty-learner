import { isSeparatorChar } from './displayWord'
import { EXPLICIT_SPACE } from '@/constants'

/**
 * 输入判定的纯函数层（v11.6.2）。
 *
 * 借鉴 TypeWords 的 `visible-word-typing.ts`：把「这个字符是否算对」「新增输入该判到哪一位」
 * 从组件的 effect 里抽出来，组件只负责收集按键、播放音效、写状态。这样做的直接收益：
 * - 增量结算的边界（上一次判到哪、越界输入、大小写、分隔符等价）可以脱离浏览器逐条断言；
 * - keydown 通道与 textarea 通道共用同一套判定，不会再出现「一条通道修了、另一条没修」；
 * - 以后加输入法/粘贴/语音等新来源时，只需把字符送进来，不必再写一份比较逻辑。
 *
 * 行为与抽取前的 effect 逐字等价（见 `npm run test:input-judge`）。
 */

export type InputJudgement =
  /** 没有可判定的新增字符（空输入 / 空词 / 已判到末尾） */
  | { kind: 'idle' }
  /** 新增部分全部正确；`judged` 是判定后的已判长度，`finished` 表示整词完成 */
  | { kind: 'correct'; from: number; judged: number; finished: boolean }
  /** 出现错误；`index` 已夹在 [0, wordLength)，`extra` 表示错在词长之外的多余输入 */
  | { kind: 'wrong'; index: number; extra: boolean }

type JudgeArgs = {
  /** 归一化后的展示词（含 EXPLICIT_SPACE） */
  displayWord: string
  /** 当前累计输入 */
  inputWord: string
  /** 上次判定到的位置（增量结算的起点） */
  judgedLength: number
  ignoreCase: boolean
  /** 分隔符等价是否生效（仅英/德拉丁词库；见 displayWord.isSeparatorEquivalenceEnabled） */
  allowSeparatorEquivalence: boolean
}

/** 单字符比较：分隔符等价优先于大小写，顺序不能换（否则 isIgnoreCase=false 时等价被吞掉） */
function charMatches(input: string, expected: string, ignoreCase: boolean, allowSeparatorEquivalence: boolean): boolean {
  if (allowSeparatorEquivalence) {
    if (input === expected) return true
    if (isSeparatorChar(input) && isSeparatorChar(expected)) return true
    return ignoreCase ? input.toLowerCase() === expected.toLowerCase() : false
  }
  return ignoreCase ? input.toLowerCase() === expected.toLowerCase() : input === expected
}

/**
 * 判定「自上次判定以来新增的输入」。
 *
 * 与旧实现一致的几条边界：
 * - 只判到 `min(输入长度, 词长)`，不会用 `displayWord[词长] === undefined` 去比较；
 * - 词内全部匹配但输入比词长多 → 算一次错，下标夹到 `wordLength - 1`（数组永不被撑长）；
 * - `judgedLength > 输入长度` 时把起点夹回输入长度，不产生负区间。
 */
export function judgeInput({ displayWord, inputWord, judgedLength, ignoreCase, allowSeparatorEquivalence }: JudgeArgs): InputJudgement {
  const wordLength = displayWord.length
  const inputLength = inputWord.length
  if (wordLength === 0 || inputLength === 0) return { kind: 'idle' }

  const from = Math.min(Math.max(0, judgedLength), inputLength)
  const judgeEnd = Math.min(inputLength, wordLength)

  let mismatch = -1
  for (let i = from; i < judgeEnd; i += 1) {
    if (!charMatches(inputWord[i], displayWord[i], ignoreCase, allowSeparatorEquivalence)) {
      mismatch = i
      break
    }
  }

  // 词内字符全部匹配、但输入比词长多 → 多余/重复字符，仍算一次错
  if (mismatch === -1 && inputLength > wordLength) {
    return { kind: 'wrong', index: wordLength - 1, extra: true }
  }
  if (mismatch !== -1) return { kind: 'wrong', index: mismatch, extra: false }

  return {
    kind: 'correct',
    from,
    judged: Math.min(inputLength, wordLength),
    finished: inputLength >= wordLength,
  }
}

type MistakeArgs = {
  displayWord: string
  inputWord: string
  /** `judgeInput` 返回的错误下标（已夹在词内） */
  index: number
  /** 是否为「输入超过词长」 */
  extra: boolean
}

/**
 * 错误提示文案（漏字 / 重复 / 大小写 / 错字 / 多输入）。
 *
 * 抽出来的原因：这一串分支里有两处容易错的取值——
 * 超长输入时要取「词外那个字符」`inputWord[wordLength]`，而不是夹位后的词内字符；
 * 其余情况取 `inputWord[index]`。放在纯函数里可以直接断言，不必靠手打错字复现。
 */
export function describeMistake({ displayWord, inputWord, index, extra }: MistakeArgs): string {
  const wordLength = displayWord.length
  const expectedChar = displayWord[index] || ''
  const nextChar = displayWord[index + 1] || ''
  const prevChar = displayWord[index - 1] || ''
  const typedChar = extra ? inputWord[wordLength] || '' : inputWord[index] || ''

  if (extra) {
    return typedChar && typedChar.toLowerCase() === expectedChar.toLowerCase() ? `重复输入了「${typedChar}」` : `多输入了「${typedChar}」`
  }
  if (!expectedChar) return ''
  if (typedChar && nextChar && typedChar.toLowerCase() === nextChar.toLowerCase()) {
    return `漏掉了「${expectedChar}」`
  }
  if (typedChar && prevChar && typedChar.toLowerCase() === prevChar.toLowerCase()) {
    return `重复输入了「${typedChar}」`
  }
  if (typedChar && typedChar.toLowerCase() === expectedChar.toLowerCase()) {
    return `注意大小写：应为「${expectedChar}」`
  }
  return `应为「${expectedChar}」，你输入了「${typedChar}」`
}

/** 供测试与调用方复用：判断一个字符是否属于分隔符等价类（空格 / EXPLICIT_SPACE / - / /） */
export function isEquivalentSeparator(ch: string): boolean {
  return ch === ' ' || ch === EXPLICIT_SPACE || isSeparatorChar(ch)
}
