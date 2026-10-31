// 结果页正确率 / 错误分级的单测（v10.4，dsh）
//
// 为什么单独写：这两个函数原来写在 ResultScreen 的 useMemo 里，「空词表进结果页」这条路径
// 在正常使用中几乎走不到，无法用 CDP 构造，只能靠抽出来的纯函数做断言。
//
// 用法：node scripts/verify-stats.mjs
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'qz-stats-'))
const outfile = join(dir, 'correctRate.mjs')
try {
  await build({
    entryPoints: ['src/pages/Typing/components/ResultScreen/correctRate.ts'],
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

const { computeCorrectRate, mistakeLevelOf } = await import(pathToFileURL(outfile).href)

// —— 正常区间 ——
check('全对 = 100', computeCorrectRate(20, 0) === 100, computeCorrectRate(20, 0))
check('错 3/20 = 85', computeCorrectRate(20, 3) === 85, computeCorrectRate(20, 3))
check('错 6/20 = 70', computeCorrectRate(20, 6) === 70, computeCorrectRate(20, 6))
check('错 7/20 = 65（向下取整）', computeCorrectRate(20, 7) === 65, computeCorrectRate(20, 7))
check('错 1/3 = 66（floor）', computeCorrectRate(3, 1) === 66, computeCorrectRate(3, 1))

// —— 边界：空词表（原 bug：0/0 = NaN）——
const emptyRate = computeCorrectRate(0, 0)
check('空词表 = 0 而不是 NaN', emptyRate === 0 && Number.isFinite(emptyRate), { value: String(emptyRate) })
check('空词表分级为 2（红色）', mistakeLevelOf(emptyRate) === 2, mistakeLevelOf(emptyRate))
check('错词数大于词数时夹到 0（不产生负数）', computeCorrectRate(5, 9) === 0, computeCorrectRate(5, 9))
check('错词数为负时夹到 100', computeCorrectRate(5, -2) === 100, computeCorrectRate(5, -2))

// —— 非法输入兜底 ——
check('chapterLength 为 NaN → 0', computeCorrectRate(Number.NaN, 0) === 0)
check('chapterLength 为负 → 0', computeCorrectRate(-5, 0) === 0)
check('wrongWordCount 为 NaN → 按 0 错处理', computeCorrectRate(10, Number.NaN) === 100, computeCorrectRate(10, Number.NaN))

// —— 分级边界（与改前的 if 链逐字一致）——
check('85 → 0 级', mistakeLevelOf(85) === 0)
check('84 → 1 级', mistakeLevelOf(84) === 1)
check('70 → 1 级', mistakeLevelOf(70) === 1)
check('69 → 2 级', mistakeLevelOf(69) === 2)
check('0 → 2 级', mistakeLevelOf(0) === 2)

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `FAILED ${failures}`)
process.exit(failures === 0 ? 0 : 1)
