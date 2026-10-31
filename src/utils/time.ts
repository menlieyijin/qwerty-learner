/**
 * 时间与日期（v10.6，dsh：从 `utils/index.ts` 抽出）。
 *
 * 这里只放与「当前时间 / 时间戳格式化」有关的纯函数；业务上的到期计算在 `utils/srsRules.ts`，
 * 记忆曲线的时间阶梯在 `utils/memoryLadder.ts`，不要混进来。
 */
import dayjs from 'dayjs'

/** 当前日期 `YYYYMMDD`（导出文件名、备份名用） */
export function getCurrentDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = ('0' + (date.getMonth() + 1)).slice(-2)
  const day = ('0' + date.getDate()).slice(-2)

  return `${year}${month}${day}`
}

/** 当前 UTC 秒级时间戳（与 `Math.floor(Date.now()/1000)` 等价，保留历史实现以便逐位一致） */
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

/** 秒级时间戳 → `MM-DD HH:mm`（中文环境） */
export function timeStamp2String(timestamp: number) {
  const date = new Date(timestamp * 1000)

  const dateString = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  const timeString = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  return `${dateString} ${timeString}`
}

/**
 * v9.14（dsh，M4-015）：导出文件名用的「日期时间」格式化。
 *
 * 输出与原先 `DropdownExport` 内手写的 getFullYear/getMonth/... 逐字符一致（时分秒仍用 `-` 分隔，
 * 因为文件名里不能出现 `:`），只是改用已有的 dayjs。
 */
export function formatDate(date: Date) {
  return dayjs(date).format('YYYY-MM-DD HH-mm-ss')
}
