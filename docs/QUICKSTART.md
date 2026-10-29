# 快速开始（Quickstart）

本仓库是 Qwerty Learner 的**非官方分支**（见根目录 `FORK-NOTICE.md`）。下面是从零跑起来的**最少命令**，
以及克隆后最容易踩的几个坑。桌面端（Electron）的打包与安装见文末。

> 包管理器统一为 **npm**。仓库只保留 `package-lock.json` 一份锁文件（`yarn.lock` 已移除，避免两份锁漂移）。

## 1. 环境要求

| 项 | 要求 | 校验 |
| --- | --- | --- |
| Node.js | **18 ~ 22**（推荐 20 LTS） | `node -v` |
| npm | **≥ 9**（随 Node 安装） | `npm -v` |
| 磁盘 | 约 300 MB（依赖 + 构建产物） | — |

版本约束写在 `package.json` 的 `engines`，`.nvmrc` 为 `20`（`nvm use` 可直接切换）。
Node ≥ 23 目前未验证，npm 会打印 `EBADENGINE` 警告；**Warning 不影响安装**，但请勿用它提 issue。

## 2. 开发（2 条命令）

```bash
npm ci
npm run dev
```

打开终端提示的地址（默认 <http://localhost:5173>）。

- `npm ci` 严格按 `package-lock.json` 安装，可复现；**不要**用 `npm install` 代替（它会改写锁文件）。
- 首次安装会触发 `prepare` 脚本执行 `husky install`；在非 git 目录里该步骤可能报错，不影响运行。

## 3. 生产构建（2 条命令）

```bash
npm ci
npm run build
```

产物在 `build/`（`vite build --base=./`，相对路径）。**没有内置 preview 命令**，用任意静态服务器托管即可：

```bash
npx --yes serve build        # 或 python -m http.server 8080 -d build
```

> 必须通过 HTTP 打开：直接双击 `build/index.html` 走 `file://`，`fetch('./dicts/...')` 会被浏览器的同源策略拦下，
> 表现为「词库加载失败 / 一直加载中」。桌面端由 Electron 主进程注册协议解决，浏览器不行。

## 4. 质量门禁

```bash
npm run test:quality     # tsc --noEmit + eslint src --max-warnings 0
npm run test:local       # CDP 冒烟（需先按第 5 节启动带调试端口的实例）
```

- `npm run test:quality` 是提交前的最低门槛，CI（`.github/workflows/quality.yml`）跑的是同一组命令。
- `npm run test:local` 通过 Chrome DevTools Protocol 连到已运行的应用做 11 项检查；连不上时退出码为 2（不是失败）。

## 5. 桌面端（Electron）打包与安装

桌面端源码在 `local-fork/`，版本号唯一来源是 `local-fork/package.json` 的 `version`。
脚本需要 Windows PowerShell 5.1 或 PowerShell 7。

```powershell
# 只构建 + 打包（产出 app.asar / SHA256SUMS / release-info.json，不安装）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1

# 构建 + 安装到测试目录 + 隔离 profile 冒烟
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -TestInstall -Smoke

# 构建 + 安装到两个正式目录（先备份、原子替换、失败回滚、写安装日志）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -Install

# 回滚到上一个版本（回滚前会先存一个 redo 点）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-rollback.ps1 -List
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-rollback.ps1
```

### ⚠️ 脚本默认路径是作者本机布局

`scripts/dsh-release.ps1`、`dsh-rollback.ps1`、`quality-gate.ps1` 的内置默认值指向作者机器的目录
（`D:\整理\...`、`D:\bangong\...`）。**在别人的机器上直接跑会写错位置**，请用环境变量覆盖：

| 变量 | 含义 | 建议值 |
| --- | --- | --- |
| `QZ_STAGE_ROOT` | 打包暂存目录 | `%LOCALAPPDATA%\QwertyLearner\release` |
| `QZ_BACKUP_DIR` | asar 备份目录 | `%LOCALAPPDATA%\QwertyLearner\backup` |
| `QZ_AUDIT_DIR` | 回归/审计输出目录 | `%LOCALAPPDATA%\QwertyLearner\audit` |
| `QZ_TEST_APP_DIR` | 测试安装目录 | `%LOCALAPPDATA%\QwertyLearner\app` |
| `QZ_INSTALL_DIRS` | 正式安装目录（分号分隔多个） | 你的实际安装路径 |

也可以直接用显式参数：`-StageRoot`、`-BackupDir`、`-TestAppDir`、`-InstallDirs`（优先级：参数 > 环境变量 > 内置默认）。

## 6. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `npm ci` 报 `EBADENGINE` | Node 版本超出 `>=18 <23`；用 `nvm use 20` 切回 |
| `npm ci` 报 `EUSAGE: lock file does not satisfy` | 有人手改过 `package.json` 依赖但没更新锁；跑一次 `npm install --package-lock-only` 后提交锁文件 |
| `husky install` 失败（`.git can't be found`） | 在非 git 目录安装依赖；忽略即可 |
| 页面一直「加载中」 | 用了 `file://` 打开，见第 3 节 |
| PowerShell 拒绝执行脚本 | `Set-ExecutionPolicy -Scope Process Bypass`（仅当前会话） |
| 桌面端安装后仍是旧版本 | 关闭正在运行的实例再装；`dsh-rollback.ps1` 会自动选「与当前版本不同的最近备份」 |
| 词库更新/在线释义失败 | 二者都需要联网；在线释义可在设置中关闭（`FORK-NOTICE.md §6.9` 有域名与数据披露） |

## 7. 相关文档

- `README.md` — 本项目概览与相对上游的改动
- `FORK-NOTICE.md` — 分支声明、GPL 义务、隐私与联网披露
- `docs/DSH-FORK.md` — 技术实现细节（自动进阶、SRS、桌面端增强）
- `docs/AUDIT-CLOSE.md` — 发布前审计的逐条闭环记录
- `docs/THIRD-PARTY.md` — 词库与图标来源、许可
