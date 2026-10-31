#!/usr/bin/env node
/**
 * 可复现性检查（R-SIM-04）：同一 Node 下把两个 --strict 门禁各跑两遍，
 * 比较报告 JSON（忽略 generatedAt），并校验退出码均为 0。
 *
 * 运行：node "scripts/core-regression\determinism-check.mjs"
 * 产物：scripts/core-regression\report-determinism.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const AUDIT = import.meta.dirname
const node = process.execPath
const sims = [
  { name: 'srs', script: path.join(AUDIT, 'srs-sim.mjs'), report: path.join(AUDIT, 'report-srs.json') },
  { name: 'autoLevel', script: path.join(AUDIT, 'sim-autolevel.mjs'), report: path.join(AUDIT, 'report-autolevel.json') },
]

const strip = (obj) => {
  const clone = JSON.parse(JSON.stringify(obj))
  delete clone.generatedAt
  return JSON.stringify(clone)
}

const results = {}
let ok = true
for (const sim of sims) {
  const runs = []
  for (let i = 0; i < 2; i++) {
    const res = spawnSync(node, [sim.script, '--strict'], { cwd: AUDIT, stdio: 'ignore' })
    runs.push({ exitCode: res.status, report: JSON.parse(fs.readFileSync(sim.report, 'utf8')) })
  }
  const same = strip(runs[0].report) === strip(runs[1].report)
  const exits = runs.map((r) => r.exitCode)
  const pass = same && exits.every((c) => c === 0)
  results[sim.name] = {
    pass,
    stable: same,
    exitCodes: exits,
    totals: [runs[0].report.total, runs[0].report.passed, runs[0].report.failed],
  }
  if (!pass) ok = false
}

const out = { generatedAt: new Date().toISOString(), pass: ok, results }
fs.writeFileSync(path.join(AUDIT, 'report-determinism.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
process.exit(ok ? 0 : 1)
