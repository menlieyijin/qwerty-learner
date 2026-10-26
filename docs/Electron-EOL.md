# Electron 运行时与 EOL 说明（dsh 维护）

## 现状（2026-10-27 已升级）

| 项 | 值 |
| --- | --- |
| Electron 运行时 | **43.8.3**（Chromium **150.0.7871.250**），随安装目录 `Qwerty Learner.exe` 预置 |
| 上一运行时 | 43.4.0（Chromium 150.0.7871.224），旧文件已备份，可回滚 |
| 升级日期 | 2026-10-27（Batch6 / task-32，用户已批准） |
| 项目内是否有 electron 依赖 | 否（本地 fork 冻结上游，不改依赖；运行时来自官方预构建分发包，手工替换二进制） |
| 官方支持策略 | 仅维护最新 3 个大版本（Electron 官方 timelines） |
| **43.x EOL** | **2027-01-05**（46 发布后 43 退出支持；43.8.3 是 43.x 最新补丁） |
| 参考 | <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>、<https://endoflife.date/electron> |

> 查询/升级时间 2026-10-27。日期以官方页面为准，建议每季度复核一次；43.x EOL 前需评估升级到 44/45/46。

## 本次升级做法（可复现）

1. **下载**：`https://npmmirror.com/mirrors/electron/43.8.3/electron-v43.8.3-win32-x64.zip`
   - zip SHA256 = `98efbd2d1c7bd44150c0aa800cd9ac5fefcefd2d44fd94958a95d6744d86c6de`（与 `SHASUMS256.txt` 官方清单一致，已校验）
   - 解压到 `D:\整理\QwertyRelease\electron-43.8.3\`
2. **品牌化（关键）**：官方 zip 内是 `electron.exe`（Electron 品牌、图标/描述均为 Electron），直接改名会让任务栏/文件图标变成 Electron。用 **rcedit v2.0.0**（`rcedit-x64.exe`，sha256 `3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a`）写入：
   - `--set-icon public\icon.ico`（与旧 43.4 exe 图标一致：实测提取图标哈希 = `8B639E01…`，而未品牌化的 electron.exe 是 `74D479EE…`）
   - `ProductName` / `FileDescription` = `Qwerty Learner`
   - `CompanyName` = `Qwerty Learner Contributors`；`OriginalFilename` / `InternalName` = `Qwerty Learner(.exe)`
   - `FileVersion` = `9.8.0.0`；`ProductVersion` = `1.0.0-enhanced-v9.8`
   - 品牌化后 exe 仍可 `ELECTRON_RUN_AS_NODE=1` 运行并报告 `electron 43.8.3`（未损坏）
3. **备份 + 替换**：以「只换运行时二进制、不动 `resources/`（含 app.asar）与用户数据」为原则，用 `D:\整理\QwertyRelease\runtime-upgrade\upgrade-runtime.ps1` 对每个安装目录：
   - 备份**所有将被覆盖的旧运行时文件**（相对路径原样）到 `D:\整理\Qwerty备份\runtime-43.4.0-<stamp>[-<dir>]\`，并生成 `manifest.json`（每个文件相对路径 / 旧 SHA256 / 新 SHA256 / 旧大小 / 新大小）与 `ROLLBACK.txt`；
   - 替换 `electron.exe → Qwerty Learner.exe` 与 DLL / pak / `icudtl.dat` / `locales/` / `snapshot_blob.bin` / `v8_context_snapshot.bin` / `LICENSES.chromium.html` 等共 72 个文件（另新增 `version` 文件 = `43.8.3`）；
   - **不替换** `resources/`、仓库 GPL `LICENSE`、`FORK-NOTICE.md`、`LICENSE.electron.txt`（其内容与新版 zip 的 `LICENSE` 完全相同，sha256 `5154E165…`）。
4. **升级顺序**：先测试目录 `D:\整理\qtest9\app`（探针 + 冒烟通过），再正式双目录 `D:\bangong\QwertyLearner-Plus`、`D:\bangong\新建文件夹 (2)\Qwerty Learner`。

## 已验证项（2026-10-27）

对三个目录分别用**隔离 profile + 独立 CDP 端口**启动（未触碰用户数据），结果：

- `process.versions.electron = 43.8.3`、`chromium = 150.0.7871.250`；应用版本 `1.0.0-enhanced-v9.8`；
- `scripts/dsh-smoke.mjs` **11/11 全过**（版本/页面/开始/面板 5 tab/数据区/练习/备份/统计/错题本/无异常/无 console error）；
- 外壳安全探针 19/19：CSP（hash 方案生效、注入内联脚本被拦、内联脚本 dark-mode init 正常执行）、gtag/埋点未加载、剪贴板小窗仅 5 个最小 API、备份 IPC、迷你模式/置顶、托盘创建、全局快捷键注册（`registered=true`）、日志无 crash/uncaughtException/preload-error；
- `resources/app.asar` 升级前后 sha256 完全一致（`65CCFA78…`），`LICENSE` / `FORK-NOTICE.md` 未变；
- 三个目录 exe 升级后 sha256 一致（品牌化 exe `58C10EFB…`），VersionInfo = Qwerty Learner / 9.8.0.0 / 1.0.0-enhanced-v9.8。
- 顺带发现：第二正式目录升级前 `locales/` 只有 3 个 pak（en-US/zh-CN/zh-TW，运行时文件不完整，历史手工安装遗留）；本次升级后补全为 55 个（与第一目录一致）。

## 回滚方法（失败时）

每个被替换目录都有独立备份（见 `electron-runtime-upgrade.json` 的 `backups`）：

1. 完全退出应用：`Get-Process -Name 'Qwerty Learner' | Stop-Process -Force`；
2. 将对应备份目录下的所有文件按相对路径覆盖回安装目录：
   `Copy-Item '<备份目录>\*' '<安装目录>' -Recurse -Force`（不要动 `resources\` 与用户数据）；
3. 校验：`$env:ELECTRON_RUN_AS_NODE='1'; & '<安装目录>\Qwerty Learner.exe' -e "console.log(process.versions.electron)"` 期望回到 `43.4.0`；
4. 每个备份目录内还有 `manifest.json`（逐文件 SHA256）与 `ROLLBACK.txt`。

> 注意：回滚会恢复旧 exe（43.4.0，上游安装器的 Qwerty 品牌，FileVersion 0.1.0）与旧 DLL/pak；`resources/app.asar` 从来不参与替换，无需回滚。

## 未验证项 / 后续

- 未做长时间运行稳定性测试与大词库发音/在线更新等全功能回归（本轮只做启动 + 冒烟 + 外壳安全探针；冒烟覆盖练习/统计/错题本/备份）；
- 未验证 Windows 旧版本（Win10）兼容性（本机 Win11 26100）；Electron 43 官方支持 Win10+；
- 图标/版本元数据的视觉确认：已用图标提取哈希 + VersionInfo 程序化验证；**未**人工肉眼确认任务栏图标（可让用户看一眼任务栏/文件资源管理器）；
- rcedit 品牌化是手工步骤，**不是构建流水线的一部分**：未来升级运行时需重复步骤 2（命令见本文件；可后续并入发布脚本，但本轮按约束未改 `scripts/`）；
- 43.x 于 2027-01-05 EOL：到期前需评估升级 44/45/46（升级时同样需要 rcedit 品牌化 + 全部回归）。

## 其他运行时约束

- 本地 Node：v24.19.0（构建用）；构建：`npm run build`（Vite 4）+ `npx @electron/asar pack`，已由 `scripts/dsh-release.ps1` 串联。
- 安装包 exe 的版本元数据**不再固定为上游 0.1.0**：自 43.8.3 起由 rcedit 写入 `FileVersion 9.8.0.0 / ProductVersion 1.0.0-enhanced-v9.8`；应用内版本仍以 `local-fork/package.json` 为唯一来源。
- 运行时时区/语言：`locales/` 完整 55 个 pak（含 zh-CN/zh-TW/en-US）。
