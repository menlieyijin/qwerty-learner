import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { LearningStartChoice } from '@/utils/autoLevel'
import { safeStorage } from './storage'

/**
 * v9.16（dsh，目标-2）：首次打开应用的「词汇水平起点选择」。
 * - `''` 表示尚未选择：练习页首启自动弹出选择卡；
 * - 选择结果持久化到 localStorage（键 `learningStartChoice`），支持随时在练习页
 *   顶栏「学习路线」按钮重新打开修改（修改会同步改写 qzAutoLevelState.levelId）。
 */
export const learningStartChoiceAtom = atomWithStorage<LearningStartChoice | ''>(
  'learningStartChoice',
  '',
  safeStorage<LearningStartChoice | ''>(),
)

/** 起点选择卡开关：首启自动置 true，顶栏按钮也可手动打开。 */
export const learningStartPickerOpenAtom = atom(false)
