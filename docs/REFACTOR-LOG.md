# v10 重构与审计记录（逐条）

- **基线**：`v9.15-base` = `ce7eb79`（v9.15.1，含 AUDIT.md 闭环）
- **结果**：`v10.0.0`（6 个提交，逐批打 tag；见文末版本表）
- **执行方式**：每批先打回滚点 tag → 改 → `tsc + eslint` → `vite build` → 打包 → 隔离 profile CDP 冒烟 →
  双目录安装（比对 asar SHA256）；任一步失败即 `git reset --hard` 回该批 tag。
- **署名**：所有提交 `dsh <dsh@dsh.local>`，带 `Signed-off-by`。

判定口径：**已修**（有改动 + 有验证）/ **接受风险**（不改，附理由）/ **未闭环**（缺验证或受环境限制）。

---

## 一、批次 1 · 部署与工程基线（`v9.16-batchA` / `0237034`）

| # | 问题 | 根因 | 修复 | 验证 | 风险 |
| --- | --- | --- | --- | --- | --- |
| B1-1 | 非 git 环境（Docker 构建、源码包）执行 `vite build` **静默退出**：退出码 0、无任何输出、不产出 `build/` | `vite.config.ts` 里 `getLastCommit((err, commit) => err ? 'unknown' : resolve(...))`：err 分支只是「表达式的值」，Promise 永不 resolve，`defineConfig(async …)` 永不返回 | 两个分支都显式 `resolve('unknown')` | 在没有 `.git` 的干净副本里 `npm ci`（916 包）+ `npm run build` → 13.42s 产出 `build/`；修复前同一副本 0 输出、无产物 | 低：只影响 `LATEST_COMMIT_HASH` 的取值（非 git 时为 `unknown`，UI 仅展示） |
| B1-2 | 仓库只有 `yarn.lock`，`package-lock.json` 被 `.gitignore` 忽略；npm 路径无法复现 | 上游用 yarn，fork 后部署方式未统一 | `package-lock.json` 入库（lockfileVersion 3，已核对与 `package.json` 依赖零差异）；删除 `yarn.lock`、`.yarnrc`；`.gitignore` 解除忽略 | `npm ci` 在干净副本成功、依赖树一致 | 中：删除 `yarn.lock` 会使「用 yarn 的人」失去冻结安装；已在 README/QUICKSTART 明确「npm 是唯一包管理器」 |
| B1-3 | 未声明运行时版本要求 | 无 `engines` / `.nvmrc` | `package.json` 加 `engines`（node `>=18 <23`、npm `>=9`）与 `packageManager: npm@10.9.7`；新增 `.nvmrc=20` | `node -v` 22 通过；Docker 基础镜像 node:20 落在区间内 | 低：Node ≥23 会打印 `EBADENGINE` 警告（不阻断） |
| B1-4 | 安装脚本依赖 yarn；`pre-check.*` 还会自动 `npm i -g yarn` | 上游遗留 | `install.ps1` / `install.sh` 改 `npm ci`（无锁回退 `npm install`）；`pre-check.*` 改为校验 node/npm 版本并给出明确提示 | 静态复核 + 与 QUICKSTART 命令一致 | 低：脚本未在 CI 覆盖，属「按文档核对」级验证 |
| B1-5 | `Dockerfile` 用 `npm install`（不可复现）、`npm config set registry` 写进镜像全局配置、命令末尾多余空格 | 上游遗留 | 改 `npm ci --registry=…`（registry 只对本次命令生效） | 构建链路推演 + B1-1 修复后非 git 构建实测 | 低：未实际构建镜像（本机无 docker） |
| B1-6 | CI 用 yarn，且 `quality.yml` 顶部注释写「仓库里没有 package-lock.json」——修完 B1-2 后该注释会变成假话 | 注释与实现耦合 | 三个 workflow 全改 npm（`cache: npm` / `npm ci` / `npm run build`），注释同步改写 | YAML 语法复核 | 低：fork 上 `deploy-pages.yml`/`e2e.yml` 有 `if: repository == upstream` 守卫，不会误跑 |

**批次验证**：`tsc` ✅ / `eslint --max-warnings 0` ✅ / 核心回归 309/309 ✅ / build ✅ / 隔离冒烟 11/11 ✅ /
双目录安装 `E4CD6F08…` 一致 ✅

---

## 二、批次 2 · 首启词汇起点选择（`v9.17-batchB` / `8af6799`）

| # | 内容 | 说明 |
| --- | --- | --- |
| B2-1 | 五档起点 | 没学过→`primary-1`、初中→`junior-1`、高中→`senior-1`、四级→`cet4`、六级→`cet6`；只写 `qzAutoLevelState.levelId`，不动记忆曲线、不写练习记录 |
| B2-2 | 独立持久化 | 选择存 `qzLearningStart`（`{version,choiceId,decidedAt}`），与进阶状态解耦：清空学习数据不会把「已经问过」一起清掉；读回统一校验，脏数据按「没选过」处理 |
| B2-3 | 只打扰一次 | 弹窗条件 =「没选过」且「进程启动前没有 `qzAutoLevelState`」。`HAD_AUTO_LEVEL_STATE_AT_BOOT` 在模块求值时取值，早于任何异步写入；「以后再说」记为 `deferred`，下次不再弹 |
| B2-4 | 修改入口不在主界面 | 放在词库页顶部「学习起点：&lt;当前档位&gt;」按钮；练习页不加入口 |
| B2-5 | 选完立刻生效 | `useWordList` 增加 `learningStart` 依赖触发重载；写入顺序为「先级别、后选择」，避免先出旧级别词再刷一次 |

