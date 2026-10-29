import type { LearningStartId } from '@/utils/learningStart'
import { LEARNING_START_OPTIONS } from '@/utils/learningStart'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import IconCheck from '~icons/heroicons/check-circle-solid'
import IconXMark from '~icons/heroicons/x-mark-solid'

type LearningStartDialogProps = {
  open: boolean
  /** 已选过的档位，用于高亮；首次打开时为 null */
  currentChoiceId?: LearningStartId | 'deferred' | null
  /** 首次打开（显示「以后再说」）；从词库页进入时只允许「取消」 */
  firstRun?: boolean
  onPick: (choiceId: LearningStartId) => void
  onClose: () => void
}

/**
 * 词汇起点选择弹层（v9.16，dsh）。
 *
 * 复用仓库已有的 `@headlessui/react` Dialog（与 `InfoPanel` / `SharePicDialog` 一致）：
 * 焦点陷阱、Esc 关闭、`aria-modal` 都由 headless UI 负责，不自造。样式沿用现有卡片风格
 * （白底 + `dark:bg-gray-800` + `rounded-lg` + `shadow-xl`），不引入新的设计语言。
 */
export function LearningStartDialog({ open, currentChoiceId, firstRun = false, onPick, onClose }: LearningStartDialogProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-2xl transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all dark:bg-gray-800">
                <div className="px-6 pb-4 pt-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <Dialog.Title className="text-lg font-medium text-gray-900 dark:text-gray-100">选择词汇起点</Dialog.Title>
                      <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        决定你从哪一级开始练，之后按掌握程度自动往上进阶。随时可在「词库」页修改。
                      </Dialog.Description>
                    </div>
                    <button
                      type="button"
                      aria-label="关闭"
                      className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      onClick={onClose}
                    >
                      <IconXMark className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {LEARNING_START_OPTIONS.map((option) => {
                      const selected = currentChoiceId === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          data-testid={`start-level-${option.id}`}
                          aria-pressed={selected}
                          className={`flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors ${
                            selected
                              ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/30'
                              : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500'
                          }`}
                          onClick={() => onPick(option.id)}
                        >
                          <span className="flex w-full items-center justify-between">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{option.name}</span>
                            {selected ? (
                              <IconCheck className="h-4 w-4 flex-shrink-0 text-indigo-500 dark:text-indigo-300" />
                            ) : (
                              <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                {option.tag}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{option.desc}</span>
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <p className="text-xs text-gray-400 dark:text-gray-500">起点只影响从哪一级开始，不影响已经练过的记录。</p>
                    <button
                      type="button"
                      className="rounded-md px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      onClick={onClose}
                    >
                      {firstRun ? '以后再说' : '取消'}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
