// 纯函数属性测试（seeded fuzz，v11.2）
//
// 为什么不用测试框架：仓库没有 vitest/jest，而这些函数是纯函数、无 DOM 依赖，
// 用 esbuild 打成 ESM 后直接跑 500~1200 组固定种子的随机输入即可，结果可复现。
//
// 覆盖：
//   1) csvSafeCell  — 公式前缀必须被中和，非字符串必须原样返回
//   2) normalizeTrans — 任何输入都必须得到 string[]，且数组输入只过滤不改造
//   3) computeCorrectRate / mistakeLevelOf — 结果必须在 0~100 / 0~2，且单调
//
// 用法：node scripts/verify-fuzz.mjs [--iterations 800]
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) || fallback : fallback
}
const ITER = Math.min(5000, Math.max(100, argOf('iterations', 800)))

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

// mulberry32：固定种子，可复现
let seed = 0x9e3779b9
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1))

const dir = mkdtempSync(join(tmpdir(), 'qz-fuzz-'))
async function bundle(entry, name) {
  const outfile = join(dir, `${name}.mjs`)
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'neutral', target: 'es2020', logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}

let mods
try {
  mods = {
    csv: await bundle('src/utils/csvSafe.ts', 'csv'),
    trans: await bundle('src/utils/trans.ts', 'trans'),
    rate: await bundle('src/pages/Typing/components/ResultScreen/correctRate.ts', 'rate'),
  }
} catch (e) {
  console.error(`BUILD_FAILED: ${e.message}`)
  rmSync(dir, { recursive: true, force: true })
  process.exit(2)
}

const { csvSafeCell } = mods.csv
const { normalizeTrans } = mods.trans
const { computeCorrectRate, mistakeLevelOf } = mods.rate

// —— 1) CSV 公式注入 ——
{
  const DANGER = ['=', '+', '-', '@', '\t', '\r']
  const ALPHA = ['a', 'Z', '0', ' ', '"', ',', '\n', '中', '文', '😀', ...DANGER]
  let bad = 0
  let sample = null
  for (let i = 0; i < ITER; i++) {
    const len = int(0, 24)
    let s = ''
    for (let j = 0; j < len; j++) s += pick(ALPHA)
    const out = csvSafeCell(s)
    const dangerous = /^[=+\-@\t\r]/.test(s)
    const expected = dangerous ? `'${s}` : s
    if (out !== expected || typeof out !== 'string') {
      bad += 1
      sample = sample || { in: s, out, expected }
    }
  }
  check(`csvSafeCell：${ITER} 组随机字符串的前缀处理`, bad === 0, sample)
  check(
    'csvSafeCell：非字符串原样返回',
    [0, -1, 3.14, null, undefined, true, { a: 1 }].every((v) => csvSafeCell(v) === v),
  )
}

// —— 2) trans 归一化 ——
{
  let bad = 0
  let sample = null
  const scalar = () => pick(['hello', '', '中文', 0, 1.5, true, { x: 1 }, null, undefined])
  for (let i = 0; i < ITER; i++) {
    const shape = int(0, 2)
    let input
    if (shape === 0) input = scalar()
    else {
      const len = int(0, 8)
      input = Array.from({ length: len }, scalar)
    }
    const out = normalizeTrans(input)
    const okShape = Array.isArray(out) && out.every((x) => typeof x === 'string')
    const expected = Array.isArray(input) ? input.filter((x) => typeof x === 'string') : input == null ? [] : [String(input)]
    const okValue = JSON.stringify(out) === JSON.stringify(expected)
    if (!okShape || !okValue) {
      bad += 1
      sample = sample || { input, out, expected }
    }
  }
  check(`normalizeTrans：${ITER} 组随机输入都得到 string[]`, bad === 0, sample)
}

// —— 3) 正确率与分级 ——
{
  let bad = 0
  let sample = null
  for (let i = 0; i < ITER; i++) {
    const n = int(-5, 500)
    const wrong = int(-10, 600)
    const rate = computeCorrectRate(n, wrong)
    const level = mistakeLevelOf(rate)
    const ok =
      Number.isInteger(rate) &&
      rate >= 0 &&
      rate <= 100 &&
      (level === 0 || level === 1 || level === 2) &&
      (level === 0 ? rate >= 85 : level === 1 ? rate >= 70 && rate < 85 : rate < 70)
    if (!ok) {
      bad += 1
      sample = sample || { n, wrong, rate, level }
    }
  }
  check(`computeCorrectRate：${ITER} 组随机输入都落在 0~100 且分级一致`, bad === 0, sample)

  // 单调：词数固定时，错得越多正确率不会更高
  let mono = true
  for (let i = 0; i < 200; i++) {
    const n = int(1, 300)
    let prev = Number.POSITIVE_INFINITY
    for (let w = 0; w <= n; w += Math.max(1, Math.floor(n / 17))) {
      const r = computeCorrectRate(n, w)
      // 非递增：错得越多，正确率不能变大
      if (r > prev) mono = false
      prev = r
    }
  }
  check('computeCorrectRate：错词数增加时正确率不上升', mono)
}

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