**验证**（`scripts/verify-start-level.mjs`，21 项全过）：
1 首启弹窗；2 选六级 → `qzLearningStart=cet6`、`levelId=cet6`、CDP 抓到 `dicts/CET6_T.json`、弹层关闭、
顶栏「大学六级」；3 重启后不弹窗、级别仍 `cet6`；4 词库页入口 → 改初中 → `junior-1` → 回练习页抓到
`PEPChuZhong7_1/7_2_T.json` → 顶栏「初中一年级」；5 老用户（有进阶状态、无起点记录）不弹窗、级别不变；
6 全程无未捕获异常 / 控制台错误。

> 取证方式说明：Electron 下 `file://` 的 `fetch` 不一定写进 `performance` 资源计时，改用 CDP `Network` 域
> 收集请求，才能证明「词表真的去取了」而不是只改了状态。

**风险**：`deferred` 一旦写入，用户不会再被主动询问（入口仍在词库页）；选择「从零开始」的老用户，若该级别
已全部掌握，会自动快速进阶（`advanceIfComplete` 只升不回退），属预期行为但未单独用例覆盖。

---

## 三、批次 3 · 前端清理（`v9.18-batchC` / `f5cbe6c`）

| # | 问题 | 修复 | 验证 | 风险 |
| --- | --- | --- | --- | --- |
| B3-1 | 两套类名拼接并存：`@/utils` 自定义 `classNames`（trim + 空格，冲突类看 CSS 顺序）与 `@/utils/ui` 的 `cn`（clsx + tailwind-merge） | 唯一调用点 `components/Tooltip` 改 `cn`，删除自定义实现 | `Tooltip` 的 `className` 全仓无传入 → 输出等价；tsc/eslint/冒烟通过 | 低：若将来给 Tooltip 传冲突类，合并策略不同于旧实现（这本身是修复） |
| B3-2 | `pages/ErrorBook/index.tsx` 300 行混着读库、分组、排序、删除确认、回顾构造 | 抽出 `deleteConfirm.ts`（纯函数）与 `hooks/useGroupedWrongRecords.ts`（读库+分组+三态）→ 197 行 | 新增 17 项页面级回归（排序/详情/Esc/删除取消）；冒烟 `errorBookWorks` 通过 | 低：`Map` 键 `dict\u0000word`、错误态、取消标志逐行保留 |
| B3-3 | `Word/index.module.css` 中 `.word-sound` 三条规则无人引用（`styles.wordSound` 全仓 0 命中） | 删除 18 行 | 构建通过；`.wrong` 仍在用、未动 | 低：CSS module 类名只在被引用时生效，删除无渲染影响 |
| B3-4 | 设置面板样式表 | 复核 `tabContent/section/sectionLabel/sectionDescription/block/blockLabel/switchBlock` 全部在用 | — | 不改 |

**未做**：`Word/index.tsx`（554 行）与 `Setting/SoundSetting.tsx`（335 行）的拆分——前者是单词输入状态机
（作答结算、字母统计、落库互相耦合），后者是 11 个表单回调；当前自动化只有冒烟级，没有逐操作页面用例，
按「无法验证的不改」处理，列入遗留。

---

## 四、批次 4 · README 项目化（`v9.18-batchD` / `bb2ffb5`）

| # | 问题 | 修复 |
| --- | --- | --- |
| B4-1 | README 是「顶部 fork 声明 + 逐行照搬上游正文」，与本项目实际功能不符 | 重写为项目版：这是什么、相对上游 9 项改动对照表、快速开始、目录结构、验证命令、隐私、许可、文档索引、已知限制 |
| B4-2 | 没有本项目的英文 README（只有上游英文原文） | 新增 `README.en.md`（与中文版同构，非上游副本） |
| B4-3 | `docs/README_EN.md` 与根 README 容易混淆 | 三份上游原文归档为 `docs/UPSTREAM-README.md` / `_EN.md` / `_JP.md`，头部注明「正文未改，仅按新位置调整相对链接」 |
| B4-4 | 归档后 6 处相对链接断链（`./docs/CONTRIBUTING.md`、`scripts/…` 等按仓库根书写） | 补 `./` `../` 前缀；用脚本检查全部文档相对链接 → **0 处断链** |

---

## 五、批次 5 · 审计与缺陷修复（`v9.19-batchE` / `39d3dd4`，`v9.19.1` / `56b9c04`）

