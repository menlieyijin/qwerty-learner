# v10.0.0 / v10.1.0 发布说明（dsh）

> 版本字符串：`1.0.0-enhanced-v10.2.0`（唯一来源：`local-fork/package.json`；v10.0.0 / v10.1.0 为同一基线的早期版本）
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


---

# v10.1.0 追加（结构收尾 + 回归入仓）

在 v10.0.0 之上补完三件事，都属于「让项目更像一个正式开源项目」而不是加功能：

## 1. 两个大文件收窄

| 文件 | 之前 | 之后 | 做法 |
| --- | --- | --- | --- |
| `Setting/SoundSetting.tsx` | 335 行，11 个 `useCallback`、4 开关 + 5 滑块的 JSX 全在一处 | **206 行** + `sound/SoundSwitchRow.tsx`(29) + `sound/SoundVolumeRow.tsx`(55) | 行级展示组件化；8 个同构回调合并为 3 个通用写值包装 |
| `WordPanel/.../Word/index.tsx` | 554 行，展示层与输入/结算状态机混在一起 | **500 行** + `WordDisplay.tsx` + `letterVisibility.ts` | 只抽展示层与「字母是否可见」的纯函数；状态机保留（拆 hook 会让接口更宽，见 REFACTOR-LOG） |

## 2. 核心算法回归随仓库发布

之前 309 条断言只在作者本机，公开用户无法复跑。现在：

```bash
npm run test:core   # build-core → srs-sim → sim-autolevel → determinism → aggregate
```

- 用 esbuild 打包**真实源码** `src/utils/*`（只把 dexie/react/jotai/网络换成 stub），不是复制一份算法；
- 结果：**309/309**（SRS 120 + 自动进阶 189）+ 确定性门禁 pass；
- `scripts/dsh-release.ps1` 与 `scripts/quality-gate.ps1` 的默认回归目录已改指仓库内
  （`QZ_AUDIT_DIR` 仍可覆盖），发版不再依赖本机 `D://整理//audit`。

## 3. 验证矩阵（现在共 4 个行为脚本）

| 脚本 | 项数 | 覆盖 |
| --- | --- | --- |
| `test:local`（冒烟） | 11 | 应用能起、面板/数据/备份/分析/错题本能开、无异常 |
| `test:start-level` | 21 | 首启起点选择全流程（含「选完立刻出对应词」「重启保持」「老用户不打扰」） |
| `test:pages` | 17 | 错题本排序/详情/Esc/删除取消、设置面板、脏 payload 不白屏 |
| `test:typing` | **15** | 进入输入态、错字标红、整词完成切词、记录落库、暂停写会话、音效开关/滑块、默写 hideAll |
| `test:core` | **309** | 纯算法层（SRS / 自动进阶 / 确定性） |
| `test:csv` | 14 | CSV 公式注入防护 |

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `npm run test:core` | 309/309 + determinism pass |
| `npm run test:typing` | 15/15 |
| `npm run test:pages` | 17/17 |
| `npm run test:start-level` | 21/21 |
| `npm run test:csv` | 14/14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | asar SHA256 一致（见交付说明） |


---

# v10.2.0 追加（审计收尾：3 个可验证缺陷 + 1 处去重）

## 修复

| 编号 | 现象 | 影响 | 验证 |
| --- | --- | --- | --- |
| F5-003 | 暂停后继续练一会儿再暂停，**这次会话的记录不更新**（正确/错误键数、用时都丢） | 数据准确性：会话行的用时与正确数停在第一次暂停的时刻 | `test:typing` 新增 5c：resume 后等 2.8s，`time` 1→3、词数不变、行数仍为 1；**把判重回退后同用例失败**（`time` 停在 0） |
| F5-005 | 空词表时结果页 `0/0 = NaN`，界面会出现 `NaN%` | 只影响空词表这一异常路径 | 代码级验证（无法构造稳定复现路径），约定按 0% 处理 |
| F5-006 | `release-info.json` 与安装日志带 UTF-8 BOM，`JSON.parse` 直接抛异常 | 发版产物被脚本解析时会失败 | 新产物 `BOM: false` + `JSON.parse` 通过 |

## 去重

- `trans` 归一化原有 8 处实现、语义不一：把**语义完全相同**的 3 处（`learningPath` / `useWordList` /
  `DropdownExport`）合并到 `src/utils/trans.ts` 的 `normalizeTrans`，其余 5 处在文件头列出差异表、**保持原样**。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:core` | 309/309 + determinism pass |
| `test:start-level` | 21/21 |
| `test:pages` | 17/17 |
| `test:typing` | **16/16** |
| `test:csv` | 14/14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | asar `8D4DF7C6…`，两目录一致 |

## 仍未闭环（本版新增两条）

- L-11 全仓 prettier 未统一：`prettier --check src` 仍报 21 个既有文件；仓库配置带
  `prettier-plugin-tailwindcss`，批量格式化会重排 class 顺序，需要视觉回归，本环境没有 → 未做。
- L-12 空词表正确率语义（0% vs 不展示）需产品确认，现按 0%。


---

# v10.2.0 追加（审计收尾：3 个可验证缺陷 + 1 处去重）

## 修复

| 编号 | 现象 | 影响 | 验证 |
| --- | --- | --- | --- |
| F5-003 | 暂停后继续练一会儿再暂停，**这次会话的记录不更新**（正确/错误键数、用时都丢） | 数据准确性：会话行的用时与正确数停在第一次暂停的时刻 | `test:typing` 新增 5c：resume 后等 2.8s，`time` 1→3、词数不变、行数仍为 1；**把判重回退后同用例失败**（`time` 停在 0） |
| F5-005 | 空词表时结果页 `0/0 = NaN`，界面会出现 `NaN%` | 只影响空词表这一异常路径 | 代码级验证（无法构造稳定复现路径），约定按 0% 处理 |
| F5-006 | `release-info.json` 与安装日志带 UTF-8 BOM，`JSON.parse` 直接抛异常 | 发版产物被脚本解析时会失败 | 新产物 `BOM: false` + `JSON.parse` 通过 |

## 去重

- `trans` 归一化原有 8 处实现、语义不一：把**语义完全相同**的 3 处（`learningPath` / `useWordList` /
  `DropdownExport`）合并到 `src/utils/trans.ts` 的 `normalizeTrans`，其余 5 处在文件头列出差异表、**保持原样**。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:core` | 309/309 + determinism pass |
| `test:start-level` | 21/21 |
| `test:pages` | 17/17 |
| `test:typing` | **16/16** |
| `test:csv` | 14/14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | asar `8D4DF7C6…`，两目录一致 |

## 仍未闭环（本版新增两条）

- L-11 全仓 prettier 未统一：`prettier --check src` 仍报 21 个既有文件；仓库配置带
  `prettier-plugin-tailwindcss`，批量格式化会重排 class 顺序，需要视觉回归，本环境没有 → 未做。
- L-12 空词表正确率语义（0% vs 不展示）需产品确认，现按 0%。
