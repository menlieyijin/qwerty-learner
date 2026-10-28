import { LoadingUI } from '@/components/Loading'
import type { FC } from 'react'
import ErrorIcon from '~icons/ic/outline-error'

type LoadingWordUIProps = {
  className?: string
  isLoading: boolean
  hasError: boolean
}

export const LoadingWordUI: FC<LoadingWordUIProps> = ({ className, isLoading, hasError }) => {
  return (
    <div className={`${className}`}>
      {hasError ? (
        // v9.14（dsh，M4-008）：`data-tip` 全仓没有任何实现（无 CSS/无 JS 读取），提示永远不出现、
        // 读屏也没有内容。改用浏览器原生 title + aria-label（零依赖）。.tooltip 类保留，避免内边距变化导致图标位移。
        <div className="tooltip !bg-transparent" title="数据加载失败">
          <ErrorIcon className="text-red-500" role="img" aria-label="数据加载失败" />
        </div>
      ) : (
        isLoading && <LoadingUI />
      )}
    </div>
  )
}
