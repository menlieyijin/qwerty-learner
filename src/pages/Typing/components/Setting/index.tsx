import { TypingContext, TypingStateActionType } from '../../store'
import AboutSetting from './AboutSetting'
import AdvancedSetting from './AdvancedSetting'
import DataSetting from './DataSetting'
import DictSetting from './DictSetting'
import SettingBoundary from './SettingBoundary'
import SoundSetting from './SoundSetting'
import ToolsSetting from './ToolsSetting'
import ViewSetting from './ViewSetting'
import { desktop, isDesktop } from '@/utils/desktop'
import { Dialog, Tab, Transition } from '@headlessui/react'
import classNames from 'classnames'
import type { ComponentType } from 'react'
import { Fragment, useCallback, useContext, useEffect, useState } from 'react'
import IconAdjustmentsHorizontal from '~icons/tabler/adjustments-horizontal'
import IconBook from '~icons/tabler/book'
import IconDatabaseCog from '~icons/tabler/database-cog'
import IconEar from '~icons/tabler/ear'
import IconEye from '~icons/tabler/eye'
import IconInfoCircle from '~icons/tabler/info-circle'
import IconCog6Tooth from '~icons/tabler/settings'
import IconTool from '~icons/tabler/tool'
import IconX from '~icons/tabler/x'

type SettingTabDef = {
  id: string
  label: string
  Icon: ComponentType<{ className?: string }>
  Panel: ComponentType
  desktopOnly?: boolean
}

const SETTING_TABS: SettingTabDef[] = [
  { id: 'sound', label: '音效设置', Icon: IconEar, Panel: SoundSetting },
  { id: 'view', label: '显示设置', Icon: IconEye, Panel: ViewSetting },
  { id: 'data', label: '数据设置', Icon: IconDatabaseCog, Panel: DataSetting },
  { id: 'dict', label: '词库管理', Icon: IconBook, Panel: DictSetting, desktopOnly: true },
  { id: 'tools', label: '桌面工具', Icon: IconTool, Panel: ToolsSetting, desktopOnly: true },
  { id: 'advanced', label: '高级设置', Icon: IconAdjustmentsHorizontal, Panel: AdvancedSetting },
  { id: 'about', label: '关于', Icon: IconInfoCircle, Panel: AboutSetting },
]

export default function Setting() {
  const [isOpen, setIsOpen] = useState(false)
  const { dispatch } = useContext(TypingContext) ?? {}

  const openModal = useCallback(() => {
    setIsOpen(true)
    if (dispatch) {
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    }
  }, [dispatch])

  // 桌面壳的快捷键 / 托盘入口不再打开独立的增强面板，统一打开这里
  useEffect(() => {
    const off = desktop()?.onEvent((payload) => {
      if (payload?.type === 'openSettings') openModal()
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [openModal])

  const tabs = isDesktop() ? SETTING_TABS : SETTING_TABS.filter((t) => !t.desktopOnly)

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`flex items-center justify-center rounded p-[2px] text-lg text-indigo-500 outline-none transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white  ${
          isOpen && 'bg-indigo-500 text-white'
        }`}
        title="打开设置对话框"
      >
        <IconCog6Tooth className="icon" />
      </button>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setIsOpen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="flex w-200 flex-col overflow-hidden rounded-2xl bg-white p-0 shadow-xl dark:bg-gray-800">
                  <div className="relative flex h-22 items-end justify-between rounded-t-lg border-b border-neutral-100 bg-stone-50 px-6 py-3 dark:border-neutral-700 dark:bg-gray-900">
                    <span className="text-3xl font-bold text-gray-600">设置</span>
                    <button type="button" onClick={() => setIsOpen(false)} title="关闭对话框">
                      <IconX className="absolute right-7 top-5 cursor-pointer text-gray-400" />
                    </button>
                  </div>

                  <Tab.Group vertical>
                    <div className="flex h-120 w-full ">
                      <Tab.List className="flex h-full w-52 flex-col items-start space-y-2 border-r border-neutral-100 bg-stone-50 px-6 py-3 dark:border-transparent dark:bg-gray-900">
                        {tabs.map(({ id, label, Icon }) => (
                          <Tab
                            key={id}
                            className={({ selected }) =>
                              classNames(
                                'flex h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-2 ring-0 focus:outline-none',
                                selected && 'bg-gray-200 bg-opacity-50 dark:bg-gray-800',
                              )
                            }
                          >
                            <Icon className="mr-2 h-5 w-5 text-neutral-500 dark:text-neutral-300" />
                            <span className="text-neutral-500 dark:text-neutral-300">{label}</span>
                          </Tab>
                        ))}
                      </Tab.List>

                      <Tab.Panels className="h-full w-full flex-1">
                        {tabs.map(({ id, label, Panel }) => (
                          <Tab.Panel key={id} unmount className="flex h-full w-full focus:outline-none">
                            <SettingBoundary name={label}>
                              <Panel />
                            </SettingBoundary>
                          </Tab.Panel>
                        ))}
                      </Tab.Panels>
                    </div>
                  </Tab.Group>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
