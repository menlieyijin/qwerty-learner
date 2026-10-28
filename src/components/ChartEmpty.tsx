import type { FC } from 'react'

type ChartEmptyProps = {
  text?: string
}

/**
 * v9.14（dsh，M4-015）：图表空态占位。
 *
 * `LineCharts` 与 `KeyboardWithBarCharts` 原先各有一份逐字相同的「暂无数据」占位（连 class 都一致），
 * 这里抽成一处，DOM 结构与文案保持原样。
 */
const ChartEmpty: FC<ChartEmptyProps> = ({ text = '暂无数据' }) => {
  return <div className="flex flex-grow items-center justify-center text-sm text-gray-400 dark:text-gray-500">{text}</div>
}

export default ChartEmpty
