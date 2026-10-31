// CSV 公式注入防护的验证脚本（v9.19，dsh；审计 F5-001）
//
// 直接对源码 src/utils/csvSafe.ts 做断言：用 esbuild 把 TS 打成临时 ESM 再 import，
// 不引入新的测试框架，也不把测试代码塞进 src。
//
// 用法：node scripts/verify-csv-safe.mjs   退出码 0=全过，1=有失败，2=环境问题（esbuild 不可用）
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as XLSX from 'xlsx'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'qz-csvsafe-'))
const outfile = join(dir, 'csvSafe.mjs')

try {
  await build({
    entryPoints: ['src/utils/csvSafe.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    logLevel: 'silent',
  })
} catch (e) {
  console.error(`BUILD_FAILED: ${e.message}`)
  rmSync(dir, { recursive: true, force: true })
  process.exit(2)
}

const { csvSafeCell } = await import(pathToFileURL(outfile).href)

check('等号开头加前缀', csvSafeCell('=cmd|calc') === "'=cmd|calc", csvSafeCell('=cmd|calc'))
check('加号开头加前缀', csvSafeCell('+1+1') === "'+1+1", csvSafeCell('+1+1'))
check('减号开头加前缀', csvSafeCell('-2+3') === "'-2+3", csvSafeCell('-2+3'))
check('@ 开头加前缀', csvSafeCell('@SUM(A1)') === "'@SUM(A1)", csvSafeCell('@SUM(A1)'))
check('Tab 开头加前缀', csvSafeCell('\t=x') === "'\t=x", csvSafeCell('\t=x'))
check('普通单词不变', csvSafeCell('apple') === 'apple', csvSafeCell('apple'))
check('中文释义不变', csvSafeCell('苹果；苹果树') === '苹果；苹果树')
check('数字类型不变', csvSafeCell(3) === 3)
check('null 不变', csvSafeCell(null) === null)
check('内部等号不算公式（不误伤）', csvSafeCell('a=b') === 'a=b', csvSafeCell('a=b'))

// 端到端：模拟 DropdownExport 的 csv 分支，确认导出的文本里公式已被中和
const rows = [{ 单词: '=HYPERLINK("http://x")', 释义: csvSafeCell('=1+1'), 错误次数: 2, 词典: 'CET4' }]
const safeRows = rows.map((r) => ({ 单词: csvSafeCell(r.单词), 释义: csvSafeCell(r.释义), 错误次数: r.错误次数, 词典: r.词典 }))
const ws = XLSX.utils.json_to_sheet(safeRows)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
const csv = XLSX.write(wb, { bookType: 'csv', type: 'string' })
const lines = csv.split(/\r?\n/)
// SheetJS 会给含引号的字段整体加双引号，所以这里断言“字段内容里是 '= 而不是裸 =”
check('CSV 单词列已中和', csv.includes("'=HYPERLINK"), lines[1])
check('CSV 释义列已中和', csv.includes("'=1+1"), lines[1])
check('CSV 数字列未被加引号', /,2,/.test(lines[1] || ''), lines[1])
check('CSV 无裸公式单元格', !/(^|,)"?=/.test(csv), lines[1])

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `FAILED ${failures}`)
process.exit(failures === 0 ? 0 : 1)
