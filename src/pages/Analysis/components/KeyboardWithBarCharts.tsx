import Keyboard from './keyboard'
import purple from './purple.json'
import type { WrongKeyStat } from '../hooks/useWordStats'
import useWindowSize from '@/hooks/useWindowSize'
import { isOpenDarkModeAtom } from '@/store'
import { BarChart, MapChart } from 'echarts/charts'
import { GeoComponent, ToolboxComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import { useAtom } from 'jotai'
import type { FC } from 'react'
import { useEffect, useRef } from 'react'

echarts.use([BarChart, CanvasRenderer, GeoComponent, MapChart, ToolboxComponent, TooltipComponent, UniversalTransition, VisualMapComponent])
echarts.registerTheme('purple', purple)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
echarts.registerMap('Keyboard', Keyboard as any)

const keyboardData = [
  { name: 'Q', value: 0 },
  { name: 'W', value: 0 },
  { name: 'E', value: 0 },
  { name: 'R', value: 0 },
  { name: 'T', value: 0 },
  { name: 'Y', value: 0 },
  { name: 'U', value: 0 },
  { name: 'I', value: 0 },
  { name: 'O', value: 0 },
  { name: 'P', value: 0 },
  { name: 'A', value: 0 },
  { name: 'S', value: 0 },
  { name: 'D', value: 0 },
  { name: 'F', value: 0 },
  { name: 'G', value: 0 },
  { name: 'H', value: 0 },
  { name: 'J', value: 0 },
  { name: 'K', value: 0 },
  { name: 'L', value: 0 },
  { name: 'Z', value: 0 },
  { name: 'X', value: 0 },
  { name: 'C', value: 0 },
  { name: 'V', value: 0 },
  { name: 'B', value: 0 },
  { name: 'N', value: 0 },
  { name: 'M', value: 0 },
]

/** PAGES-008：柱状图最多展示的按键数（含空格/数字/标点等非 A-Z 键） */
const BAR_TOP_N = 20

interface KeyboardWithBarChartsProps {
  title: string
  data: WrongKeyStat[]
  name: string
  suffix?: string
}

const KeyboardWithBarCharts: FC<KeyboardWithBarChartsProps> = ({ data, title, suffix, name }) => {
  const [isOpenDarkMode] = useAtom(isOpenDarkModeAtom)

  const chartRef = useRef<HTMLDivElement>(null)

  const { width, height } = useWindowSize()
  const hasData = data.length > 0

  // PAGES-008：键盘图只能映射 A-Z，其余按键（空格/数字/标点/特殊键）只在柱状图中展示；
  // 这里统计被排除的键数与次数，渲染在标题下方告知用户，避免“统计漏了”误解。
  const excludedKeys = data.filter((item) => !item.mappable)
  const excludedKeyCount = excludedKeys.length
  const excludedHitCount = excludedKeys.reduce((sum, item) => sum + item.value, 0)

  useEffect(() => {
    if (!chartRef.current || !hasData) return

    const statsByKey = new Map(data.map((item) => [item.key, item]))
    const myData = keyboardData.map((item) => ({ ...item, value: statsByKey.get(item.name)?.value ?? 0 }))
    const mappedMax = myData.reduce((max, item) => Math.max(max, item.value), 0)
    // PAGES-008：visualMap 的 max 必须 > 0。旧实现取 myData[0].value，若所有错误都不在 A-Z
    // （例如只错空格/数字/标点），max=0 会让色阶退化、键盘图全灰无法比较。
    const visualMax = Math.max(1, mappedMax)

    // 柱状图：展示全量按键（字母 + 空格/数字/标点/特殊键）按错误次数排序的 TopN
    const barData = [...data].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, BAR_TOP_N)

    let chart = echarts.getInstanceByDom(chartRef.current)
    chart?.dispose()

    chart = echarts.init(chartRef.current, isOpenDarkMode ? 'purple' : 'light')
    const instance = chart

    const mapOption = {
      tooltip: {
        trigger: 'item',
        showDelay: 0,
        transitionDuration: 0.2,
        formatter: '{b}: {c} 次',
      },
      toolbox: {
        feature: {
          restore: {},
          myToBarChart: {
            show: true,
            title: `切换为柱状图（Top ${BAR_TOP_N}，含空格/数字/标点）`,
            icon: 'path://M896 928 768 928C732.656 928 704 899.344 704 864L704 416C704 380.656 732.656 352 768 352L896 352C931.344 352 960 380.656 960 416L960 864C960 899.344 931.344 928 896 928ZM896 416 768 416 768 864 896 864 896 416ZM576 928 448 928C412.656 928 384 899.344 384 864L384 160C384 124.656 412.656 96 448 96L576 96C611.344 96 640 124.656 640 160L640 864C640 899.344 611.344 928 576 928ZM576 160 448 160 448 864 576 864 576 160ZM256 928 128 928C92.656 928 64 899.344 64 864L64 544C64 508.656 92.656 480 128 480L256 480C291.344 480 320 508.656 320 544L320 864C320 899.344 291.344 928 256 928ZM256 544 128 544 128 864 256 864 256 544Z',
            onclick: function () {
              chart?.setOption(barOption, true)
            },
          },
        },
      },
      visualMap: {
        left: 'right',
        min: 0,
        max: visualMax,
        inRange: {
          color: isOpenDarkMode ? ['hsl(0, 0%, 22%)', '#818cf8'] : ['#f0f0f0', '#6366f1'],
        },
        text: ['多', '少'],
        textStyle: {
          color: isOpenDarkMode ? '#fff' : '#000',
        },
        calculable: true,
      },
      series: [
        {
          name,
          id: 'population',
          type: 'map',
          roam: true,
          map: 'Keyboard',
          animationDurationUpdate: 1000,
          universalTransition: true,
          data: myData,
          label: { show: true, color: isOpenDarkMode ? '#fff' : '#000' },
        },
      ],
    }

    const barOption = {
      tooltip: { trigger: 'axis' },
      toolbox: {
        feature: {
          myToKeyboard: {
            show: true,
            title: '切换为键盘热力图',
            icon: 'path://M192 448h64v64H192zM384 448h64v64h-64zM576 448h64v64h-64zM768 448h64v64h-64zM192 320h64v64H192zM384 320h64v64h-64zM576 320h64v64h-64zM768 320h64v64h-64zM256 640h512v64H256z M1024 864H0V256h64v544h896V224H0V160h1024v704z',
            onclick: function () {
              chart?.setOption(mapOption, true)
            },
          },
        },
      },
      grid: {
        left: '10%',
        right: '6%',
        top: '12%',
        bottom: '18%',
        containLabel: true,
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
      },
      xAxis: {
        type: 'category',
        axisLabel: {
          rotate: 30,
        },
        data: barData.map((item) => item.label),
      },
      animationDurationUpdate: 1000,
      series: {
        name,
        type: 'bar',
        id: 'population',
        data: barData.map((item) => item.value),
        color: isOpenDarkMode ? '#818cf8' : '#6366f1',
        universalTransition: true,
      },
    }

    instance.setOption(mapOption)

    // PAGES-004：路由卸载/主题切换时释放实例，避免 echarts 实例与 canvas 随进出统计页累积
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
      {hasData && excludedKeyCount > 0 && (
        <div className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">
          {`键盘图仅映射 A-Z；另有 ${excludedKeyCount} 个按键（共 ${excludedHitCount} 次，含空格/数字/标点）请在「切换为柱状图」中查看`}
        </div>
      )}
      {hasData ? (
        <div style={{ width: '100%', height: '100%' }} ref={chartRef} className="line-chart flex-grow"></div>
      ) : (
        // PAGES-007：无数据时给出占位文案，避免整块图表区空白
        <div className="flex flex-grow items-center justify-center text-sm text-gray-400 dark:text-gray-500">暂无数据</div>
      )}
    </div>
  )
}

export default KeyboardWithBarCharts
