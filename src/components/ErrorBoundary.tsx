import React from 'react'

/**
 * PAGES-002 / 全局错误边界：
 * - 任何页面组件在 render/生命周期中抛错时，React 18 会卸载整棵树导致白屏；
 * - 这里捕获后渲染可操作的兜底界面（错误摘要 + 重新加载 + 清除界面配置并重载），
 *   避免用户只能看到空白窗口且无法自助恢复。
 * - 只清理“界面/偏好配置”类 localStorage 键（不含任何 IndexedDB 学习数据），
 *   用于修复因坏配置（如 null/数组/类型不符的 config）导致的启动即崩。
 */
const CLEARABLE_STORAGE_KEYS = [
  'loopWordConfig',
  'keySoundsConfig',
  'hintSoundsConfig',
  'pronunciation',
  'fontsize',
  'randomConfig',
  'phoneticConfig',
  'wordDictationConfig',
  'currentDict',
  'learningMode',
  'qzCustomDict',
  'currentChapter',
  'isShowPrevAndNextWord',
  'isIgnoreCase',
  'isShowAnswerOnHover',
  'isTextSelectable',
  'isOpenDarkModeAtom',
  'dismissStartCardDate',
  'donateDate',
  'hasSeenEnhancedPromotion',
  'v7FontAdjusted',
]

type ErrorBoundaryProps = {
  children?: React.ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 保留控制台堆栈，便于用户反馈时复制；不引入额外依赖、不阻塞 UI
    console.error('[ErrorBoundary] 页面渲染异常：', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleClearConfigAndReload = () => {
    try {
      for (const key of CLEARABLE_STORAGE_KEYS) window.localStorage.removeItem(key)
    } catch (error) {
      console.error('[ErrorBoundary] 清除界面配置失败：', error)
    }
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const message = error?.message || String(error)
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-[#faf9ff] px-6 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800">
          <h1 className="text-xl font-bold text-red-500">页面出错了</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            当前页面渲染遇到异常，学习数据仍保存在本地。你可以先尝试重新加载；若反复出现，可清除界面配置后再重载（不会删除练习记录与错题本）。
          </p>
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
            {message}
          </pre>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
              onClick={this.handleReload}
            >
              重新加载
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={this.handleClearConfigAndReload}
            >
              清除界面配置并重载
            </button>
          </div>
        </div>
      </div>
    )
  }
}
