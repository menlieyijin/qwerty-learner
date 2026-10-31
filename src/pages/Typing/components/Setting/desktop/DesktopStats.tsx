import { Bar, Btn, Row, Section, Stats } from '../controls'
import { useDesktopSettings } from '../useDesktopSettings'
import type { DesktopInsights, DesktopStats as StatsData } from '@/utils/desktop'
import { desktop, runtime } from '@/utils/desktop'
import { useCallback, useEffect, useMemo, useState } from 'react'

const n = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '-' : String(v))

export default function DesktopStats() {
  const { settings, patch } = useDesktopSettings()
  const [data, setData] = useState<StatsData | null>(null)
  const [insights, setInsights] = useState<DesktopInsights | null>(null)
  const [goal, setGoal] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      // 顺序执行：collectInsights 复用 collectStats 刚读到的记录（3 秒 TTL），只扫一次全表
      const s = await rt.collectStats()
      const i = await rt.collectInsights()
      setData(s)
      setInsights(i)
      setGoal(String(s.goal ?? 30))
      setMsg('')
    } catch (e) {
      setMsg(`读取失败：${String((e as Error)?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const say = useCallback((text: string) => setMsg(text), [])

  const heat = useMemo(() => data?.heatDays ?? [], [data])
  const heatMax = useMemo(() => Math.max(1, ...heat.map((d) => d.count)), [heat])
  const dueCount = data?.memory?.dueList?.length ?? 0
  const al = data?.autoLevel

  return (
    <>
      <Section label="每日目标" description="桌面版独立统计口径：按当天练过的不同单词计数">
        <Row label="每天的目标词数">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={500}
              step={5}
              value={goal}
              aria-label="每日目标"
              onChange={(e) => setGoal(e.target.value)}
              className="h-8 w-20 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-indigo-400 dark:border-neutral-600 dark:bg-gray-700 dark:text-gray-200"
            />
            <Btn
              variant="primary"
              onClick={async () => {
                const v = Math.min(500, Math.max(5, parseInt(goal, 10) || 30))
                await patch({ dailyGoal: v })
                await load()
                say(`每日目标已设为 ${v} 词`)
              }}
            >
              保存
            </Btn>
          </div>
        </Row>
        <Bar
          ratio={data?.ratio ?? 0}
          label={data ? `今日 ${data.words} / ${data.goal} 词 · 完成 ${Math.round(data.ratio * 100)}%` : '读取中…'}
        />
      </Section>

      <Section label="学习概览">
        <Stats
          items={[
            { label: '连续打卡(天)', value: n(data?.streak) },
            { label: '累计单词', value: n(data?.totalWords) },
            { label: '错词种类', value: n(data?.wrongWords?.length) },
            { label: '准确率', value: data?.accuracy == null ? '-' : `${data.accuracy}%` },
            { label: '估算 WPM', value: n(data?.wpm) },
            { label: '练习时长(分)', value: n(data?.totalMinutes) },
          ]}
        />
        <div className="flex w-full items-center justify-between pl-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data
              ? `数据源：${
                  data.source === 'RecordDB' ? 'IndexedDB RecordDB' : data.source === 'localStorage' ? 'localStorage 回退' : '暂无记录'
                }`
              : ' '}
          </span>
          <Btn onClick={() => void load()} disabled={busy}>
            {busy ? '刷新中…' : '刷新'}
          </Btn>
        </div>
        {msg ? <span className="pl-4 text-xs text-red-500">{msg}</span> : null}
      </Section>

      <Section label="近 14 天" description="按当天练过的不同单词数">
        <div className="flex h-16 w-full items-end gap-1 pl-4">
          {heat.map((d) => (
            <div
              key={d.date}
              title={`${d.date}：${d.count} 词`}
              className="flex-1 rounded-sm bg-indigo-400/70"
              style={{ height: `${Math.max(d.count ? 8 : 2, Math.round((d.count / heatMax) * 56))}px` }}
            />
          ))}
          {!heat.length ? <span className="text-xs text-gray-400">暂无数据</span> : null}
        </div>
        <div className="w-full pl-4 text-xs text-gray-400">
          {heat.length ? `${heat[0].date.slice(5)} → ${heat[heat.length - 1].date.slice(5)}` : ' '}
        </div>
      </Section>

      <Section label="记忆曲线">
        <Stats
          items={[
            { label: '已学单词', value: n(data?.memory?.learned) },
            { label: '短期(≤2档)', value: n(data?.memory?.buckets?.short) },
            { label: '巩固中(3~5档)', value: n(data?.memory?.buckets?.mid) },
            { label: '长期(≥6档)', value: n(data?.memory?.buckets?.long) },
          ]}
        />
        <div className="w-full pl-4 text-xs text-gray-500 dark:text-gray-400">
          未来 7 天到期：
          {data?.memory?.dueDays?.length ? data.memory.dueDays.map((d) => `${d.date.slice(5)} ${d.count}`).join(' · ') : '-'}
        </div>
      </Section>

      <Section label="到期复习">
        <Row label={dueCount ? `已到期 ${dueCount} 词` : '暂无到期词'} hint="按记忆曲线排队，答对推进档位、答错回到 10 分钟档">
          <Btn
            variant="primary"
            disabled={!dueCount}
            onClick={async () => {
              await runtime()?.startDueReview()
            }}
          >
            开始复习
          </Btn>
        </Row>
      </Section>

      <Section label="自动进阶">
        <Stats
          items={[
            { label: '当前级别', value: al?.name || al?.levelId || '-' },
            { label: '已掌握', value: n(al?.mastered) },
            { label: '已见', value: n(al?.seen) },
            { label: '待攻克', value: n(al?.suspended) },
          ]}
        />
        <div className="w-full pl-4 text-xs text-gray-500 dark:text-gray-400">
          {al?.levelId
            ? `有效词 ${Math.max(1, (al.total || 0) - (al.suspended || 0))} · 掌握率 ${
                al.mastered && al.total ? Math.round((al.mastered / Math.max(1, al.total - al.suspended)) * 100) : 0
              }% · 复习债 ${al.due || 0} 词`
            : '尚未初始化（开始自动进阶练习后生成）'}
        </div>
        <div className="flex w-full gap-2 pl-4">
          <Btn onClick={() => runtime()?.reevaluateLevel()}>重新评估级别</Btn>
          <Btn onClick={() => runtime()?.resumeSuspended()}>恢复全部待攻克</Btn>
        </div>
      </Section>

      <Section label="备份与迁移" description="跨设备恢复用全量导出；导入前自动备份">
        <div className="flex w-full flex-wrap gap-2 pl-4">
          <Btn
            variant="primary"
            onClick={async () => {
              const r = await desktop()?.backupNow()
              say(r?.ok ? `备份完成：${r.path || ''}` : `备份失败：${r?.error || '未知错误'}`)
            }}
          >
            立即备份
          </Btn>
          <Btn onClick={() => void desktop()?.openPath('backup')}>打开备份目录</Btn>
          <Btn onClick={() => void runtime()?.exportAll()}>导出全量 JSON</Btn>
          <Btn onClick={() => void runtime()?.importAll()}>导入全量 JSON</Btn>
        </div>
        <div className="w-full pl-4 text-xs text-gray-500 dark:text-gray-400">
          含设置、记忆曲线、自定义词库与外壳配置；官方「数据设置」导出不含自定义词库
        </div>
      </Section>

      <Section label="学习洞察" description="来自本机练习记录，只读">
        <div className="grid w-full grid-cols-3 gap-3 pl-4">
          <div>
            <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">错词 Top 5</div>
            {(data?.wrongWords ?? []).slice(0, 5).map((w) => (
              <div key={w.word} className="flex justify-between border-b border-neutral-100 py-1 text-xs dark:border-neutral-700">
                <span className="truncate text-gray-600 dark:text-gray-300">{w.word}</span>
                <span className="text-gray-400">×{w.wrongCount}</span>
              </div>
            ))}
            {!data?.wrongWords?.length ? <div className="text-xs text-gray-400">暂无</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">慢词 Top 5</div>
            {(insights?.slow ?? []).slice(0, 5).map((w) => (
              <div key={w.word} className="flex justify-between border-b border-neutral-100 py-1 text-xs dark:border-neutral-700">
                <span className="truncate text-gray-600 dark:text-gray-300">{w.word}</span>
                <span className="text-gray-400">{w.ms}ms</span>
              </div>
            ))}
            {!insights?.slow?.length ? <div className="text-xs text-gray-400">暂无</div> : null}
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">错误键 Top 5</div>
            {(insights?.errKeys ?? []).slice(0, 5).map((k) => (
              <div key={k.key} className="flex justify-between border-b border-neutral-100 py-1 text-xs dark:border-neutral-700">
                <span className="font-mono text-gray-600 dark:text-gray-300">{k.key === ' ' ? '空格' : k.key}</span>
                <span className="text-gray-400">{k.rate}%</span>
              </div>
            ))}
            {!insights?.errKeys?.length ? <div className="text-xs text-gray-400">暂无</div> : null}
          </div>
        </div>
        <div className="flex w-full gap-2 pl-4">
          <Btn onClick={() => void runtime()?.exportWrongCsv()}>导出错词 CSV</Btn>
          <Btn onClick={() => void runtime()?.exportRecordsCsv()}>导出记录 CSV</Btn>
          <Btn onClick={() => void desktop()?.openPath('exports')}>打开导出目录</Btn>
        </div>
      </Section>

      {!settings ? <span className="text-xs text-gray-400">桌面运行时未就绪</span> : null}
    </>
  )
}
