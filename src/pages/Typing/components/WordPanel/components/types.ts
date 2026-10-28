import type { FormEvent } from 'react'

// 输入处理器（KeyEventHandler / TextAreaHandler）与 InputHandler、Word 共用的「契约」类型放这里，
// 避免子处理器反向依赖父组件模块（原定义在 InputHandler/index.tsx 里，形成 type 环）。
export type WordUpdateAction = WordAddAction | WordDeleteAction | WordCompositionAction

export type WordAddAction = {
  type: 'add'
  value: string
  event: FormEvent<HTMLTextAreaElement> | KeyboardEvent
}

export type WordDeleteAction = {
  type: 'delete'
  length: number
}

// composition api is not ready yet
export type WordCompositionAction = {
  type: 'composition'
  value: string
}
