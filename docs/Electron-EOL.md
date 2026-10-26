# Electron 运行时与 EOL 说明（dsh 维护）

## 现状

| 项 | 值 |
| --- | --- |
| Electron 运行时 | **43.4.0**（Chromium 150），随安装包 `Qwerty Learner.exe` 预置 |
| 项目内是否有 electron 依赖 | 否（本地 fork 冻结上游，不升级依赖；exe 为上游发布的预构建安装器） |
| 官方支持策略 | 仅维护最新 3 个大版本（Electron 官方 timelines） |
| 43.x 最新补丁 | 43.8.3（2026-10 查询） |
| **43.x EOL** | **2027-01-05**（46 发布后 43 退出支持） |
| 参考 | <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>、<https://endoflife.date/electron> |

> 查询时间 2026-10-26。日期以官方页面为准，建议每季度复核一次。

## 结论：本轮不升级运行时

升级 Electron 不是改 `app.asar`：exe / DLL / Chromium 全在安装器里，需要 **Electron 官方分发包 + electron-builder 重打包**，并且要重新验证托盘、全局快捷键、迷你模式、剪贴板小窗、自定义协议、字体渲染等。风险高、收益低（当前 43.4.0 仍在支持窗口内），因此：

- v9.2 只做**版本号单一来源、构建/冒烟门禁、GPL 材料**，不动运行时；
- v9.3/v9.4 仍未升级运行时（v9.4 为全栈审计/外壳安全加固：CSP、下载白名单、剪贴板转义、测试钩子门控、日志脱敏）；
- 2026-12 前做一次评估：优先升级到 **43.8.3**（同大版本补丁，风险最低）；
- 2027-01-05 之前若仍未升级，需要接受"不再收到安全补丁"的风险（本应用离线个人使用，风险可控）。

## 升级演练清单（未来执行）

1. 获取 Electron 43.8.3（或 44/45）官方 `electron-v43.8.3-win32-x64.zip`；
2. 用 electron-builder / 手工替换 `Qwerty Learner.exe` 与 DLL，保持 `resources/app.asar` 不变；
3. 冒烟：启动 → 练习 3 词 → 打开面板 5 tab → 迷你模式 → 托盘 → 快捷键 → 剪贴板查词 → 发音缓存；
4. 回归 `scripts/dsh-smoke.mjs`；双目录安装并留旧 asar/旧 exe 回滚点；
5. 更新本文件与 CHANGELOG。

## 其他运行时约束

- 本地 Node：v24.19.0（构建用）；CI 曾用 18.17，建议统一到 24（`.nvmrc` 可选）。
- 构建：`npm run build`（Vite 4）+ `npx @electron/asar pack`，已由 `scripts/dsh-release.ps1` 串联。
- 安装包 exe 的 ProductVersion 仍是上游 `0.1.0`，无法在 asar 层修改；应用内版本以 `package.json` 为准，面板/关于页/API 均已统一读取。
