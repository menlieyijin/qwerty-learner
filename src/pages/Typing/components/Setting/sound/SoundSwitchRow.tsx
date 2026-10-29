import styles from '../index.module.css'
import { Switch } from '@headlessui/react'
import type { ReactNode } from 'react'

type SoundSwitchRowProps = {
  /** 开关的可访问名（读屏与自动化都用它定位） */
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** 右侧状态文案，如「发音已开启」 */
  hint: ReactNode
}

/**
 * 「一行开关」：左侧 Switch、右侧状态文案（v10.1，dsh）。
 *
 * 从 `SoundSetting.tsx` 抽出：四个开关（单词发音/释义发音/按键音/效果音）的 DOM 结构逐字一致，
 * 差异只有 aria-label、checked、onChange 与文案。样式类名与嵌套顺序保持原样，避免视觉回归。
 */
export function SoundSwitchRow({ label, checked, onChange, hint }: SoundSwitchRowProps) {
  return (
    <div className={styles.switchBlock}>
      <Switch aria-label={label} checked={checked} onChange={onChange} className="switch-root">
        <span aria-hidden="true" className="switch-thumb" />
      </Switch>
      <span className="text-right text-xs font-normal leading-tight text-gray-600">{hint}</span>
    </div>
  )
}
