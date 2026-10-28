// 可靠的未使用文件 / 未使用导出分析：基于 import 说明符与标识符出现次数
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] || 'src'
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p)
  }
}
walk(root)

const src = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]))
const allText = [...src.values()].join('\n')

// 1) 文件级：是否被任何其它文件 import（支持 @/ 别名与相对路径）
const imported = new Set()
for (const [f, text] of src) {
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] || m[2] || m[3]
    if (!spec) continue
    let target = null
    if (spec.startsWith('@/')) target = path.join('src', spec.slice(2))
    else if (spec.startsWith('.')) target = path.join(path.dirname(f), spec)
    if (!target) continue
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const cand = target + ext
      if (src.has(cand)) { imported.add(cand); break }
      if (src.has(target) && !ext.startsWith('/')) { imported.add(target); break }
    }
  }
}
const orphanFiles = files.filter((f) => !imported.has(f) && !/index\.(ts|tsx)$/.test(f) && !/^src\/(index|main|App)/.test(f))

// 2) 导出级：导出名在其它文件中的出现次数（排除自身）
const unusedExports = []
for (const [f, text] of src) {
  const names = new Set()
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1])
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (n) names.add(n)
    }
  }
  for (const n of names) {
    const re = new RegExp(`\\b${n.replace(/[$]/g, '\\$')}\\b`, 'g')
    let count = 0
    for (const [g, t] of src) {
      if (g === f) continue
      const c = (t.match(re) || []).length
      count += c
    }
    if (count === 0) unusedExports.push(`${f}: ${n}`)
  }
}

console.log('files=' + files.length)
console.log('ORPHAN(' + orphanFiles.length + '):')
orphanFiles.forEach((f) => console.log('  ' + f))
console.log('UNUSED_EXPORT(' + unusedExports.length + '):')
unusedExports.slice(0, 40).forEach((x) => console.log('  ' + x))