| # | 问题 | 根因 | 修复 | 验证 | 风险 |
| --- | --- | --- | --- | --- | --- |
| B5-1 | 错题本导出 `.csv` 时，以 `=` `+` `-` `@` 开头的单元格原样写入，Excel/WPS 打开会当**公式执行**（CSV injection）。实测 SheetJS 输出的首列就是裸 `=cmd\|calc` | 用 SheetJS 把对象直接转表，没有做公式前缀中和；词库来自第三方、也可用户导入，属不可信输入 | 新增 `utils/csvSafe.ts`（命中前缀时前缀 `'`，数字/非字符串原样），仅对 csv 分支套用 | `scripts/verify-csv-safe.mjs`：14 项断言（含「内部等号不误伤」「数字列不加引号」「端到端 csv 无裸公式单元格」） | 低：`'` 是 Excel 文本标记不显示；xlsx 分支不动（实测写为 `t:"s"` 字符串，不可执行） |
| B5-2 | `qzDueReviewWords` 脏 payload 让**整页落到 ErrorBoundary**（「页面出错了」） | 只校验「是非空数组」，元素形状不校验；`[{bad:1},null,'x',42]` 被直接送进复习流程，`WordPanel` 读 `word.name` 抛 TypeError | 按 `name` 为非空字符串过滤；全无效时只 `warn`、不进入复习模式 | `verify-pages.mjs` 用例 9/9b/9c + 正控 10。**前后对照**：修复前同一 payload → body 文本「页面出错了 / 当前页面渲染遇到异常」、顶栏消失；修复后 → 正常显示「小学一年级」 | 低：过滤条件只要求 `name`，其它字段缺失仍能进入（与原行为一致） |
| B5-3 | 冒烟对错题本的覆盖只有「页面文本出现过 '错题'」，无法支撑 B3-2 的拆分 | 发布链只有 `dsh-smoke.mjs` | 新增 `scripts/verify-pages.mjs`（17 项）：注入 3 条确定错题 → 渲染 / 升序 / 切降序 / 详情 / Esc / 删除取消 / 设置面板 / 脏 payload / 无异常 | 全过 | 低：脚本直接操作 IndexedDB 与 DOM，选择器变化时需要同步维护 |

**全仓扫描结论（未发现问题的项，也记录以免重复排查）**

| 扫描项 | 结果 |
| --- | --- |
| `JSON.parse` | 2 处（`index.tsx:65`、`Typing/index.tsx:54`）均在 `try/catch` 内 |
| `dangerouslySetInnerHTML` / `eval` / `new Function` | `src/` 内 0 处 |
| React hooks 依赖 | 以 `react-hooks/exhaustive-deps: error` 全量跑一遍，0 违规 |
| `as any` / 非空断言 `!.` | 0 处（`KeyboardWithBarCharts` 的注释提到「不再用 as any」） |
| 除零 | `accuracy` 的 `inputSum` 有 `=== 0 ? 1` 兜底；`wpm` 有 `newTime > 0` 守卫；`getMixRatio` 有 `req < MIX_MIN_REQUIRED` 早退 |
| 定时器清理 | `useConfetti` / 打字页 interval / 移动端提示均返回 cleanup |

---

## 五之二、v10.1 追加三批（按同一套流程）

| 批次 | 提交 | 内容 | 验证 |
| --- | --- | --- | --- |
| F | `724f75a` | 音效设置 335 → 206 行：抽出 `SoundSwitchRow` / `SoundVolumeRow`，8 个同构 `useCallback` 合并为 3 个通用写值包装 | 新增 `verify-typing`（15 项）：4 开关 / 5 滑块 / 开关落盘 / 滑块键盘左移后 volume 1→0.9；冒烟 11/11；asar `4FFE28C0…` |
| G | `9334fe4` | Word 554 → 500 行：抽出 `WordDisplay.tsx`（展示层）与 `letterVisibility.ts`（可见性纯函数） | `verify-typing` 增 8/8b 默写模式（hideAll 全占位、关闭后恢复）；冒烟 11/11；asar `30B6FD37…` |
| H | `6102282` | 309 条核心回归**随仓库发布**（`scripts/core-regression`），`npm run test:core` 一条命令跑完；发布脚本与质量门禁的默认回归目录改指仓库内 | `npm run test:core`：309/309 + determinism pass；`dsh-release.ps1`（不加 `-SkipAudit`）实际调用仓库内脚本并通过 |

**为什么 Word 状态机没有继续拆（G）**：`flushStats` / `persistOnce` / `settleAttempt` 与 `wordStateRef`、
`attemptRef`、`dispatch`、`saveWordRecord` 互相引用，抽成 hook 需要对外暴露 6 个 ref/回调，接口比现状更宽；
拆错的代价是统计与记忆曲线被污染。因此只动「看得见的部分」，状态机保留原位并加区块注释。

| I | 本批（v10.2.0） | 修三个可验证缺陷：二次暂停丢更新（F5-003）、空词表 NaN（F5-005）、安装日志 BOM；`trans` 归一化 8 处中语义相同的 3 处合并（F5-004） | `test:typing` 增 5c（含反证）；`release-info`/安装日志无 BOM 且可 `JSON.parse`；`test:core` 309/309；四脚本 21/17/16/14；冒烟 11/11 |

### 批次 I 逐条

