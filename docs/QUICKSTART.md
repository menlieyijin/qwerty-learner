# 快速开始（面向其他人克隆本仓库）

本仓库是 Qwerty Learner 的 dsh 非官方分支。下面是**从零到跑起来**的最少步骤。

## 0. 环境（唯一硬要求）

| 项 | 版本 | 检查命令 |
| --- | --- | --- |
| Node.js | 18.x 或 20.x（`engines` 已锁 `>=18 <23`，`.nvmrc`=20） | `node -v` |
| yarn | 1.22+（仓库有 `yarn.lock`） | `yarn -v` |

> 没有 Node？用 [nvm](https://github.com/nvm-sh/nvm) 或 [nvm-windows](https://github.com/coreybutler/nvm-windows)：`nvm install 20 && nvm use 20`。

## 1. 网页版：跑起来（2 条命令）

```bash
yarn install --frozen-lockfile   # 按 lockfile 安装，不升级依赖
yarn dev                         # http://localhost:5173
```

## 2. 网页版：构建（1 条命令）

```bash
yarn build                       # 静态产物在 build/
```

## 3. 桌面版（Electron，Windows）

```bash
yarn install --frozen-lockfile
yarn build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -Version 1.0.0-enhanced-local
```

- 脚本默认路径是作者本机布局，**其他人必须用环境变量覆盖**（或改脚本参数默认值）：

```powershell
$env:QZ_STAGE_ROOT='D:\qwerty\release'      # 产物目录
$env:QZ_BACKUP_DIR='D:\qwerty\backup'       # 回滚备份目录
$env:QZ_INSTALL_DIRS='D:\qwerty\app'        # 要替换 app.asar 的安装目录（分号分隔多个）
```

- 只想要 asar、不安装：加 `-TestInstall`（装到临时目录自检）或 `-SkipInstall`（仅打包）。
- 回滚：`scripts\dsh-rollback.ps1 -List` 看列表，`-AsarPath <文件>` 回滚；回滚前会自动备份当前版本。
- 冒烟：应用以 `--remote-debugging-port=9222` 启动后，`node scripts\dsh-smoke.mjs`（11 项检查）。

## 4. 常见问题

| 现象 | 处理 |
| --- | --- |
| `yarn install` 慢或失败 | `yarn config set registry https://registry.npmmirror.com`（`scripts/install.*` 已内置） |
| `yarn dev` 端口占用 | `yarn dev --port 5174` |
| 桌面冒烟 `NO_PAGE` | 个别机器 GPU 进程崩溃：启动加 `--disable-gpu --no-sandbox`，并清除 `NODE_OPTIONS` 与 `ELECTRON_RUN_AS_NODE` |
| 构建报 Node 版本错误 | 确认 `node -v` 在 18–22 之间（`engines` 会拦截） |
| 打包要联网 | 首次会通过 `npx` 下载固定版本 `@electron/asar@4.3.1`，之后走缓存 |

## 5. 目录速览

| 路径 | 作用 |
| --- | --- |
| `src/` | 前端源码（分层：`typings/constants → resources → utils → store → hooks → components → pages`） |
| `local-fork/electron/` | 桌面壳（主进程、preload、增强面板） |
| `public/dicts/` | 词库（385 本，体积主要来源） |
| `scripts/` | 发布 / 回滚 / 冒烟 / 质量门禁 |
| `docs/` | 技术文档、发布说明、审计闭环表 |
