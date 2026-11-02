#!/usr/bin/env node
// 桌面图标生成：一份 SVG → 多尺寸 PNG → Windows .ico + macOS .icns。
//
// 为什么自己写：ICO/ICNS 都是很薄的容器格式（目录项 + PNG 负载），
// 自己生成可以做到零平台工具依赖（不需要 ImageMagick / iconutil / png2icns），
// 在 Windows / macOS / Linux 上产出逐字节一致的文件，方便 --check 进 CI。
//
//   node scripts/icons.mjs                 # 生成到 local-fork/icons
//   node scripts/icons.mjs --check         # 校验已提交产物是否与 SVG 一致（CI）
//   node scripts/icons.mjs --source a.svg --out some/dir
//
// 依赖 sharp 只用于「SVG 光栅化 + 缩放」，是 devDependency；生成物已提交，
// 普通用户与打包流程都不需要安装 sharp。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
const CHECK = args.includes('--check')
const SOURCE = path.resolve(opt('source', path.join(REPO, 'src', 'assets', 'logo.svg')))
const OUT = path.resolve(opt('out', path.join(REPO, 'local-fork', 'icons')))

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_TYPES = [
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** ICO：ICONDIR + n×ICONDIRENTRY + PNG 负载（Windows Vista+ 支持 PNG 压缩条目） */
export function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  images.forEach(({ size, png }, i) => {
    const e = 16 * i
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0) // 0 表示 256
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1)
    entries.writeUInt8(0, e + 2) // 调色板数
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // planes
    entries.writeUInt16LE(32, e + 6) // bpp
    entries.writeUInt32LE(png.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, entries, ...images.map((x) => x.png)])
}

export function parseIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('ICO 头无效')
  const count = buf.readUInt16LE(4)
  const items = []
  for (let i = 0; i < count; i += 1) {
    const e = 6 + 16 * i
    const size = buf.readUInt8(e) === 0 ? 256 : buf.readUInt8(e)
    const bytes = buf.readUInt32LE(e + 8)
    const off = buf.readUInt32LE(e + 12)
    const png = buf.subarray(off, off + bytes)
    items.push({ size, png, declared: { width: size, height: size }, actual: pngSize(png) })
  }
  return items
}

/** ICNS：'icns' + 总长度 + 若干 (4 字符类型 + 长度 + PNG) */
export function buildIcns(images) {
  const chunks = images.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(total, 4)
  return Buffer.concat([head, ...chunks])
}

export function parseIcns(buf) {
  if (buf.toString('ascii', 0, 4) !== 'icns') throw new Error('ICNS 头无效')
  const total = buf.readUInt32BE(4)
  if (total !== buf.length) throw new Error(`ICNS 长度不符：头 ${total} / 实际 ${buf.length}`)
  const out = []
  let p = 8
  while (p < buf.length) {
    const type = buf.toString('ascii', p, p + 4)
    const len = buf.readUInt32BE(p + 4)
    if (len < 8 || p + len > buf.length) throw new Error(`ICNS 块长度无效：${type}`)
    const png = buf.subarray(p + 8, p + len)
    out.push({ type, png, actual: pngSize(png) })
    p += len
  }
  return out
}

