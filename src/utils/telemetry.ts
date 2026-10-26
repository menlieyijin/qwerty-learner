/**
 * 遥测（telemetry）总开关 —— PRIV-001 / Batch2（v9.5）
 *
 * 背景：桌面版是“本地优先、可离线”的应用，但此前在 `src/index.tsx` 里无条件初始化 Mixpanel，
 * 且 `trackEvent.ts` 会调用 @vercel/analytics，等于桌面用户默认被上报使用统计（词库名/章节/正确错误数/
 * 时长等），没有开关也没有告知。
 *
 * 本模块的策略：
 * - 网页版（qwerty.kaiyi.cool）：保持原有行为（继续统计），不影响线上数据；
 * - 桌面 Electron（preload 已设 `window.__QZ_ELECTRON__`）/ UA 含 Electron / file:// 页面：
 *   **默认完全关闭**：不初始化 mixpanel、不调用 @vercel/analytics、不向 gtag 推事件。
 *   用户显式设置 `localStorage['qzTelemetryOptIn'] === '1'`（或在控制台 `qzTelemetry.optIn()`）才开启。
 * - 关闭状态下所有上报函数都是安全 no-op：不抛错、不排队、不产生网络请求。
 *
 * 说明：Google Analytics 的脚本加载由壳层负责（index.html 依据 `window.__QZ_ELECTRON__` 不加载 gtag.js），
 * 本模块只做事件级门控，不改 index.html / local-fork/**。设置 UI 的开关留给后续版本（本轮只做默认关闭 +
 * opt-in 读取）。
 */
import { track as trackVercel } from '@vercel/analytics'
import mixpanel from 'mixpanel-browser'
import process from 'process'

export const TELEMETRY_OPT_IN_KEY = 'qzTelemetryOptIn'

declare global {
  interface Window {
    /** preload 在页面脚本执行前设置的桌面环境标记（local-fork/electron/preload.js） */
    __QZ_ELECTRON__?: boolean
    /** 控制台可用的显式开关：window.qzTelemetry.optIn() / optOut() / status() */
    qzTelemetry?: {
      isDesktop: () => boolean
      isEnabled: () => boolean
      optIn: () => boolean
      optOut: () => void
      status: () => Record<string, unknown>
    }
  }
}

let mixpanelInitialized = false
let lastInitError: string | null = null

export function isDesktopElectron(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.__QZ_ELECTRON__ === true) return true
    if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent || '')) return true
    if (typeof location !== 'undefined' && location.protocol === 'file:') return true
  } catch {
    /* ignore */
  }
  return false
}

export function isTelemetryOptedIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(TELEMETRY_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

/** 是否允许上报：网页版恒为 true（维持现状）；桌面版默认 false，需显式 opt-in。 */
export function isTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (!isDesktopElectron()) return true
  return isTelemetryOptedIn()
}

export function setTelemetryOptIn(enabled: boolean): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (enabled) window.localStorage.setItem(TELEMETRY_OPT_IN_KEY, '1')
    else window.localStorage.removeItem(TELEMETRY_OPT_IN_KEY)
    return isTelemetryEnabled()
  } catch {
    return false
  }
}

/**
 * 初始化 mixpanel（只在允许上报时执行；可重复调用，幂等）。
 * 返回是否真的完成了初始化，便于测试/日志。
 */
export function initTelemetry(): boolean {
  if (!isTelemetryEnabled()) {
    // 桌面默认路径：不 init、不 import 任何上报动作，也不写任何排队数据。
    registerConsoleApi()
    return false
  }
  if (mixpanelInitialized) return true
  try {
    if (process.env.NODE_ENV === 'production') {
      mixpanel.init('bdc492847e9340eeebd53cc35f321691')
    } else {
      mixpanel.init('5474177127e4767124c123b2d7846e2a', { debug: true })
    }
    mixpanelInitialized = true
    lastInitError = null
  } catch (error) {
    // 初始化失败不应影响应用启动（混入第三方脚本/网络异常时也不能白屏）。
    lastInitError = String(error)
    console.error('initTelemetry (mixpanel.init) failed:', error)
  }
  registerConsoleApi()
  return mixpanelInitialized
}

/** mixpanel 事件上报：未初始化/被关闭时安全 no-op（不抛错、不排队）。 */
export function trackMixpanel(event: string, properties?: Record<string, unknown>): void {
  if (!isTelemetryEnabled() || !mixpanelInitialized) return
  try {
    mixpanel.track(event, properties)
  } catch (error) {
    console.error('mixpanel.track failed:', error)
  }
}

/** @vercel/analytics 事件上报：桌面默认关闭时完全不调用（避免向相对路径 /_vercel/insights 发请求）。 */
export function trackVercelEvent(event: string, properties?: Record<string, string>): void {
  if (!isTelemetryEnabled()) return
  try {
    trackVercel(event, properties)
  } catch (error) {
    console.error('vercel analytics track failed:', error)
  }
}

function registerConsoleApi() {
  if (typeof window === 'undefined') return
  try {
    window.qzTelemetry = {
      isDesktop: isDesktopElectron,
      isEnabled: isTelemetryEnabled,
      optIn: () => {
        const enabled = setTelemetryOptIn(true)
        initTelemetry()
        return enabled
      },
      optOut: () => {
        setTelemetryOptIn(false)
        mixpanelInitialized = false
      },
      status: () => ({
        desktop: isDesktopElectron(),
        optedIn: isTelemetryOptedIn(),
        enabled: isTelemetryEnabled(),
        mixpanelInitialized,
        lastInitError,
        optInKey: TELEMETRY_OPT_IN_KEY,
      }),
    }
  } catch {
    /* ignore */
  }
}
