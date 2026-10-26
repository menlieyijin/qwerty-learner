# Release Notes — v9.9（首次公开版本）

| 项 | 值 |
| --- | --- |
| 应用版本 | `1.0.0-enhanced-v9.9` |
| 分支 | `dsh-local-v8` |
| Tag | `v9.9-dsh-local` |
| 仓库 | [menlieyijin/qwerty-learner](https://github.com/menlieyijin/qwerty-learner)（非官方分支） |
| 上游基线 | `RealKai42/qwerty-learner` @ `1182426f2bd0a28c95302c33f9e19136b1262a70` |
| 许可证 | GNU GPL v3.0（见根目录 `LICENSE`） |
| 发布日期 | 2026-10-27 |
| 作者署名 | `dsh <dsh@dsh.local>` |

> 这是本分支的**首次公开发布**，也是 v8.9 → v9.9 一轮工程收尾的终点。分支声明、GPL 合规与免责声明以 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 为准，技术细节见 [`DSH-FORK.md`](DSH-FORK.md)。

## 1. 首次开源发布说明

### 1.1 本次公开了什么

- 完整源码：上游基线 `1182426` + 本分支 21 个提交（含网页源码修改、Electron 外壳源码、构建/回滚/门禁脚本、文档与测试）。
- 分支声明与合规材料：`FORK-NOTICE.md`（非官方声明、GPL-3.0、修改说明、已知限制）；根目录 `LICENSE` 原样保留。
- 技术文档：`docs/DSH-FORK.md`（中文详细版）、`docs/DSH-FORK_EN.md`（英文精简版）、`docs/Backup-Restore.md`、`docs/Electron-EOL.md`。
- 测试：`tests/e2e/`（Playwright）与 CDP 冒烟脚本 `scripts/dsh-smoke.mjs`。

### 1.2 本次没有公开什么

- **不发布预编译安装包 / `app.asar`**：本分支只公开源码，不提供可直接运行的二进制包；请按第 4 节从源码构建。
- **不包含核心算法仿真脚本与审计报告**：SRS / 自动进阶的 253 条断言脚本及其报告位于作者本机独立审计目录，未随仓库发布（因此干净 clone 无法一键复现该门禁，详见 `FORK-NOTICE.md` 第 7 节）。
- **不包含 Electron 运行时**：运行时是官方预构建二进制，仓库只产出 `app.asar`；升级/品牌化步骤见 `docs/Electron-EOL.md`。
- **不提供云服务**：无账号、云同步、在线词库市场；学习数据默认留在本机。

### 1.3 合规与署名

- 本分支作为上游衍生作品按 **GPL-3.0** 分发；`LICENSE` 与全部上游版权声明保持不变。
- 修改说明：`FORK-NOTICE.md` + 本文档 + git 提交历史（全部 21 个提交的作者为 `dsh <dsh@dsh.local>`；其中 v9.3 起的 6 个提交带正式 `Signed-off-by` trailer，更早提交在说明中署名 dsh）。
- 构建脚本会把 `LICENSE` 与 `FORK-NOTICE.md` 打包进 `app.asar`，二进制分发时可随附许可与修改声明。
- 不冒用上游身份；对上游只提交与本分支无关的通用 bug 最小修复（独立 patch，署名 dsh，带 `Signed-off-by`）。

## 2. v8.9 → v9.9 里程碑

| 版本（tag） | 提交 | 主要交付 | 关键验证（作者本机记录） |
| --- | --- | --- | --- |
| v8.9 | `e4ec008` | 正确性/数据/安全加固：Skip 空白、SRS 重复作答刷档、错词重现上限、迁移标记、删除错词残留；`memoryRecords` 内存缓存；Electron 导航/外链守卫、音频白名单、IPC sender 校验、崩溃 reload 限流、日志轮转、逻辑备份；新增 `dsh-release.ps1` / `dsh-rollback.ps1` | 隔离 profile 练习/数据/备份回归；冒烟通过 |
| v9.0 | `302098d` | 学习闭环：到期复习中心（未来 7 天柱状图 + 到期列表 + 一键复习）、开始页到期数可点、口径统一（今日练习/新学）、错题本释义回退、全量数据 JSON 导入/导出 | 隔离 profile 练习 + 导入导出回归 |
| v9.1 / v9.2 | `357943b` | 整词上报减少重渲染、14 天周历 + 30 天趋势、词库切换直写官方 localStorage、画廊进度；版本号单一来源（`package.json` → main / preload sync IPC / `window.__QZ_VERSION__`）；tsc 纳入发布门禁；新增 `dsh-smoke.mjs`、`docs/Electron-EOL.md` | tsc 0 error；冒烟通过 |
| v9.3 | `e75429d` | **SRS / 自动进阶核心重建**：12 档阶梯、mastery gate、持久化级别、Skip/suspended、动态配比、显式 refresh、迁移加固；算法拆出纯规则模块 `srsRules.ts` | 核心回归 **248/248** |
| v9.4 / v9.5 | `b1712db` | 全栈审计两批（7 路并行审计，102 条证据化问题：P0 0 / P1 9 / P2 41 / P3 52）：崩溃/白屏、原子导入、功能键/IME、Skip/结算、自动进阶竞态、CSP、下载白名单、剪贴板 XSS；`memoryKey` 大小写拆分与迁移、唯一词数进度分母、空白词条归一化、桌面遥测默认关闭、质量门禁、发布/回滚脚本重写 | tsc 0；248 断言；eslint 0-0；各域回归；冒烟 11/11；双目录安装 + 回滚演练 |
| v9.6 | `6986b00` | 第三批收尾：自动进阶旧 key 迁移（幂等）、错题本统计口径修正、备份含自定义词库端到端实证、主窗 CSP 去 `unsafe-inline`（sha256）、剪贴板小窗最小 preload（50→5 API）、`tsconfig.node` 21→0、`npm test` 真门禁 | 248 断言；verify-batch3 52/52；data008 13/13；冒烟 11/11 |
| v9.7 | `02cc02a` | AUDIO-004：发音改原生 `HTMLAudioElement` 直放（预取/播放共用缓存、换词不 unload）；DATA-009：`deferMemoryDue` 改为精确 `now + N×24h`（Skip 真正至少 1 天）；PROMO-001：捐赠卡 30 天静默与防误触；上游提交署名 dsh | srs-sim 120/120、auto 133/133，汇总 **253/253** gate pass；音频 human 5/5 + stress A1–A6 PASS；冒烟 11/11 |
| v9.8 | `ce1cf73` | **去营销 UI**：删除捐赠/推广/作者推荐卡片、mobile 落地页与 `/mobile` 路由、`gtag`/GA 脚本、GitHub Pages 重定向、SEO/OG/官网外链、分享图水印；保留分享成绩/导出/请求词库/学习功能 | tsc/eslint 0；no-promo 67+45；运行时无推广文本；冒烟 11/11；asar 86,384,123 B（同口径 −3.44 MB） |
| v9.9 | `f18e723` | 工程收尾（见第 3 节） | 见第 3 节 |

> 表中 v9.1 与 v9.2、v9.4 与 v9.5 分别合并在同一提交交付，因此没有单独的 `v9.1` / `v9.4` tag。

## 3. v9.9 详细变更

### 3.1 死代码清理

- 删除不可达的 `Gallery DictDetail`、`ErrorTable`、`ReviewDetail`、`useMemoryDictStats` 等 **7 个文件 / 593 行**，以及只写不读的调用；保留表与类型定义，避免数据层破坏。

### 3.2 E2E 落地

- 安装 Chromium 1091，新增 `npm run test:e2e:local`（本地 dev server 模式，`QZ_E2E_BASE_URL` 覆盖）。
- 实测 **12 passed / 5 skipped / 0 failed**；跳过项附旧流程下线依据，不是失败。

### 3.3 Electron 运行时升级

- 43.4.0 → **43.8.3**（Chromium 150.0.7871.250）：官方 zip SHA256 校验、rcedit 保留图标/品牌/版本元数据、三个安装目录逐文件备份替换。
- 验收：CDP 冒烟 **11/11**、外壳安全探针 **19/19**；`resources/app.asar` 与用户数据未动；`LICENSE` / `FORK-NOTICE.md` 未变。
- 细节与回滚方法见 [`Electron-EOL.md`](Electron-EOL.md)。

### 3.4 IndexedDB 导入强杀实测

- 9 轮"导入中途强制结束进程"实测：主库 **0 次被清空 / 0 次部分写入**（原子导入生效）。
- 发现并修复：强杀后 `RecordDB-import-*` 临时导入库残留（v9.8 之前会永久泄漏）；v9.9 改为启动即清理，重跑 **defects=0**。

### 3.5 交付产物（作者本机构建记录）

| 项 | 值 |
| --- | --- |
| `app.asar` 大小 | 86,383,823 B |
| `app.asar` SHA256 | `7951B877…42EF2`（完整值见构建目录 `SHA256SUMS`） |
| 安装目录一致性 | 双目录 `app.asar` 哈希一致 |
| 回滚点 | v9.8 备份 + runtime-43.4.0 三份运行时备份 |

> 上述为作者本机 v9.9 构建/验收记录；不同机器重新构建的产物哈希必然不同，不能据此校验。

## 4. 安装 / 升级 / 回滚

### 4.1 从源码构建

```powershell
git clone https://github.com/menlieyijin/qwerty-learner.git
cd qwerty-learner
git checkout dsh-local-v8
yarn install
pwsh -File scripts/dsh-release.ps1 -TestInstall -Smoke
```

- 需要 Windows + PowerShell 5.1+/7、Node.js ≥ 18；项目内没有 `electron` 依赖，运行时需自备官方预构建二进制。
- `dsh-release.ps1` 的 staging / 备份 / 审计 / 安装目录默认值为作者本机布局，**其他机器必须用 `-StageRoot`、`-BackupDir`、`-AuditRoot`、`-TestAppDir`、`-InstallDirs` 覆盖**。

### 4.2 从旧版本升级

1. **先备份**：使用应用内"工具 → 数据 → 导出全量数据 JSON"，或等待/触发每日自动备份；
2. 按第 4.1 节构建，先 `-TestInstall -Smoke` 验证；
3. 再 `-Install` 正式安装（脚本会预检双目录 asar 哈希一致、备份旧 asar、原子替换、校验并写安装日志）；
4. 首次启动会自动执行数据迁移（`wordRecords → memoryRecords`、旧 key 兼容等），迁移完成会写 localStorage 标记；迁移失败会在下次启动重试，不覆盖旧数据。

### 4.3 回滚

```powershell
pwsh -File scripts/dsh-rollback.ps1 -List   # 查看可用备份
pwsh -File scripts/dsh-rollback.ps1         # 回滚到与当前版本不同的最近备份
```

- 回滚前会自动把当前版本存为 redo 点，可再次切回。
- Electron 运行时回滚与 `app.asar` 回滚相互独立，见 `docs/Electron-EOL.md`。

## 5. 验证清单（v9.9 作者本机）

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 error |
| `eslint src --max-warnings 0` | 0 error / 0 warning |
| 核心算法回归 | 253/253（120 SRS + 133 自动进阶；v9.3–v9.6 旧口径 248） |
| Playwright 本地 E2E | 12 passed / 5 skipped / 0 failed |
| CDP 冒烟 | 11/11 |
| 外壳安全探针 | 19/19 |
| IDB 导入强杀 | 9 轮 defects=0 |
| 双目录安装 | 哈希一致、安装日志完整 |
| 回滚演练 | v9.8 + 运行时 43.4.0 回滚点可用 |

## 6. 已知问题

1. **非官方分支**：不受上游支持；上游更新不会自动进入本分支。
2. **仅 Windows 实测**：桌面外壳未验证 macOS/Linux。
3. **回归脚本未随仓库发布**：253/248 断言、确定性、19 项安全探针等为本机验收记录，公开仓库无法一键复现。
4. **Electron 43.8.3 EOL 2027-01-05**：到期前需评估升级到 44/45/46，升级需重新品牌化与全量回归。
5. **无代码签名**：Windows SmartScreen 可能提示未知发布者。
6. **版本元数据可能滞后**：exe FileVersion 当前为 9.8.0.0，应用内版本为 v9.9。
7. **无每日新词硬上限**：动态配比可能一次引入较多新词。
8. **遥测边界**：桌面默认关闭，opt-in 后复用上游第三方统计配置；网页构建沿用上游统计口径（gtag/GA 脚本已移除）。
9. 其余限制（词库版权、备份一致性、第三方在线服务、数据兼容性等）见 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 第 7 节。

## 7. 后续计划

- 保持上游冻结；如吸收上游修复，逐条评估 + 完整回归，不整包合并。
- 在 2027-01-05（Electron 43 EOL）前评估运行时升级，并把 rcedit 品牌化步骤整理成可复现流程。
- 视情况整理可公开的回归脚本子集，使 253 断言门禁能在干净 clone 上复现（当前未包含）。
- 维护文档与已知限制；修复通过本 fork 的 Issues 收集。

## 8. 致谢

感谢 **RealKai42** 与 Qwerty Learner 全体贡献者提供的基础项目与词库体系；感谢上游词库/数据来源与第三方释义、发音服务；感谢 Electron、Chromium、React、Vite、Dexie、Tailwind CSS 等开源项目；本分支的开发、审计与文档工作使用了 **DeepSeek Harness（dsh）** 工具链（工具署名，不代表官方背书）。

---

*相关文档：[FORK-NOTICE.md](../FORK-NOTICE.md) · [DSH-FORK.md](DSH-FORK.md) · [DSH-FORK_EN.md](DSH-FORK_EN.md) · [Backup-Restore.md](Backup-Restore.md) · [Electron-EOL.md](Electron-EOL.md)*
