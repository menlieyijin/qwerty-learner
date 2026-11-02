#!/usr/bin/env node
// 一条命令跑桌面冒烟：自启程序（隔离 profile + CDP）→ dsh-smoke 13 项 → 收尾。
// 与 dsh-smoke.mjs 的区别：那个要求「外部已经起好带调试端口的实例」，这个自己起。
//
//   npm run test:desktop-smoke
//   npm run test:desktop-smoke -- --exe "release/shell-win32-x64/Qwerty Learner.exe"
import { resolveDesktopExe } from './lib/desktop-app.mjs'
import { runSmoke } from './lib/smoke.mjs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

let exe
try {
  exe = resolveDesktopExe(argOf('exe', ''))
} catch (e) {
  console.error(`VERIFY_ERROR: ${e.message}`)
  process.exit(2)
}

const port = Number(argOf('port', process.env.QZ_SMOKE_PORT || 9472))
const root = fs.mkdtempSync(path.join(tmpdir(), 'qz-smoke-'))

try {
  console.log(`冒烟：${exe}`)
  const out = await runSmoke(exe, { port, userDir: path.join(root, 'userdata'), plusDir: path.join(root, 'plus') })
  console.log(out.trim())
  let checks = {}
  try {
    checks = JSON.parse(out.trim())
  } catch {
    /* 非 JSON 时按 0 项展示 */
  }
  const total = Object.keys(checks).length
  const passed = Object.values(checks).filter((v) => v === true).length
  console.log(`DESKTOP_SMOKE_PASS  ${passed}/${total} 项`)
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* profile 仍被占用时留给系统清理 */
  }
}
