import { learningStartChoiceAtom, learningStartPickerOpenAtom } from '@/store/learningStart'
import { applyLearningStartChoice, hasAutoLevelState } from '@/utils/autoLevel'
import type { LearningStartChoice } from '@/utils/autoLevel'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect } from 'react'

/**
 * v9.16（dsh，目标-2）：首次打开应用的「词汇水平起点选择」卡。
 * - 自动弹出条件：从未选择过（learningStartChoice 为空）**且**没有任何练习数据
 *   （hasAutoLevelState()===false）。老用户升级后不会被骚扰；「稍后再说」只在本次
 *   会话内生效（sessionStorage），下次启动若仍未选择会再次提示。
 * - 修改入口：练习页顶栏「学习路线」按钮（LearningStartButton），可随时重开本卡。
 * - 选择结果：learningStartChoiceAtom 持久化 + applyLearningStartChoice 写入
 *   qzAutoLevelState.levelId，个性化路线由 LEARNING_PATH + 自动进阶接管。
 */

const OPTIONS: Array<{ value: LearningStartChoice; title: string; desc: string }> = [
  { value: 'never', title: '从未学过', desc: '从小学一年级开始，循序渐进建立词汇基础' },
  { value: 'junior', title: '初中水平', desc: '从初中一年级词表开始' },
  { value: 'senior', title: '高中水平', desc: '从高中必修词表开始' },
  { value: 'cet4', title: '四级水平', desc: '从大学四级词表开始' },
  { value: 'cet6', title: '六级水平', desc: '从大学六级词表开始' },
]

const POSTPONE_KEY = 'qz-start-postponed'

export default function FirstRunLevelPicker() {
  const choice = useAtomValue(learningStartChoiceAtom)
  const [open, setOpen] = useAtom(learningStartPickerOpenAtom)

  useEffect(() => {
    if (choice === '' && !hasAutoLevelState() && sessionStorage.getItem(POSTPONE_KEY) !== '1') {
      setOpen(true)
    }
  }, [choice, setOpen])

  if (!open) return null

  const postpone = () => {
    try {
      sessionStorage.setItem(POSTPONE_KEY, '1')
    } catch {
      /* sessionStorage 被禁时仅影响本次会话的去重，不阻塞主流程 */
    }
    setOpen(false)
  }

  const choose = (value: LearningStartChoice) => {
    applyLearningStartChoice(value)
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="选择词汇水平起点"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') postpone()
      }}
    >
      <div className="mx-4 w-[440px] max-w-full rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-bold text-gray-800 dark:text-gray-100">选择你的词汇起点</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          将据此生成个性化学习路线（自动进阶），之后可随时在顶栏「学习路线」修改。
        </p>
        <div className="flex flex-col gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-gray-600 dark:hover:border-indigo-400 dark:hover:bg-gray-700"
            >
              <span>
                <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">{o.title}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{o.desc}</span>
              </span>
              <span className="text-indigo-400">→</span>
            </button>
          ))}
        </div>
        <div className="mt-4 text-right">
          <button type="button" className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={postpone}>
            稍后再说
          </button>
        </div>
      </div>
    </div>
  )
}

/** 顶栏入口：随时打开起点选择卡（查看/修改学习路线起点）。 */
export function LearningStartButton() {
  const [, setOpen] = useAtom(learningStartPickerOpenAtom)
  return (
    <button
      type="button"
      className="my-btn-primary bg-indigo-500 hover:bg-indigo-400"
      aria-label="查看或修改学习路线起点"
      onClick={() => setOpen(true)}
    >
      学习路线
    </button>
  )
}
