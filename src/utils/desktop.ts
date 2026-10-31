// 桌面壳（Electron）能力桥。
// 唯一的访问入口：React 侧不再直接摸 window.qwertyEnhance / window.qzRuntime。
// 网页版返回 null，调用方据此隐藏桌面区块（不做假按钮）。

export type DesktopSettings = {
  alwaysOnTop: boolean
  miniMode: boolean
  closeToTray: boolean
  autoStart: boolean
  opacity: number
  zoom: number
  dailyGoal: number
  clipboardWatch: boolean
  onlineLookup: boolean
  pronCache: boolean
  keySound: boolean
  keySoundVolume: number
  theme: string
  fontFamily: string
  darkMode: boolean | null
  dictFavorites: string[]
  dictRecent: Record<string, number>
  pomodoroFocus: number
  pomodoroBreak: number
  version?: string
}

export type DictEntry = {
  id?: string
  file: string
  name: string
  description?: string
  category?: string
  tags?: string[]
  count?: number
  size?: number
}

export type WrongWord = { word: string; wrongCount: number; dict?: string; timeStamp?: number }

export type DesktopStats = {
  today: string
  words: number
  goal: number
  streak: number
  ratio: number
  totalWords: number
  totalMinutes: number
  wpm: number
  accuracy: number | null
  wrongWords: WrongWord[]
  heatDays: { date: string; weekday: number; count: number; words: string[] }[]
  trend: { date: string; practiced: number; fresh: number }[]
  memory: {
    learned: number
    buckets: { short: number; mid: number; long: number }
    dueDays: { date: string; count: number }[]
    dueList: { word: string; trans: string[]; dict?: string; stage?: number }[]
  }
  autoLevel: {
    levelId: string
    name: string
    total: number
    seen: number
    mastered: number
    suspended: number
    due: number
    newRatio: number | null
  } | null
  source: string
}

export type DesktopInsights = {
  slow: { word: string; ms: number; times: number }[]
  errKeys: { key: string; errors: number; rate: number }[]
}

export type PrecacheSnapshot = {
  ok: boolean
  total: number
  done: number
  okCount: number
  failCount: number
  skipped: number
  paused: boolean
  cancelled: boolean
  finished: boolean
  failures: string[]
}

type PrecacheOpts = { dictFile?: string; type?: 'us' | 'uk'; limit?: number }

export type DesktopBridge = {
  version: string
  platform: string
  getSettings(): Promise<DesktopSettings>
  updateSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  onEvent(cb: (payload: { type: string }) => void): (() => void) | void
  setAlwaysOnTop(v: boolean): Promise<unknown>
  setMiniMode(v: boolean): Promise<unknown>
  setOpacity(v: number): Promise<{ opacity: number }>
  setZoom(v: number): Promise<{ zoom: number }>
  setAutoStart(v: boolean): Promise<unknown>
  setCloseToTray(v: boolean): Promise<unknown>
  setClipboardWatch(v: boolean): Promise<unknown>
  backupNow(): Promise<{ ok: boolean; path?: string; copied?: string[]; error?: string }>
  openPath(which: string): Promise<unknown>
  notify(title: string, body: string): Promise<unknown>
  freeLookup(word: string, dictId?: string): Promise<unknown>
  freeStats(): Promise<{ count?: number; bytes?: number; [k: string]: unknown }>
  freeClear(): Promise<unknown>
  saveCSV(name: string, content: string): Promise<{ ok: boolean; path?: string; error?: string }>
  openExports(): Promise<unknown>
  dictList(): Promise<{ ok: boolean; total: number; dicts: DictEntry[] }>
  dictCheckUpdates(): Promise<{
    ok: boolean
    changes?: { name: string; status: string; remoteSize: number; downloadUrl: string }[]
    newCount?: number
    updatedCount?: number
    error?: string
  }>
  dictDownloadUpdate(name: string, url: string): Promise<{ ok: boolean; error?: string }>
  dictUpdateInfo(): Promise<Record<string, unknown>>
  dictOpenUpdateDir(): Promise<unknown>
  dictClearUpdates(): Promise<unknown>
  relaunchApp(): Promise<unknown>
  precacheStart(opts: PrecacheOpts): Promise<unknown>
  precachePause(): Promise<unknown>
  precacheResume(): Promise<unknown>
  precacheCancel(): Promise<unknown>
  precacheStatus(): Promise<PrecacheSnapshot | null>
  onPrecacheProgress(cb: (s: PrecacheSnapshot | null) => void): () => void
  pronStats(): Promise<{ count?: number; bytes?: number; [k: string]: unknown }>
  clearPronCache(): Promise<unknown>
}

type DesktopRuntime = {
  collectStats(): Promise<DesktopStats>
  collectInsights(): Promise<DesktopInsights>
  lookupWord(word: string): Promise<void>
  startDueReview(): Promise<boolean>
  reevaluateLevel(): Promise<void>
  resumeSuspended(): Promise<void>
  exportAll(): Promise<void>
  importAll(): Promise<void>
  exportWrongCsv(): Promise<void>
  exportRecordsCsv(): Promise<void>
  setCurrentDict(entry: DictEntry): Promise<boolean | void>
  toggleDictFavorite(file: string): Promise<string[] | undefined>
  currentDict(): Promise<DictEntry | null>
  listCustomDicts(): Promise<{ name: string; count: number; createdAt: number }[]>
  importCustomDict(text: string, ext: string, name: string): Promise<{ name: string; count: number }>
  removeCustomDict(name: string): Promise<void>
  startCustomMemory(name: string): Promise<void>
  toast(msg: string): void
}

declare global {
  interface Window {
    qwertyEnhance?: DesktopBridge
    qzRuntime?: DesktopRuntime
  }
}

export function desktop(): DesktopBridge | null {
  return typeof window === 'undefined' ? null : window.qwertyEnhance ?? null
}

export function runtime(): DesktopRuntime | null {
  return typeof window === 'undefined' ? null : window.qzRuntime ?? null
}

export const isDesktop = () => !!desktop()
