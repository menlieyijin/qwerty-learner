# 本地增强外壳（Electron，dsh）

Qwerty Learner 本地魔改版的 Electron 外壳源码：主进程（托盘/快捷键/备份/免费释义/发音缓存等）、preload 白名单、注入式增强 UI（顶栏「工具」全屏页）。

本目录与仓库根目录的网页源码（Vite 工程）一起构成完整程序。**上游版本冻结，不跟随官方更新。**

## 目录

- `package.json` — asar 根 package.json（`main: electron/main.js`，**版本号唯一来源**：`1.0.0-enhanced-v9.6`）
- `electron/main.js` — 主进程（窗口/托盘/快捷键/单实例/备份/词库/发音缓存/免费接口/安全守卫等 IPC）
- `electron/preload.js` — contextBridge 白名单 API（版本号通过 `app:version-sync` 同步 IPC 获取）
- `electron/enhance/` — 注入的增强 UI（enhance.js/css、剪贴板查词窗、词库映射表）

## 构建与安装（v9.4 起脚本强化）

```powershell
# 只构建 + 打包（产出 app.asar / SHA256SUMS / release-info.json）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1

# 本地质量门禁（tsc + eslint --max-warnings 0；-WithSim 追加 248 断言；-WithSmoke 追加冒烟）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\quality-gate.ps1 -WithSim

# 构建 + 测试安装 + 隔离 profile CDP 冒烟（默认先跑 tsc + 248 条核心回归）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -TestInstall -Smoke

# 构建 + 正式安装（预检双目录哈希一致 → 备份（精确到秒）→ 原子替换 → 校验 → 写安装日志）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -Install

# 回滚（自动选“与当前版本不同的最近备份”，回滚前自动存 redo 点）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-rollback.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-rollback.ps1
```

> 本机只有 Windows PowerShell 5.1（无 `pwsh`），脚本保存为 UTF-8 BOM 以兼容 PS5；若使用 PowerShell 7，`pwsh -File` 等价。
> `-SkipCheck` 跳过 tsc、`-SkipAudit` 跳过 248 条核心回归、`-SkipBuild` 复用现有 `build/`。
> 发版只需改本目录 `package.json` 的 `version`：主进程读取 package.json；preload 通过 `app:version-sync` 获取；注入的增强面板用主进程传入的 `window.__QZ_VERSION__`。
> 旧的打包工作区 `D:\整理\QwertyPackV7` 仍保留但不再手工同步（脚本直接从本目录组装）。
> Electron 运行时版本与 EOL 见 `docs/Electron-EOL.md`。

## 维护约定

- 所有本地修改由 **dsh（DeepSeek Harness）** 完成并署名；原始版权归上游作者（GPL-3.0，见根目录 `LICENSE` / `FORK-NOTICE.md`）。
- 不 `fetch` / `pull` / `rebase` 官方仓库，不升级依赖，避免与本地魔改冲突。
