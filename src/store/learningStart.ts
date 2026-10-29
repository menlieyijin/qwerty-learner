import { learningModeAtom } from './index'
import { safeStorage } from './storage'
import type { ApplyStartResult, LearningStartId, LearningStartState } from '@/utils/learningStart'
import { LEARNING_START_STORAGE_KEY, applyLearningStartChoice, parseLearningStartState } from '@/utils/learningStart'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { SyncStorage } from 'jotai/vanilla/utils/atomWithStorage'

/**
 * 起点选择（v9.16，dsh）：持久化 + 应用。
 *
 * 存储值形状：`{ version: 1, choiceId: 'cet6' | 'deferred' | ..., decidedAt: 1730000000000 }`
 * 读回时统一过 `parseLearningStartState`，脏数据（手改、旧格式）按「没选过」处理，不抛错。
 */
const jsonStorage = safeStorage<LearningStartState | null>()
const validatedStorage: SyncStorage<LearningStartState | null> = {
  ...jsonStorage,
  getItem(key, initialValue) {
    return parseLearningStartState(jsonStorage.getItem(key, initialValue))
  },
}

/** null = 从未问过（首次打开时弹选择）；对象 = 已问过（含用户选「以后再说」） */
export const learningStartAtom = atomWithStorage<LearningStartState | null>(LEARNING_START_STORAGE_KEY, null, validatedStorage)

/**
 * 应用一次起点选择：写级别 + 切到自动进阶 + 记录选择。
 *
 * 顺序有意为之：先改级别再写 `learningStartAtom`，因为 `useWordList` 以 `learningStartAtom`
 * 作为重载依赖——写它的时候级别已经就位，重载就直接出对应级别的词（不会先出旧级别的词再刷一次）。
 */
export const setLearningStartAtom = atom(null, (get, set, choiceId: LearningStartId | 'deferred'): ApplyStartResult => {
  const result = applyLearningStartChoice(choiceId)
  if (result.levelId) set(learningModeAtom, 'auto')
  set(learningStartAtom, { version: 1, choiceId, decidedAt: Date.now() })
  return result
})
