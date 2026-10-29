import styles from '../index.module.css'
import { toFixedNumber } from '@/utils'
import * as Slider from '@radix-ui/react-slider'

type SoundVolumeRowProps = {
  /** 左侧标题，如「音量」 */
  title: string
  /** 滑块的可访问名（读屏与自动化都用它定位） */
  ariaLabel: string
  /** 0~1 的比例值（配置里就是 0~1） */
  value: number
  /** 滑块下限（按键音/效果音是 1，单词发音是 0） */
  min?: number
  disabled?: boolean
  onChange: (value: [number]) => void
  /** 额外的说明（如「倍速」行用 0.5~4 而不是百分比），不传则按百分比展示 */
  variant?: 'percent' | 'rate'
}

/**
 * 「标题 + 滑块 + 数值」一行（v10.1，dsh）。
 *
 * 从 `SoundSetting.tsx` 抽出：四个百分比滑块（单词发音音量、释义发音音量、按键音音量、效果音音量）
 * 与倍速滑块结构一致，差异只在 aria-label、上下限、是否禁用与数值格式。
 * `variant='rate'` 时不做 ×100 换算、显示保留两位小数（与原「倍速」行完全一致）。
 */
export function SoundVolumeRow({ title, ariaLabel, value, min = 0, disabled, onChange, variant = 'percent' }: SoundVolumeRowProps) {
  const isRate = variant === 'rate'
  // 与原实现逐字一致：百分比行直接用 value*100（不取整），取整只用于右侧文案
  const sliderValue = isRate ? value : value * 100
  const display = isRate ? toFixedNumber(value, 2) : `${Math.floor(value * 100)}%`

  return (
    <div className={styles.block}>
      <span className={styles.blockLabel}>{title}</span>
      <div className="flex h-5 w-full items-center justify-between">
        <Slider.Root
          defaultValue={[sliderValue]}
          max={isRate ? 4 : 100}
          min={isRate ? 0.5 : min}
          step={isRate ? 0.1 : 10}
          className="slider"
          onValueChange={onChange}
          disabled={disabled}
        >
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumb aria-label={ariaLabel} />
        </Slider.Root>
        <span className="ml-4 w-10 text-xs font-normal text-gray-600">{display}</span>
      </div>
    </div>
  )
}
