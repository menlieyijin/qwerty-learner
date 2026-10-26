import purple from './purple.json'
import useWindowSize from '@/hooks/useWindowSize'
import { isOpenDarkModeAtom } from '@/store'
import { LineChart } from 'echarts/charts'
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useAtom } from 'jotai'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'

echarts.registerTheme('purple', purple)
echarts.use([GridComponent, TitleComponent, TooltipComponent, LineChart, CanvasRenderer])

interface LineChartsProps {
  title: string
  data: [string, number][]
  name: string
  suffix?: string
}

const LineCharts: FC<LineChartsProps> = ({ data, title, suffix, name }) => {
  const [isOpenDarkMode] = useAtom(isOpenDarkModeAtom)

  const chartRef = useRef<HTMLDivElement>(null)

  const { width, height } = useWindowSize()
  const hasData = data.length > 0

  useEffect(() => {
    if (!chartRef.current || !hasData) return

    let chart = echarts.getInstanceByDom(chartRef.current)
    chart?.dispose()

    chart = echarts.init(chartRef.current, isOpenDarkMode ? 'purple' : 'light')
    const instance = chart

    const option = {
      tooltip: { trigger: 'axis' },
      grid: {
        left: '10%',
        right: '10%',
        top: '20%',
        bottom: '10%',
      },
      xAxis: {
        type: 'time',
        axisPointer: {
          label: {
            // PAGES-012：ECharts 回调参数形态不保证 seriesData 存在，缺失时返回空串而不是抛错
            formatter: function (params: { seriesData?: Array<{ data?: unknown }> }) {
              const firstData = params?.seriesData?.[0]?.data
              return Array.isArray(firstData) ? String(firstData[0]) : ''
            },
          },
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => value + (suffix || '') },
      },
      series: [
        {
          name,
          type: 'line',
          smooth: true,
          data: data,
          emphasis: { focus: 'series' },
        },
      ],
    }

    instance.setOption(option)

    // PAGES-004：路由卸载/主题切换时释放实例（含 zrender 与 canvas），
    // 否则每次进出统计页都会在 echarts 内部实例表里留下引用（内存泄漏）。
    return () => {
      instance.dispose()
    }
  }, [data, hasData, title, suffix, name, isOpenDarkMode])

  useEffect(() => {
    if (!chartRef.current) return
    const chart = echarts.getInstanceByDom(chartRef.current)
    chart?.resize()
  }, [width, height, chartRef])

  return (
    <div className="flex h-full flex-col">
      <div className="text-center text-xl font-bold text-gray-600	dark:text-white">{title}</div>
      {hasData ? (
        <div style={{ width: '100%', height: '100%' }} ref={chartRef} className="line-chart flex-grow"></div>
      ) : (
        // PAGES-007：无数据时给出占位文案，不再直接 return 留白（用户无法区分“无数据”与“加载失败”）
        <div className="flex flex-grow items-center justify-center text-sm text-gray-400 dark:text-gray-500">暂无数据</div>
      )}
    </div>
  )
}

export default LineCharts
