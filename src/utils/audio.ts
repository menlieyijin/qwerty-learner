/**
 * 音频工具（v10.6，dsh：从 `utils/index.ts` 抽出）。
 *
 * 只做「注册监听并返回取消函数」这种通用包装；具体音效资源与播放策略见 `utils/sounds/`。
 */
import type { Howl } from 'howler'

/** 给 Howl 注册事件监听，返回取消监听的函数（便于在 effect cleanup 里调用） */
export function addHowlListener(howl: Howl, ...args: Parameters<Howl['on']>) {
  howl.on(...args)

  return () => howl.off(...args)
}
