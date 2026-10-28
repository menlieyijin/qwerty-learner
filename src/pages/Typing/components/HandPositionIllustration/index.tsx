import standTypingHandPosition from '@/assets/standard_typing_hand_position.png'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState } from 'react'
import IconKeyboard from '~icons/ic/round-keyboard'
import IconX from '~icons/tabler/x'

export default function HandPositionIllustration() {
  const [isOpen, setIsOpen] = useState(false)

  function closeModal() {
    setIsOpen(false)
  }

  function openModal() {
    setIsOpen(true)
  }

  return (
    <>
      {/* v9.14（dsh，M3-005）：图标按钮只有 <IconKeyboard/>，没有可访问名，读屏只会念「按钮」 */}
      <button
        type="button"
        aria-label="查看指法图示"
        onClick={openModal}
        className={`flex items-center justify-center rounded p-[2px] text-lg text-indigo-500 outline-none transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white  ${
          isOpen && 'bg-indigo-500 text-white'
        }`}
      >
        <IconKeyboard className="icon"></IconKeyboard>
      </button>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
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
                <Dialog.Panel className="w-200  transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all dark:bg-gray-800">
                  <button type="button" onClick={() => setIsOpen(false)} title="关闭对话框">
                    <IconX className="absolute right-7 top-5 cursor-pointer text-gray-400" />
                  </button>
                  <Dialog.Title as="h3" className="text-center text-xl font-medium leading-6 text-gray-800 dark:text-gray-200">
                    推荐打字指法图示
                  </Dialog.Title>
                  <div className="mt-8">
                    {/* v9.14（dsh，M3-006）：这张指法图是对话框的唯一内容，alt="" 会让读屏用户打开一个空对话框 */}
                    <img className="block " src={standTypingHandPosition} alt="标准打字指法示意图" />
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