async function render(sharp, size, density) {
  const svg = fs.readFileSync(SOURCE)
  const buf = await sharp(svg, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  const got = pngSize(buf)
  if (got.width !== size || got.height !== size) throw new Error(`渲染尺寸不符：期望 ${size}，得到 ${got.width}x${got.height}`)
  return buf
}

async function generate(outDir) {
  let sharp
  try {
    ;({ default: sharp } = await import('sharp'))
  } catch {
    throw new Error('缺少 sharp。请先 npm install（sharp 是 devDependency，仅生成图标时需要）。')
  }
  if (!fs.existsSync(SOURCE)) throw new Error(`图标源不存在：${SOURCE}`)

  fs.mkdirSync(outDir, { recursive: true })
  const pngs = new Map()
  for (const size of PNG_SIZES) {
    // 按源 SVG 的固有宽度反推 DPI：保证光栅化后至少 2048px，再缩到目标尺寸；
    // 旧 logo（200×200）与新图标（1024×1024）都不会糊，也不会触发 sharp 的像素上限。
    const srcWidth = Number((fs.readFileSync(SOURCE, 'utf8').match(/<svg[^>]*\bwidth="(\d+)"/) || [])[1]) || 1024
    const density = Math.max(192, Math.ceil((2048 * 72) / srcWidth))
    pngs.set(size, await render(sharp, size, density))
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), pngs.get(size))
  }

  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) })))
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
  const icns = buildIcns(ICNS_TYPES.map(([size, type]) => ({ type, png: pngs.get(size) })))
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns)
  fs.writeFileSync(path.join(outDir, 'icon.png'), pngs.get(1024))

  const manifest = {
    source: path.relative(REPO, SOURCE).replace(/\\/g, '/'),
    sourceSha256: sha256(fs.readFileSync(SOURCE)),
    note: `由 npm run icons 从 ${path.relative(REPO, SOURCE).replace(/\\/g, '/')} 生成，勿手改；GPL-3.0，见 FORK-NOTICE.md。`,
    pngSizes: PNG_SIZES,
    icoSizes: ICO_SIZES,
    icns: Object.fromEntries(ICNS_TYPES),
    files: Object.fromEntries(
      fs
        .readdirSync(outDir)
        .filter((f) => f !== 'manifest.json' && !f.endsWith('.svg'))
        .sort()
        .map((f) => [f, sha256(fs.readFileSync(path.join(outDir, f)))]),
    ),
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** 校验生成物：签名、目录项、每档尺寸都要与声明一致，且与源文件重算结果逐字节相同 */
export function verifyIcons(dir) {
  const issues = []
  const need = ['icon.ico', 'icon.icns', 'icon.png', 'manifest.json']
  for (const f of need) if (!fs.existsSync(path.join(dir, f))) issues.push(`缺少 ${f}`)
  if (issues.length) return { ok: false, issues }

  try {
    const items = parseIco(fs.readFileSync(path.join(dir, 'icon.ico')))
    const got = items.map((x) => x.size).join(',')
    if (got !== ICO_SIZES.join(',')) issues.push(`ICO 尺寸序列不符：${got}`)
    for (const it of items) {
      if (it.actual.width !== it.size || it.actual.height !== it.size)
        issues.push(`ICO ${it.size} 实际 ${it.actual.width}x${it.actual.height}`)
    }
  } catch (e) {
    issues.push(`ICO 解析失败：${e.message}`)
  }

  try {
    const chunks = parseIcns(fs.readFileSync(path.join(dir, 'icon.icns')))
    const want = ICNS_TYPES.map(([size, type]) => `${type}:${size}`)
    const got = chunks.map((c) => `${c.type}:${c.actual.width}`)
    if (got.join(',') !== want.join(',')) issues.push(`ICNS 块不符：期望 ${want.join(',')}，实际 ${got.join(',')}`)
  } catch (e) {
    issues.push(`ICNS 解析失败：${e.message}`)
  }

  const main = pngSize(fs.readFileSync(path.join(dir, 'icon.png')))
  if (main.width !== 1024 || main.height !== 1024) issues.push(`icon.png 应为 1024，实际 ${main.width}x${main.height}`)

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  for (const [file, hash] of Object.entries(manifest.files)) {
    const p = path.join(dir, file)
    if (!fs.existsSync(p)) {
      issues.push(`产物缺失：${file}`)
      continue
    }
    if (sha256(fs.readFileSync(p)) !== hash) issues.push(`哈希不符：${file}`)
  }
  return { ok: issues.length === 0, issues }
}

async function main() {
  if (CHECK) {
    const result = verifyIcons(OUT)
    if (!result.ok) {
      console.error('ICON_CHECK_FAIL')
      for (const i of result.issues) console.error(`  - ${i}`)
      process.exitCode = 1
      return
    }
    // 结构对了还要确认「改过 SVG 但忘了重新生成」：在临时目录重算一遍再逐字节比对
    const tmp = fs.mkdtempSync(path.join(tmpdir(), 'qz-icons-'))
    try {
      await generate(tmp)
      const files = fs.readdirSync(OUT).filter((f) => f !== 'manifest.json')
      for (const f of files) {
        const a = fs.readFileSync(path.join(OUT, f))
        const b = fs.readFileSync(path.join(tmp, f))
        if (!a.equals(b)) {
          result.ok = false
          result.issues.push(`与源不一致（请重跑 npm run icons）：${f}`)
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    if (!result.ok) {
      console.error('ICON_CHECK_FAIL')
      for (const i of result.issues) console.error(`  - ${i}`)
      process.exitCode = 1
      return
    }
    console.log(`ICON_CHECK_PASS  ${path.relative(REPO, OUT)}`)
    console.log(`  ico: ${ICO_SIZES.join(', ')}`)
    console.log(`  icns: ${ICNS_TYPES.map(([s]) => s).join(', ')}`)
    return
  }

  const manifest = await generate(OUT)
  const check = verifyIcons(OUT)
  if (!check.ok) {
    console.error('ICON_GEN_FAIL')
    for (const i of check.issues) console.error(`  - ${i}`)
    process.exitCode = 1
    return
  }
  console.log(`ICON_GEN_PASS  ${path.relative(REPO, OUT)}`)
  console.log(`  源: ${manifest.source}（${manifest.sourceSha256.slice(0, 12)}…）`)
  console.log(`  ICO: ${ICO_SIZES.join(', ')}`)
  console.log(`  ICNS: ${ICNS_TYPES.map(([s]) => s).join(', ')}`)
  const totalKB = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1024
  console.log(`  文件: ${Object.keys(manifest.files).length} 个，共 ${totalKB.toFixed(1)}KB`)
}

// 只有直接执行时才生成；被 package.mjs import 时只暴露 build/verify 函数
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`ICON_ERROR: ${e.message}`)
    process.exitCode = 2
  })
}
