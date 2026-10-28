import { EXPLICIT_SPACE } from '@/constants'
import { fontSizeConfigAtom } from '@/store'
import { useAtomValue } from 'jotai'
import React from 'react'

export type LetterState = 'normal' | 'correct' | 'wrong'

// v9.14（dsh，M3-004）：原来是 Record<string, ...> + 布尔值 as unknown as string 当键查表，
// 双重断言会把「键名笔误 / 新增字母类别」的取值为 undefined 的问题藏到运行时（undefined[state] 直接抛错）。
// 改为两张普通映射，类名逐字保留，tsc 可校验取值。
const plainLetterClass: Record<LetterState, string> = {
  normal: 'text-gray-600 dark:text-gray-50',
  correct: 'text-green-600 dark:text-green-400',
  wrong: 'text-red-600 dark:text-red-400',
}
const spaceLetterClass: Record<LetterState, string> = {
  normal: 'text-gray-400',
  correct: 'text-green-400 dark:text-green-700',
  wrong: 'text-red-400 dark:text-red-600',
}

export type LetterProps = {
  letter: string
  state?: LetterState
  visible?: boolean
}

const Letter: React.FC<LetterProps> = ({ letter, state = 'normal', visible = true }) => {
  const fontSizeConfig = useAtomValue(fontSizeConfigAtom)
  return (
    <span
      className={`m-0 p-0 font-mono font-normal ${
        (letter === EXPLICIT_SPACE ? spaceLetterClass : plainLetterClass)[state]
      } pr-0.8 duration-0 dark:text-opacity-80`}
      style={{ fontSize: fontSizeConfig.foreignFont.toString() + 'px' }}
    >
      {visible ? letter : '_'}
    </span>
  )
}

export default React.memo(Letter)
