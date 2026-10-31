import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

type Props = { name: string; children: ReactNode }
type State = { error: Error | null }

// 单个页签崩了不应该让整个设置对话框白屏（此前一个面板抛错 = 设置不可用）。
export default class SettingBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[setting:${this.props.name}]`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-sm text-gray-500">
          <span>「{this.props.name}」加载失败</span>
          <span className="text-xs text-gray-400">{String(this.state.error.message || this.state.error)}</span>
          <button
            type="button"
            className="rounded-lg border border-neutral-200 px-3 py-1 text-xs"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
