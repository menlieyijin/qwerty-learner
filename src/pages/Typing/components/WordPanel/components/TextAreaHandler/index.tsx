import type { WordUpdateAction } from '../types'
import { TypingContext } from '@/pages/Typing/store'
import type { FormEvent, KeyboardEvent } from 'react'
import { useCallback, useContext, useEffect, useRef } from 'react'

export default function TextAreaHandler({ updateInput }: { updateInput: (updateObj: WordUpdateAction) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!

  useEffect(() => {
    if (!textareaRef.current) return

    if (state.isTyping) {
      textareaRef.current.focus()
    } else {
      textareaRef.current.blur()
    }
  }, [state.isTyping])

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as InputEvent
    if (!nativeEvent.isComposing && nativeEvent.data !== null) {
      // v9.4（TYP-003）：一次 input 事件可能带多个字符（粘贴 / 输入法上屏 / 移动端联想 / 语音输入），
      // 必须逐字符送入判定，不能整串 append（否则只校验最后一个字符，拼错也能过词）。
      // 逐字符处理同时保证空格 → EXPLICIT_SPACE 的映射不会被绕过。
      for (const char of nativeEvent.data) {
        updateInput({ type: 'add', value: char, event: e })
      }

      if (textareaRef.current) {
        textareaRef.current.value = ''
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // v9.14（dsh，M3-002）：TYP-010 的 e.repeat 过滤此前只加在 KeyEventHandler（en/de/romaji 路径），
    // code 词库走 textarea，而 InputEvent 上没有 repeat 字段（Word.updateInput 的 'repeat' in evt 也拦不住），
    // 长按会把自动重复的字符一个个累积成错字并连判 4 次错。可打印字符的插入默认行为挂在 keydown 上，
    // 这里对 repeat 的 keydown 做 preventDefault 即不产生 input 事件，语义与 en 路径「长按只算第一个字符」对齐。
    if (e.repeat) e.preventDefault()
  }

  const onBlur = useCallback(() => {
    if (!textareaRef.current) return

    if (state.isTyping) {
      textareaRef.current.focus()
    }
  }, [state.isTyping])

  return (
    <textarea
      className="absolute left-0 top-0 m-0 h-0 w-0 appearance-none overflow-hidden border-0 p-0 focus:outline-none"
      ref={textareaRef}
      autoFocus
      spellCheck="false"
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onCompositionStart={() => {
        alert('您正在使用输入法，请关闭输入法。')
      }}
    ></textarea>
  )
}
