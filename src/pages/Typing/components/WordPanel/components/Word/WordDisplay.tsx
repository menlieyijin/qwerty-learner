import Letter from './Letter'
import Notation from './Notation'
import style from './index.module.css'
import type { WordState } from './type'
import Tooltip from '@/components/Tooltip'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import { isTextSelectableAtom, pronunciationIsOpenAtom, wordDictationConfigAtom } from '@/store'
import type { Word } from '@/typings'
import { CTRL } from '@/utils'
import { useAtomValue } from 'jotai'
import type React from 'react'

type WordDisplayProps = {
  word: Word
  wordState: WordState
  currentLanguage: string
  currentLanguageCategory: string
  onHoverChange: (hovering: boolean) => void
  /** 由 `letterVisibility.isLetterVisible` 包出来的判定（带当前配置与悬停状态） */
  isLetterVisible: (index: number) => boolean
  wordPronunciationIconRef: React.RefObject<WordPronunciationIconRef>
  wrongHint: string
}

/**
 * 当前词的展示层（v10.1，dsh：从 `Word/index.tsx` 的返回值里抽出）。
 *
 * 只负责渲染：默写提示、逐字母、发音按钮、错误分类提示。**不含任何输入/结算逻辑**，
 * 这样才能在「不碰状态机」的前提下把 500 多行的 Word 组件收窄。
 *
 * DOM 结构与 class 名与抽出前逐字一致（含 `data-testid="current-word"`，供 CDP 脚本识别当前词）。
 */
export function WordDisplay({
  word,
  wordState,
  currentLanguage,
  currentLanguageCategory,
  onHoverChange,
  isLetterVisible,
  wordPronunciationIconRef,
  wrongHint,
}: WordDisplayProps) {
  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const isTextSelectable = useAtomValue(isTextSelectableAtom)
  const pronunciationIsOpen = useAtomValue(pronunciationIsOpenAtom)

  return (
    <div
      lang={currentLanguageCategory !== 'code' ? currentLanguageCategory : 'en'}
      className="flex flex-col items-center justify-center pb-1 pt-4"
    >
      {['romaji', 'hapin'].includes(currentLanguage) && word.notation && <Notation notation={word.notation} />}
      <div
        className={`tooltip-info relative w-fit bg-transparent p-0 leading-normal shadow-none dark:bg-transparent ${
          wordDictationConfig.isOpen ? 'tooltip' : ''
        }`}
        // v9.14（dsh，M4-008）：原先只有 `data-tip`，而全仓没有任何 CSS/JS 读取该属性 → 提示永远不出现。
        // 改用原生 `title`（悬停可见、读屏可播报），不引入新依赖；`tooltip-info` 类名保留，避免样式回归。
        title={wordDictationConfig.isOpen ? '按 Tab 快捷键显示完整单词' : undefined}
      >
        <div
          onMouseEnter={() => onHoverChange(true)}
          onMouseLeave={() => onHoverChange(false)}
          data-testid="current-word"
          className={`flex items-center ${isTextSelectable && 'select-all'} justify-center ${wordState.hasWrong ? style.wrong : ''}`}
        >
          {wordState.displayWord.split('').map((t, index) => {
            return <Letter key={`${index}-${t}`} letter={t} visible={isLetterVisible(index)} state={wordState.letterStates[index]} />
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
      {wrongHint && <div className="mt-3 text-center text-[15px] font-medium leading-6 text-red-500 dark:text-red-400">{wrongHint}</div>}
    </div>
  )
}
