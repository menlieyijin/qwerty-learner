# v10.0.0 / v10.1.0 发布说明（dsh）

> 版本字符串：`1.0.0-enhanced-v10.7.0`（唯一来源：`local-fork/package.json`；v10.0.0–v10.6.0 为同一基线的早期版本）
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


---

# v10.3.0 追加（结构收尾：状态机抽离 + 归一化全统一 + 完整历史核验）

## 1. Word 组件最后一块也拆了

`Word/index.tsx` **500 → 400 行**，`useAttemptSettlement.ts`（147 行）承接全部作答结算：

| 迁出的东西 | 说明 |
| --- | --- |
| `AttemptMeta` / `createAttemptMeta` | 一次作答的结算元数据（已上报计数、错字下标长度、是否已落库/已结算） |
| `flushStats()` | 增量上报（幂等）：只把「自上次上报以来」的按键与错字写进 chapterData |
| `persistOnce()` | 每个 attempt 只落库一次，返回 Promise 供父级保序 |
| `settleAttempt({persist})` | 组合入口：先 flush，必要时落库 |
| `resetAttempt()` | 换词时重置 meta（原来在换词 effect 里直接赋值） |

组件现在只剩：输入处理（`updateInput`）、渲染编排、settleRef 注册。

## 2. `trans` 归一化 8/8 统一

之前只合并了语义相同的 3 处，剩下 5 处语义各不相同（有的不过滤、有的不回退标量）。
本版全部并入 `normalizeTrans`，并把「4 类旧语义 + 统一后的行为变化」写进 `src/utils/trans.ts` 头部。
方向都是更健壮：`autoLevel`/`sessionRequeue`/`memory` 现在接受标量 `trans`；`Word`/`useGetWord`/`memory` 现在过滤非字符串。

## 3. 测试补到逐字母粒度

| 用例 | 断言 |
| --- | --- |
| 4c | 完成词后 `wordRecords.mistakes` 记录错误下标（逐字母错因） |
| 5d | 敲对一个字母 → 暂停 → 恢复，该字母仍为「已答对」（暂停只停表、不丢进度） |

## 4. 完整历史核验（原「浅克隆」限制解除）

执行 `git fetch --unshallow` 补全上游历史（**未合并任何上游代码、未改工作树**），随后用 git 历史复核词库来源：

- 5 本本地补回词库在上游历史中 **0 条提交**；
- `git diff --stat 1182426 HEAD -- public/dicts` 仅显示这 **5 个文件新增（200,766 行）**，其余 380 本与基线逐字节一致。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:core` | 309/309 + determinism pass |
| `test:start-level` | 21/21 |
| `test:pages` | 17/17 |
| `test:typing` | **18/18** |
| `test:csv` | 14/14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

## 遗留（本版关闭 3 条：L-1 / L-3 / L-8）

剩余：L-12 空词表正确率语义（已按 0% 实现，若产品口径不同需改）、以及「class 重排无像素级视觉回归」这一残余风险。


---

# v10.3.0 追加（结构收尾：状态机抽离 + 归一化全统一 + 完整历史核验）

## 1. Word 组件最后一块也拆了

`Word/index.tsx` **500 → 400 行**，`useAttemptSettlement.ts`（147 行）承接全部作答结算：

| 迁出的东西 | 说明 |
| --- | --- |
| `AttemptMeta` / `createAttemptMeta` | 一次作答的结算元数据（已上报计数、错字下标长度、是否已落库/已结算） |
| `flushStats()` | 增量上报（幂等）：只把「自上次上报以来」的按键与错字写进 chapterData |
| `persistOnce()` | 每个 attempt 只落库一次，返回 Promise 供父级保序 |
| `settleAttempt({persist})` | 组合入口：先 flush，必要时落库 |
| `resetAttempt()` | 换词时重置 meta（原来在换词 effect 里直接赋值） |

组件现在只剩：输入处理（`updateInput`）、渲染编排、settleRef 注册。

## 2. `trans` 归一化 8/8 统一

之前只合并了语义相同的 3 处，剩下 5 处语义各不相同（有的不过滤、有的不回退标量）。
本版全部并入 `normalizeTrans`，并把「4 类旧语义 + 统一后的行为变化」写进 `src/utils/trans.ts` 头部。
方向都是更健壮：`autoLevel`/`sessionRequeue`/`memory` 现在接受标量 `trans`；`Word`/`useGetWord`/`memory` 现在过滤非字符串。

## 3. 测试补到逐字母粒度

| 用例 | 断言 |
| --- | --- |
| 4c | 完成词后 `wordRecords.mistakes` 记录错误下标（逐字母错因） |
| 5d | 敲对一个字母 → 暂停 → 恢复，该字母仍为「已答对」（暂停只停表、不丢进度） |

## 4. 完整历史核验（原「浅克隆」限制解除）

执行 `git fetch --unshallow` 补全上游历史（**未合并任何上游代码、未改工作树**），随后用 git 历史复核词库来源：

- 5 本本地补回词库在上游历史中 **0 条提交**；
- `git diff --stat 1182426 HEAD -- public/dicts` 仅显示这 **5 个文件新增（200,766 行）**，其余 380 本与基线逐字节一致。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:core` | 309/309 + determinism pass |
| `test:start-level` | 21/21 |
| `test:pages` | 17/17 |
| `test:typing` | **18/18** |
| `test:csv` | 14/14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

