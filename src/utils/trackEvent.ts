import { isTelemetryEnabled, trackVercelEvent } from '@/utils/telemetry'

declare global {
  interface Window {
    gtag?: (command: string, event: string, params?: Record<string, unknown>) => void
  }
}

export const trackPromotionEvent = (event: string, properties: Record<string, string>) => {
  // PRIV-001 / Batch2：桌面端默认关闭遥测时，推广事件同样不上报（@vercel/analytics + gtag 都跳过）。
  if (!isTelemetryEnabled()) return

  trackVercelEvent(event, properties)

  if (typeof window !== 'undefined' && window?.gtag) {
    try {
      window.gtag('event', event, { ...properties })
      if (properties.action_detail) {
        window.gtag('event', properties.action_detail)
      }
    } catch (error) {
      console.error(error)
    }
  }
}
