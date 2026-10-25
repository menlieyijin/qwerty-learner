import Tooltip from '@/components/Tooltip'

/** v7：增强工具入口（替代原来的右下角悬浮 Q+ 按钮），打开全屏工具页 */
export const EnhanceButton = () => {
  const open = () => {
    window.dispatchEvent(new CustomEvent('qz-open-enhance'))
  }
  return (
    <Tooltip content="增强工具（词库管理 / 备份 / 发音 / 统计等）">
      <button className="whitespace-nowrap rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100" onClick={open}>
        工具
      </button>
    </Tooltip>
  )
}