## 遗留（本版关闭 3 条：L-1 / L-3 / L-8）

剩余：L-12 空词表正确率语义（已按 0% 实现，若产品口径不同需改）、以及「class 重排无像素级视觉回归」这一残余风险。


---

# v10.4.0 追加（最后两条遗留清零）

## 1. 空词表正确率：从「代码级约定」变成「可执行断言」

`correctRate` / `mistakeLevel` 从 `ResultScreen` 的 `useMemo` 里抽成纯函数（`ResultScreen/correctRate.ts`），
由此可以脱离浏览器直接断言：

```bash
npm run test:stats    # 15 条
```

覆盖：`0/0 → 0`（不是 NaN）、`NaN`/负数入参兜底、`floor` 取整（错 1/3 = 66）、85/84/70/69 分档边界、
空词表分级落在红色档。

## 2. 视觉回归：给 prettier 的 class 重排补上像素级把关

v10.2.1 那次全仓格式化含 `prettier-plugin-tailwindcss` 的 class 排序，当时只有行为断言兜底。
本版新增 `tests/e2e/visual.spec.ts`：

```bash
npm run test:visual        # 与基线比对（2 张：错题本空态、设置面板）
npx playwright test tests/e2e/visual.spec.ts --project=chromium --update-snapshots   # 重建基线
```

- `maxDiffPixelRatio: 0.002`、`animations: 'disabled'`；基线 PNG 随仓库提交，改样式能在 review 里看见。
- **练习页刻意不入基线**：实测遮住随机词与计时后仍有 1% 像素抖动（1916 px），会持续误报；
  练习页的正确性由 `test:typing` 的 18 条行为断言覆盖。原因写在 spec 注释里。

## 3. 两个「从未审计过」的文件审完了

| 文件 | 规模 | 审计点 | 结论 |
| --- | --- | --- | --- |
| `local-fork/electron/enhance/enhance.js` | 2660 行 | `innerHTML` 插值是否转义、`JSON.parse` 是否在 try 内、`parseInt` radix、除法 `toFixed` 的 NaN | 未发现可改缺陷：唯一未套 `esc()` 的是键盘热区（字符来自常量表）；4 处 `JSON.parse` 全有 try；`parseInt` 全带 radix；`toFixed` 前均有守卫 |
| `src/utils/db/data-export.ts` | 266 行 | 导入流程的校验与失败恢复 | 实现完备：文件头校验 → 临时库 staging → 逐表行数比对 → 主库单事务 clear+bulkPut → 失败回滚 → 残留临时库清理 |

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint | 通过 |
| `test:core` | 309/309 + determinism |
| `test:stats` | **15/15**（新增） |
| `test:visual` | **2/2**（新增，连跑 3 次稳定） |
| `test:start-level` / `test:pages` / `test:typing` / `test:csv` | 21 / 17 / **18** / 14 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

## 遗留

原 12 条遗留已全部关闭。仅剩的不是「待办」而是**能力边界**：视觉基线是本机 Chromium 产物（换机器需重建）；
核心回归是 stub 化仿真（不等于真实浏览器）。两者都已写进 README「已知限制」。


---

# v10.5.0 追加（仓库一致性收尾，无功能变化）

## 1. 命名统一：核心回归脚本去掉 `_v93` 前缀

11 个文件从 `_v93-build-core.mjs` / `_v93-harness.mjs` / `_v93-stub-*.mjs` … 改为
`build-core.mjs` / `harness.mjs` / `stub-*.mjs` …；生成物统一为 `core.mjs` + `report-*.json`。
同步了 `run.mjs`、`scripts/core-regression/README.md`、`scripts/dsh-release.ps1`、`scripts/quality-gate.ps1`、
`.gitignore` 和 `src/utils/memoryLadder.ts` 的注释。**验证**：`npm run test:core` 仍 309/309 + determinism。

## 2. 文档不再硬编码「当前版本/提交数」

- `docs/DSH-FORK.md` / `docs/DSH-FORK_EN.md`：版本改为「以 `local-fork/package.json` 为准」，
  提交数改为给出统计命令；
- `docs/THIRD-PARTY.md`：顶部版本同样改为指向唯一来源；
- `FORK-NOTICE.md`：签名统计更新为「截至 v10.4.0，35/48」并注明时点。
- 历史发布说明（`RELEASE-NOTES-v9.11.md` / `v9.15.md` 等）里的旧版本号**保留不删**——那是发布事实存档。

## 3. 一键验证

```bash
npm run test:all      # quality → stats → core → start-level → pages → typing → csv
npm run test:visual   # 视觉回归（需先起 dev server）
```

## 本版验证

| 检查 | 结果 |
| --- | --- |
| `npm run test:all` | 7 段全绿（含 309 核心回归、15 正确率断言、四脚本 21/17/18/14） |
| `npm run test:visual` | 2/2 |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

