# v10.0.0 发布说明（dsh）

> 版本字符串：`1.0.0-enhanced-v10.0.0`（唯一来源：`local-fork/package.json`）
> 基线：v9.15.1（`ce7eb79`）→ 本次重构 6 个提交 → v10.0.0
> 逐条问题记录（根因 / 修复 / 验证 / 风险）见 [`REFACTOR-LOG.md`](./REFACTOR-LOG.md)

## 一句话

把「克隆下来能跑、功能能验、文档说自己的话」这三件事补齐：npm 一条链路部署、首启词汇起点选择、
错题本与导出路径的两个真实缺陷修复，并把验证从「冒烟 11 项」扩到「冒烟 + 3 个行为脚本 52 项断言」。

## 用户可见的变化

1. **首启选词汇起点**：第一次打开时选择「没学过 / 初中 / 高中 / 四级 / 六级」，选完立刻按该级别出词。
   之后可在**词库页**顶部「学习起点：…」随时修改；练习页不加入口，避免打断。
   已有练习记录的老用户升级后不会被弹窗拦截。
2. **错题本导出更安全**：`.csv` 里以 `= + - @` 开头的内容会被加前缀中和，Excel/WPS 打开不再把词条当公式执行。
3. **部署更简单**：`npm ci` + `npm run dev`（或 `npm run build`）两条命令；锁文件入库，版本要求写进 `engines`。
4. **README 重写**：只讲本项目；上游 README 原文完整归档到 `docs/UPSTREAM-README*.md`（保留署名），
   英文项目说明新增 `README.en.md`。

## 修复的缺陷

| 编号 | 现象 | 影响面 |
| --- | --- | --- |
| B1-1 | 在无 `.git` 的目录构建时 `vite build` 静默退出（退出码 0、无产物） | Docker 构建、源码包分发必然失败；`LATEST_COMMIT_HASH` 也未定义 |
| B5-1 | 错题本 CSV 导出可被公式注入 | 分享导出文件时的安全问题 |
| B5-2 | `qzDueReviewWords` 脏数据导致**整页白屏** | 备份恢复 / 手改 localStorage / 增强面板异常写入 |

## 工程与验证

| 项 | 变化 |
| --- | --- |
| 包管理 | npm 唯一（删除 `yarn.lock` / `.yarnrc`），`package-lock.json` 入库 |
| 运行时约束 | `engines`（node 18–22 / npm ≥9）+ `.nvmrc=20` + `packageManager` |
| CI | 三个 workflow 由 yarn 改 npm；注释同步 |
| Docker | `npm ci`，registry 只对本次命令生效 |
| 文档 | 新增 `docs/QUICKSTART.md`、`docs/REFACTOR-LOG.md`、`docs/RELEASE-NOTES-v10.md`；README 中英双语 |
| 验证脚本 | 新增 `scripts/verify-start-level.mjs`（21）、`scripts/verify-pages.mjs`（17）、`scripts/verify-csv-safe.mjs`（14），并登记为 `npm run test:start-level / test:pages / test:csv` |
| 代码结构 | 删除自定义 `classNames`；错题本 300 → 197 行（拆 `deleteConfirm.ts` + `useGroupedWrongRecords.ts`）；清理 18 行无用 CSS |

## 本版验证结果

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` + `eslint src --max-warnings 0` | 通过 |
| 核心回归（SRS 120 + 自动进阶 189） | 309/309（脚本在作者本地审计目录，**不在仓库**） |
| `vite build` | 通过（约 12.4s） |
| 隔离 profile CDP 冒烟 | 11/11 |
| `verify-start-level.mjs` | 21/21 |
| `verify-pages.mjs` | 17/17 |
| `verify-csv-safe.mjs` | 14/14 |
| 双目录安装（`D:\bangong\QwertyLearner-Plus`、`D:\bangong\新建文件夹 (2)\Qwerty Learner`） | asar SHA256 一致 |

## 已知限制（与上一版一致的部分）

- 词库约 79 MB（385 本），clone 较重。
- 309 条回归脚本不随仓库发布，公开用户无法复跑。
- `scripts/*.ps1` 默认路径是作者本机布局，需用 `QZ_*` 覆盖。
- 浅克隆，无法本地核验上游历史（影响第三方词库溯源）。
- `Word/index.tsx`、`SoundSetting.tsx` 仍是较大单文件（拆分列入遗留，理由见 `REFACTOR-LOG.md §六`）。

## 升级方式

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dsh-release.ps1 -Install
# 回滚：scripts\dsh-rollback.ps1（会自动选「与当前版本不同的最近备份」）
```

用户数据（`%APPDATA%\qwerty-learner-plus`）与新增的 `qzLearningStart` 键向后兼容：老版本忽略该键，
新版本对缺失该键的情况按「老用户」处理，不会重新弹窗。

---
*本版本的全部修改由 dsh 完成并署名；上游版权归 RealKai42 及贡献者，许可证 GPL-3.0。*
