import { Row, Section, Select, Toggle } from '../controls'
import { useDesktopSettings } from '../useDesktopSettings'

const THEMES = [
  { value: 'indigo', label: '靛蓝（默认）' },
  { value: 'emerald', label: '翡翠绿' },
  { value: 'rose', label: '玫瑰红' },
  { value: 'amber', label: '琥珀黄' },
  { value: 'sky', label: '天空蓝' },
  { value: 'violet', label: '紫罗兰' },
]

const FONTS = [
  { value: 'default', label: '默认' },
  { value: 'mono', label: '等宽' },
  { value: 'serif', label: '衬线' },
  { value: 'round', label: '圆体' },
]

export default function DesktopAppearance() {
  const { settings, patch } = useDesktopSettings()
  if (!settings) return null

  return (
    <Section label="主题与字体" description="强调色与单词字体由桌面壳施加到页面；深色模式与应用内主题联动">
      <Row label="强调色">
        <Select label="强调色" value={settings.theme} options={THEMES} onChange={(v) => void patch({ theme: v })} />
      </Row>
      <Row label="单词字体" hint="只影响练习区的大号单词">
        <Select label="单词字体" value={settings.fontFamily} options={FONTS} onChange={(v) => void patch({ fontFamily: v })} />
      </Row>
      <Row label="深色模式">
        <Toggle label="深色模式" checked={settings.darkMode === true} onChange={(v) => void patch({ darkMode: v })} />
      </Row>
    </Section>
  )
}
