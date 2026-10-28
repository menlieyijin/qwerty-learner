import type { LanguageCategoryType } from '@/typings'
import { createContext } from 'react'
import type { Updater } from 'use-immer'

// Gallery 页的 state/context 契约原先定义在 index.tsx（页面组件）里，
// 导致子组件 LanguageTabSwitcher 必须通过页面模块的自引用路径反向依赖整页模块。
// 抽到独立模块后依赖方向单向：子组件 → context，页面 → context。
export type GalleryState = {
  currentLanguageTab: LanguageCategoryType
}

export const initialGalleryState: GalleryState = {
  currentLanguageTab: 'en',
}

export const GalleryContext = createContext<{
  state: GalleryState
  setState: Updater<GalleryState>
} | null>(null)
