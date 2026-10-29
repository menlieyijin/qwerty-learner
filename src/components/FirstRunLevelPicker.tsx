import { LearningStartDialog } from './LearningStartDialog'
import { learningStartAtom, setLearningStartAtom } from '@/store/learningStart'
import type { LearningStartId } from '@/utils/learningStart'
import { hasPriorAutoLevelState, readStoredLearningStart } from '@/utils/learningStart'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useState } from 'react'

/**
 * 启动时是否有过自动进阶状态 —— **模块求值时就取**，早于任何组件副作用。
 * 必须在 `useWordList` 首次写入 `cached` 之前读，否则「新装」与「老用户」分不出来。
 */
const HAD_AUTO_LEVEL_STATE_AT_BOOT = hasPriorAutoLevelState()

/**
 * 首次打开时的词汇起点选择（v9.16，dsh）。
 *
 * 只在「没选过 且 启动前没有任何进阶状态」时弹一次；老用户升级上来不会被拦。
 * 修改入口不在这里（避免主界面被打扰），在词库页 —— 见 `pages/Gallery-N/index.tsx`。
 */
export function FirstRunLevelPicker() {
  // 惰性初始化里同步读 localStorage：避免 atomWithStorage 首帧为 null 导致老用户闪一下弹窗
  const [shouldPrompt, setShouldPrompt] = useState(() => readStoredLearningStart() === null && !HAD_AUTO_LEVEL_STATE_AT_BOOT)
  const start = useAtomValue(learningStartAtom)
  const applyChoice = useSetAtom(setLearningStartAtom)

  const pick = useCallback(
    (choiceId: LearningStartId) => {
      applyChoice(choiceId)
      setShouldPrompt(false)
    },
    [applyChoice],
  )

  // 关掉弹层（X / 以后再说）：记录 deferred，下次启动不再重复打扰；入口仍在词库页
  const defer = useCallback(() => {
    applyChoice('deferred')
    setShouldPrompt(false)
  }, [applyChoice])

  if (!shouldPrompt) return null

  return <LearningStartDialog open firstRun currentChoiceId={start?.choiceId ?? null} onPick={pick} onClose={defer} />
}
