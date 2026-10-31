import { Btn, Range, Row, Section, Toggle } from '../controls'
import { useDesktopSettings } from '../useDesktopSettings'
import { desktop } from '@/utils/desktop'
import { useCallback, useEffect, useState } from 'react'

function fmtBytes(n: number) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function DesktopSound() {
  const { settings, patch, preview } = useDesktopSettings()
  const [pron, setPron] = useState<{ count: number; bytes: number } | null>(null)
  const [err, setErr] = useState('')

  const loadPron = useCallback(async () => {
    const b = desktop()
    if (!b) return
    try {
      const s = await b.pronStats()
      setPron({ count: Number(s?.count) || 0, bytes: Number(s?.bytes) || 0 })
    } catch {
      setPron(null)
    }
  }, [])

  useEffect(() => {
    void loadPron()
  }, [loadPron])

  if (!settings) return null

  return (
    <>
      <Section label="机械键盘键音" description="仅桌面版；打字时播放轻键音">
        <Row label="启用键音">
          <Toggle label="机械键盘键音" checked={settings.keySound} onChange={(v) => void patch({ keySound: v })} />
        </Row>
        <Row label="键音音量" stacked>
          <Range
            label="键音音量"
            value={settings.keySoundVolume}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => preview('keySoundVolume', v)}
            onCommit={(v) => void patch({ keySoundVolume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
      </Section>

      <Section label="发音缓存" description="缓存有道发音音频，二次播放可离线">
        <Row label="启用缓存">
          <Toggle label="发音缓存" checked={settings.pronCache} onChange={(v) => void patch({ pronCache: v })} />
        </Row>
        <Row label="缓存统计" hint={err || (pron ? `${pron.count} 个文件 · ${fmtBytes(pron.bytes)}` : '读取中…')}>
          <Btn
            onClick={async () => {
              try {
                await desktop()?.clearPronCache()
                await loadPron()
                setErr('')
              } catch (e) {
                setErr(`清空失败：${String((e as Error)?.message || e)}`)
              }
            }}
          >
            清空
          </Btn>
        </Row>
      </Section>
    </>
  )
}
