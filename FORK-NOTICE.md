# Qwerty Learner — dsh 非官方分支声明（Fork Notice）

> **本仓库是 Qwerty Learner 的非官方分支（non-official fork），由 dsh 维护。**
> 本分支与上游项目及其作者、维护者**没有隶属、委托、赞助或背书关系**，不代表上游官方立场，也不保证与上游最新代码一致。上游项目名称、版权与商标归其原作者及贡献者所有。

- Fork 仓库：<https://github.com/menlieyijin/qwerty-learner>
- 上游仓库：<https://github.com/RealKai42/qwerty-learner>
- 本分支：`dsh-local-v8`
- 上游基线：commit `1182426f2bd0a28c95302c33f9e19136b1262a70`
- 许可证：**GNU GPL v3.0**（与上游一致，见根目录 `LICENSE`）

详细技术说明见 [`docs/DSH-FORK.md`](docs/DSH-FORK.md)（英文精简版 [`docs/DSH-FORK_EN.md`](docs/DSH-FORK_EN.md)），版本里程碑见 [`docs/RELEASE-NOTES-v9.9.md`](docs/RELEASE-NOTES-v9.9.md)。

## 目录

1. [上游来源与基线](#1-上游来源与基线)
2. [版权与许可证](#2-版权与许可证)
3. [修改者与提交规范](#3-修改者与提交规范)
4. [相对上游的主要改动](#4-相对上游的主要改动)
5. [上游冻结策略](#5-上游冻结策略)
6. [构建与运行](#6-构建与运行)
7. [已知限制与免责声明](#7-已知限制与免责声明)
8. [反馈渠道](#8-反馈渠道)
9. [文档索引](#9-文档索引)
10. [致谢](#10-致谢)

---

## 1. 上游来源与基线

| 项 | 内容 |
| --- | --- |
| 上游项目 | Qwerty Learner — <https://github.com/RealKai42/qwerty-learner> |
| 上游基线 commit | `1182426f2bd0a28c95302c33f9e19136b1262a70`（上游 `master`） |
| 上游作者 / 版权 | 归上游作者及贡献者所有（见 `LICENSE`，GPL-3.0） |
| 上游在线站点 | <https://qwerty.kaiyi.cool/>（本分支不部署、不运营该站点） |
| 本分支仓库 | <https://github.com/menlieyijin/qwerty-learner>（GitHub fork） |
| 本分支名称 | `dsh-local-v8` |
| 相对上游的提交 | 21 个（`git log --oneline origin/master..dsh-local-v8` 可复核） |
| 里程碑 tag | `v7.1-dsh-local`、`v8.9-dsh-local`、`v9.0-dsh-local`、`v9.2-dsh-local`、`v9.3-dsh-local`、`v9.5-dsh-local`、`v9.6-dsh-local`、`v9.7-dsh-local`、`v9.8-dsh-local`、`v9.9-dsh-local` |

说明：

- 本分支从上游基线 `1182426` 分出，**没有** merge / rebase 上游后续提交，因此基线之后的官方新功能与修复默认不在本分支内。
- v9.1 与 v9.2、v9.4 与 v9.5 分别合并在同一提交中完成，因此没有单独的 `v9.1` / `v9.4` tag；功能仍包含在对应提交里。
- 本分支是"从上游源码自建"的桌面增强版本，只保留上游的网页源码结构；桌面外壳（`local-fork/electron/`）为本分支自行添加。

## 2. 版权与许可证

- 上游 Qwerty Learner 使用 **GNU GPL v3.0**。本分支是其衍生作品，因此整体同样按 **GPL-3.0** 分发。
- 根目录 `LICENSE` 原样保留，未删除、替换或改写任何上游版权声明与作者署名。
- 本分支的修改也受 GPL-3.0 约束。再分发本分支（包括修改后的 `app.asar`、安装包、二次修改版本）时，必须：
  1. 随附完整对应源码（含本分支的修改），或按 GPL-3.0 提供源码的等效方式；
  2. 保留 `LICENSE` 与全部版权声明；
  3. 明确标注本分支相对上游做了修改（本文件即该声明）。
- 构建脚本 `scripts/dsh-release.ps1` 在组装 `app.asar` 时会把 `LICENSE` 与 `FORK-NOTICE.md` 一并打包进 asar，便于二进制分发时随附许可与修改声明。
- 上游作者与贡献者的署名方式保持不变；本分支不冒用、不替换上游身份。
- 本分支新增代码的著作权归其各自作者所有（本分支修改主要由 dsh 完成，见下一节）。

## 3. 修改者与提交规范

| 项 | 内容 |
| --- | --- |
| 修改者 | **dsh（DeepSeek Harness）** |
| 提交作者 / 署名 | `dsh <dsh@dsh.local>`；**部分提交**带 `Signed-off-by: dsh <dsh@dsh.local>`（v9.3 起的 6 个提交为 git 可识别的正式 trailer；更早提交在提交说明中署名 dsh） |
| 本地修改时间 | 2026-10-21 ~ 2026-10-27（本分支 git 提交日期 2026-10-25 ~ 2026-10-27） |
| 本地版本迭代 | v1 ~ v9.9 |
| 当前应用版本 | `1.0.0-enhanced-v9.9`（唯一来源：`local-fork/package.json`） |

约定：

- 本分支修改全部以 `dsh` 身份提交，**不冒用上游作者身份**，也不把本地魔改混入上游提交历史。
- 对上游的贡献仅限于**与本分支无关的通用 bug 最小修复**：独立 patch / PR，署名 `dsh`，带 `Signed-off-by`，不夹带任何本地专属功能。
- 本分支的功能问题、体验建议请反馈到本 fork 的 Issues，而不是要求上游处理（见第 8 节）。

## 4. 相对上游的主要改动

> 以下只列改动方向与对应代码位置；精确行为以源码为准，完整说明与规则表见 [`docs/DSH-FORK.md`](docs/DSH-FORK.md)。

### 4.1 记忆曲线 / SRS 调度

- 代码：`src/utils/memoryLadder.ts`、`src/utils/srsRules.ts`、`src/utils/memory.ts`、`src/utils/db/index.ts`
- 使用 12 档艾宾浩斯阶梯：10 分钟 → 30 分钟 → 12 小时 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天 → 60 天 → 120 天 → 240 天；新词首次答对进入 1 天档。
- 答错采用分级降档（成熟词 1 次手滑只降 2 档，≥2 次回 0 档重学）；单次作答 > 6 秒记慢词；≥1 天的间隔按本地自然日 00:00 到期；对"记录时间戳在未来"的时钟回拨做保守校正。
- 新增 `memoryRecords` 表（Dexie v4）承载 SRS 记录；上游 `wordRecords` / `chapterRecords` / `reviewRecords` 结构与用途保留，不破坏旧数据。

### 4.2 动态出词（无章节主流程）

- 代码：`src/pages/Typing/hooks/useWordList.ts`、`src/utils/memory.ts`、`src/utils/sessionRequeue.ts`
- 不预生成整章词表：每答完一个词，按最新记忆数据实时选取下一个词；到期词优先，未到期词按概率随机回顾。
- 新词比例与回顾概率随到期词数量动态调整（见 `autoLevel.getNewRatio` / `getRefreshChance`）；不设每日新词硬上限。
- 到期池按 `memoryKey` 去重；"是否学过"按单词跨词库去重；最近 12 个词不重复出现。
- 本次会话答错的词隔 3 个其他词重现（同词最多 2 次），并标注"再练一次"；随机回顾标注"随机回顾"。

### 4.3 自动进阶

- 代码：`src/utils/autoLevel.ts`、`src/utils/learningPath.ts`
- 13 级学习路径：小学一年级 → 初中 → 高中必修 → 高频基础词 → 大学四级 → 大学六级；练习时无需手动选章节。
- 级别状态持久化在 `localStorage` 键 `qzAutoLevelState`，只升不回退；显式"重新评估级别"是唯一允许回退的入口。
- 升级判据：本级 required（总量 − 已挂起）**已见 100% 且掌握率 ≥ 90%**；"掌握"要求答对 ≥2 次、档位 ≥2 且最近一次不是答错。
- Skip 累计 3 次自动挂起为"待攻克"，不阻塞升级；连续遗忘（lapses ≥ 4）也会自动挂起；词库加载失败不判完成、不推进级别。

### 4.4 本地数据表与迁移

- `memoryRecords` 为新增表；`memoryKey` 为 `${dict}::${word}`（v9.5 起保留大小写），并保留旧 key（`trim + lower`）读写兼容与一次性迁移。
- 数据库导入改为"临时库 + 行数校验 + 主库单事务"的原子流程；v9.9 起启动时清理"导入中途被强杀"残留的临时库。
- 每日自动备份同时写逻辑快照 `data.json`（RecordDB 全表 + 自定义词库 + localStorage + 外壳设置），另有全量 JSON 导出/导入；细节见 [`docs/Backup-Restore.md`](docs/Backup-Restore.md)。

### 4.5 Electron 增强外壳

- 代码：`local-fork/electron/`（`main.js` / `preload.js` / 注入式增强 UI / 剪贴板小窗）。
- 托盘、全局快捷键、迷你模式、窗口置顶、透明度/缩放、开机自启、关闭到托盘、每日自动备份、日志轮转与脱敏。
- 剪贴板查词小窗、免 Key 释义/翻译（本地词库优先，在线接口可关）、发音缓存（`qzcache` 协议，仅放行有道 `dictvoice` 音频）、词库在线更新、注入式"工具"面板。
- 主进程/预加载与网页源码一起打包为 `app.asar`；不修改 `build/` 产物本身。

### 4.6 去营销 UI

- 移除与学习无关的捐赠/推广/作者推荐卡片、移动端营销落地页与 `/mobile` 路由、`gtag`/GA 脚本、GitHub Pages 重定向、SEO/OG/官网外链、分享图水印等。
- 保留分享成绩、数据导出、词库请求和全部学习功能。

### 4.7 构建、回滚与质量门禁

- `scripts/dsh-release.ps1`：tsc → 核心算法回归 → Vite build → 组装 staging + asar → `SHA256SUMS` / `release-info.json` → 可选测试安装 + 隔离 profile CDP 冒烟 → 可选正式安装（双目录哈希预检 → 备份 → 原子替换 → 校验 → 安装日志）。
- `scripts/dsh-rollback.ps1`：列出备份、自动选择"与当前版本不同的最近备份"、回滚前自动存 redo 点。
- `scripts/quality-gate.ps1`：`tsc --noEmit` + `eslint --max-warnings 0`；`-WithSim` 追加 SRS/自动进阶回归，`-WithSmoke` 追加 CDP 冒烟。
- `scripts/dsh-smoke.mjs`：11 项 CDP 冒烟（版本、页面、开始、面板、数据、练习、备份、统计、错题本、无异常等）。

### 4.8 测试与验收记录

- 静态门禁：`tsc --noEmit` 0 error、`eslint src --max-warnings 0` 0 error / 0 warning。
- 核心算法回归：作者本机 v9.9 交付记录为 **253/253**（120 条 SRS + 133 条自动进阶；v9.3 ~ v9.6 的旧口径为 248 条，v9.7 起增至 253 条）。
- Playwright 本地模式：12 passed / 5 skipped（跳过项为已下线的旧流程）。
- CDP 冒烟 11/11；外壳安全探针 19/19（v9.9 本机验收记录）。
- 上述数字来自作者本机审计产物；回归脚本与报告**未随本仓库发布**，公开仓库默认无法一键复现（见第 7 节）。

## 5. 上游冻结策略

> **本分支不 `git fetch` / `git pull` / `git rebase` 合并上游官方更新，也不升级项目依赖。**

原因：

1. 本分支对出词、调度、自动进阶、数据表、路由与 Electron 外壳做了较大改动，官方后续改动与本地魔改存在直接冲突风险；
2. 上游依赖（React/Vite/Dexie 等）升级需要完整回归，而本分支优先保证本地学习数据稳定；
3. 冻结基线便于溯源、复现与 GPL 合规说明。

例外与允许操作：

- 可继续把与本分支无关的通用 bug 最小修复单独提交上游（不夹带本地功能）；
- 如需吸收某个上游补丁，必须单独立项评估，逐条 cherry-pick 并完整回归，禁止整包合并；
- Electron 运行时升级属于单独决策，需用户确认并更新 [`docs/Electron-EOL.md`](docs/Electron-EOL.md)。

冻结的代价：本分支**不会自动获得**上游新功能、安全修复和依赖更新。请把它当作一个功能已定型的个人分支使用。

## 6. 构建与运行

### 6.1 网页源码开发（与上游同构）

环境：Node.js ≥ 18（作者构建环境 Node 24.19.0）、Yarn 1.x、Git。

```bash
git clone https://github.com/menlieyijin/qwerty-learner.git
cd qwerty-learner
git checkout dsh-local-v8
yarn install
yarn start     # Vite dev server，默认 http://localhost:5173/
yarn build     # 生产构建，输出 build/（等价 npm run build）
```

其他常用脚本：`npm run typecheck`、`npm run lint:strict`、`npm test`、`npm run test:e2e:local`、`npm run test:local`（CDP 冒烟，需先启动带调试端口的应用）。

### 6.2 桌面版构建与安装（Windows）

前置：Windows 10/11、PowerShell 5.1+ 或 PowerShell 7、Node.js；不需要在项目里安装 `electron` 依赖（运行时使用官方预构建二进制）。

```powershell
# 构建 + 打包（输出 app.asar / SHA256SUMS / release-info.json）
pwsh -File scripts/dsh-release.ps1

# 构建 + 测试安装 + 隔离 profile CDP 冒烟
pwsh -File scripts/dsh-release.ps1 -TestInstall -Smoke

# 构建 + 正式安装（备份 → 原子替换 → 校验 → 安装日志）
pwsh -File scripts/dsh-release.ps1 -Install

# 回滚
pwsh -File scripts/dsh-rollback.ps1 -List
pwsh -File scripts/dsh-rollback.ps1
```

注意：

- 脚本内置的 staging / 备份 / 审计 / 测试安装 / 正式安装目录默认值来自作者本机布局，**在其他机器上必须先覆盖**：使用参数 `-StageRoot`、`-BackupDir`、`-AuditRoot`、`-TestAppDir`、`-InstallDirs`。
- `-SkipCheck` 跳过 tsc，`-SkipAudit` 跳过核心回归，`-SkipBuild` 复用现有 `build/`。
- Electron 运行时不在本仓库构建；升级运行时需要单独下载官方二进制、用 rcedit 做品牌化并替换，步骤与风险见 [`docs/Electron-EOL.md`](docs/Electron-EOL.md)。
- 发布脚本会把 `LICENSE` 与 `FORK-NOTICE.md` 复制到安装目录并打包进 asar。

## 7. 已知限制与免责声明

1. **非官方分支**：本分支不受上游项目支持；上游不会处理本分支的专属问题，上游的修复也不会自动进入本分支。
2. **仅 Windows 实测**：桌面外壳只在 Windows 11（26100）上验证；未经 macOS / Linux 验证，Electron 外壳为 Windows 定制。网页部分理论上可跨平台运行。
3. **回归脚本未随仓库发布**：SRS / 自动进阶的仿真脚本、审计报告与 248/253 断言结果位于作者本机的独立审计目录，不在本仓库内；在干净 clone 上 `quality-gate.ps1 -WithSim` 会跳过缺失脚本。文档中的断言数量与通过结论是作者本机验收记录，不是公开可复现的 CI 结果。
4. **Electron 运行时 EOL**：当前为 Electron 43.8.3（Chromium 150.0.7871.250），43.x 官方支持至 2027-01-05；到期前需要升级运行时。运行时升级是手工步骤（含 rcedit 品牌化），不在发布脚本流水线内。
5. **版本元数据可能滞后**：应用内版本以 `local-fork/package.json` 为唯一来源；安装程序 exe 的文件版本元数据在运行时升级时才更新，可能与应用内版本不完全一致（当前 FileVersion 为 9.8.0.0，应用版本为 v9.9）。
6. **无代码签名**：本分支不提供代码签名的安装包，Windows SmartScreen 可能提示"未知发布者"。
7. **词库与数据版权**：内置词库及释义数据版权归上游及原始数据来源（如 kajweb 等）所有；本分支补回的 5 本旧版词库（AWL / NAWL / NGSL / google-10000 / google-20000）在当前上游仓库中已不存在（2026-10-27 经 GitHub contents API 核实 `master` / `dev` / `gh-pages` 均为 404），来自旧版本地构建，逐本来源与许可见 [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md)。使用者应自行确认所在地区与用途的合规性。
8. **无每日新词硬上限**：出词按到期量和动态比例调节，不设强制每日上限；一次可能引入较多新词。设置里的每日目标用于统计与提醒，不是硬限制。
9. **遥测**：桌面版默认不初始化 Mixpanel / Vercel Analytics，只有用户显式设置 `localStorage['qzTelemetryOptIn'] = '1'`（或控制台 `qzTelemetry.optIn()`）才开启；开启后会复用上游代码中的第三方统计配置。网页构建仍沿用上游的统计行为（v9.8 已从 `index.html` 移除 gtag/GA 脚本）。
10. **备份一致性**：自动备份的"目录副本"是在应用运行期间复制的，LevelDB 可能处于写入中；跨设备恢复请优先使用"导出全量数据 JSON"或备份中的 `data.json`（见 `docs/Backup-Restore.md`）。
11. **第三方在线能力**：在线释义/翻译、发音音频等依赖第三方服务，可能受网络、服务可用性与隐私政策影响；可在设置中关闭在线释义。
12. **不保证反向兼容**：不承诺从上游未来版本迁移数据，也不承诺旧版本应用能读取新版本导出的数据（导入方版本应 ≥ 导出方）。

**免责声明**：本分支按"现状"提供，不附带任何明示或暗示担保（包括但不限于适销性、特定用途适用性与不侵权）。使用本分支造成的数据丢失、学习记录异常或其他损失，由使用者自行承担；请注意自行备份。GPL-3.0 中的免责条款同样适用。

## 8. 反馈渠道

- **本分支问题**（功能、数据、构建、Electron 外壳）：请在 <https://github.com/menlieyijin/qwerty-learner/issues> 提交，附上：
  - 应用版本（`工具 → 关于` 或 `local-fork/package.json` 的 `version`）与操作系统版本；
  - 复现步骤、期望/实际结果；
  - 相关日志片段（不要粘贴学习数据、路径中的个人信息或任何密钥）。
- **上游通用 bug**：如果问题在上游 `1182426` 基线上同样可复现，也可以报给上游仓库；但请先说明本分支相对上游的改动，避免误导上游维护者。
- **安全敏感问题**：不要在公开 Issue 中直接贴完整利用细节；先提交不含利用代码的 Issue 请求私下沟通。本分支为个人维护，不承诺安全响应时限。
- 反馈前请先看第 7 节"已知限制"，许多问题属于冻结上游 / 依赖外部服务 / 未随仓库发布回归脚本的已知边界。

## 9. 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/DSH-FORK.md`](docs/DSH-FORK.md) | 本分支详细技术文档：功能差异、架构、核心算法、构建、数据迁移、安全设计、测试、限制 |
| [`docs/DSH-FORK_EN.md`](docs/DSH-FORK_EN.md) | English concise version of the fork documentation |
| [`docs/RELEASE-NOTES-v9.9.md`](docs/RELEASE-NOTES-v9.9.md) | v8.9 → v9.9 里程碑与首次公开说明 |
| [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md) | 第三方组件与数据来源/许可披露（内置词库、补回词表、图标、截图、Electron 运行时、在线服务） |
| [`docs/Backup-Restore.md`](docs/Backup-Restore.md) | 备份 / 导出 / 跨设备恢复说明 |
| [`docs/Electron-EOL.md`](docs/Electron-EOL.md) | Electron 运行时版本、EOL 与升级步骤 |
| [`README.md`](README.md) | 上游原始 README（本分支仅在顶部加了非官方分支提示） |

## 10. 致谢

- 感谢 **RealKai42** 与 Qwerty Learner 全体贡献者：上游的设计思想、词库体系、练习与统计实现是本分支的基础。
- 感谢上游词库与数据来源（kajweb、社区词库贡献者等）以及发音/释义相关第三方服务。
- 感谢 Electron、Chromium、React、Vite、Dexie、Tailwind CSS 等开源项目。
- 本分支的开发、审计与文档工作使用了 **DeepSeek Harness（dsh）** 工具链；徽章仅作工具署名，见下。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

> 该徽章表示本分支在开发/文档过程中使用了 DeepSeek Harness 工具，**不**表示 DeepSeek 官方对本分支的认证、背书或隶属关系。
