import { isOpenDarkModeAtom } from '@/store'
import { useAtom } from 'jotai'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import type { Activity } from 'react-activity-calendar'
import ActivityCalendar from 'react-activity-calendar'
import { Tooltip as ReactTooltip } from 'react-tooltip'
import 'react-tooltip/dist/react-tooltip.css'

interface HeatmapChartsProps {
  title: string
  data: Activity[]
  /** PAGES-012：每个热力图使用唯一 tooltip id，避免同页两个实例抢同一个 data-tooltip-id */
  tooltipId?: string
}

const MAX_BLOCK_SIZE = 22
const MIN_BLOCK_SIZE = 8
const WEEKS_IN_YEAR = 53
// 预留给星期标签/图例/块间距，避免自适应后仍溢出容器
const RESERVED_WIDTH = 150

const HeatmapCharts: FC<HeatmapChartsProps> = ({ data, title, tooltipId = 'react-tooltip' }) => {
  const [isOpenDarkMode] = useAtom(isOpenDarkModeAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const [blockSize, setBlockSize] = useState(MAX_BLOCK_SIZE)

  // PAGES-003：react-activity-calendar 的 blockSize 固定为 22 时一整年约 1326px 宽，
  // 默认 1280 窗口会被父容器 overflow-hidden 裁掉最近数周。这里按容器实际宽度自适应，
  // 保证 53 列完整可见且不产生横向滚动条（1920 等大窗口仍保持 22px 视觉尺寸）。
  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const recomputeBlockSize = () => {
      const width = element.clientWidth
      if (!width) return
      const available = width - RESERVED_WIDTH
      const next = Math.floor(available / WEEKS_IN_YEAR)
      setBlockSize(Math.max(MIN_BLOCK_SIZE, Math.min(MAX_BLOCK_SIZE, Number.isFinite(next) ? next : MAX_BLOCK_SIZE)))
    }

    recomputeBlockSize()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(recomputeBlockSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const horizontalPadding = blockSize >= 18 ? 100 : blockSize >= 13 ? 70 : 48
  const rightPadding = blockSize >= 18 ? 60 : blockSize >= 13 ? 40 : 24
  const fontSize = Math.max(10, Math.min(20, blockSize))

  return (
    <div ref={containerRef} className="flex w-full flex-col items-center justify-center">
      <div className="text-center text-xl font-bold text-gray-600	dark:text-white">{title}</div>
      <ActivityCalendar
        fontSize={fontSize}
        blockSize={blockSize}
        blockRadius={7}
        style={{
          padding: `40px ${rightPadding}px 20px ${horizontalPadding}px`,
          color: isOpenDarkMode ? '#fff' : '#000',
        }}
        colorScheme={isOpenDarkMode ? 'dark' : 'light'}
        data={data}
        theme={{
          light: ['#f0f0f0', '#6366f1'],
          dark: ['hsl(0, 0%, 22%)', '#818cf8'],
        }}
        renderBlock={(block, activity) =>
          React.cloneElement(block, {
            'data-tooltip-id': tooltipId,
            'data-tooltip-html': `${activity.date} 练习 ${activity.count} 次`,
          })
        }
        showWeekdayLabels={true}
        labels={{
          months: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
          weekdays: ['日', '一', '二', '三', '四', '五', '六'],
          totalCount: '过去一年总计 {{count}} 次',
          legend: {
            less: '少',
            more: '多',
          },
        }}
      />
      <ReactTooltip id={tooltipId} />
    </div>
  )
}

export default HeatmapCharts
