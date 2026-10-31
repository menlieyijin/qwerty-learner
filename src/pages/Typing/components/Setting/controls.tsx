import styles from './index.module.css'
import { Switch } from '@headlessui/react'
import * as Slider from '@radix-ui/react-slider'
import classNames from 'classnames'
import type { ReactNode } from 'react'

// 设置面板共用控件：新面板一律用这些，避免每个面板各写一套 class / 各写一个 Switch。

export function Section({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{label}</span>
      {description ? <span className={styles.sectionDescription}>{description}</span> : null}
      {children}
    </div>
  )
}

export function Row({ label, hint, children, stacked }: { label: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={classNames('w-full pl-4', stacked ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-4')}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</div> : null}
      </div>
      <div className={classNames('shrink-0', stacked && 'w-full')}>{children}</div>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Switch
      aria-label={`${label}开关`}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className={classNames('switch-root', disabled && 'cursor-not-allowed opacity-50')}
    >
      <span aria-hidden="true" className="switch-thumb" />
    </Switch>
  )
}

export function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <Slider.Root
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        className="slider"
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit?.(v)}
      >
        <Slider.Track>
          <Slider.Range />
        </Slider.Track>
        <Slider.Thumb />
      </Slider.Root>
      <span className="w-14 shrink-0 text-right text-xs text-gray-600 dark:text-gray-400">{format ? format(value) : value}</span>
    </div>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-8 w-36 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-indigo-400 dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={classNames(
        'rounded-lg px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-indigo-400 text-white hover:bg-indigo-500',
        variant === 'ghost' &&
          'border border-neutral-200 text-gray-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-gray-300 dark:hover:bg-gray-700',
        variant === 'danger' && 'border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/30',
      )}
    >
      {children}
    </button>
  )
}

export function Stats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="grid w-full grid-cols-3 gap-2 pl-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg bg-stone-50 px-2 py-2 text-center dark:bg-gray-900">
          <div className="text-lg font-semibold leading-tight text-gray-700 dark:text-gray-200">{it.value}</div>
          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{it.label}</div>
        </div>
      ))}
    </div>
  )
}

export function Bar({ ratio, label }: { ratio: number; label: string }) {
  return (
    <div className="w-full pl-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-gray-700">
        <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  )
}
