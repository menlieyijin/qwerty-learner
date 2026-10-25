# 本地增强外壳（Electron，dsh）

Qwerty Learner 本地魔改版的 Electron 外壳源码：主进程（托盘/快捷键/备份/免费释义/发音缓存等）、preload 白名单、注入式增强 UI（顶栏「工具」全屏页）。

本目录与仓库根目录的网页源码（Vite 工程）一起构成完整程序。**上游版本冻结，不跟随官方更新。**

## 目录

- `package.json` — asar 根 package.json（`main: electron/main.js`，版本 `1.0.0-enhanced-v8`）
- `electron/main.js` — 主进程（窗口/托盘/快捷键/单实例/备份/词库/发音缓存/免费接口等 IPC）
- `electron/preload.js` — contextBridge 白名单 API
- `electron/enhance/` — 注入的增强 UI（enhance.js/css、剪贴板查词窗、词库映射表）

## 构建与安装（当前手工流程）

1. 仓库根目录：`npm run build`（Vite，`outDir=build`）
2. 组装 asar 根目录：`package.json` + `electron/` + `build/`（网页产物与 385 本词库）
3. 打包：`npx --yes @electron/asar pack <组装目录> <输出>.asar`
4. 退出应用后替换：`<安装目录>\resources\app.asar`
5. 启动验证；保留上一版 asar 以便回滚

> 当前打包工作区为 `D:\整理\QwertyPackV7`（`electron/` 与本目录保持同步、`build/` 由 Vite 产物同步）。
> 后续会改为同一脚本从本目录组装，避免双份文件漂移。

## 维护约定

- 所有本地修改由 **dsh（DeepSeek Harness）** 完成并署名；原始版权归上游作者（GPL-3.0，见根目录 `LICENSE` / `FORK-NOTICE.md`）。
- 不 `fetch` / `pull` / `rebase` 官方仓库，不升级依赖，避免与本地魔改冲突。
