# Release Notes — v9.15（含 v9.12 / v9.13 / v9.14）

| 项 | 值 |
| --- | --- |
| 应用版本 | `1.0.0-enhanced-v9.15` |
| 分支 | `dsh-local-v8` |
| Tag | 尚未打（建议 `v9.15-dsh-local`；v9.12–v9.14 为中间批次，不打 tag，仅保留 `v9.1x-pre-batchX` 打点） |
| 仓库 | [menlieyijin/qwerty-learner](https://github.com/menlieyijin/qwerty-learner)（非官方分支） |
| 上游基线 | `RealKai42/qwerty-learner` @ `1182426f2bd0a28c95302c33f9e19136b1262a70` |
| 许可证 | GNU GPL v3.0（见根目录 `LICENSE`） |
| 发布日期 | 2026-10-28 |
| 作者署名 | `dsh <dsh@dsh.local>` |
| 提交 | v9.12 `f7f2c99`、v9.13 `d5064fd`、v9.14 `980bb5a`、v9.15 `1fb2b0f` |

> 本版本是**连续四批审计修复**：先由 6 路只读审计对 v9.11（`be1e715`）通读全仓，产出 96 条 finding（3 条 P1 / 32 条 P2 / 61 条 P3，两个 P1 在架构域、一个在核心算法域），再按写域分四批落地——**架构基座 → 核心与数据 → 交互与页面 → 外壳与工程**。四批都不改学习算法语义（阈值 / 比例 / 出题顺序 / 到期口径）、不改 UI 交互流程与文案、不改数据表结构；仅 4 处行为变化属"纠正异常路径或视觉错字"，见 2.5。
> **装 v9.15 即包含前三批**，不需要逐版安装。分支声明与 GPL 合规见 [`FORK-NOTICE.md`](../FORK-NOTICE.md)，技术细节见 [`DSH-FORK.md`](DSH-FORK.md)。

## 1. 概览

| 版本 | 一句话 | 影响面 |
| --- | --- | --- |
| v9.12 | 架构基座：拆掉 `@/utils` 聚合导出与 `utils/db` 里的 React hook，依赖环 4→0、死代码 536 行 | 全仓 import 结构、数据层可脱 React 复用；无运行时行为变化 |
| v9.13 | 核心与数据层 19 项：词库部分加载失败不再被当成"本级完成"，SRS 写库不再整对象覆盖 | 自动进阶进度判定、SRS 落库、导入导出失败路径 |
| v9.14 | 交互与页面 22 项：超长输入不再越界、统计区间不再每帧重查、可访问性补齐 | 打字判定边界、分析/错题本/词库画廊渲染；2 处像素变化 |
| v9.15 | 外壳与工程 11 项：冒烟悬挂、首帧深色闪烁、词库缓存不失效、脏设置、失败清理 | Electron 外壳、发布/回滚脚本；无学习功能变化 |

四批合起来解决的问题：

1. **一个失误就能毁掉进度的路径**：本级词表按文件分批加载，任一文件 500 时残缺词表会被当成"已见 100%"，`levelId` 直接跳级且没有回退入口（P1）。
2. **架构上"改一处、炸一片"**：`import '@/utils'` 会连带初始化 jotai store、mixpanel 与 377 条词库对象；`utils/db` 内嵌 3 个 React hook 反向依赖页面 store，形成 7 文件大环——分层规则无法成立，Node 侧仿真必须给 4 个模块打 stub。
3. **静默失败太多**：导出失败不给提示、导入失败显示 100%、统计读失败被渲染成"0 次"、原子写入被并发覆盖、设置里能持久化 `dailyGoal:"abc"` 这类脏值。
4. **交互层的真实越界**：一次粘贴/长按长于词长时 `letterMistake` 下标越界、复习末词点"下一个"被误记 Skip、code 词库长按累积误触发自动 Skip。

## 2. 详细变更

> 每批只列**代表性条目**与编号；完整证据、复现脚本与"已检查无问题"清单在审计目录 `audit/v912/M{1..6}-*/FINDINGS.md`（未随仓库发布）。批次取舍与"明确不修"清单见 `audit/v912/MASTER-TRIAGE.md`。

### 2.1 v9.12 架构基座（`f7f2c99`，14 条）

| 编号 | 内容 |
| --- | --- |
| M6-001 (P1) | 拆掉 `@/utils` 的 `export * from './mixpanel'`，17 处改为直引；telemetry 初始化仍在 `index.tsx` 唯一调用点（side-effect 只减不增）。本条是 4 个依赖环的主断点（其余三个由 M6-002/006/007/008 断开） |
| M6-002 (P1) | `utils/db/index.ts` 里内嵌的 3 个记录写入 hook 迁出（→ `src/hooks/useRecordMutations.ts`、`pages/Typing/hooks/`），数据层不再 import `pages/**` |
| M6-006 / M6-007 / M6-008 (P2) | `PhoneticType` 并为 `PronunciationType` 别名、词库类型落位 `typings/resource.ts`；`WordUpdateAction` 迁至 `WordPanel/components/types.ts`；`GalleryContext` 迁至 `Gallery-N/context.ts` —— 消掉 3 个 type 环与页面入口双环 |
| M6-005 (P2) | `idDictionaryMap` 收紧为 `Record<string, Dictionary \| undefined>`，类型不再说谎 |
| M6-009 / M6-010 (P2) | 删 4 个零引用 atom；字体默认值 48/18 由三处不一致收敛为单一定义 |
| M6-011 / M6-003 (P2/P3) | `groupBy` 保留 `__proto__` 键、`clamp` 处理 `NaN`、`shuffle` 支持注入 rng、`range` 签名对齐；`atomWithStorage` 写失败不再抛出（配额满不再白屏） |
| M6-013 / M4-013 (P3) | 删 `components/Drawer`、`utils/range.ts`、8 个零引用 `ui/` 组件（提交记录为 10 文件 / 536 行死代码；`hooks/useIntersectionObserver.ts` 42 行在 v9.14 随 M4-011 一并删除） |
| M6-015 (P3) | `classNames` 标 `@deprecated` 指向 `cn`，不批量替换（避免冲突类表现变化） |

### 2.2 v9.13 核心与数据层（`d5064fd`，19 条）

| 编号 | 内容 |
| --- | --- |
| M1-001 (P1) | **部分加载误判**：`loadLevelWords` 收集 `failed[]` 后抛错，交由既有 `load-failed` 分支处理——`done=false`、`levelId` 不动、残缺词表不进缓存，下次恢复后自愈。复现：`primary-1` 第 2 个文件 500，修复前 `done=true` 并跳级 |
| M1-003 (P2) | 两处整对象 `bulkPut` 改为字段级 `update`（只写 `{due}` / `{trans,phone}`），不再覆盖并发作答造成的丢失更新 |
| M1-002 (P2) | 迁移链的 `localStorage` 读写加 `try/catch`，存储被禁不再让整条迁移永久 rejected，下次启动可重试 |
| M1-008 (P2) | 区分"读失败"与"空表"：读失败 `console.error` 明示"数据仍在库"，补释义写库失败不再退化成空表 |
| M2-001 (P2) | 章节记录 reset effect 依赖补 `currentChapter`（暂停行不再被下一章改写） |
| M2-002 / M2-007 (P2) | 导出失败补 `try/catch` + 提示并复位按钮；导入失败不再显示 100% |
| M2-004 (P2) | 内层 `catch` 不再吞错，3 处上层兜底重新可达 |
| M2-009 (P3) | 导出文件名加时分秒（见 2.5） |
| 其余 | M1-004 阶梯/阈值引用单一来源、M1-005/006 注释纠错、M1-015/016/017 类型与零引用导出收紧、M2-005 key 注释、M2-006 删 `revision*` 表声明与 3 个只读 getter（不动已装库、不加 Dexie 版本）、M2-011 `localStorage` 键收敛到 `constants` |

### 2.3 v9.14 交互与页面（`980bb5a`，22 条）

| 编号 | 内容 |
| --- | --- |
| M3-001 (P2) | 一次输入事件长于词长时，判定上界由 `inputLength` 夹到 `min(输入长, 词长)`，`letterMistake` 下标不再越界；hint 新增"重复输入了 / 多输入了"。正常逐字路径新旧对跑 diff 为空 |
| M3-002 (P2) | `TextAreaHandler` 过滤长按 repeat（code 词库长按不再累积 4 错触发自动 Skip） |
| M3-003 (P3) | 复习末词点"下一个"不再误记 Skip（仅去误记，UI 与结算不变） |
| M3-005 / M3-006 (P2) | 23 个 `aria-label`（Slider 挂在 Thumb）、键盘可达、`img` alt —— 最小改动，不引入焦点陷阱 |
| M4-002 (P2) | `Analysis` 统计区间改用 `useState` 初始化（原来在渲染期调 `dayjs()`，每次重渲染都整年重查 + 5 张图表重建） |
| M4-003 (P2) | 统计补 `try/catch` 与错误态，丢弃过期查询结果；读取失败不再伪装成"暂无数据" |
| M4-004 (P3) | 新增 `CloseButton` 替换 4 处 `svg onClick`（可聚焦/可播报），错题本支持 `esc` 返回 |
| M4-005 / M4-008 / M4-011 / M4-012 (P2/P3) | Gallery 跨语言 tag 回落、`data-tip`（全仓无实现）改 `title`、已学词数由每卡各算一次改为页面算一次 + Map 查找、错题本 `find` → `Map` |
| M4-016 (P3) | 两处 Tailwind 类名拼写修正（**本批唯一的像素变化**，见 2.5） |
| 其余 | M4-014/015/017/018 重复常量与空态抽取、类型断言收窄、恒真判断与 `'false'` 类名清理；顺带删除因 M4-011 失去引用的 `hooks/useIntersectionObserver.ts` |

### 2.4 v9.15 外壳与工程（`1fb2b0f`，11 项）

| 编号 | 内容 |
| --- | --- |
| M5-001 / M5-002 (P2) | `dsh-smoke.mjs` 增加单次 CDP 超时（15 s）、全局看门狗（90 s，`QZ_SMOKE_TIMEOUT` 可调）、`ws close` 拒绝未决 promise；启动三判由"一次性 1.5 s 快照"改为轮询（15 s），消除冷启动误报与脚本悬挂 |
| M5-003 (P3) | 窗口状态写盘 400 ms 去抖 + `close` 时 flush（原来每帧同步写盘） |
| M5-004 (P3) | `index.html` 首帧深色改读真实键 `isOpenDarkModeAtom` 并包 `try/catch`（旧键 `state` 已无写入方，显式设过主题的用户每次启动会闪一帧深色） |
| M5-006 (P3) | 词库下载/清空后失效主进程 5 个缓存（原来要重启才生效） |
| M5-008 (P3) | `app.getPath` 加 `safeGetPath` 兜底（`appData` → `home` → `__dirname`），Documents 不可用不再启动即崩 |
| M5-012 (P3) | `app:updateSettings` 按 `DEFAULT_SETTINGS` 逐键做类型守卫（见 2.5） |
| M5-016 / M5-017 (P3) | 发布失败清理 `.tmp-*` 临时 asar；`dsh-rollback.ps1` 目标与当前相同时**默认中止**（见 2.5） |
| M5-005 (P3) | 补齐 `ket2021` / `Yilin1-3` 四个现役词库的元数据（取自 `dictionary.ts` 真实条目） |
| M5-010 / M5-011 (P3) | 删 enhance 侧死 DOM/函数与 preload 幽灵通道（`app:settings`、`clipboard:get`、`getClipboard`） |

### 2.5 四处可感知的行为变化

四批整体按"行为等价"推进，只有下面 4 处会被用户或外部脚本感知：

| # | 变化 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | **两处像素变化** | M4-016，`DictionaryWithoutCover.tsx`、`Loading/index.tsx` | ① 词库画廊浅色模式下**未选中卡片的简介文字由黑转灰**（原类名 `textdelayDuration-gray-600` 不是合法 Tailwind 类，`text-gray-600` 从未生效）；② 首屏 **Loading 遮罩由透明转不透明**（`bg-[#faf9ff;]` 多了一个分号，任意值类生成失败；`ErrorBoundary` 用的正确写法是 `bg-[#faf9ff]`）。两处都是恢复设计意图，不涉布局与间距 |
| 2 | **导出文件名格式变化** | M2-009，`src/utils/db/data-export.ts` | `Qwerty-Learner-User-Data-YYYYMMDD.gz` → `Qwerty-Learner-User-Data-YYYYMMDD-HHmmss.gz`。原来同一天多次导出会重名互相覆盖；**若有外部脚本/备份任务按文件名匹配 `.gz`，需要同步调整**（仓库内无此模式） |
| 3 | **无操作回滚现在需要 `-Force`** | M5-017，`scripts/dsh-rollback.ps1` | 当选中备份与当前安装的 `app.asar` 内容相同时，脚本原来只打印"需加 `-Force`"却照常执行；现在**默认中止（exit 0）并提示**，加 `-Force` 才重放一次替换。语义从"提示"变为"拒绝" |
| 4 | **`app:updateSettings` 会丢弃非法设置值** | M5-012，`local-fork/electron/main.js` | 按 `DEFAULT_SETTINGS` 的声明类型逐键守卫：类型不符 → 忽略并记 `logError('settings-invalid')`；数字必须是有限数；`opacity` 收敛到 `[0.3, 1]`、`zoom` 收敛到 `[0.6, 1.6]`（与 `win:setOpacity` / `win:setZoom` 一致）；`darkMode` 显式放行 `null`（跟随系统）。**导入一份手改过的全量 JSON 时，脏值不再被持久化**，而是被跳过 |

## 3. 架构与门禁变化

### 3.1 依赖分层

本轮把"分层"从口头约定变成可检测的规则（目标层次，数字越小越底层，只允许低层 → 高层）：

```
typings / constants (0) < resources (1) < utils (2) < store (3) < hooks (4) < components (5) < pages (6)
```

- **唯一豁免**：入口 `src/index.tsx`（应用引导点，路由表必须在最外层组装）。
- **动态 import 不计入**：`utils/db/index.ts ↔ utils/autoLevel.ts` 的双向 `await import()` 是为规避 TDZ 的刻意设计，脚本单独列出（当前 7 条动态边）。
- **检测方法（Tarjan SCC）**：审计脚本 `audit/v912/M6-shared/repro/scan-graph.mjs` 解析 `src/**` 的全部静态 import/export，构建文件级依赖图后用 Tarjan 求强连通分量，再按层次表统计"低层 → 高层"的逆向边；输出首行为 `files=… edges=… scc(>1)=…`，其后列出逆向边明细。用法：`node scan-graph.mjs <src 目录>`。
- **本轮结果**：`scc(>1)=0`（审计前为 4 个静态环），入口 `index.tsx` 的两条边属豁免。**逆向依赖未完全归零**：审计前按提案层次为 6 条，当前实测剩 3 条——`utils/mixpanel.ts` → `@/store`（值导入 8 个 atom）、`utils/mixpanel.ts` → `pages/Typing/store/type`（仅类型）、`resources/dictionary.ts` → `@/utils`（`calcChapterCount`）。前两条属 M6-001 的"只拆聚合导出、不搬 mixpanel"边界，第三条是"把 `resources` 抬到 `utils` 之下"的计划未落地，一并记入第 6 节已知问题与第 7 节后续。
- **落地程度（如实说明）**：分层规则目前**只在文档与审计脚本层面成立**；`.eslintrc.cjs` 未加 `no-restricted-imports` 规则，`quality-gate.ps1` 也没有 `-WithArch` 开关，`scan-graph.mjs` 不随仓库发布，也不返回非零退出码。也就是说它现在是"可复核的验收记录"，不是 CI 硬门禁。

### 3.2 其他结构性变化

- **数据层脱 React**：`utils/db/index.ts` 不再 import `pages/**`，SRS 仿真不必再为页面 store 打 stub（M6-002）。
- **聚合导出收敛**：`@/utils` 不再顺带初始化 mixpanel 与 store；引用 `@/utils` 的文件数由 17 降到 13（M6-001）。
- **死代码**：删除 11 个整文件（`components/Drawer`、8 个 `ui/` 组件、`utils/range.ts`、`hooks/useIntersectionObserver.ts`）与 4 个零引用 atom。
- **测试工具链**：`dsh-smoke.mjs` 从"可能无限等待"变为有超时与看门狗，冷启动误报消除（M5-001/002）。

### 3.3 门禁口径未变

309 断言（120 SRS + 189 自动进阶）、determinism、CDP 冒烟 11 项、双目录哈希一致——四批沿用同一套口径，**没有为了让新代码通过而修改断言**。

## 4. 升级与回滚

### 4.1 升级

- **数据兼容**：四批均无 schema 变更、无 `localStorage` 键改名、无迁移逻辑；旧数据直接可用（M2-006 只删了从未写入的 `revision*` 表声明，不加 Dexie 版本，已装库文件不动）。
- **从 v9.11 直接升**：跳过 v9.12–v9.14 没有任何问题，后一批包含前一批。
- **流程**：按 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 第 6.2 节（`dsh-release.ps1 -TestInstall -Smoke` 验证后再 `-Install`）。
- **升级后可能注意到的差异**：只有 2.5 的 4 处。其余为同类行为等价改动。

### 4.2 回滚

```powershell
pwsh -File scripts/dsh-rollback.ps1 -List   # 查看可用备份
pwsh -File scripts/dsh-rollback.ps1         # 回滚到与当前版本不同的最近备份
pwsh -File scripts/dsh-rollback.ps1 -Force  # 选中备份与当前内容相同、确需重放时才加
```

可用回滚点（作者本机）：

| 回滚点 | 路径 |
| --- | --- |
| v9.14（安装 v9.15 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.15-20261028-201024.asar` |
| v9.13（安装 v9.14 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.14-20261028-195336.asar` |
| v9.12（安装 v9.13 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.13-20261028-193945.asar` |
| v9.11（安装 v9.12 前） | `D:\整理\Qwerty备份\app.asar.before-1.0.0-enhanced-v9.12-20261028-192548.asar` |

行为差异提示：

- 回滚到 v9.11 会重新出现"M1-001 部分加载被当成完成"的跳级风险、`utils/db` 反向依赖、超长输入越界、复习末词误记 Skip 等问题；学习记录本身不受影响。
- 回滚到 v9.14 或更早版本后，`dsh-rollback.ps1` 又变回"无操作也照常执行"的旧语义（脚本随 asar 之外的 `scripts/` 走）。

## 5. 验证清单（作者本机）

### 5.1 统一门禁

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `tsc --noEmit` | 0 error | 四批各一次 |
| `eslint src --max-warnings 0` | 0 error / 0 warning | 四批各一次 |
| 核心算法回归 | **309/309**（120 SRS + 189 自动进阶） | 四批均在同一口径下通过；断言集未改（v9.12–v9.14 提交记录逐项列明，v9.15 沿用同一门禁） |
| 确定性 | determinism pass | 两个 sim 各跑两遍逐字节一致（v9.12、v9.13 提交记录明确；v9.14、v9.15 沿用同一门禁） |
| 打字判定用例 | `wordmatch-src` 29/29、`word-judgment-sim` 42/42 | v9.14 重跑（判定路径有改动，故重跑） |
| 依赖图 | `scc(>1)=0` | v9.12 起成立；逆向边剩 3 条（见 3.1） |
| CDP 冒烟 | **11/11** | v9.12–v9.14 为测试安装；v9.15 测试安装 **与已安装版各 11/11**（每版隔离 profile） |
| 双目录安装 | `app.asar` 哈希一致 | `D:\bangong\QwertyLearner-Plus` 与 `D:\bangong\新建文件夹 (2)\Qwerty Learner` |
| 脚本自检 | `node --check` 全部 js 通过、`dsh-rollback.ps1 -List` 正常 | v9.15 |

### 5.2 交付产物

| 版本 | `app.asar` 大小 | SHA256 | 构建目录 | 安装日志 |
| --- | --- | --- | --- | --- |
| v9.12 | 86,395,797 B | `8E92FC594E47A27C17E5C6A2AEBFB187AFE41B623E7A0D54B1F6E390DD4834B4` | `QwertyRelease\staging-1.0.0-enhanced-v9.12-20261028-192548` | `logs\qwerty-1.0.0-enhanced-v9.12-installed-20261028-192548.json` |
| v9.13 | 86,396,101 B | `F2DC7F4A9F492F07203D78891CCEF581A4D8EFE25546DDB806458FE121707AA4` | `QwertyRelease\staging-1.0.0-enhanced-v9.13-20261028-193945` | `logs\qwerty-1.0.0-enhanced-v9.13-installed-20261028-193945.json` |
| v9.14 | 86,398,061 B | `850D5E2C9F2F87EA156EC8F3E7B6C355AEE9A493F9641B52BBA2B1092481A1D6` | `QwertyRelease\staging-1.0.0-enhanced-v9.14-20261028-195336` | `logs\qwerty-1.0.0-enhanced-v9.14-installed-20261028-195336.json` |
| v9.15 | 86,400,877 B | `10129D9DCFFBB2DA3723DCA2434278D294B68FDB84380F199472E6027D20BA9F` | `QwertyRelease\staging-1.0.0-enhanced-v9.15-20261028-201024` | `logs\qwerty-1.0.0-enhanced-v9.15-installed-20261028-201024.json` |

> 不同机器重新构建的产物哈希必然不同，上面的哈希不能用于校验他机构建。体积从 v9.12 的 86,395,797 B 增至 v9.15 的 86,400,877 B（+5,080 B），相对 v9.11 的 86,402,263 B 净 −1,386 B —— 属新增守卫与删死代码同量级，不代表任何性能结论。

## 6. 已知问题

1. **非官方分支**：不受上游支持；上游更新不会自动进入本分支。
2. **逆向依赖未归零**：审计台账与提交信息写的是"逆向依赖 3→0"，但按本轮的层次口径实测，基线是 6 条、现在剩 3 条（`utils/mixpanel.ts` → `@/store`、→ `pages/Typing/store/type`，`resources/dictionary.ts` → `@/utils`）。三处都不构成环，`scc(>1)=0` 成立；但按分层规则它们是违例，需要"搬 mixpanel 的 hook 用法"与"把 `calcChapterCount` 下沉"两个独立改动才能清零。文档一律按实测值记录，未沿用"3→0"。
3. **分层门禁未进 CI**：`.eslintrc.cjs` 无 `no-restricted-imports` 分层规则，`quality-gate.ps1` 无 `-WithArch`，`scan-graph.mjs` 只在审计目录且返回 0 退出码——目前靠人工跑脚本比对，不是硬门禁。
4. **批次计数口径不一致**：`MASTER-TRIAGE.md` 的批次标题为 Batch A 14 条 / B 19 条 / C 22 条 / D 12 条，但逐条列出的编号分别是 13 / 18 / 21 / 12（合计 64，标题合计 67）；v9.15 提交信息按"11 项"（把 `M5-016/017` 合并计一行）。本文档小节标题按**提交口径**写 14 / 19 / 22 / 11，逐条状态以 FINDINGS 编号为准；四批编号合计与审计清单 96 条、未修 22 条之间也无法简单相加对齐，故本文不做总账推算。
5. **死代码行数口径**：v9.12 提交记为"10 文件 / 536 行"，`git diff --numstat` 实测 10 文件 504 行（`Drawer` 68、8 个 `ui/` 组件 401、`utils/range.ts` 35），再加上 v9.14 删掉的 `hooks/useIntersectionObserver.ts` 42 行共 546 行。文档保留提交口径 536，不据此外推其他数字。
6. **源码注释的小版本标号有偏差**：`src/utils/db/data-export.ts`、`src/constants/index.ts` 把 M2-009 / M2-011 标成 `v9.12`，实际这两条随 v9.13 发布（注释不参与产物，vite 压缩已剔除中文注释，行为与文档一致）。
7. **构建元数据 gitSha 滞后一版**：`release-info.json` 在提交前生成，四份安装日志的 `gitSha` 分别记 `be1e715` / `f7f2c99` / `d5064fd` / `980bb5a`（均为上一版提交）。真实代码提交以本文档头的 `f7f2c99` / `d5064fd` / `980bb5a` / `1fb2b0f` 为准。
8. **CDP 冒烟仍在本机异常环境执行**：本机（Windows + 远程/沙箱会话）Electron GPU 进程启动即崩（`gpu_process_host: exit_code=-1073741819`），冒烟需以 `--disable-gpu --no-sandbox` + 隔离 profile 手工跑。见 `logs\smoke-1.0.0-enhanced-v9.15-installed.txt`。属环境问题，不是产品缺陷。
9. **回归脚本未随仓库发布**：309 断言、确定性检查、依赖图脚本均在作者本机审计目录，公开仓库无法一键复现（见 `FORK-NOTICE.md` 第 7 节）。
10. **仅 Windows 实测**：桌面外壳未验证 macOS / Linux。
11. **无代码签名 / Electron EOL**：Windows SmartScreen 可能提示未知发布者；Electron 43.8.3 于 2027-01-05 EOL。

### 6.1 本轮明确未修的条目（要点）

以下条目在审计中被判定为**需要产品决策或单独立项**，本轮**刻意不改**（完整理由见 `MASTER-TRIAGE.md` 第三节，此处只列要点，不复制整表）：

- **口径/语义类**（改了会动数字或行为）：到期口径 `due<=now` 与 `isDue` 统一（会让顶栏数字变化）；`M4-001` 修"答对次数恒 0"（用户可见统计会变，方案 A 还要把首屏改成全表扫描）。
- **核心算法重构**：`pickDynamicWord` / `reevaluateLevel` 重构、三处合并（分组键、`-0.5` 取整、缓存拷贝开销各不相同）——收益是维护性，风险是全量重标定，需单独一轮 + 完整 309 重跑。
- **需要真实并发/性能实测**：`M2-003` SRS 读改写事务化（重写 40+ 行核心，收益仅"多标签页少丢一次"，建议随下一次 DB 版本升级做）；`M5-014/015` enhance 轮询与主进程同步解析 385 个 JSON；`M2-008/010` 临时库年龄门槛与 `trans` 归一化。
- **需要换技术方案**：`M4-006` 完整焦点陷阱（要引 focus-trap 或换组件库，本轮只补语义属性）；`M3-007/008/012` 抽 `SwitchRow`、拆 `Word` 的 8 个 effect（涉及 15 处 DOM 与结算时序）。
- **需要安全/数据专项回归**：`M5-007/009/013` 导入跨 store 事务化、IPC 通道级白名单、备份互斥。
- **需要先改输入层**：`M6-014` 6 条词库 `language` 自相矛盾，修正会把 5 个 code 词库切到另一输入通道。
- **已知遗留**：主窗口 CSP（React/Tailwind 行内样式），需全量视觉回归；`M6-012` Word 事件上报（已停，删还是恢复待定）。

## 7. 后续

- **把分层变成硬门禁**：① 先清剩下 3 条逆向边（搬 `mixpanel` 的 atom 读取到 hooks 层、`calcChapterCount` 下沉到 `resources`）；② 再加 `.eslintrc.cjs` 的 `no-restricted-imports`；③ 最后把 `scan-graph.mjs` 接进 `quality-gate.ps1`（建议开关 `-WithArch`），与 309 断言并列。脚本需要补 `--max-scc` / `--max-back` 与非零退出码才能当门禁用。
- **SRS 事务化（M2-003）**：与下一次 Dexie 版本升级一起做，避免"为了少丢一次而重写核心"。
- **统计口径（M4-001 / M1-020）**：需要产品确认"答对次数"与到期口径的预期语义，再动代码。
- **可访问性收尾（M4-006）**：评估引入 focus-trap，替换本轮的最小语义补丁。
- **README / 用户文档同步**：`docs/Backup-Restore.md` 若引用导出文件名，需按 2.5 第 2 条更新（本轮未改，仓库内当时未见硬编码文件名）。
- 保持上游冻结；如需吸收上游修复，逐条评估 + 完整回归，不整包合并。
- 视情况整理可公开的回归脚本子集，使 309 断言与依赖图门禁能在干净 clone 上复现（当前未包含）。

## 8. 致谢

感谢 **RealKai42** 与 Qwerty Learner 全体贡献者提供的基础项目与词库体系；感谢上游词库/数据来源与第三方释义、发音服务；感谢 Electron、Chromium、React、Vite、Dexie、Tailwind CSS 等开源项目；本分支的开发、审计与文档工作使用了 **DeepSeek Harness（dsh）** 工具链（工具署名，不代表官方背书）。

---

*相关文档：[FORK-NOTICE.md](../FORK-NOTICE.md) · [DSH-FORK.md](DSH-FORK.md) · [DSH-FORK_EN.md](DSH-FORK_EN.md) · [RELEASE-NOTES-v9.11.md](RELEASE-NOTES-v9.11.md) · [Backup-Restore.md](Backup-Restore.md) · [Electron-EOL.md](Electron-EOL.md)*
