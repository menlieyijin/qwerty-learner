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

## 六、遗留清单（未改或无法闭环，附具体差距）

| # | 项 | 状态 | 差距 / 原因 |
| --- | --- | --- | --- |
| L-1 | `WordPanel/Word/index.tsx`（554 行）拆分 | **未做** | 输入状态机（`settleAttempt`/`flushStats`/`persistOnce` 相互引用），缺少逐操作页面用例；拆错会直接污染统计与落库 |
| L-2 | `Setting/SoundSetting.tsx`（335 行）拆分 | **未做** | 11 个表单回调 + 受控滑块，改动面大而收益是「可读性」；无逐开关用例 |
| L-3 | `trans` 归一化为 `string[]` 的逻辑重复 8 处（`learningPath` / `useWordList` / `Word` / `autoLevel` / `memory` / `sessionRequeue` / `useGetWord` / `DropdownExport`） | **未改** | 四处语义并不一致（有的过滤非字符串、有的 `String()` 兜底、有的不处理），统一会改变其中若干处的边界行为；需先统一口径再动 |
| L-4 | 结果页在「词表为空」时 `correctCount / chapterLength` = `0/0` → `NaN`（`ResultScreen/index.tsx:99`） | **未改** | 无法构造稳定复现路径；且「空词表算 0% 还是 100%」是产品决策，不擅自定 |
| L-5 | 暂停时若已完成词数未变，不重复 upsert 会话记录（`Typing/index.tsx:200`） | **未验证** | 需要「同一词多打几个字母后再次暂停」的埋点用例；目前只是读代码推断，按规则不当作缺陷处理 |
| L-6 | Electron CSP 解析失败时回退 `script-src 'self' 'unsafe-inline'`（AUDIT L2） | **接受风险** | 改 fail-closed 会在 `index.html` 结构变化时白屏；当前实测走 sha256 分支 |
| L-7 | 发布脚本默认路径是作者本机布局（AUDIT M5） | **接受风险** | 全部支持 `QZ_*` 环境变量覆盖，`local-fork/README` 与 QUICKSTART 已说明；改默认值会破坏本机发布链 |
| L-8 | 仓库是**浅克隆**（AUDIT S4） | **无法处理** | `fetch --unshallow` 会拉取上游全部历史，与「不拉取上游代码」的指令冲突；影响 5 本第三方词库的来源核验（`docs/THIRD-PARTY.md` 已按可查证据登记） |
| L-9 | 309 条 SRS / 自动进阶回归脚本不在仓库 | **无法闭环** | 位于作者本地审计目录；公开用户只能跑 `test:quality` / 冒烟 / 三个行为脚本 |
| L-10 | 6 个提交**未推送**到 fork | **按指示未推** | 远端 `fork/dsh-local-v8` 仍停在 `8ae7577`；本地领先 17 个提交（含本次 6 个） |

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
| `v10.0.0` | 本次提交 | 版本号 + 发布说明 + 三份交付文档 | 11/11 | `F42835A7…` |

> 回滚点同时保存在 tag（`v9.16-batchA` … `v10.0.0`）与分支历史里；回退前的 HEAD 另存为
> `archive/v10-baseline-20261029` / `backup/v10-baseline`（均为 `b97eb62`，即本次「回退到 v9.15 重做」之前的树），
> 更早那次 v9.16/v9.17 尝试仍在 `backup/v9.16-v9.17` 与 `v9.17-archive`。
