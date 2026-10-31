import { Range, Row, Section, Toggle } from '../controls'
import { useDesktopSettings } from '../useDesktopSettings'
import { desktop } from '@/utils/desktop'

// 桌面壳窗口行为。写入即生效（主进程 IPC），不需要「保存」按钮。
export default function DesktopWindow() {
  const { settings, patch, preview } = useDesktopSettings()
  if (!settings) return null
  const platform = desktop()?.platform
  const autoStartSupported = platform !== 'linux'

  return (
    <Section label="窗口与系统" description="仅桌面版生效">
      <Row label="窗口置顶" hint="始终显示在其他程序之上">
        <Toggle label="窗口置顶" checked={settings.alwaysOnTop} onChange={(v) => void patch({ alwaysOnTop: v })} />
      </Row>
      <Row label="迷你模式" hint="窄条窗口，只留练习区（Ctrl+Alt+M）">
        <Toggle label="迷你模式" checked={settings.miniMode} onChange={(v) => void patch({ miniMode: v })} />
      </Row>
      <Row label="关闭时最小化到托盘" hint="托盘图标单击恢复窗口">
        <Toggle label="关闭时最小化到托盘" checked={settings.closeToTray} onChange={(v) => void patch({ closeToTray: v })} />
      </Row>
      <Row label="开机自动启动" hint={autoStartSupported ? undefined : '当前平台不支持（仅 Windows / macOS）'}>
        <Toggle
          label="开机自动启动"
          checked={settings.autoStart}
          onChange={(v) => void patch({ autoStart: v })}
          disabled={!autoStartSupported}
        />
      </Row>
      <Row label="窗口不透明度" stacked>
        <Range
          label="窗口不透明度"
          value={settings.opacity}
          min={0.3}
          max={1}
          step={0.05}
          onChange={(v) => preview('opacity', v)}
          onCommit={(v) => void patch({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
      <Row label="页面缩放" stacked>
        <Range
          label="页面缩放"
          value={settings.zoom}
          min={0.6}
          max={1.6}
          step={0.05}
          onChange={(v) => preview('zoom', v)}
          onCommit={(v) => void patch({ zoom: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
    </Section>
  )
}
