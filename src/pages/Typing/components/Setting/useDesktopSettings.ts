import type { DesktopSettings } from '@/utils/desktop'
import { desktop, runtime } from '@/utils/desktop'
import { useCallback, useEffect, useState } from 'react'

// 桌面端设置只有一份（主进程 enhanced-settings.json）。
// 这里做「读一次 + 写时同步缓存 + 广播」，避免每个面板各读一份、互相看不到变更。
let cache: DesktopSettings | null = null
const listeners = new Set<(s: DesktopSettings) => void>()

function broadcast(next: DesktopSettings) {
  cache = next
  listeners.forEach((fn) => fn(next))
}

function applySideEffect(key: keyof DesktopSettings, value: unknown) {
  const b = desktop()
  if (!b) return
  switch (key) {
    case 'alwaysOnTop':
      void b.setAlwaysOnTop(!!value)
      break
    case 'miniMode':
      void b.setMiniMode(!!value)
      break
    case 'autoStart':
      void b.setAutoStart(!!value)
      break
    case 'closeToTray':
      void b.setCloseToTray(!!value)
      break
    case 'clipboardWatch':
      void b.setClipboardWatch(!!value)
      break
    case 'opacity':
      void b.setOpacity(Number(value))
      break
    case 'zoom':
      void b.setZoom(Number(value))
      break
    default:
      break
  }
}

export function useDesktopSettings() {
  const [settings, setSettings] = useState<DesktopSettings | null>(cache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const b = desktop()
    if (!b) return
    let alive = true
    b.getSettings()
      .then((s) => {
        if (!alive) return
        cache = s
        setSettings(s)
      })
      .catch((e) => alive && setError(String(e?.message || e)))
    listeners.add(setSettings)
    return () => {
      alive = false
      listeners.delete(setSettings)
    }
  }, [])

  // 立即生效（拖动滑块时用），但不落盘
  const preview = useCallback((key: keyof DesktopSettings, value: unknown) => {
    applySideEffect(key, value)
    if (cache) setSettings({ ...cache, [key]: value })
  }, [])

  // 落盘。副作用统一由主进程 updateSettings 执行（避免同一动作在两侧各做一次）
  const patch = useCallback(async (p: Partial<DesktopSettings>) => {
    const b = desktop()
    if (!b) return
    try {
      const next = await b.updateSettings(p)
      if (next) broadcast({ ...(cache || ({} as DesktopSettings)), ...next, ...p })
      else if (cache) broadcast({ ...cache, ...p })
    } catch (e) {
      // 主进程拒绝/通道断开时不让 UI 卡在旧状态，也不产生未捕获的 rejection
      const msg = String((e as Error)?.message || e)
      setError(msg)
      runtime()?.toast(`设置保存失败：${msg}`)
    }
  }, [])

  return { settings, patch, preview, error }
}
