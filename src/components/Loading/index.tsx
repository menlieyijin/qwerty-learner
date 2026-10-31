import React from 'react'

export function LoadingUI({ className }: { className?: string }) {
  return (
    <div
      className={`inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid  border-indigo-400 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite] ${className}`}
      role="status"
      aria-label="加载中"
    >
      <span className="sr-only">加载中</span>
    </div>
  )
}

function Loading() {
  return (
    // v9.14（dsh，M4-016）：原 `bg-[#faf9ff;]` 多了一个分号，Tailwind 不生成该类，
    // 首屏遮罩背景实际是透明的（与 ErrorBoundary 里的正确写法不一致）
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#faf9ff]">
      <div className="flex flex-col items-center justify-center ">
        <LoadingUI />
      </div>
    </div>
  )
}

export default React.memo(Loading)
