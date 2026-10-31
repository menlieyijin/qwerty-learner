/**
 * 平台判定（v10.6，dsh：从 `utils/index.ts` 抽出）。
 *
 * 注意：`IS_MAC_OS` 在模块加载时读取一次 `navigator.userAgent`，无 DOM 环境（如 node 单测）会抛错，
 * 因此只允许在浏览器/渲染进程侧引用；需要跨环境使用的代码请改用 `IsDesktop()` 这类惰性函数。
 */

export const IS_MAC_OS = navigator.userAgent.indexOf('Macintosh') !== -1

/** 快捷键文案里的修饰键名（Mac 显示 Control，其余显示 Ctrl） */
export const CTRL = IS_MAC_OS ? 'Control' : 'Ctrl'

/** 是否桌面端（用 UA 里的移动端标识做排除，保持与历史实现一致） */
export const IsDesktop = () => {
  const userAgentInfo = navigator.userAgent
  const Agents = ['Android', 'iPhone', 'SymbianOS', 'Windows Phone', 'iPad', 'iPod']

  let flag = true
  for (let v = 0; v < Agents.length; v++) {
    if (userAgentInfo.indexOf(Agents[v]) > 0) {
      flag = false
      break
    }
  }
  return flag
}
