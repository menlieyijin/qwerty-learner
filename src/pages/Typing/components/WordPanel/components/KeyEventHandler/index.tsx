import type { WordUpdateAction } from '../types'
import { TypingContext } from '@/pages/Typing/store'
import { isChineseSymbol, isLegal } from '@/utils'
import { useCallback, useContext, useEffect } from 'react'

export default function KeyEventHandler({ updateInput }: { updateInput: (updateObj: WordUpdateAction) => void }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!

  const onKeydown = useCallback(
    (e: KeyboardEvent) => {
      // v9.4 修复（dsh，TYP-001 P1）：IME 正在组词时不能把按键当成英文输入。
      // 组词期浏览器会先派发 keydown（key 可能是 'Process'/字母），提交时才给 compositionend；
      // 若此时走下面的 add 分支，会把拼音字母（如 'n' 'i'）当成错字记进正确率与记忆曲线。
      if (e.isComposing || e.keyCode === 229) return

      // v9.4 修复（dsh，TYP-010）：长按产生的自动重复 keydown 不计入输入，
      // 否则按住一个键会连续拼进多个字母、错字数被放大（且 interval 计时失真）。
      if (e.repeat) return

      const char = e.key

      if (isChineseSymbol(char)) {
        alert('您正在使用输入法，请关闭输入法。')
        return
      }

      if (isLegal(char) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // v9.4 修复（dsh）：isLegal 已保证是单个可打印字符；这里仍保留显式守卫，
        // 避免将来 isLegal 放宽后把 'F5' 这类多字符 e.key 拼进 inputWord 造成一次错字。
        if (char.length !== 1) return
        // 打字过程中吞掉可打印键的浏览器默认行为（快速查找栏等），与 Word 里空格键的处理保持一致
        e.preventDefault()
        updateInput({ type: 'add', value: char, event: e })
      }
    },
    [updateInput],
  )

  useEffect(() => {
    if (!state.isTyping) return

    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [onKeydown, state.isTyping])

  return <></>
}
