#!/usr/bin/env node
// 安装目录体检（只读）。用法：
//   node scripts/check-install.mjs --dir "<安装目录>" [--dir "<另一个>"] [--expect <sha256>]
// 退出码：0 全部通过；1 有问题；2 参数错误。
//
// 检查：可执行文件在不在、app.asar 能否读出目录、关键文件是否齐全、
//       哈希是否与预期一致、有没有上次失败留下的 .tmp-*、GPL 的 LICENSE / FORK-NOTICE 是否随包。
import { checkInstallDir } from './lib/install-check.mjs'
import path from 'node:path'

const args = process.argv.slice(2)
const dirs = []
args.forEach((a, i) => {
  if (a === '--dir' && args[i + 1]) dirs.push(args[i + 1])
  else if (a.startsWith('--dir=')) dirs.push(a.slice(6))
})
const expectIdx = args.indexOf('--expect')
const expected = expectIdx >= 0 ? args[expectIdx + 1] : ''

if (!dirs.length) {
  console.error('用法：node scripts/check-install.mjs --dir "<安装目录>" [--dir "..."] [--expect <sha256>]')
  process.exit(2)
}

let failed = 0
for (const dir of dirs) {
  const r = checkInstallDir(path.resolve(dir), { expectedHash: expected })
  if (r.ok) {
    console.log(`PASS  ${dir}`)
    console.log(`      asar=${r.info.sha256.slice(0, 12)}… size=${Math.round(r.info.size / 1024 / 1024)}MB entries=${r.info.entries}`)
  } else {
    failed += 1
    console.log(`FAIL  ${dir}`)
    for (const issue of r.issues) console.log(`      - ${issue}`)
  }
}

console.log(`\n${failed === 0 ? 'INSTALL_OK' : 'INSTALL_BAD'}  ${dirs.length - failed}/${dirs.length}`)
process.exit(failed === 0 ? 0 : 1)
