import { Bar, Btn, Row, Section, Select } from './controls'
import styles from './index.module.css'
import { useDesktopSettings } from './useDesktopSettings'
import type { PrecacheSnapshot } from '@/utils/desktop'
import { desktop, runtime } from '@/utils/desktop'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useCallback, useEffect, useState } from 'react'

function mmss(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Pomodoro() {
  const { settings, patch } = useDesktopSettings()
  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [remain, setRemain] = useState(25 * 60)
  // 用「结束时间戳」而不是每秒自减：窗口被挂起/节流后不会走慢，也不在 setState 回调里做副作用
  const [deadline, setDeadline] = useState<number | null>(null)
  const [count, setCount] = useState(0)

  const total = Math.max(1, (mode === 'focus' ? settings?.pomodoroFocus ?? 25 : settings?.pomodoroBreak ?? 5) * 60)
  const running = deadline !== null

  // 设置变化（未运行时）同步到剩余时间
  useEffect(() => {
    if (!running) setRemain(total)
  }, [running, total])

  useEffect(() => {
    if (deadline === null) return
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setRemain(left)
      if (left > 0) return
      setDeadline(null)
      if (mode === 'focus') setCount((c) => c + 1)
      void desktop()?.notify(mode === 'focus' ? '专注结束' : '休息结束', mode === 'focus' ? '起来活动一下' : '继续练习')
      setMode(mode === 'focus' ? 'break' : 'focus')
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [deadline, mode])

  return (
    <Section label="番茄钟" description={`本次已完成 ${count} 个专注段`}>
      <div className="flex w-full items-center gap-4 pl-4">
        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full border-4 border-indigo-400">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{mmss(remain)}</span>
          <span className="text-[10px] text-gray-400">{mode === 'focus' ? '专注' : '休息'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            variant="primary"
            onClick={() => {
              if (running) return setDeadline(null)
              const seconds = remain > 0 ? remain : total
              setRemain(seconds)
              setDeadline(Date.now() + seconds * 1000)
            }}
          >
            {running ? '暂停' : '开始'}
          </Btn>
          <Btn
            onClick={() => {
              setDeadline(null)
              setRemain(total)
            }}
          >
            重置
          </Btn>
          <Btn
            onClick={() => {
              setDeadline(null)
              setMode((m) => (m === 'focus' ? 'break' : 'focus'))
            }}
          >
            跳过
          </Btn>
        </div>
      </div>
      <Row label="时长（分钟）">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <input
            type="number"
            min={5}
            max={90}
            value={settings?.pomodoroFocus ?? 25}
            aria-label="专注时长"
            onChange={(e) => void patch({ pomodoroFocus: Math.min(90, Math.max(5, Number(e.target.value) || 25)) })}
            className="h-8 w-16 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700"
          />
          专注
          <input
            type="number"
            min={1}
            max={30}
            value={settings?.pomodoroBreak ?? 5}
            aria-label="休息时长"
            onChange={(e) => void patch({ pomodoroBreak: Math.min(30, Math.max(1, Number(e.target.value) || 5)) })}
            className="h-8 w-16 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700"
          />
          休息
        </div>
      </Row>
    </Section>
  )
}

function Lookup() {
  const [word, setWord] = useState('')
  const [cache, setCache] = useState<{ count: number; bytes: number } | null>(null)

  const load = useCallback(async () => {
    const s = await desktop()?.freeStats()
    setCache({ count: Number(s?.count) || 0, bytes: Number(s?.bytes) || 0 })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Section label="查词与翻译" description="本地词库 + 有道 + dictionaryapi，无需 Key">
      <Row label="查询单词或短语" stacked>
        <div className="flex w-full gap-2">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && word.trim()) void runtime()?.lookupWord(word.trim())
            }}
            placeholder="例：serendipity"
            aria-label="查询单词"
            className="h-8 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <Btn variant="primary" disabled={!word.trim()} onClick={() => void runtime()?.lookupWord(word.trim())}>
            查询
          </Btn>
        </div>
      </Row>
      <Row label="释义缓存" hint={cache ? `${cache.count} 条 · ${Math.round(cache.bytes / 1024)} KB` : '读取中…'}>
        <Btn
          onClick={async () => {
            await desktop()?.freeClear()
            await load()
          }}
        >
          清空
        </Btn>
      </Row>
    </Section>
  )
}

function Precache() {
  const [snap, setSnap] = useState<PrecacheSnapshot | null>(null)
  const [type, setType] = useState<'us' | 'uk'>('us')
  const [limit, setLimit] = useState('')
  const [msg, setMsg] = useState('')
  const [current, setCurrent] = useState<{ file: string; name: string } | null>(null)

  useEffect(() => {
    const b = desktop()
    if (!b) return
    void b.precacheStatus().then(setSnap)
    const off = b.onPrecacheProgress((s) => setSnap(s))
    void runtime()
      ?.currentDict()
      .then((d) => setCurrent(d ? { file: d.file, name: d.name } : null))
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])

  const ratio = snap && snap.total > 0 ? snap.done / snap.total : 0

  return (
    <Section label="发音预缓存" description={current ? `当前词库：${current.name}` : '先选择一个词库'}>
      <Row label="参数">
        <div className="flex items-center gap-2">
          <Select
            label="发音类型"
            value={type}
            options={[
              { value: 'us', label: '美音' },
              { value: 'uk', label: '英音' },
            ]}
            onChange={(v) => setType(v)}
          />
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))}
            placeholder="上限"
            aria-label="本次上限"
            className="h-8 w-20 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-600 dark:bg-gray-700"
          />
        </div>
      </Row>
      <div className="flex w-full flex-wrap gap-2 pl-4">
        <Btn
          variant="primary"
          disabled={!current}
          onClick={async () => {
            const r = (await desktop()?.precacheStart({
              dictFile: current?.file,
              type,
              limit: Number(limit) || 0,
            })) as { ok?: boolean; error?: string } | undefined
            setMsg(r?.ok === false ? String(r.error || '启动失败') : '')
          }}
        >
          开始
        </Btn>
        <Btn onClick={() => void desktop()?.precachePause()}>暂停</Btn>
        <Btn onClick={() => void desktop()?.precacheResume()}>继续</Btn>
        <Btn onClick={() => void desktop()?.precacheCancel()}>取消</Btn>
      </div>
      <Bar
        ratio={ratio}
        label={
          snap
            ? `${snap.done} / ${snap.total} · 成功 ${snap.okCount} · 失败 ${snap.failCount}${
                snap.skipped ? ` · 跳过 ${snap.skipped}` : ''
              }${snap.paused ? ' · 已暂停' : ''}`
            : '未开始'
        }
      />
      {msg ? <span className="pl-4 text-xs text-red-500">{msg}</span> : null}
    </Section>
  )
}

export default function ToolsSetting() {
  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <Pomodoro />
          <Lookup />
          <Precache />
          <Section label="文件位置">
            <div className="flex w-full flex-wrap gap-2 pl-4">
              <Btn onClick={() => void desktop()?.openPath('plus')}>插件数据</Btn>
              <Btn onClick={() => void desktop()?.openPath('log')}>错误日志</Btn>
              <Btn onClick={() => void desktop()?.openPath('exports')}>导出目录</Btn>
              <Btn onClick={() => void desktop()?.openPath('backup')}>备份目录</Btn>
              <Btn onClick={() => void desktop()?.openPath('dictupdate')}>词库更新</Btn>
            </div>
          </Section>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical" />
    </ScrollArea.Root>
  )
}
