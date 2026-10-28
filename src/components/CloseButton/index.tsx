import classNames from 'classnames'
import type { FC } from 'react'
import IconX from '~icons/tabler/x'

type CloseButtonProps = {
  className?: string
  /** 读屏播报名（默认「返回」） */
  label?: string
  onClose: () => void
}

/**
 * v9.14（dsh，M4-004/M4-015）：返回/关闭按钮统一实现。
 *
 * 四处（统计页、词库页、错题本、错题详情）原先都是 `<IconX onClick>`：不可聚焦、无键盘触发、
 * 读屏没有名称。这里用原生 <button>（天然支持 Enter/Space 与 Tab 聚焦），
 * 尺寸/颜色/定位类仍由调用方通过 className 传入，盒子尺寸与图标尺寸保持不变。
 */
const CloseButton: FC<CloseButtonProps> = ({ className, label = '返回', onClose }) => {
  return (
    <button
      type="button"
      aria-label={label}
      className={classNames(
        'inline-flex cursor-pointer items-center justify-center text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        className,
      )}
      onClick={onClose}
    >
      <IconX className="h-full w-full" />
    </button>
  )
}

export default CloseButton
