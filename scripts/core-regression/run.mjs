#!/usr/bin/env node
// 核心算法回归的一键入口（v10.1，dsh）
//
// 依次执行：
//   1. 用 esbuild 把**真实源码** src/utils/{srsRules,autoLevel,memory,memoryLadder,memoryKey,
//      memoryCache,sessionRequeue,learningPath,db/index}.ts 打包成 core.mjs（只把浏览器依赖换成 stub）；
//   2. srs-sim.mjs --strict（SRS / 记忆曲线，120 条断言）；
//   3. sim-autolevel.mjs --strict（自动进阶 / 出词，189 条断言）；
//   4. determinism-check.mjs（同输入跑两遍必须完全一致）；
//   5. aggregate.mjs（汇总 309 条 + 确定性门禁，任一项失败即非 0 退出）。
//
// 用法：npm run test:core
// 产物：同目录下 core.mjs、v93-*-report.json、report-all.json（均已在 .gitignore 中）

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const steps = [
  { name: 'build-core（打包真实源码）', file: 'build-core.mjs', args: [] },
  { name: 'srs-sim --strict', file: 'srs-sim.mjs', args: ['--strict'] },
  { name: 'sim-autolevel --strict', file: 'sim-autolevel.mjs', args: ['--strict'] },
  { name: 'determinism-check', file: 'determinism-check.mjs', args: [] },
  { name: 'aggregate（汇总门禁）', file: 'aggregate.mjs', args: [] },
]

for (const step of steps) {
  const script = join(here, step.file)
  if (!existsSync(script)) {
    console.error(`缺少脚本：${step.file}`)
    process.exit(2)
  }
  console.log(`\n==> ${step.name}`)
  const res = spawnSync(process.execPath, [script, ...step.args], { cwd: here, stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`\n核心回归失败于「${step.name}」（退出码 ${res.status}）`)
    process.exit(res.status ?? 1)
  }
}

console.log('\n核心回归全部通过（309 条断言 + 确定性门禁），明细见 report-all.json')