| # | 问题 | 根因 | 修复 | 验证 | 风险 |
| --- | --- | --- | --- | --- | --- |
| F5-003 | 继续练习后再次暂停，本次会话行**不更新**（正确/错误键数、用时丢失） | 暂停保存用 `wordCount` 判「有没有变化」；这一轮没练完新词时 `wordCount` 不变 → 整段跳过 | 改为「已完成词数 + 正确数 + 错误数 + 用时」的签名判重 | `test:typing` 5c：resume 后等 2.8s，`time` 1→3、`wordCount` 不变、行数仍为 1。**反证**：把判重回退成 `wordCount` 后同用例失败（`time` 停在 0） | 低：只在「同一会话内继续练」的路径上多写一次 upsert，仍是 update 不是 add |
| F5-005 | 空词表时结果页正确率 `0/0 = NaN`，界面上会出现 `NaN%`，错误分级全落 else 分支 | 未对 `chapterLength === 0` 兜底 | `chapterLength <= 0` 时返回 0 | 静态修复；**无法构造稳定复现路径**（正常流程不会进空词表的结果页），未做运行期复现 | 低：仅影响空词表；有词时逐字不变 |
| F5-004 | `trans` 归一化有 8 处各自实现，语义不一致 | 历史累积 | 新增 `utils/trans.ts` 的 `normalizeTrans`，合并**语义完全相同**的 3 处（learningPath / useWordList / DropdownExport）；其余 5 处保留并在文件头列了差异表 | `test:core` 309/309（learningPath 在算法路径上）；四脚本全过 | 中低：另 5 处「不过滤/不回退标量」的语义没动，仍是遗留 |
| F5-006 | 安装日志与 `release-info.json` 带 UTF-8 BOM，`JSON.parse` 直接抛 `Unexpected token` | `Set-Content -Encoding UTF8` 在 5.1 下写 BOM | 改用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` | 新生成的 `release-info.json` 与安装日志均 `BOM: false` 且 `JSON.parse` 通过 | 低：只影响这两个产物的编码 |

| J | v10.3.0 | **Word 结算逻辑整体抽出**（`useAttemptSettlement.ts`，147 行）：AttemptMeta / flushStats / persistOnce / settleAttempt / resetAttempt 全部迁出，`Word/index.tsx` 500 → 400 行；`trans` 归一化剩余 5 处全部并入 `normalizeTrans`（8/8 统一）；`test:typing` 增 4c / 5d | `test:typing` 18/18；`test:core` 309/309；四脚本 21/17/18/14；冒烟 11/11；双目录哈希一致 |

### 批次 J 逐条

| # | 内容 | 做法 | 验证 | 风险 |
| --- | --- | --- | --- | --- |
| J-1 | Word 的作答结算（增量上报 / 一次性落库 / 组合入口）与输入渲染混在 500 行里 | 抽到 `Word/useAttemptSettlement.ts`：`attemptRef`/`persistPromiseRef` 一并迁入，暴露 `flushStats`/`persistOnce`/`settleAttempt`/`resetAttempt`；组件只保留 `wordStateRef`、`pendingKeysRef` 与 settleRef 注册 | `test:typing` 18 项（含 4c 逐字母错因、5c 二次暂停 upsert、5d 暂停恢复不丢进度）；核心回归 309 | 中：这块是「统计与记忆曲线的唯一写入口」，接口逐一对照搬迁，无逻辑改写 |
| J-2 | `trans` 归一化最后 5 处（`Word` attempt meta、`autoLevel`、`memory`、`sessionRequeue`、`useGetWord`）语义各不相同 | 统一到 `normalizeTrans`（数组过滤非字符串 / 标量 `String` / 空 `[]`）；`src/utils/trans.ts` 头部写清 4 类旧语义与统一后的行为变化 | 核心回归 309/309（`learningPath`/`autoLevel`/`memory` 都在算法路径上）+ 四脚本全过 | 中：`autoLevel`/`sessionRequeue`/`memory` 现在接受标量 `trans`（原丢弃），`Word`/`useGetWord`/`memory` 现在过滤非字符串（原原样带），均为更健壮方向 |
| J-3 | 逐字母粒度缺用例 | `test:typing` 增 4c（完成后 `wordRecords.mistakes` 记录错误下标）与 5d（敲对一个字母 → 暂停 → 恢复，该字母仍为已答对） | 两项均通过 | 低 |

> 5d 的由来：原本想断言「暂停时 chapterData.correctCount 正好 +1」，用临时探针（`globalThis.__qzProbe`，
> 因为生产构建会 drop `console.*`）发现暂停时 `wordState.correctCount` 为 0 —— 原因是那一刻已切换到新词，
> 不是丢数据。于是把断言换成用户可见的不变式「暂停恢复后进度仍在」，实测通过。探针已全部移除。

| K | v10.4.0 | 空词表正确率抽纯函数 + 15 条单测（L-12 闭环）；建立**视觉回归基线**（L-11 残余风险闭环）；审计 `enhance.js`（2660 行）与 `db/data-export.ts` | `test:stats` 15/15；`test:visual` 2/2（连跑 3 次稳定）；其余脚本全过 |

### 批次 K 逐条

| # | 内容 | 做法 | 验证 | 结论 |
| --- | --- | --- | --- | --- |
| K-1 | 结果页正确率/错误分级写在 `useMemo` 里，空词表边界只能靠"进到空词表的结果页"复现 | 抽到 `ResultScreen/correctRate.ts`：`computeCorrectRate` + `mistakeLevelOf`，纯函数无依赖 | 新增 `scripts/verify-stats.mjs`（15 条）：0/0 → 0 而非 NaN、NaN/负数兜底、floor 取整、85/84/70/69 分档边界 | **L-12 闭环**：空词表语义（0%）第一次有了可执行断言 |
| K-2 | v10.2.1 全仓 prettier 含 tailwind class 重排，当时只用行为断言兜底 | 新增 `tests/e2e/visual.spec.ts`：错题本空态 + 设置面板两张基线截图（`maxDiffPixelRatio: 0.002`、禁用动画）；基线随仓库提交 | `npm run test:visual` 连跑 3 次 2/2 通过 | **L-11 残余风险闭环**：class 重排/样式漂移从此会被像素级对比抓到 |
| K-3 | 练习页当时也想入视觉回归 | 实测遮住当前词与数字后仍有 1916 px（ratio 0.01）抖动 —— 随机词 + 每秒计时 | 结论写进 spec 注释：练习页不入视觉回归，正确性由 `test:typing` 覆盖 | 记录「为什么不做」，避免以后重复踩 |
| K-4 | `local-fork/electron/enhance/enhance.js`（2660 行）从未审计 | 扫 `innerHTML` 插值、`JSON.parse`、`parseInt`、除法 `toFixed` | ① 唯一没套 `esc()` 的插值是键盘热区渲染，字符来自常量表而非用户数据；② 4 处 `JSON.parse` 全在 try/catch 内；③ `parseInt` 全部带 radix；④ `toFixed` 前都有 `n ?` / `st && st.ok ?` 守卫 | **未发现可改缺陷**，不改（不为改而改） |
| K-5 | `src/utils/db/data-export.ts` 的导入路径（唯一会批量写用户库的地方） | 逐段读导入流程 | 已有：文件头校验（formatName/databaseName/表存在）、临时库 staging、逐表行数比对、主库单事务 clear+bulkPut、失败回滚标记、残留临时库清理 | **实现完备，未发现缺陷** |

| L | v10.5.0 | 仓库一致性收尾：核心回归脚本去掉 `_v93` 历史前缀；文档里的「当前版本/提交数」改为指向唯一来源、不再硬编码；新增 `npm run test:all` | `test:core` 309/309（改名后）；`test:all` 一键通过；`test:visual` 2/2 |

### 批次 L 逐条

| # | 问题 | 做法 | 验证 |
| --- | --- | --- | --- |
| L-1 | `scripts/core-regression/` 里 11 个文件仍带 `_v93-` 前缀（历史遗留），与 `verify-*.mjs`、`dsh-*.ps1` 的命名风格不一致 | 去掉前缀：`build-core.mjs` / `harness.mjs` / `entry.ts` / `aggregate.mjs` / `determinism-check.mjs` / `stub-*.mjs`；生成的 `core.mjs` 与报告改名 `report-*.json`；同步 `run.mjs`、`README.md`、`dsh-release.ps1`、`quality-gate.ps1`、`.gitignore` 与 `src/utils/memoryLadder.ts` 的注释 | `npm run test:core` → 309/309 + determinism；`grep _v93` 全仓 0 命中 |
| L-2 | 文档里硬编码「当前应用版本」「fork 提交数」，每次发布都会过期（`DSH-FORK.md` 写 v9.15、`THIRD-PARTY.md` 写 v9.9、`DSH-FORK_EN.md` 写 29 提交/17 签名） | 改为指向唯一来源：版本 → `local-fork/package.json`；提交数 → 给出 `git rev-list --count` 命令；仅 `FORK-NOTICE.md` 保留一个带时点的统计（35/48，注明截至 v10.4.0） | 复查 `grep enhanced-v9.` 只剩**历史发布说明**（v9.11/v9.15 记录，属事实存档，不改） |
| L-3 | 验证入口分散在 8 个命令里，发布前容易漏跑 | 新增 `npm run test:all`：quality → stats → core → start-level → pages → typing → csv；`test:visual` 因需 dev server 单独说明 | 直接跑 `test:all`，7 段全绿 |

| M | v10.6.0 | 前端整洁度专项：`utils/index.ts`（168 行杂物桶）按领域拆成 6 个文件、只剩 14 行 re-export；删除 3 条无人引用的全局样式与 5 段无人引用的 keyframes；移除 13 个未被引用的依赖；7 处 `React.FC` 收敛为函数组件；新增 `docs/CONVENTIONS.md` | `test:all` 全绿；`test:visual` 2/2（删除样式后截图未变）；构建产物 index chunk 468.16 kB |

### 批次 M 逐条

| # | 问题 | 做法 | 验证 |
| --- | --- | --- | --- |
| M-1 | `src/utils/index.ts` 168 行同时放键盘判定、平台判定、Howl 监听、日期格式化、数值取整、数组交集、章节计算 | 拆为 `keyboard.ts` / `platform.ts` / `time.ts` / `number.ts` / `chapter.ts` / `audio.ts`；`index.ts` 退化为 14 行纯 re-export，**对外 API 与全部调用点不变** | tsc + eslint 通过；`test:all` 全绿 |
| M-2 | `src/index.css` 里有 3 条类与 5 段 keyframes 无人引用（`gradient-text` / `text-shadow` / `typewriter` + `gradient-text-hue` / `typing` / `blink-caret` / `hideCaret` / `gradientBG`） | 逐块删除（花括号配对校验），文件 168 → 143 行 | `test:visual` 2/2 —— 截图基线未变，证明删除的确实是死样式；构建通过 |
| M-3 | `package.json` 里 13 个包没有任何 import（6 个 radix、react-table、dexie-react-hooks、embla-carousel、lucide-react、react-timer-hook、source-map-explorer、@tailwindcss/postcss7-compat） | `npm uninstall` 并更新锁文件；保留 `immer`（use-immer 的 peer）、`@iconify/json` 与 `@svgr/*`（unplugin-icons 构建期需要） | `npm run build` 通过；`test:all` 全绿 |
| M-4 | 组件声明风格两套：30 处 `export default function` vs 7 处 `React.FC` | 7 处改为函数声明（含 `memo` 的两处先声明再 `memo(X)`），清理因此失效的 `import type React` | tsc + eslint 零告警；`grep React.FC` 命中 0 |
| M-5 | 没有成文的代码约定，风格靠口口相传 | 新增 `docs/CONVENTIONS.md`：分层、组件写法、样式、utils 放置、命名、验证矩阵、提交与发布、Electron 侧约束；README 中英与 CONTRIBUTING 均已链接 | 文档链接检查 0 断链 |

| N | v10.7.0 | 入口与文案收敛：增强工具入口从顶栏按钮并入「设置 → 关于」；删除增强面板的「关于」页（-3456 字符）；设置页 4 段重复 JSX → 一次 map（150 → 131 行）；版本号改为构建期注入 | `test:pages` 扩到 19 项（五页签 / 关于页版本 / 顶栏无「工具」）；`test:all` 全绿；视觉基线已按新页面重建 |

### 批次 N 逐条

| # | 问题 | 做法 | 验证 |
| --- | --- | --- | --- |
| N-1 | 「关于」是两处重复且都是一屏文字：增强面板一个 tab（版本 + 逐版本功能清单 + 已知限制，3456 字符），前端没有关于页 | 面板删除整个「关于」页签；前端新增 `Setting/AboutSetting.tsx`（版本 + 提交 + 上游 + 仓库链接 + 桌面端「打开增强工具」按钮），约 80 行 | `test:pages` 7d：关于页显示的版本号与 `local-fork/package.json` 一致 |
| N-2 | 增强工具入口是顶栏一个「工具」按钮，与「设置」并列，用户要记两个入口 | 移除顶栏按钮与 `EnhanceButton` 组件；入口统一到「设置 → 关于 → 打开增强工具」（仅桌面端显示） | `test:pages` 7e：顶栏无独立「工具」按钮 |
| N-3 | 设置页签列表是 4 段几乎相同的 JSX（每段 11 行）；图标两套（heroicons + tabler）混用 | 抽 `SETTING_TABS` 常量 + 一次 `map`，图标统一为 tabler；文件 150 → 131 行 | 五页签断言（7c）+ 设置面板截图基线 |
| N-4 | 前端拿不到版本号，只能硬编码或再读文件 | `vite.config.ts` 构建期从 `local-fork/package.json` 注入 `APP_VERSION`（与 `LATEST_COMMIT_HASH` 同一处），`vite-env.d.ts` 声明 | 关于页显示值与包版本一致（7d） |
| N-5 | 增强面板三处长说明各 2–3 句（升级条件 / JSON 含什么 / 自动备份路径） | 各压成一句（保留可操作信息，删掉实现细节与版本号回顾）；文档里「顶栏『工具』」的表述同步改 | `node --check` 通过；文档 `grep 工具页` 归零 |

---

## 五之三、v11.0.0（批次 P）：删除注入式面板，统一到设置

| # | 问题 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| P-1 | 增强工具是独立 Shadow DOM 面板（2605 行，自带 CSS/页签/状态），与设置面板两套 UI；v10.7 只在关于页加入口，是跳板不是合并 | 面板先于设置页存在，逻辑与视图写在一起（`renderXxx` 直接改 DOM），React 无法复用 | 删除整页 UI（净减 937 行：删 2227 / 增 1290）；保留无头 `window.qzRuntime`（统计/洞察/查词/到期复习/导入导出/词库切换/自定义词库）；React 重建 5 个区块 | 冒烟 13/13（7 页签 + runtime + collectStats 结构）；`test:pages` 20 项 |
| P-2 | 设置无桌面能力，组件直接摸全局对象 | 没有桥接层 | `src/utils/desktop.ts`：唯一访问点 + 类型 + `isDesktop()`；网页返回 null，页签按 `desktopOnly` 过滤 | tsc 通过；网页版视觉基线仍 5 页签 |
| P-3 | 单面板抛错会让整个设置白屏 | 无错误边界 | `SettingBoundary` 按页签隔离，可重试 | 代码级；`test:pages` 打开各页无异常 |
| P-4 | 数据页一次打开把 `wordRecords` 读两遍 | 两个采集函数各自 `idbAll` | 3s TTL + 顺序调用 | 冒烟 `statsRuntime` 校验返回结构 |
| P-5 | 番茄钟 `setState` updater 内有副作用；键音音量每像素写盘 | 建模方式 | 结束时间戳 + 轮询；滑块 `preview/commit` 分离 | `test:typing` 6d 仍通过（音量滑块） |

**为什么删掉面板而不是继续维护两套**：面板的 74 条 CSS 规则、4 个页签、8 个 `#btn-*` 绑定、5 个 `refreshXxxUI`
都只服务于那一份 DOM；设置页已有同一批开关的等价实现（音效/显示/数据）。两套 UI 必然继续漂移，
且面板无法复用应用的错误处理、主题与可访问性。合并后只剩一套控件（Headless UI Switch + Radix Slider + Tailwind）。

**顺带删除的脆弱路径**：词库切换的官方画廊 DOM 自动化（`trySwitchViaOfficialUI` / `findAppTrigger` / `isUnsafeSwitch`，约 160 行）
改为直接写 `currentDict/learningMode/currentChapter` 后重载；缺 `id` 的词库给出明确提示并跳到词库页。

---

## 五之四、v11.1.0（批次 Q）：兼容性与可移植性

| # | 问题 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| Q-1 | 三个桌面验证脚本写死作者机器的 exe 路径，其他人无法运行 | 复制粘贴的临时默认值散落在脚本里 | 新增 `scripts/lib/desktop-app.mjs`：显式参数 / 环境变量 / 仓库产物目录 / 平台后缀，找不到时给出可执行提示 | `test:all` 88 项通过（用 `QZ_TEST_APP_DIR` 定位） |
| Q-2 | `test:visual` 依赖手工起 dev server | Playwright 配置里 webServer 被注释 | 检测本地 baseURL 时自动启动并复用 | 关掉服务后直接 `npm run test:visual` → 2/2 |
| Q-3 | 设置对话框固定 800×480，1366×768 以下的窗口会溢出 | 早期只考虑作者屏幕 | 宽度/高度改 `min()` 表达式，侧栏 176→208px 断点 | 1280×800 桌面视觉基线 0.000% |
| Q-4 | Linux 上「开机自启」开关可点但无效 | `app.setLoginItemSettings` 仅 macOS/Windows | 主进程拒绝写入，界面置灰并注明平台限制 | 代码级；`platform` 由 preload 暴露 |
| Q-5 | 词库页首开为 385 个文件各解析一次 JSON | 计数取数组长度，未用元数据 | 优先 `dict-meta.json` 的 `length`，缺失才读文件 | 桌面视觉 dict 页 0.000%，列表词数正常 |
| Q-6 | **切页偶发错位**：点「数据设置」落到「高级设置」 | `Tab.Panel unmount` 时 Headless UI 会注销 Panel 并重算选中索引，注销时序与点击竞争 | 改 `LazyPanel`（首次激活后保持挂载） | 桌面视觉连跑 3 次 4/4；`test:pages` 7c/7f 通过 |
| Q-7 | 桌面 UI 只有临时截图，没有可复跑的基线 | 没有像素对比依赖 | 新增 `test:desktop-visual`（pixelmatch + pngjs，固定视口、按平台命名基线） | 4 页连跑 3 次差异 0.000% |
| Q-8 | 本 fork 没有针对 feature 分支的 CI | 上游 workflow 只监听 master/dev | 新增 `quality-fork.yml`：typecheck + lint + build + stats + core | YAML 语法检查；命令与本地一致 |

---

## 六、遗留清单（未改或无法闭环，附具体差距）

| # | 项 | 状态 | 差距 / 原因 |
| --- | --- | --- | --- |
| L-1 | `WordPanel/Word/index.tsx` 拆分 | **已闭环**（v10.3.0，554 → 400 行） | 展示层（`WordDisplay`）、可见性规则（`letterVisibility`）、作答结算（`useAttemptSettlement`）三块已拆出；组件只剩输入处理与编排 |
| L-2 | `Setting/SoundSetting.tsx` | **已闭环** | 335 → 206 行 + 两个行级组件；由 `verify-typing` 的 6/6b/6c/6d 覆盖 |
| L-3 | `trans` 归一化重复 8 处 | **已闭环**（v10.3.0） | 8 处全部并入 `normalizeTrans`（`learningPath` / `useWordList` / `DropdownExport` / `Word` attempt meta / `autoLevel` / `memory` / `sessionRequeue` / `useGetWord`）；4 类旧语义与统一后的行为变化写在 `src/utils/trans.ts` 头部；由 309 条核心回归 + 四脚本把关 |
| L-4 | 结果页空词表 `0/0 → NaN` | **已闭环（约定 0%）** | `chapterLength <= 0` 直接返回 0；约定「没有词就没有正确率可言，按 0% 处理」写在代码注释与发布说明里。仍无法构造复现路径，属代码级验证 |
| L-5 | 暂停时若已完成词数未变，不重复 upsert | **已修 + 已反证** | 见 F5-003：改签名判重，`test:typing` 5c 覆盖，并将判重回退后确认用例会失败 |
| L-6 | Electron CSP 解析失败时回退 `script-src 'self' 'unsafe-inline'`（AUDIT L2） | **接受风险** | 改 fail-closed 会在 `index.html` 结构变化时白屏；当前实测走 sha256 分支 |
| L-7 | 发布脚本默认路径是作者本机布局（AUDIT M5） | **接受风险** | 全部支持 `QZ_*` 环境变量覆盖，`local-fork/README` 与 QUICKSTART 已说明；改默认值会破坏本机发布链 |
| L-8 | 仓库是**浅克隆**（AUDIT S4） | **已闭环**（v10.3.0） | 已执行 `git fetch --unshallow`（补全上游历史，未合并任何上游代码、未改工作树）。收益：用 git 历史复核了 5 本本地补回词库（上游 0 条提交）+ 确认其余 380 本与基线逐字节一致，见 `docs/THIRD-PARTY.md` §3 |
| L-9 | 309 条核心回归脚本不在仓库 | **已闭环** | 已迁入 `scripts/core-regression`（路径仓库相对、产物 gitignore、`npm run test:core`），发布脚本默认改指仓库内。局限（非差距）：它是 stub 化的纯算法仿真，不等于真实浏览器/Electron 环境；界面/交互由冒烟、`test:pages`、`test:typing`、`test:visual` 覆盖 |
| L-10 | 提交推送 | **已闭环** | 分支与标签均已推到 `menlieyijin/qwerty-learner`，远端与本地 HEAD 一致。推送路径有两种（都记录了）：① v10.2.1 之前：临时 unset 全局 `url.*.insteadOf` + 清空 `*_PROXY` 后 `git push` 直连；② v10.3.0：github.com:443 已完全不可达（6 次重试均 TCP 超时，直连与本地代理都不通），改用 GitHub **Git Data API**（`gh api` 建 blob → tree → commit → 更新 ref）复刻同一个提交，因元数据逐字一致，远端 commit SHA 与本地**完全相同**（`7352e3d`）。均未走 ghfast 传凭据 |
| L-11 | 全仓 prettier 未统一 | **已闭环**（v10.2.1 格式化 + v10.4.0 视觉回归） | 格式化 18 个文件；v10.4.0 补上视觉基线（`test:visual`，2 张截图，连跑 3 次稳定），原「无像素级手段」的残余风险已消除。局限：基线是本机 Chromium 产物，换机器需 `--update-snapshots` 重建 |
| L-12 | 结果页空词表的正确率语义 | **已闭环**（v10.4.0） | 抽成 `computeCorrectRate` 纯函数，约定 0% 并写进注释/发布说明；`scripts/verify-stats.mjs` 用 15 条断言把这个边界固定下来 |

---

## 七、版本与提交对照

| 版本 / tag | 提交 | 内容 | 隔离冒烟 | 双目录 asar SHA256 |
| --- | --- | --- | --- | --- |
| `v9.15-base` | `ce7eb79` | 起点（v9.15.1） | — | — |
| `v9.16-batchA` | `0237034` | npm 化 + 非 git 构建修复 | 11/11 | `E4CD6F08…` |
| `v9.17-batchB` | `8af6799` | 起点选择 + 21 项行为验证 | 11/11 | `52D2B433…` |
| `v9.18-batchC` | `f5cbe6c` | 前端清理 F1/F2/F3 | 11/11 | `B288FC3F…` |
| `v9.18-batchD` | `bb2ffb5` | README 项目化 + 英文版 | （产物未变） | 未重复安装 |
| `v9.19-batchE` | `39d3dd4` | CSV 注入 + 脏 payload + 页面回归 | 11/11 | `4FF118FD…` |
| `v9.19.1` | `56b9c04` | 格式化收尾 | 11/11 | `4FF118FD…` |
| `v10.0.0` | `a8dc39e` | 版本号 + 发布说明 + 三份交付文档 | 11/11 | `F42835A7…` |
| `v10.1-batchF` | `724f75a` | 音效设置拆分 + verify-typing | 11/11 | `4FFE28C0…` |
| `v10.1-batchG` | `9334fe4` | Word 展示层拆分 | 11/11 | `30B6FD37…` |
| `v10.1-batchH` | `6102282` | 核心回归入仓 + 脚本默认路径 | `test:core` 309/309 | `B5E03BA9…` |
| `v10.2.0` | `b9c4f4e` | 二次暂停丢更新 / 空词表 NaN / 日志 BOM / trans 去重 | 11/11 | `8D4DF7C6…` |
| `v10.2.1` | `ca6e36d` | 全仓 prettier | 11/11 | `363CDF30…` |
| `v10.3.0` | `7a2b83f` | Word 结算抽离 + trans 8/8 + 完整历史 | 11/11 | `22ACE837…` |
| `v10.4.0` | `b40d9fc` | 空词表单测 + 视觉回归 + 两个大文件审计 | 11/11 | `042E511D…` |
| `v10.5.0` | `5c1d30f` | 回归脚本去 `_v93` 前缀 / 文档去硬编码 / `test:all` | 11/11 | `540BE1B6…` |
| `v10.6.0` | `99b489b` | utils 拆域 / 死样式 / 13 个死依赖 / `React.FC` 统一 | 11/11 | `4972FC04…` |
| `v10.7.0` | `7be65e1` | 增强面板「关于」页删除 + 设置页重构 + 审查报告 | 11/11 | `0A3D27B4…` |
| `v11.0.0` | `bb7456c` | 删除注入式面板，功能重建为设置内的词库/工具/数据/显示/音效区块 | **13/13** | `1169D76C…` |
| `v11.0.1` | `e38f5bb` | 桌面面板文字对齐 + 词库筛选文案/宽度 | **13/13** | `A1F9A90A…` |
| `v11.1.0` | 本次提交 | 跨平台脚本路径 / 响应式设置 / 桌面视觉回归 / Linux 自启 / 切页错位 | **13/13** + 桌面视觉 4/4 | `ADC627A8…` |

> 回滚点同时保存在 tag（`v9.16-batchA` … `v10.0.0`）与分支历史里；回退前的 HEAD 另存为
> `archive/v10-baseline-20261029` / `backup/v10-baseline`（均为 `b97eb62`，即本次「回退到 v9.15 重做」之前的树），
> 更早那次 v9.16/v9.17 尝试仍在 `backup/v9.16-v9.17` 与 `v9.17-archive`。
