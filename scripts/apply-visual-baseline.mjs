#!/usr/bin/env node
// 把 CI artifact 里的桌面视觉基线落到仓库（跨平台基线的唯一落地口）。
//
//   npm run test:desktop-visual:apply -- <下载并解压后的目录>
//   npm run test:desktop-visual:apply -- <目录> --platform linux
//
// 校验：文件名/平台后缀、5 张固定页面、PNG 尺寸 1280x800、非空白图；通过后才复制。
// 目的：让「在 macOS/Linux 上生成基线」这件事有可复核的步骤，而不是手工拖文件。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_DIR = path.join(REPO, 'tests', 'desktop-visual')
const PAGES = ['view', 'data', 'dict', 'tools', 'accent']
const args = process.argv.slice(2)
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
// 取第一个位置参数（跳过 --dir/--platform 的值）
let positional = ''
for (let i = 0; i < args.length; i += 1) {
  const a = args[i]
  if (a.startsWith('--')) {
    const name = a.slice(2).split('=')[0]
    if (!a.includes('=') && (name === 'dir' || name === 'platform')) i += 1
    continue
  }
  positional = a
  break
}
const givenDir = opt('dir', positional || '')
const dir = givenDir ? path.resolve(givenDir) : ''
const platform = opt('platform', process.env.QZ_DESKTOP_VISUAL_PLATFORM || process.platform)
const dryRun = args.includes('--dry-run')

const die = (m) => {
  console.error(`BASELINE_APPLY_FAIL: ${m}`)
  process.exit(1)
}

if (!dir) die('请提供基线目录：npm run test:desktop-visual:apply -- <目录>')
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`目录不存在：${dir}`)

const files = []
const issues = []
for (const page of PAGES) {
  const name = `${page}-${platform}.png`
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) {
    issues.push(`缺少 ${name}`)
    continue
  }
  const buf = fs.readFileSync(file)
  let png
  try {
    png = PNG.sync.read(buf)
  } catch (e) {
    issues.push(`${name} 不是有效 PNG：${e.message}`)
    continue
  }
  if (png.width !== 1280 || png.height !== 800) issues.push(`${name} 尺寸 ${png.width}x${png.height}，期望 1280x800`)
  if (buf.length < 10 * 1024) issues.push(`${name} 只有 ${(buf.length / 1024).toFixed(1)}KB，疑似空白/失败截图`)
  // 纯色图（全黑/全白）说明截到的是空窗口
  const colors = new Set()
  for (let i = 0; i < png.data.length; i += 4 * 97) colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
  if (colors.size < 20) issues.push(`${name} 颜色种类只有 ${colors.size}，疑似纯色图`)
  files.push({ name, file, sha: createHash('sha256').update(buf).digest('hex').slice(0, 12), size: buf.length })
}

const extras = fs.readdirSync(dir).filter((f) => f.endsWith(`-${platform}.png`) && !PAGES.includes(f.replace(`-${platform}.png`, '')))
if (extras.length) issues.push(`出现未知页面（请确认是否要一起提交）：${extras.join(', ')}`)

if (issues.length) die(`\n  - ${issues.join('\n  - ')}`)

console.log(`平台：${platform}；来源：${dir}`)
for (const f of files) console.log(`  ${f.name}  ${f.sha}…  ${(f.size / 1024).toFixed(1)}KB`)
if (dryRun) {
  console.log('BASELINE_APPLY_DRY_RUN（未复制）')
  process.exit(0)
}
fs.mkdirSync(BASELINE_DIR, { recursive: true })
for (const f of files) fs.copyFileSync(f.file, path.join(BASELINE_DIR, f.name))
console.log(`BASELINE_APPLY_PASS  已写入 ${path.relative(REPO, BASELINE_DIR)}（共 ${files.length} 张，请提交）`)
