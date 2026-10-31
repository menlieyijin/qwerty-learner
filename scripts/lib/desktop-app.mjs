// 跨平台解析桌面程序路径。
// 优先级：显式参数 > QZ_VERIFY_EXE > QZ_TEST_APP_DIR > 仓库内常见产物目录 > 作者旧默认值。
// 找不到时给出可执行的提示，而不是抛一个 Windows 路径错误。
import { existsSync } from 'node:fs'
import path from 'node:path'

const APP_NAME = 'Qwerty Learner'

function variants(dir) {
  if (process.platform === 'darwin') {
    // 允许直接传 .app 包路径
    if (dir.endsWith('.app')) return [path.join(dir, 'Contents', 'MacOS', APP_NAME)]
    return [path.join(dir, `${APP_NAME}.app`, 'Contents', 'MacOS', APP_NAME), path.join(dir, APP_NAME)]
  }
  if (process.platform === 'win32') {
    return [path.join(dir, `${APP_NAME}.exe`)]
  }
  return [path.join(dir, 'qwerty-learner'), path.join(dir, APP_NAME), path.join(dir, `${APP_NAME}.AppImage`)]
}

export function resolveDesktopExe(explicit) {
  const dirs = []
  if (process.env.QZ_TEST_APP_DIR) dirs.push(process.env.QZ_TEST_APP_DIR)
  dirs.push(path.resolve('release', 'app'), path.resolve('release'), path.resolve('local-fork', 'dist'))

  const candidates = []
  if (explicit) candidates.push(explicit)
  if (process.env.QZ_VERIFY_EXE) candidates.push(process.env.QZ_VERIFY_EXE)
  for (const dir of dirs) candidates.push(...variants(dir))

  const found = candidates.find((p) => p && existsSync(p))
  if (found) return found

  throw new Error(
    [
      '找不到桌面程序。请任选一种方式指定：',
      '  1) node scripts/verify-xxx.mjs --exe "<可执行文件路径>"',
      '  2) 设置环境变量 QZ_VERIFY_EXE',
      '  3) 设置 QZ_TEST_APP_DIR 指向包含程序的目录',
      `当前平台：${process.platform}；已尝试：`,
      ...candidates.map((p) => `  - ${p}`),
    ].join('\n'),
  )
}
