import { CHAPTER_LENGTH } from '@/constants'
import type { Howl } from 'howler'

export * from './mixpanel'

const bannedKeys = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'CapsLock',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Escape',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'OS',
  // Up, down, left and right keys
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  // volume keys
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
  // special keys
  'End',
  'PageDown',
  'PageUp',
  'Clear',
  'Home',
  // v9.4 修复（dsh）：功能键 / 非字符键。这些键以前没被排除，按下去会被当成一次“输入字母”，
  // 立刻判成错字（正确率、WPM、记忆曲线 wrong/lapses 被污染），F5 还会真的刷新页面丢进度。
  // 注：其中多数 e.key 本身就是多字符，已由 isLegal 的单字符守卫拦下；这里显式列出，
  // 既记录意图，也防止将来有人放宽单字符守卫后再次回归。
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'Insert',
  'PrintScreen',
  'ScrollLock',
  'Pause',
  'NumLock',
  'ContextMenu',
  'Dead',
  'Unidentified',
  'Process',
  'Compose',
]

/**
 * 是否是可作为“输入字符”处理的按键。
 *
 * 判定按 e.key 进行（KeyboardEvent.key），只有**可打印的单字符**才算输入：
 * - 单字符守卫：'F5' / 'Dead' / 'Unidentified' / 'Process' 这类多字符 e.key 一律不是输入字符，
 *   从根上避免将来新增键名再次漏进 bannedKeys 造成误判；
 * - 控制字符（\u0000-\u001F）与 DEL(\u007F) 不是输入；空格(\u0020) 算输入（单词间的空格）；
 * - bannedKeys 里的历史条目保留（语义相同，且便于阅读）。
 */
export const isLegal = (key: string): boolean => {
  if (typeof key !== 'string') return false
  if (key.length !== 1) return false
  if (key < ' ' || key === '\u007f') return false
  if (bannedKeys.includes(key)) return false
  return true
}

export const isChineseSymbol = (val: string): boolean =>
  /[\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3008|\u3009|\u3010|\u3011|\u300e|\u300f|\u300c|\u300d|\ufe43|\ufe44|\u3014|\u3015|\u2026|\u2014|\uff5e|\ufe4f|\uffe5]/.test(
    val,
  )

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

export const IS_MAC_OS = navigator.userAgent.indexOf('Macintosh') !== -1

export const CTRL = IS_MAC_OS ? 'Control' : 'Ctrl'

export function addHowlListener(howl: Howl, ...args: Parameters<Howl['on']>) {
  howl.on(...args)

  return () => howl.off(...args)
}

export function classNames(...classNames: Array<string | void | null>) {
  const finallyClassNames: string[] = []

  for (const className of classNames) {
    if (className) {
      finallyClassNames.push(className.trim())
    }
  }

  return finallyClassNames.join(' ')
}

export function getCurrentDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = ('0' + (date.getMonth() + 1)).slice(-2)
  const day = ('0' + date.getDate()).slice(-2)

  return `${year}${month}${day}`
}

export function calcChapterCount(length: number) {
  return Math.ceil(length / CHAPTER_LENGTH)
}

export function findCommonValues<T>(xs: T[], ys: T[]): T[] {
  const set = new Set(ys)
  return xs.filter((x) => set.has(x))
}

export function toFixedNumber(number: number, fractionDigits: number) {
  return Number((number ?? 0).toFixed(fractionDigits))
}

export function getUTCUnixTimestamp() {
  const now = new Date()
  return Math.floor(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ) / 1000,
  )
}

export function timeStamp2String(timestamp: number) {
  const date = new Date(timestamp * 1000)

  const dateString = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  const timeString = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  return `${dateString} ${timeString}`
}
