import { Btn, Row, Section } from './controls'
import styles from './index.module.css'
import { useDesktopSettings } from './useDesktopSettings'
import type { DictEntry } from '@/utils/desktop'
import { desktop, runtime } from '@/utils/desktop'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import classNames from 'classnames'
import { useCallback, useEffect, useMemo, useState } from 'react'

const CATEGORIES = ['全部分类', 'CET', '考研', '雅思', '托福', 'GRE', '编程', '其他']
const MODES = [
  { value: 'all', label: '全部词库' },
  { value: 'fav', label: '收藏' },
  { value: 'recent', label: '最近' },
] as const

type Mode = (typeof MODES)[number]['value']

export default function DictSetting() {
  const { settings } = useDesktopSettings()
  const [dicts, setDicts] = useState<DictEntry[]>([])
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('all')
  const [category, setCategory] = useState('全部分类')
  const [visible, setVisible] = useState(40)
  const [favs, setFavs] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [changes, setChanges] = useState<{ name: string; status: string; remoteSize: number; downloadUrl: string }[]>([])
  const [checking, setChecking] = useState(false)
  const [custom, setCustom] = useState<{ name: string; count: number }[]>([])
  const [customName, setCustomName] = useState('')

  const loadCustom = useCallback(async () => {
    const list = (await runtime()?.listCustomDicts()) ?? []
    setCustom(list)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const r = await desktop()?.dictList()
        setDicts(r?.dicts ?? [])
      } catch (e) {
        setMsg(`词库列表读取失败：${String((e as Error)?.message || e)}`)
      }
      void loadCustom()
    })()
  }, [loadCustom])

  // 当前词库：应用自身把它存在 localStorage.currentDict（JSON 字符串）
  const current = useMemo(() => {
    const raw = localStorage.getItem('currentDict')
    if (!raw) return null
    let id = raw
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') id = parsed
      else if (parsed && typeof parsed === 'object') id = String(parsed.id || parsed.dict || parsed.value || '')
    } catch {
      // 历史版本可能直接存裸字符串（不是 JSON），按原值处理
      id = raw
    }
    return dicts.find((d) => d.id === id) ?? null
  }, [dicts])

  useEffect(() => {
    if (settings?.dictFavorites) setFavs(settings.dictFavorites)
  }, [settings?.dictFavorites])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const favSet = new Set(favs)
    const recent = settings?.dictRecent ?? {}
    let list = dicts.slice()
    if (q) {
      list = list.filter((d) =>
        [d.name, d.description, d.file, d.id, d.category, (d.tags || []).join(' ')].join(' ').toLowerCase().includes(q),
      )
    }
    if (category !== '全部分类') list = list.filter((d) => d.category === category)
    if (mode === 'fav') list = list.filter((d) => favSet.has(d.file))
    if (mode === 'recent') list = list.filter((d) => recent[d.file]).sort((a, b) => (recent[b.file] || 0) - (recent[a.file] || 0))
    else {
      list.sort((a, b) => {
        if (current && a.file === current.file) return -1
        if (current && b.file === current.file) return 1
        const fa = favSet.has(a.file) ? 0 : 1
        const fb = favSet.has(b.file) ? 0 : 1
        if (fa !== fb) return fa - fb
        return (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh')
      })
    }
    return list
  }, [category, current, dicts, favs, mode, query, settings?.dictRecent])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <Section label="内置词库" description={`共 ${dicts.length} 个 · 匹配 ${items.length} 个`}>
            <div className="flex w-full gap-2 pl-4">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setVisible(40)
                }}
                placeholder="搜索词库（中英文 / 文件名）"
                aria-label="搜索词库"
                className="h-8 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-indigo-400 dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
              />
              <select
                aria-label="词库筛选"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className="h-8 w-24 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="词库分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-8 w-24 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full space-y-1 pl-4">
              {items.slice(0, visible).map((d) => {
                const isCur = current?.file === d.file
                const isFav = favs.includes(d.file)
                return (
                  <div
                    key={d.file}
                    className="flex items-center gap-2 rounded-lg border border-neutral-100 px-2 py-1.5 dark:border-neutral-700"
                  >
                    <button
                      type="button"
                      aria-label={isFav ? `取消收藏${d.name}` : `收藏${d.name}`}
                      onClick={async () => {
                        try {
                          const next = await runtime()?.toggleDictFavorite(d.file)
                          if (next) setFavs(next)
                        } catch (e) {
                          setMsg(`收藏失败：${String((e as Error)?.message || e)}`)
                        }
                      }}
                      className={classNames('text-base leading-none', isFav ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400')}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200" title={d.name}>
                      {d.name}
                      {isCur ? (
                        <span className="ml-2 rounded-full border border-indigo-400 px-1.5 text-[10px] text-indigo-500">当前</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {d.count ? `${d.count} 词` : '—'} · {d.category || '其他'}
                    </span>
                    <Btn
                      disabled={isCur}
                      onClick={async () => {
                        const entry = dicts.find((x) => x.file === d.file)
                        if (!entry) return
                        try {
                          await runtime()?.setCurrentDict(entry)
                        } catch (e) {
                          setMsg(`切换失败：${String((e as Error)?.message || e)}`)
                        }
                      }}
                    >
                      设为当前
                    </Btn>
                  </div>
                )
              })}
              {!items.length ? <div className="text-xs text-gray-400">没有匹配的词库</div> : null}
            </div>
            {items.length > visible ? (
              <div className="w-full pl-4">
                <Btn onClick={() => setVisible((v) => v + 60)}>显示更多</Btn>
              </div>
            ) : null}
            {msg ? <span className="pl-4 text-xs text-red-500">{msg}</span> : null}
          </Section>

          <Section label="在线更新" description="对比 GitHub 官方词库，按需下载单个文件">
            <div className="flex w-full flex-wrap gap-2 pl-4">
              <Btn
                variant="primary"
                disabled={checking}
                onClick={async () => {
                  setChecking(true)
                  try {
                    const r = await desktop()?.dictCheckUpdates()
                    const list = (r?.changes as typeof changes) || []
                    setChanges(list)
                    setMsg(r?.ok ? `检查完成：${list.length} 个可更新` : String(r?.error || '检查失败'))
                  } catch (e) {
                    setMsg(`检查失败：${String((e as Error)?.message || e)}`)
                  } finally {
                    setChecking(false)
                  }
                }}
              >
                {checking ? '检查中…' : '检查更新'}
              </Btn>
              <Btn onClick={() => void desktop()?.dictOpenUpdateDir()}>更新目录</Btn>
              <Btn onClick={() => void desktop()?.dictClearUpdates()}>清空已下载</Btn>
              <Btn onClick={() => void desktop()?.relaunchApp()}>重启生效</Btn>
            </div>
            <div className="w-full space-y-1 pl-4">
              {changes.slice(0, 20).map((c) => (
                <div key={c.name} className="flex items-center gap-2 border-b border-neutral-100 py-1 text-xs dark:border-neutral-700">
                  <span className={c.status === 'new' ? 'text-indigo-500' : 'text-amber-600'}>{c.status === 'new' ? '新增' : '更新'}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{c.name}</span>
                  <span className="text-gray-400">{Math.round(c.remoteSize / 1024)}KB</span>
                  <Btn
                    onClick={async () => {
                      try {
                        const r = await desktop()?.dictDownloadUpdate(c.name, c.downloadUrl)
                        setMsg(
                          r?.ok ? `已下载 ${c.name}${r.resumed ? '（断点续传）' : ''}，重启后生效` : `下载失败：${r?.error || '未知错误'}`,
                        )
                      } catch (e) {
                        setMsg(`下载失败：${String((e as Error)?.message || e)}`)
                      }
                    }}
                  >
                    下载
                  </Btn>
                </div>
              ))}
              {changes.length > 20 ? <div className="text-xs text-gray-400">仅显示前 20 条</div> : null}
            </div>
          </Section>

          <Section label="自定义词库" description="支持 CSV / JSON / TXT，导入后可走记忆曲线">
            <Row label="导入文件" stacked>
              <div className="flex w-full flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".csv,.json,.txt"
                  aria-label="选择词库文件"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (f.size > 32 * 1024 * 1024) {
                      setMsg('文件超过 32MB，请拆分后再导入')
                      e.target.value = ''
                      return
                    }
                    const ext = (f.name.split('.').pop() || '').toLowerCase()
                    try {
                      const text = await f.text()
                      const name = customName.trim() || f.name.replace(/\.[^.]+$/, '')
                      const r = await runtime()?.importCustomDict(text, ext, name)
                      setMsg(r ? `已导入「${r.name}」：${r.count} 词` : '导入失败')
                      setCustomName('')
                      e.target.value = ''
                      await loadCustom()
                    } catch (err) {
                      setMsg(`导入失败：${String((err as Error)?.message || err)}`)
                    }
                  }}
                  className="text-xs text-gray-500 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-400 file:px-3 file:py-1 file:text-white"
                />
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="词库名称（留空用文件名）"
                  aria-label="词库名称"
                  className="h-8 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
                />
              </div>
            </Row>
            <div className="w-full space-y-1 pl-4">
              {custom.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-2 rounded-lg border border-neutral-100 px-2 py-1.5 text-sm dark:border-neutral-700"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{c.name}</span>
                  <span className="text-[11px] text-gray-400">{c.count} 词</span>
                  <Btn
                    onClick={async () => {
                      try {
                        await runtime()?.startCustomMemory(c.name)
                      } catch (e) {
                        setMsg(`切换失败：${String((e as Error)?.message || e)}`)
                      }
                    }}
                  >
                    记忆曲线
                  </Btn>
                  <Btn
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm(`删除自定义词库「${c.name}」？此操作不可撤销。`)) return
                      try {
                        await runtime()?.removeCustomDict(c.name)
                        await loadCustom()
                      } catch (e) {
                        setMsg(`删除失败：${String((e as Error)?.message || e)}`)
                      }
                    }}
                  >
                    删除
                  </Btn>
                </div>
              ))}
              {!custom.length ? <div className="text-xs text-gray-400">还没有导入过自定义词库</div> : null}
            </div>
          </Section>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical" />
    </ScrollArea.Root>
  )
}