功能行为零变化：本版只改命名、文档表述与验证入口。


---

# v10.6.0 追加（前端整洁度专项，页面行为不变）

## 1. `utils/index.ts`：168 行杂物桶 → 14 行纯 barrel

拆成 6 个领域文件，`@/utils` 的导出名与所有调用点一字未改：

| 新文件 | 内容 |
| --- | --- |
| `utils/keyboard.ts` | `isLegal` / `isChineseSymbol`（含 50+ 键名的 bannedKeys） |
| `utils/platform.ts` | `IS_MAC_OS` / `CTRL` / `IsDesktop` |
| `utils/time.ts` | `getCurrentDate` / `getUTCUnixTimestamp` / `timeStamp2String` / `formatDate` |
| `utils/number.ts` | `toFixedNumber` / `findCommonValues` |
| `utils/chapter.ts` | `calcChapterCount`（唯一入口，依赖 `CHAPTER_LENGTH`） |
| `utils/audio.ts` | `addHowlListener` |

## 2. 删除死样式（有截图证明"没影响页面"）

`src/index.css` 里 3 个类 + 5 段 keyframes 全仓无人引用，已删除（168 → 143 行）：
`.gradient-text`、`.text-shadow`、`.typewriter`、`@keyframes gradient-text-hue / typing / blink-caret / hideCaret / gradientBG`。
删除后 `npm run test:visual` 仍 2/2 —— 基线截图逐像素一致，说明删的确实是死代码。

## 3. 移除 13 个未引用依赖

`@radix-ui/react-{avatar,dialog,slot,tabs,toggle,toggle-group}`、`@tanstack/react-table`、
`dexie-react-hooks`、`embla-carousel-react`、`lucide-react`、`react-timer-hook`、
`source-map-explorer`、`@tailwindcss/postcss7-compat`。
**保留**：`immer`（`use-immer` 的 peer）、`@iconify/json` 与 `@svgr/*`（`unplugin-icons` 构建期解析图标集合）、
`cross-env`（npm scripts 使用）。

## 4. 组件写法统一

7 处 `React.FC` 收敛为函数声明（`memo` 的两处改为「先声明再 `memo(X)`」），并清掉随之失效的
`import type React`。`grep -r "React.FC" src` 命中 0。

## 5. 新增 `docs/CONVENTIONS.md`

把"大家默认这么做"写成文档：目录分层、组件写法（函数声明 + `XxxProps` + 导出规则）、
样式规则（Tailwind 优先、CSS Module kebab-case 与 `camelCaseOnly` 映射）、utils 放置、
命名表、验证矩阵（改什么跑什么）、提交与发布、Electron 侧约束。README 中英与 CONTRIBUTING 已链接。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| tsc + eslint（零告警） | 通过 |
| `test:all` | 全绿（85 条行为断言 + 核心 309/309 + determinism） |
| `test:visual` | 2/2（删样式后截图未变） |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

**页面行为不变**：本版没有改任何组件逻辑、样式生效值或文案；删除的样式与依赖均经引用扫描确认无人使用，
并由视觉基线与行为脚本复核。


---

# v10.7.0 追加（入口合并 + 文案收敛，页面功能不变）

## 1. 增强工具合并进设置

- 顶栏的「工具」按钮**移除**（连带删掉 `EnhanceButton` 组件）；
- 入口统一为 **设置 → 关于 → 打开增强工具**（仅桌面端显示该按钮，浏览器版只显示版本与链接）；
- 增强面板里的**「关于」页签整页删除**（原有 3456 字符：版本长描述 + v7–v9 逐版本功能清单 + 已知限制）。

## 2. 新的「关于」页只有 4 行事实

`设置 → 关于`：

```
版本   1.0.0-enhanced-v10.7.0
       提交 <hash>
来源   基于 Qwerty Learner（commit 1182426）· GPL-3.0
       本分支仓库 ↗
桌面端 [打开增强工具]
```

版本号来自构建期常量 `APP_VERSION`（`vite.config.ts` 从 `local-fork/package.json` 读取），前端不再硬编码。

## 3. 其他收敛

- 设置页签 4 段重复 JSX（每段 11 行）→ `SETTING_TABS` 一次 `map`；图标由 heroicons/tabler 混用统一为 tabler；`index.tsx` 150 → 131 行。
- 增强面板三处长说明各压缩成一句（升级条件 / JSON 范围 / 自动备份），保留可操作信息。
- 文档中「顶栏『工具』」的表述已同步（`DSH-FORK.md`、`Backup-Restore.md`、`local-fork/README.md`）。

## 本版验证

| 检查 | 结果 |
| --- | --- |
| `test:pages` | **19 项**（新增 7d 关于页版本一致、7e 顶栏无「工具」，7c 改为五页签） |
| `test:all` | 全绿（87 条行为断言 + 核心 309/309 + determinism） |
| `test:visual` | 2/2（设置面板基线已按新增页签重建） |
| 隔离冒烟 | 11/11 |
| 双目录安装 | 两目录 asar SHA256 一致 |

功能零变化：练习、错题本、数据、音效等逻辑未改；仅入口位置与文案长度变化。
