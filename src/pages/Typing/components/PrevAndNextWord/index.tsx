import { TypingContext, TypingStateActionType } from '../../store'
import Tooltip from '@/components/Tooltip'
import { currentDictInfoAtom, wordDictationConfigAtom } from '@/store'
import { CTRL } from '@/utils'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useMemo } from 'react'
import type { KeyboardEvent } from 'react'
import IconPrev from '~icons/tabler/arrow-narrow-left'
import IconNext from '~icons/tabler/arrow-narrow-right'

export default function PrevAndNextWord({ type, onSkip }: LastAndNextWordProps) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!

  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const newIndex = useMemo(() => state.chapterData.index + (type === 'prev' ? -1 : 1), [state.chapterData.index, type])
  const word = state.chapterData.words[newIndex]
  const shortCutKey = useMemo(() => (type === 'prev' ? `${CTRL} + Shift + ArrowLeft` : `${CTRL} + Shift + ArrowRight`), [type])
  const currentLanguage = useAtomValue(currentDictInfoAtom).language

  const onClickWord = useCallback(() => {
    if (!word) return

    // v9.4（TYP-007）：优先走父级的统一跳过路径（含 recordSkip / deferMemoryDue / 未完成结算 / 动态取词）；
    // 只有父级未提供回调时才退回旧的纯索引切换。
    if (onSkip) {
      void Promise.resolve(onSkip(type)).catch((e) => console.error('skip failed', e))
      return
    }
    if (type === 'prev') dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex })
    if (type === 'next') dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex })
  }, [type, dispatch, newIndex, word, onSkip])

  // v9.14（dsh，M3-006）：div onClick 既不进 Tab 序也没有键盘事件，键盘用户只能用快捷键跳词。
  // 只补 role/tabIndex + Enter/Space，不改结构与样式；热键系统（Ctrl+Shift+方向键 / Tab 看答案）不受影响。
  const onKeyDownWord = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClickWord()
      }
    },
    [onClickWord],
  )

  const headWord = useMemo(() => {
    if (!word) return ''

    const showWord = ['romaji', 'hapin'].includes(currentLanguage) ? word.notation : word.name

    if (type === 'prev') return showWord

    if (type === 'next') {
      return !wordDictationConfig.isOpen ? showWord : (showWord || '').replace(/./g, '_')
    }
  }, [word, currentLanguage, type, wordDictationConfig.isOpen])

  return (
    <>
      {word ? (
        <Tooltip content={`快捷键: ${shortCutKey}`}>
          <div
            role="button"
            tabIndex={0}
            aria-label={type === 'prev' ? '跳过：上一个单词' : '跳过：下一个单词'}
            onClick={onClickWord}
            onKeyDown={onKeyDownWord}
            className="flex max-w-xs cursor-pointer select-none items-center text-gray-700 opacity-60 duration-200 ease-in-out hover:opacity-100 dark:text-gray-400"
          >
            {type === 'prev' && <IconPrev className="mr-4 shrink-0 grow-0 text-2xl" />}

            <div className={`grow-1 flex w-full flex-col ${type === 'next' ? 'items-end text-right' : ''}`}>
              <p
                className={`font-mono text-2xl font-normal text-gray-700 dark:text-gray-400 ${
                  !wordDictationConfig.isOpen ? 'tracking-normal' : 'tracking-wider'
                }`}
              >
                {headWord}
              </p>
              {state.isTransVisible && (
                <p className="line-clamp-1 max-w-full text-sm font-normal text-gray-600 dark:text-gray-500">{word.trans.join('；')}</p>
              )}
            </div>
            {type === 'next' && <IconNext className="ml-4 shrink-0 grow-0 text-2xl" />}
          </div>
        </Tooltip>
      ) : (
        <div />
      )}
    </>
  )
}

export type LastAndNextWordProps = {
  /** 上一个单词还是下一个单词 */
  type: 'prev' | 'next'
  /** v9.4（TYP-007）：统一跳过入口（落库/顺延/结算语义与 Skip 一致） */
  onSkip?: (type: 'prev' | 'next') => void | Promise<void>
}
