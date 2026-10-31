# DSH Fork 技术文档（Qwerty Learner Plus）

> 本文档描述 Qwerty Learner 的 **dsh 非官方分支**（分支 `dsh-local-v8`；应用版本以 `local-fork/package.json` 的 `version` 为唯一来源，本文不写死）。
> 上游项目：[RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)，基线 commit `1182426`，GPL-3.0。
> 分支声明、GPL 合规与已知限制的**权威版本**见仓库根目录 [`FORK-NOTICE.md`](../FORK-NOTICE.md)；本文档补充实现细节。

## 目录

1. [项目定位](#1-项目定位)
2. [与上游的功能差异](#2-与上游的功能差异)
3. [架构与目录结构](#3-架构与目录结构)
4. [核心算法](#4-核心算法)
5. [数据表与迁移](#5-数据表与迁移)
6. [开发与构建](#6-开发与构建)
7. [Electron 外壳构建与安装](#7-electron-外壳构建与安装)
8. [版本号规则](#8-版本号规则)
9. [安全设计](#9-安全设计)
10. [测试与回归](#10-测试与回归)
11. [已知限制](#11-已知限制)
12. [许可证与合规](#12-许可证与合规)
13. [致谢](#13-致谢)
14. [附录：命令与文件速查](#14-附录命令与文件速查)

---

## 1. 项目定位

**是什么**

- 基于上游 Qwerty Learner `1182426` 源码自建的**桌面优先**单词学习应用：保留上游的打字练习、音标/发音、错题本、统计、词库画廊等能力，把"背单词"部分替换为艾宾浩斯记忆曲线（SRS）+ 动态出词 + 自动进阶的连续学习闭环。
- 在网页源码之外，额外提供一套 Electron 增强外壳（`local-fork/electron/`）：托盘、快捷键、每日备份、剪贴板查词、免 Key 释义、发音缓存、注入式"工具"面板等。
- 通过自己的发布脚本构建 `app.asar`，可安装到现有 Electron 运行时目录，并支持备份、校验与回滚。

**不是什么**

- 不是上游官方仓库，与上游作者/维护者无隶属、委托或背书关系；不能把本分支的问题当作上游问题。
- 不是上游的"最新版"：上游基线之后的功能、修复、依赖升级默认都不在本分支内。
- 不是跨平台桌面产品：桌面外壳仅在 Windows 上实测；网页部分理论上可在其他平台浏览器运行。
- 不提供云同步、账号体系或在线词库市场；所有学习数据默认留在本机。

## 2. 与上游的功能差异

| 能力 | 上游 `1182426` | 本分支 | 代码位置 / 说明 |
| --- | --- | --- | --- |
| 练习组织 | 选词库 → 按章节练习 | **自动进阶 + 无章节**：按级别动态出词，不预生成整章词表 | `src/utils/learningPath.ts`、`src/pages/Typing/hooks/useWordList.ts` |
| 记忆调度 | 无 SRS 调度（错词进错题本） | **12 档艾宾浩斯阶梯** + 分级降档 + 慢词/时钟回拨处理 | `src/utils/memoryLadder.ts`、`src/utils/srsRules.ts`、`src/utils/memory.ts` |
| 出词 | 预先取章节词表 | **每词实时决策**：到期优先、按概率回顾、动态新词比例、跨词库去重、最近 12 词不重复 | `src/utils/memory.ts` 的 `pickDynamicWord` |
| 错词复现 | 进错题本，后续手动复习 | 本次会话**隔 3 个词重现**（同词最多 2 次）+ 持续遗忘自动挂起为"待攻克" | `src/utils/sessionRequeue.ts`、`src/utils/autoLevel.ts` |
| 自动进阶 | 无 | **13 级路径**（小学一年级 → 大学六级），状态持久化、只升不回退；本级掌握 85% 毕业，70% 起掺入下一级词 | `src/utils/autoLevel.ts` |
| 打字判定 | 逐字符严格相等（仅大小写可放宽） | 同一位置上空格 / `-` / `/` **互相等价**（仅 en/de 且非程序类词库） | `src/pages/Typing/components/WordPanel/components/Word/displayWord.ts`、`Word/index.tsx` |
| 每日上限 | 无 | **不设每日新词硬上限**；按到期量动态调节新词/复习配比 | `getNewRatio` / `getRefreshChance` |
| 数据表 | `wordRecords` / `chapterRecords` / `reviewRecords` | 新增 `memoryRecords`（Dexie v4），旧表保留不改结构 | `src/utils/db/index.ts`、`src/utils/db/record.ts` |
| 数据库导入 | 直接 `db.import`（先清表） | **临时库 + 行数校验 + 主库单事务**的原子导入；启动清理强杀残留 | `src/utils/db/data-export.ts`、`src/utils/db/temp-import-db.ts` |
| 数据备份 | 官方导出/导入数据库（仅 Dexie） | 每日自动备份（目录副本 + `data.json` 逻辑快照）+ 全量 JSON 导出/导入 | 主进程 `runBackup`、`docs/Backup-Restore.md` |
| 桌面外壳 | 无（网页应用） | Electron：托盘/快捷键/迷你模式/置顶/透明度/自启/备份/日志/剪贴板查词/免 Key 释义/发音缓存/词库更新/注入面板 | `local-fork/electron/` |
| 推广内容 | 捐赠、作者推荐、移动端落地页、站点统计与 SEO 外链等 | **移除与学习无关的营销 UI 与统计脚本**；保留分享成绩/导出/请求词库 | v9.8 提交 |
| 遥测 | 网页端默认统计 | **桌面默认关闭**（需显式 opt-in）；网页构建仍沿用上游统计口径 | `src/utils/telemetry.ts` |
| 构建/发布 | 上游 `yarn build` / 安装脚本 | `dsh-release.ps1`（门禁 → build → asar → 校验 → 安装/回滚）+ `quality-gate.ps1` | `scripts/` |
| 测试 | Playwright e2e | 在上述基础上增加核心算法回归、CDP 冒烟、安全探针（部分脚本未随仓库发布） | 见第 10 节 |

> 表格是方向性对比；具体数值、边界条件以第 4 节和第 5 节的源码规则为准。

## 3. 架构与目录结构

### 3.1 运行时结构

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 主进程 (local-fork/electron/main.js)                │
│  窗口 / 托盘 / 快捷键 / 备份 / 日志 / 词库更新 / 发音缓存     │
│  IPC 白名单 + 导航守卫 + CSP + 权限默认拒绝                   │
├─────────────────────────────────────────────────────────────┤
│ preload (contextIsolation)                                   │
│  window.qwertyEnhance 白名单 API；设置 __QZ_ELECTRON__ 标记   │
├─────────────────────────────────────────────────────────────┤
│ 渲染进程：Vite/React 应用 (build/)                            │
│  页面：练习 Typing / 词库画廊 / 分析 / 错题本                  │
│  算法：memory.ts（出词/SRS）→ autoLevel.ts（级别）            │
│  数据：Dexie `RecordDB`（IndexedDB）                          │
│  注入：enhance.js「工具」面板（Shadow DOM，不改 build 产物）  │
└─────────────────────────────────────────────────────────────┘
```

- 学习数据（IndexedDB `RecordDB`）由渲染进程持有；外壳私有数据（设置、日志、备份、缓存）写入 `%APPDATA%\qwerty-learner-plus`，不写入应用学习记录目录。
- 外壳通过 `contextBridge` 暴露少量白名单 IPC；渲染页面不接触 Node。
- 增强面板是**注入式**的（`main.js` 在页面加载后注入 `enhance.js`），不修改 `build/` 里的网页产物，因此网页构建与外壳升级相互独立。

### 3.2 目录

```
qwerty-learner/
├─ src/                        # 上游网页源码（本分支有修改）
│  ├─ pages/Typing/            # 练习主流程（useWordList 动态出词）
│  ├─ pages/Gallery-N/         # 词库画廊
│  ├─ pages/Analysis/          # 统计分析
│  ├─ pages/ErrorBook/         # 错题本
│  ├─ utils/memory.ts          # 动态出词 + SRS 写入
│  ├─ utils/memoryLadder.ts    # 12 档阶梯
│  ├─ utils/srsRules.ts        # SRS 纯规则（可测试）
│  ├─ utils/autoLevel.ts       # 自动进阶
│  ├─ utils/learningPath.ts    # 13 级路径与词库加载
│  ├─ utils/sessionRequeue.ts  # 会话内错词重现
│  ├─ utils/db/                # RecordDB、导入导出、临时导入库
│  └─ utils/telemetry.ts       # 遥测门控
├─ local-fork/
│  ├─ package.json             # asar 根 package.json（版本号唯一来源）
│  └─ electron/                # 主进程 / preload / 增强 UI / 剪贴板小窗
├─ scripts/                    # 发布、回滚、质量门禁、冒烟、上游安装脚本
├─ public/dicts/               # 385 本内置词库（JSON）
├─ docs/                       # 文档（本文档、英文版、发布说明、备份、Electron EOL）
├─ tests/e2e/                  # Playwright 测试
├─ build/                      # Vite 构建产物（生成物，不入库）
├─ FORK-NOTICE.md              # 分支声明（GPL 合规）
├─ LICENSE                     # GPL-3.0 原文（不改）
└─ package.json                # 上游网页工程配置（版本号保持 0.1.0）
```

**v9.12–v9.15 从 `src/` 移除的模块**（删除后全仓零引用，`tsc` 兜底通过）：

| 模块 | 说明 |
| --- | --- |
| `src/components/Drawer/` | 章节列表抽屉，v7 起流程下线后无引用 |
| `src/components/ui/` 下 8 个组件 | `avatar` / `button` / `dialog` / `scroll-area` / `table` / `tabs` / `toggle-group` / `toggle`（`toggle` 仅被 `toggle-group` 引用，属连锁死代码；页面需要滚动区时直接用 `@radix-ui/react-scroll-area`） |
| `src/utils/range.ts` | `toFinite` / `baseRange`，无引用（`clamp` 仍有引用，保留在 `utils/clamp.ts`） |
| `src/hooks/useIntersectionObserver.ts` | 已学计数改为页面统一统计后失去引用（v9.14 随 M4-011 删除） |

同时删除 4 个零引用 atom（`pronunciationIsTransReadAtom` / `isShowSkipAtom` / `isInDevModeAtom` / `dismissStartCardDateAtom`）与 `revision*` 表声明（从未写入，移除不加 Dexie 版本，已装库文件不动）。

### 3.3 依赖分层与门禁（v9.12 起）

**为什么需要**：v9.11 之前 `import '@/utils'` 会顺带初始化 jotai store、mixpanel 与 377 条词库对象；`utils/db/index.ts` 内嵌 3 个 React hook 反向依赖 `pages/Typing/store`。结果是 4 个静态依赖环（最大 7 节点，`dictionary → utils/index → utils/mixpanel → store/index → dictionary`），分层规则无法成立，Node 侧仿真必须给 4 个模块打 stub。

**规则**（数字越小越底层，只允许**低层 → 高层**的静态 import）：

| 层 | 目录 | 允许依赖 |
| --- | --- | --- |
| L0 | `src/typings/**`、`src/constants/**`、`src/@types/**` | L0（`typings` 内部只做 type-only，且不得成环） |
| L1 | `src/resources/**` | L0 |
| L2 | `src/utils/**` | L0、L1 |
| L3 | `src/store/**` | L0–L2 |
| L4 | `src/hooks/**` | L0–L3 |
| L5 | `src/components/**` | L0–L4 |
| L6 | `src/pages/**` | L0–L5；页面之间只允许 `pages/X → pages/X/...` 自己的子树 |
| 入口 | `src/index.tsx` | 任意（**唯一豁免**） |

- `resources` 放在 `utils` 之下，是因为它是静态数据、`utils` 是代码；`utils/memory.ts`、`utils/learningPath.ts`、`utils/sounds/keySounds.ts` 读 `resources` 属顺向。
- **动态 `await import()` 不计入**：`utils/db/index.ts ↔ utils/autoLevel.ts` 的双向边是为规避 TDZ 的刻意设计（脚本单独列出，当前 7 条）。

**如何检测（Tarjan）**：脚本 `audit/v912/M6-shared/repro/scan-graph.mjs`（未随仓库发布）做三件事——

1. 遍历 `src/**/*.ts|tsx`，用正则抽出静态 `import` / `export from`（支持多行），解析 `@/` 别名与目录 `index` 到**文件**，同时把动态 `import()` 标 `dynamic` 并排除在环统计外；
2. 对邻接表跑 **Tarjan** 求强连通分量，只报大小 > 1 的分量（自环另计）；
3. 按上表层次统计 `层号(目标) < 层号(来源)` 的边，即"逆向依赖"，逐条打印来源行与语句。

```bash
node audit/v912/M6-shared/repro/scan-graph.mjs D:/整理/qwerty-src/src
# 首行：files=… edges=… scc(>1)=…
# 之后："## 逆向依赖（低层 -> 高层）" 明细与 total back-edges=N
```

**当前结果**（HEAD = `1fb2b0f`，125 文件 / 355 条静态边）：

| 指标 | 审计前（v9.11） | 现在 |
| --- | --- | --- |
| `scc(>1)`（静态环） | 4 | **0** |
| 逆向依赖（按本表层次） | 6 | **3** |

剩余 3 条不构成环，但仍是规则违例：

| 逆向边 | 类型 | 说明 |
| --- | --- | --- |
| `utils/mixpanel.ts` → `@/store`（8 个 atom） | value | M6-001 只拆了 `@/utils` 的聚合导出，未搬 mixpanel 的 atom 读取；后续应把 hook 形态的使用迁到 hooks 层 |
| `utils/mixpanel.ts` → `pages/Typing/store/type` | type-only | 同上，类型可由 `store` 层提供 |
| `resources/dictionary.ts` → `@/utils`（`calcChapterCount`） | value | 计划中的"`calcChapterCount` 下沉到 `resources`"未落地 |

**落地程度（如实说明）**：分层目前是**文档规则 + 审计脚本复核**，`.eslintrc.cjs` 尚无 `no-restricted-imports` 规则，`scripts/quality-gate.ps1` 也没有 `-WithArch` 开关，脚本不返回非零退出码。也就是说，它现在是可复核的验收记录，不是 CI 硬门禁；落地路径见 [`RELEASE-NOTES-v9.15.md`](RELEASE-NOTES-v9.15.md) 第 7 节。

**相关结构变化**：`utils/db` 不再 import `pages/**`（数据层可脱离 React 复用）；`@/utils` 不再隐式初始化 store 与 mixpanel，引用 `@/utils` 的文件由 17 降到 13。

## 4. 核心算法

> 以下规则均可在源码中直接核对。算法模块设计为纯函数/纯状态（不依赖 React/DOM），便于回归测试。

### 4.1 艾宾浩斯阶梯

`src/utils/memoryLadder.ts` 定义 12 档（单位：天）：

| 档位 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 间隔 | 10 分钟 | 30 分钟 | 12 小时 | 1 天 | 2 天 | 4 天 | 7 天 | 15 天 | 30 天 | 60 天 | 120 天 | 240 天 |

- 新词首次答对：`stage = MEMORY_GRADUATE_STAGE = 3`（1 天档）。
- 已有记录的词答对且已到期：`stage + 1`（封顶 11 档），ease `+0.1`（上限 3）。
- 同一会话内提前重练（未到期）：只记 `early-ok`，**不升档、不延长间隔**。

### 4.2 答错规则（`srsRules.evaluateWrong`）

| 情况 | 新档位 | ease | lapse |
| --- | --- | --- | --- |
| 新词首错 / 未成熟词（stage < 3） | 0（10 分钟档） | −0.2（下限 1.3） | 不记 |
| 成熟词、本次错误次数 = 1 | `max(1, stage − 2)` | −0.2（下限 1.3） | +1 |
| 成熟词、本次错误次数 ≥ 2 | 0 | −0.2（下限 1.3） | +1 |

- 设计意图：1 次手滑不清空已建立的记忆，确实不会才回到 10 分钟档重学。
- 慢词口径：单次作答总时长 **> 6000 ms**（`MEMORY_SLOW_MS`，严格大于）；与答对/答错/回顾分支无关，统一计数。
- `lapses` 累计到 **≥ 4** 时自动挂起到"待攻克"（`db/index.ts`）。

### 4.3 到期时间（`srsRules.computeDue`）

- 间隔 `< 1 天`（10 分钟 / 30 分钟 / 12 小时）：精确毫秒 `now + interval`。
- 间隔 `>= 1 天`：按**本地自然日**，到期时间为"目标日 00:00"；目标日 = 今天 + round(间隔) 天。因此 23:00 学完的 1 天档词会在次日 00:00 进入到期池。
- 非法输入（NaN / 非正数）返回 `now`，避免写入 NaN。
- 时钟回拨（`srsRules.correctClockRollback`）：仅当 `now < lastSeen` 时把 `due` 压回 `min(due, now + interval)`；正常记录**原样返回**，不影响 15/30/60/120/240 天长间隔。取词池、到期计数、复习债展示统一使用 `effectiveDueOf` / `isRecordDue` 口径。

### 4.4 掌握判定与自动进阶

`src/utils/autoLevel.ts`：

- **掌握**（`srsRules.isMastered`）：`correct >= 2` 且 `stage >= 2` 且 `lastResult !== 'wrong'`。新词首答对不算掌握。
- **级别完成（毕业线 85%）**：`required = 本级总词数 − 已挂起`；`required === 0`，或 `seen === required` 且 `mastered / required >= MASTERY_RATIO = 0.85`（v9.11 起，v9.9 为 0.90）。代价是最多 15% 未掌握词随升级带走 —— 它们仍在 `memoryRecords` 里，会作为到期词继续复习，只是不再阻塞本级毕业；"只升不回退"的语义不变，回退仍只能靠显式"重新评估"。
- **只升不回退**：级别 id 持久化在 `localStorage` 键 `qzAutoLevelState`；只有"重新评估级别"（数据页 `qzReevaluateLevel` 标记）允许回退。
- **挂起（待攻克）**：Skip 累计 3 次自动挂起，不阻塞升级；恢复时清零 Skip 并复位该词 `lapses`（否则会因 lapses ≥ 4 立即重新挂起）。
- **容错**：状态 JSON 损坏/字段类型异常按默认值降级解析；localStorage 不可用或写入失败时返回 `persisted=false` 并派发 `qz-auto-level-state-error` 事件，不静默丢档；词库加载失败（抛错或空词表）标记 `error='load-failed'`，不判完成、不推进级别。
- **迁移**：首次使用/无持久化状态时，按"第一个仍有未学词的级别"反推，避免老用户升级后被拉回第 1 级；数据页显式重评则按"第一个未完成级别"定位。

#### 4.4.1 掺入下一级词（v9.11）

本级"已见 100% 但掌握不足毕业线"时新词池为空，出词会全部落到到期池（死区）。v9.11 起在本级掌握度到 70% 后，按概率把**下一级**的未学词掺进练习流：只展示/记录，不改 `levelId`，不参与本级完成判定。

常量（`src/utils/autoLevel.ts`）：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `MASTERY_RATIO` | 0.85 | 毕业线（v9.11 起；原 0.90） |
| `MIX_START` | 0.70 | 开始掺入的掌握度 |
| `MIX_FULL` | 0.85 | 掺入比例封顶点，与毕业线对齐 |
| `MIX_MIN` | 0.10 | 70% 时的掺入概率 |
| `MIX_MAX` | 0.30 | 85% 及以上的掺入概率 |
| `MIX_MIN_REQUIRED` | 20 | `required < 20` 的小级别不掺入（样本太少、掌握度抖动大） |
| `MIX_WINDOW_CAP` / `MIX_WINDOW_SIZE` | 6 / 20 | 会话滑动窗口：最近 20 次取词最多 6 次掺入 |

公式（`getMixRatio(mastered, required)`，纯函数，不读状态不掷骰）：

```
m = mastered / required
m <  0.70                  → 0
0.70 <= m < 0.85           → 0.10 + 0.20 × (m − 0.70) / (0.85 − 0.70)
m >= 0.85                  → 0.30
required < 20 或 = 0       → 0
末级（无下一级）            → 0
```

采样（`required = 100`）：69% → 0；70% → 0.10；75% → 0.1667；80% → 0.2333；84% → 0.2867；85% 及以上 → 0.30。

**不变式**：`MIX_MAX === MIX_WINDOW_CAP / MIX_WINDOW_SIZE`（0.30 === 6/20）。概率封顶与窗口封顶必须恒等，只改一边会让概率上限永远达不到；门禁断言 `B-19.capAligned` 检查这条。窗口是硬约束，因此长期实测掺入率略低于名义值（m = 84% 时实测 22.8%，名义 28.7%）。

**为什么是 30% + 6/20（实测，非直觉）**：`audit/mix70-sim.mjs --mode=all`（3 种子均值）——

| 场景 | v9.9 基线（0.90、无掺入） | v9.11（0.85 + 掺入） |
| --- | --- | --- |
| S1：100 词 / 每天 20 次 / 80% 正确，升级日 | 38.00 天 | **40.33 天（+6.1%）** |
| S2：392 词 / 每天 60 次 / 85% 正确，升级日 | 44.33 天 | **44.33 天（持平）** |
| 死区最后 200 次取词中"下一级词"占比（S1 / S2） | 0.3% / 0% | **46.5% / 29.2%** |

机理：掺入降低本级复习密度 → 80~85% 正确率下复习越密集 lapse 越多 → 稀疏后稳态掌握率反而更高。所以封顶要按实测选，不能按"掺入越少越快毕业"的直觉选。

### 4.5 动态出词（`src/utils/memory.ts` 的 `pickDynamicWord`）

每次取词按以下顺序决策：

1. **会话内错词重现**：若重练队列中有到期词，优先返回（标注"再练一次"）。
2. **随机回顾**：按 `refreshChance` 概率从未到期词中抽一个（答对只刷新记忆、不延长间隔，标注"随机回顾"）。
3. **新词**：按 `newRatio` 概率（或当前无到期词）进入新词流程；自动模式下先解析当前级别，只从本级未学词中取；新词在"本级未学前 20 个（按词库文件顺序）"里随机，保留教材/词频顺序。
4. **掺入的下一级词（v9.11）**：本级新词出完后，若 `auto` 模式、`dueCount > 0`、调用方给的 `previewBudget > 0`、且 `getMixRatio() > 0`，按该概率掷骰，命中则从下一级未学词里抽 1 个（`preview=true`）。**注入位置固定在错词 requeue 之后、到期兜底之前**。
5. **到期复习**：从到期池随机取（按 `memoryKey` 去重，排除已挂起与最近 12 词）。
6. **兜底**：全部学完/没有新词时随机回顾未到期词。

掺入分支的边界（`src/utils/memory.ts` 的 `pickPreviewWord`）：

- 候选池：`LEARNING_PATH[index + 1]` 的 `newWords`（已排除 suspended），按词归一化去重、排除 recent 窗口，取文件顺序前 20 个再随机。
- **fallthrough 规则**：末级（无下一级）／下一级词库加载失败／下一级没有新词／候选全落在 recent 窗口 → `pickPreviewWord` 返回 `null`，`pickDynamicWord` **必须继续走第 5 步**，绝不把 `null` 抛给调用方。
- `previewBudget <= 0` 或 `mix <= 0` 时**不掷骰**（不调用 `Math.random()`），以保证既有确定性断言的随机序列不位移。
- 返回的 `level` 仍是本级进度信息，顶栏与进度条不会跳到下一级。
- 会话窗口（`src/pages/Typing/hooks/useWordList.ts`）：`previewWindowRef` 记录最近 20 次取词是否为掺入词，`previewBudget = max(0, 6 − 窗口内掺入数)`；切词库/新会话时与 `recentRef` 一起清空。

动态配比（`autoLevel.getNewRatio` / `getRefreshChance`，按到期词数 `due`）：

| `due` | 新词比例 | 随机回顾概率 |
| --- | --- | --- |
| 0 | 1 | 0.12（≤20 档） |
| 1–20 | 0.4 | 0.12 |
| 21–100 | 0.2 | 0.03 |
| 101–299 | 0.1 | 0 |
| ≥300 | 0.02 | 0 |

- 到期词多时自动降低新词比例、关闭随机回顾，优先清理复习债。
- "是否学过"跨词库按**单词**去重（`normalizeWordName`：trim + 小写）；SRS 记录 key 按**保留大小写**的词（`normalizeWordKeyWord`），因此 `March` 与 `march` 是两条独立记录。
- 不设每日新词硬上限；设置中的每日目标只用于统计/提醒。

### 4.6 打字判定（分隔符等价，v9.10）

`src/pages/Typing/components/WordPanel/components/Word/displayWord.ts`、`Word/index.tsx`：

- **唯一判定点**：`Word/index.tsx` 的结算 effect（按 `inputWord` 增量判 `displayWord[i]`），字符级比较通过 `charsMatch(input, expected, isIgnoreCase)`。
- **等价类**：`SEPARATOR_CLASS = { ' ', '␣'(EXPLICIT_SPACE), '-', '/' }`。同一位置的两个分隔符视为相同：`t-shirt` 打 `t shirt`、`a/an` 打 `a an`、`ice cream` 打 `ice-cream` 均通过。
- **不参与等价**：`_`（程序类词库标识符）、`.`（缩写 `a.m.`）、`'`（`don't`）、`&`（`AT&T`）；否则 `a m` / `dont` 会被误判为正确。
- **不变**：长度与下标 1:1（`t shirt` 与 `t-shirt` 同为 7 位），`letterMistake` 下标、结果页导出、落库 key 全部不受影响；`isIgnoreCase` 语义不变。
- **生效范围**（`isSeparatorEquivalenceEnabled`）：仅 `language ∈ {en, de}` 且 `languageCategory !== 'code'`。romaji 的 `-` 是长音符（`taima-`）；程序类词库的 `-` `/` `_` 是语法字符。
- **数据依据**：`public/dicts` 385 个词库 / 457,031 词中，含 `-` 3,301 条、含 `/` 359 条、含 `_` 73 条（后者全部落在程序类词库）。

## 5. 数据表与迁移

### 5.1 `RecordDB`（Dexie）

`src/utils/db/index.ts` 当前 schema 版本为 **4**（Dexie 内部 IDB 版本 40），升级保留旧数据：

| 表 | 主键/索引 | 说明 |
| --- | --- | --- |
| `wordRecords` | `++id, word, timeStamp, dict, chapter, wrongCount, [dict+chapter]` | 上游逐词记录（计时/错误键），保留 |
| `chapterRecords` | `++id, timeStamp, dict, chapter, time, [dict+chapter]` | 上游章节记录，保留（用于统计口径） |
| `reviewRecords` | `++id, dict, createTime, isFinished` | 上游复习记录，保留 |
| `memoryRecords` | `key, word, dict, due, [dict+due]` | **新增**：SRS 记忆记录 |

`memoryRecords` 主要字段：

| 字段 | 含义 |
| --- | --- |
| `key` | `${dict}::${word}`（v9.5 起保留大小写；读取时兼容旧 `trim+lower` key） |
| `word` / `dict` / `trans` / `phone` | 词名、词库命名空间、释义、音标（跨词库复习可直接展示） |
| `stage` / `interval` / `ease` | 阶梯档位、当前间隔（天）、熟练度 |
| `due` / `lastSeen` / `createdAt` | 到期时间、上次作答、创建时间（毫秒） |
| `attempts` / `correct` / `wrong` / `slow` / `lapses` | 作答统计 |
| `lastResult` | `ok` / `early-ok` / `wrong` / `refresh-ok` / `refresh-wrong` / 空 |
| `shadowInterval` / `shadowDue` / `shadowAt` | v8.3 影子调度：自适应间隔估算，**仅记录、不改变实际 due** |

### 5.2 localStorage 键

| 键 | 用途 |
| --- | --- |
| `qzAutoLevelState` | 自动进阶状态（级别、Skip 计数、挂起列表、缓存进度） |
| `qzCustomDict` | 当前自定义词库桥接（词表本体在 `QwertyPlusDB.dicts`） |
| `currentDict` / `learningMode` / `state` | 当前词库、学习模式、主题等页面配置（上游键） |
| `qzReevaluateLevel` | 数据页"重新评估级别"一次性标记 |
| `memoryMigratedV1` | `wordRecords → memoryRecords` 一次性迁移标记 |
| `memoryKeyCaseV2` | v9.5 大小写 key 迁移标记 |
| `autoLevelStateKeysV1` | v9.6 自动进阶旧 key 迁移标记 |
| `memoryFutureDueFixedV1` | 未来 due 校准节流时间戳 |
| `qzTelemetryOptIn` | 桌面遥测显式开关（`'1'` 才开启） |

### 5.3 迁移与导入导出

| 版本 | 数据变更 |
| --- | --- |
| v7 | 新增 `memoryRecords`（Dexie v4）；旧表保留 |
| v9.3 | 从 `wordRecords` 一次性迁移 SRS 记录；stage 按历史错误数映射（0 错 → 3 档，1–2 错 → 2 档，≥3 错 → 1 档） |
| v9.4 | 数据库导入原子化：先写临时库、逐表校验行数，再在**主库单个读写事务**内 clear + 分块 bulkPut；失败整体回滚 |
| v9.5 | `memoryKey` 保留大小写（`March` ≠ `march`），保留旧 key 读写兼容；旧记录复制到新 key（不删旧记录）；加载层空白词条归一化 |
| v9.6 | 自动进阶状态里的旧 `skipped`/`suspended` key 迁移到新 key（幂等，失败下次重试） |
| v9.9 | 启动即清理"导入中途被强杀"残留的 `RecordDB-import-*` 临时库（此前会永久泄漏） |

导出/备份/恢复的完整说明见 [`Backup-Restore.md`](Backup-Restore.md)。要点：

- **跨设备恢复优先**用"工具 → 数据 → 导出全量数据 JSON / 导入全量数据"；它覆盖 RecordDB、`QwertyPlusDB.dicts`、localStorage 与外壳设置。
- 上游"设置 → 数据 → 导出/导入数据库"只导 Dexie（`RecordDB`），不含 localStorage 与外壳设置；本分支未改上游页面，只在工具页提示。
- 自动备份每天一次（面板/托盘可手动触发），保留最近 7 份；目录副本 + `data.json` 逻辑快照（单份上限 64 MB，8 秒超时；超时不影响目录副本）。
- 全量 JSON 导出文件名自 v9.13 起为 `Qwerty-Learner-User-Data-YYYYMMDD-HHmmss.gz`（原来只有日期，同日多次导出会重名覆盖）。字段与结构未变，导入方仍按内容解析。

## 6. 开发与构建

### 6.1 环境

| 依赖 | 版本/说明 |
| --- | --- |
| Node.js | ≥ 18（作者构建环境 Node 24.19.0） |
| Yarn | 1.x（上游使用 yarn；也可用 npm） |
| Git | 任意近期版本 |
| 桌面构建 | Windows 10/11 + PowerShell 5.1+ / PowerShell 7 |
| 运行时 | Electron 43.8.3（预构建二进制，项目内**没有** electron 依赖） |

### 6.2 网页开发

```bash
yarn install
yarn start      # Vite dev server，默认 http://localhost:5173/
yarn build      # 生产构建，输出 build/（等价 npm run build）
```

常用检查：

```bash
npm run typecheck        # tsc --noEmit
npm run lint:strict      # eslint src --ext .ts,.tsx --max-warnings 0
npm test                 # typecheck + lint:strict
npm run test:e2e:local   # Playwright（需先启动本地 dev server 并安装 chromium）
npm run test:local       # CDP 冒烟（需应用带 --remote-debugging-port 启动）
```

> `yarn start` / `yarn build` 只涉及网页部分。增强面板、托盘、备份、剪贴板查词等**只存在于 Electron 外壳**中，网页模式不可见（这是预期行为）。

### 6.3 质量门禁

```powershell
# 类型 + 严格 lint
pwsh -File scripts/quality-gate.ps1

# 追加核心算法回归（需要审计脚本目录）
pwsh -File scripts/quality-gate.ps1 -WithSim

# 全量（需先以隔离 profile 启动应用，暴露 CDP）
pwsh -File scripts/quality-gate.ps1 -WithSim -WithSmoke -SmokePort 9472
```

- 门禁只负责检查，不 build / 不安装 / 不 commit。
- `-WithSim` 默认读取作者本机审计目录（`-SimDir` 可覆盖）；脚本不存在时会标记为 SKIP，**不会**失败。
- 退出码：0 = 全绿，1 = 有步骤失败。

### 6.4 发布构建

```powershell
pwsh -File scripts/dsh-release.ps1                          # tsc + 核心回归 + Vite build + asar
pwsh -File scripts/dsh-release.ps1 -TestInstall -Smoke      # 构建 + 测试安装 + 隔离 CDP 冒烟
pwsh -File scripts/dsh-release.ps1 -Install                 # 构建 + 正式安装（备份/原子替换/校验/日志）
pwsh -File scripts/dsh-release.ps1 -SkipBuild -Install      # 复用现有 build/
```

脚本流程（`scripts/dsh-release.ps1`）：

1. 读取 `local-fork/package.json` 版本；创建 `staging-<version>-<stamp>`；
2. `tsc --noEmit`（`-SkipCheck` 可跳）；
3. 核心算法回归：重建源码 bundle → `srs-sim --strict` → `sim-autolevel --strict` → 汇总（`-SkipAudit` 可跳；审计脚本缺失时警告并跳过）；
4. `npm run build`（`-SkipBuild` 可跳）；
5. 组装 staging：`local-fork/package.json` + `electron/` + `build/` + `LICENSE` + `FORK-NOTICE.md`，用 `npx @electron/asar pack` 打包；
6. 计算 SHA256、写 `SHA256SUMS` 与 `release-info.json`；
7. 可选测试安装（原子替换 + 哈希校验 + 隔离 profile CDP 冒烟）；
8. 可选正式安装：预检多个安装目录当前 `app.asar` 哈希一致 → 备份 → 原子替换 → 校验 → 写安装日志；任一步失败自动回滚；
9. 清理旧 staging（保留最近 5 份）。

**路径参数**：`-StageRoot`、`-BackupDir`、`-AuditRoot`、`-TestAppDir`、`-InstallDirs`。脚本内置默认值来自作者本机目录布局，在其他机器上必须覆盖；公开仓库不保证默认值可用。

### 6.5 回滚

```powershell
pwsh -File scripts/dsh-rollback.ps1 -List   # 列出可用备份
pwsh -File scripts/dsh-rollback.ps1         # 回滚到"与当前版本不同的最近备份"
```

- 回滚前会先把当前版本另存为 redo 点，回滚后可再切回。
- v9.15 起：若选中备份与当前 `app.asar` 内容相同，脚本**默认中止**（提示加 `-Force`），避免"无操作回滚"白占备份空间、污染清单；确需重放时加 `-Force`。
- 正式安装的备份是 `app.asar` 文件级备份；安装日志在 `logs/` 下记录版本、SHA256、安装目录。

## 7. Electron 外壳构建与安装

### 7.1 组成

| 文件 | 职责 |
| --- | --- |
| `local-fork/package.json` | asar 根 package.json（`main: electron/main.js`），**应用版本号唯一来源** |
| `local-fork/electron/main.js` | 主进程：窗口/托盘/全局快捷键/迷你模式/置顶/透明度/缩放/自启/关闭到托盘/单实例/每日备份/日志轮转与脱敏/词库管理/发音缓存/免 Key 释义/安全守卫/IPC |
| `local-fork/electron/preload.js` | 主窗口 `contextBridge` 白名单 API；设置 `window.__QZ_ELECTRON__`；词库在线更新 fetch 包装 |
| `local-fork/electron/preload-clipboard.js` | 剪贴板小窗专用最小 preload（查词/收词/关闭 3 个能力） |
| `local-fork/electron/enhance/` | 注入式增强 UI（`enhance.js` / `enhance.css` / `clipboard.html` / 词库映射表），渲染在 Shadow DOM 中 |

### 7.2 构建

```powershell
pwsh -File scripts/dsh-release.ps1
```

产出：`staging-<version>-<stamp>/app.asar`、`SHA256SUMS`、`release-info.json`。

- 外壳**不需要** `electron` npm 依赖：项目只产出 `app.asar`，运行时使用安装目录里已有的 Electron 二进制。
- 构建机需要 `npx @electron/asar`（脚本用 `npx --yes @electron/asar pack`，首次会临时下载）。
- 脚本文件按 UTF-8 BOM 保存以兼容 Windows PowerShell 5.1；PowerShell 7 用 `pwsh -File` 等价。

### 7.3 安装

1. 准备一个已安装好的 Electron 运行时目录（含 `Qwerty Learner.exe` 与 `resources/`）；
2. 使用 `-TestInstall` 装到测试目录，跑 `-Smoke` 冒烟；
3. 使用 `-Install` 装到正式目录（脚本会预检多个目录当前 asar 哈希一致，避免混合版本）；
4. 安装会把 `LICENSE` 与 `FORK-NOTICE.md` 复制到安装目录。

安装目录、备份目录均通过参数指定；脚本不会自动发现安装目录。

### 7.4 运行时升级（单独决策）

- Electron 运行时不在构建流水线内：需下载官方预构建二进制、校验 SHA256、用 `rcedit` 写入 Windows 图标/版本元数据（否则任务栏与文件属性会显示 Electron 品牌），再逐文件备份替换。
- 当前运行时：**Electron 43.8.3 / Chromium 150.0.7871.250**；43.x 官方支持至 **2027-01-05**。
- 详细步骤、校验清单、回滚方法与 EOL 说明见 [`Electron-EOL.md`](Electron-EOL.md)。升级运行时属于高风险操作，必须用户单独确认。

## 8. 版本号规则

| 位置 | 含义 | 当前值 |
| --- | --- | --- |
| `local-fork/package.json` `version` | **应用版本唯一来源** | 以该文件为准（发布时更新） |
| `main.js` / preload / 注入面板 | 运行时读取上面的版本（`app:version-sync`、`window.__QZ_VERSION__`） | 自动 |
| 根 `package.json` `version` | 上游网页工程版本，**不用于桌面版本** | `0.1.0`（保持上游，不改） |
| Git tag | 里程碑标记 | `vX.Y-dsh-local` |
| 安装 exe 文件元数据 | 运行时升级时由 rcedit 写入，可能滞后于应用版本 | `FileVersion 9.8.0.0` |

发版约定：

1. 只改 `local-fork/package.json` 的 `version`（例如 `1.0.0-enhanced-v10.0`）；
2. 打 tag `v10.0-dsh-local`；
3. 跑 `dsh-release.ps1 -TestInstall -Smoke` 与正式安装；
4. 更新 `docs/RELEASE-NOTES-*.md` 与 `FORK-NOTICE.md` 的版本说明（如有必要）。

注意：

- 本分支版本号（v1~v9.15、`1.0.0-enhanced-vX.Y`）与上游 release 版本**没有对应关系**，不要按上游版本号比较。
- 历史上有多个小版本合并进同一提交（v9.1+v9.2、v9.4+v9.5），因此不是每个数字都有独立 tag。
- exe 文件版本元数据只在运行时升级时更新，可能与应用内版本不一致，这属于已知限制。

## 9. 安全设计

> 本分支是本地优先应用，安全设计目标是"不信任渲染进程、不信任远端内容、默认不联网上报"。

### 9.1 Electron 隔离

- `contextIsolation: true` + sandbox 化 preload；渲染进程不接触 Node。
- 只通过 `contextBridge` 暴露白名单 API；剪贴板小窗使用专用最小 preload（3 个能力），不再复用主窗口 40+ IPC。
- 所有 IPC 校验 sender 来源白名单（主窗口/剪贴板窗）；同步版本通道同样校验。

### 9.2 导航与权限

- `will-navigate` / `will-redirect`：只允许 `file://` 且真实路径位于 `app.getAppPath()` 内。
- 开发服务器：`VITE_DEV_SERVER_URL` 仅在**未打包**且目标为 `http(s)://localhost` / `127.0.0.1` / `::1` 时生效；打包版忽略该变量（**不支持通过环境变量加载远程页面**），非法/远程 URL 只记日志、不加载。
- `setWindowOpenHandler`：仅 `http:` / `https:` 交给系统浏览器，其他协议只记日志。
- 默认拒绝所有网页权限请求；仅放行 `clipboard-sanitized-write`（复制按钮需要）。

### 9.3 CSP 与内容

- 主窗口 CSP 在 `onHeadersReceived` 对主文档注入；`script-src` 使用构建产物内联脚本的 **sha256**（v9.6 去 `unsafe-inline`），解析失败回退旧策略避免白屏。
- 剪贴板小窗自带更严格的 meta CSP（nonce），远端词典字段做转义。

### 9.4 网络与下载

- 词库在线更新只允许 `https` + 受信 host + `.json`；限制体积与结构；重定向后重新校验最终地址，防 SSRF/远端注入；渲染端传入的任意 URL 忽略，回退官方源。
- 发音缓存使用自定义 `qzcache` 协议，只放行有道 `dictvoice` 的 https 音频地址，其余 403。
- 在线释义/翻译（有道 suggest、dictionaryapi.dev、MyMemory 等）可关闭（`onlineLookup` 设置）；本地词库优先。

### 9.5 隐私

- **桌面遥测默认关闭**：`src/utils/telemetry.ts` 对 Electron/file:// 环境默认不初始化 Mixpanel、不调用 Vercel Analytics；需显式 `localStorage['qzTelemetryOptIn'] = '1'`（或控制台 `qzTelemetry.optIn()`）才开启。开启后仍复用上游代码中的第三方统计配置。
- 网页构建（非 Electron）沿用上游统计口径；v9.8 已从 `index.html` 移除 `gtag`/GA 脚本与站点 SEO 外链。
- 日志脱敏：绝对路径 → 占位符，URL 查询串不落日志（避免泄露查询词/本机目录）；日志按日轮转、保留 14 天。
- 测试钩子仅在显式设置 `QZ_ALLOW_MULTI=1` 时开放；正常启动不生效。
- 自动备份与导出文件包含学习记录与词库（个人数据），请自行妥善保管/加密。

### 9.6 数据隔离

- 外壳私有数据（设置、日志、备份、缓存、导出）写入 `%APPDATA%\qwerty-learner-plus`；学习记录仍由应用自身的 IndexedDB 保存。
- 测试/多开可用 `QZ_USER_DATA`、`QZ_PLUS_DIR` 环境变量隔离 profile，不触碰真实用户数据。

## 10. 测试与回归

### 10.1 静态门禁

| 检查 | 命令 | 通过标准 |
| --- | --- | --- |
| 类型 | `tsc --noEmit -p tsconfig.json` | 0 error |
| Lint | `eslint src --ext .ts,.tsx --max-warnings 0` | 0 error / 0 warning |
| 统一入口 | `npm test` / `scripts/quality-gate.ps1` | 上述两项通过 |

### 10.2 核心算法回归

作者本机的 SRS / 自动进阶仿真采用 **esbuild 打包真实 `src` 源码 + Node stub（dexie/react/store 等）**、固定 seed 与注入时钟的方式运行，`--strict` 下失败即非零退出：

| 版本口径 | 提交 | 断言数 | `app.asar`（大小 / SHA256 前 8 位） | CDP 冒烟 |
| --- | --- | --- | --- | --- |
| v9.3 ~ v9.6 | — | 248 | — | — |
| v9.7 ~ v9.9 | `f18e723`（v9.9） | 253（120 SRS + 133 自动进阶） | 86,383,823 B / — | 11/11（v9.9 记录） |
| v9.10 | `8767c15` | 253（另有判定用例 29/29、42/42） | 86,400,986 B / `92979793` | 11/11 |
| v9.11 | `27f73e1` | 309（120 + 189） | 86,402,263 B / `831E3E92` | 11/11 |
| v9.12 | `f7f2c99` | 309 | 86,395,797 B / `8E92FC59` | 11/11（测试安装） |
| v9.13 | `d5064fd` | 309 | 86,396,101 B / `F2DC7F4A` | 11/11（测试安装） |
| v9.14 | `980bb5a` | 309 | 86,398,061 B / `850D5E2C` | 11/11（测试安装） |
| v9.15 | `1fb2b0f` | 309 | 86,400,877 B / `10129D9D` | 11/11（测试安装 + 已安装版） |

- v9.12–v9.15 是同一轮审计的四批修复（架构基座 / 核心与数据 / 交互与页面 / 外壳与工程），断言集未改，每批重跑 309/309；完整哈希与构建目录见 [`RELEASE-NOTES-v9.15.md`](RELEASE-NOTES-v9.15.md)。

- 覆盖方向：新词/到期/循环回顾、refresh、封顶、成熟词降档、时钟回拨、日粒度、迁移、Skip、leech、删除清理、影子调度；自动进阶的掌握度、全错、Skip、跨级、同名、配比、清债、持久化、阈值、加载失败、due key、**70% 掺入曲线与窗口封顶**等。
- 确定性：同 seed 重复运行结果一致（v9.11 起两个 sim 各跑两遍逐字节比对；v9.12–v9.15 沿用同一门禁）。
- 打字判定另有两组用例（不在 309 内）：`wordmatch-src.mjs` **29/29**（esbuild 打包真实 `src`）、`word-judgment-sim.mjs` **42/42**（等价状态机，v9.10 前为 32）。
- **重要**：仿真脚本、断言计划与报告位于作者本机独立审计目录，**不在本仓库内**。干净 clone 上 `quality-gate.ps1 -WithSim` 会因脚本缺失而 SKIP；309/309 是作者本机验收记录，不是公开 CI 结果。

### 10.3 E2E 与冒烟

| 测试 | 说明 | v9.9 记录 |
| --- | --- | --- |
| Playwright | `tests/e2e/`，本地模式 `npm run test:e2e:local`（需 dev server + chromium） | 12 passed / 5 skipped |
| CDP 冒烟 | `scripts/dsh-smoke.mjs`，11 项：版本/页面/开始/面板 5 tab/数据区/练习/备份/统计/错题本/无异常/无 console error | 11/11 |
| 外壳安全探针 | CSP、gtag 未加载、剪贴板最小 API、备份 IPC、迷你模式/置顶、托盘、快捷键注册、日志无 crash | 19/19 |

> 跳过项为已下线的旧流程（v9.9 清理了不可达页面/组件），不是失败。
>
> **v9.10 / v9.11 的 CDP 冒烟为手工执行**：脚本内 `-Smoke` 在构建会话里被 GPU 崩溃拦住（`gpu_process_host: exit_code=-1073741819` → `NO_PAGE`），改用 `--disable-gpu --no-sandbox` + 隔离 profile 手工跑同一脚本，v9.10/v9.11 测试安装与 v9.11 已安装版均 **11/11**（`logs\smoke-1.0.0-enhanced-v9.11-installed.txt`）；安装日志的 `smoke=false` 只表示安装步骤未带 `-Smoke`。
>
> **v9.12–v9.15**：四批均以隔离 profile 跑冒烟 11/11（v9.12–v9.14 为测试安装，v9.15 测试安装与已安装版各 11/11），日志 `logs\smoke-1.0.0-enhanced-v9.15-{testinstall,installed}.txt`。v9.15 的 M5-001/002 给脚本补了单次 CDP 超时（15 s）与全局看门狗（90 s），脚本悬挂不再表现为"卡住不结束"。

### 10.4 手工验收建议

1. `yarn install && yarn build` 确认构建通过；
2. `quality-gate.ps1` 全绿；
3. 以隔离 profile 启动应用（`QZ_USER_DATA` / `QZ_PLUS_DIR`），练 5~10 个词，检查顶栏级别、到期数、错词重现、暂停/继续、数据页；
4. 导出全量 JSON → 清空/新 profile → 导入，确认记录与自定义词库恢复；
5. 桌面安装后检查托盘、快捷键、备份目录、日志无异常。

## 11. 已知限制

1. **非官方分支**：不受上游支持；上游更新不会自动进入本分支（见 [`FORK-NOTICE.md`](../FORK-NOTICE.md) 第 5 节）。
2. **平台**：桌面外壳只在 Windows 11（26100）实测；macOS/Linux 未验证。
3. **回归不可一键复现**：核心算法仿真与审计报告未随仓库发布；公开仓库无法直接复现 248/253/309 断言、确定性、19 项安全探针等作者本机结果。
4. **Electron EOL**：43.8.3 / Chromium 150.0.7871.250，43.x 于 2027-01-05 EOL；升级运行时是手工步骤（含 rcedit 品牌化），不在发布脚本内。
5. **版本元数据滞后**：exe FileVersion 可能落后于应用内版本（运行时升级时才更新）。
6. **无代码签名**：Windows SmartScreen 可能提示未知发布者。
7. **无每日新词硬上限**：动态配比可能一次引入较多新词；每日目标只是统计/提醒。
8. **遥测边界**：桌面默认关闭，但开启 opt-in 后会复用上游第三方统计配置；网页构建沿用上游统计口径（gtag/GA 脚本已移除，Vercel Analytics 门控仍在）。
9. **备份一致性**：运行时目录副本可能遇到 LevelDB 写入中状态；跨设备优先 JSON / `data.json`。
10. **第三方在线能力**：在线释义/翻译、发音依赖第三方服务，可能受网络与服务可用性影响。
11. **词库版权**：内置词库与释义数据版权归上游/原始来源；本分支补回的 5 本旧词库来自上游旧构建产物，按上游相同方式内置。
12. **数据兼容**：不承诺从上游未来版本迁移；导入方应用版本应 ≥ 导出方。
13. **发布脚本路径**：`dsh-release.ps1` / `quality-gate.ps1` 的默认路径是作者本机布局，公开仓库使用前必须用参数覆盖；脚本面向 Windows。
14. **无遥测 UI 开关**：桌面遥测只能用 `localStorage` / 控制台切换，暂无设置界面（代码注释已标注为后续版本）。
15. **分层门禁未硬性化**：依赖环已为 0，但逆向依赖剩 3 条（见第 3.3 节），且分层规则尚未落成 ESLint 规则或发布脚本开关——目前靠人工跑 `scan-graph.mjs` 复核。
16. **两处像素与两处行为变化**：v9.14 修正两处 Tailwind 类名拼写（浅色卡片简介由黑转灰、首屏 Loading 遮罩由透明转不透明）；v9.13 导出文件名带时分秒。逐条说明见 [`RELEASE-NOTES-v9.15.md`](RELEASE-NOTES-v9.15.md) 第 2.5 节。

## 12. 许可证与合规

- 本分支整体按 **GNU GPL v3.0** 分发（与上游一致）。根目录 `LICENSE` 原样保留，上游版权声明不删除、不替换。
- 再分发（含 asar、安装包、二次修改）必须提供对应完整源码、保留 `LICENSE` 与版权声明、并标明修改；本仓库与 `FORK-NOTICE.md` 即修改声明。
- 构建产物 `app.asar` 内会包含 `LICENSE` 与 `FORK-NOTICE.md`。
- 本分支新增代码的著作权归其作者；上游代码著作权归上游作者及贡献者。
- 第三方词库/数据/服务（kajweb、有道、dictionaryapi.dev、MyMemory 等）遵循各自条款；使用者需自行确认合规性。
- 本分支按"现状"提供，无担保；详见 `FORK-NOTICE.md` 的免责声明与 GPL-3.0 免责条款。
- 第三方组件/数据（内置词库、补回的 5 本词表、图标、文档截图、Electron 运行时与在线服务）的逐项来源与许可见 [`THIRD-PARTY.md`](THIRD-PARTY.md)。

## 13. 致谢

- **RealKai42** 与 Qwerty Learner 全体贡献者：上游的设计、词库、练习与统计实现。
- 上游词库与数据来源（kajweb、社区词库贡献者）及发音/释义相关第三方服务。
- Electron、Chromium、React、Vite、Dexie、Tailwind CSS 等开源项目。
- **DeepSeek Harness（dsh）**：本分支的开发、审计与文档工作使用的工具链（工具署名，不代表官方背书）。

## 14. 附录：命令与文件速查

### 命令

| 目的 | 命令 |
| --- | --- |
| 安装依赖 | `yarn install` |
| 开发服务器 | `yarn start` |
| 生产构建 | `yarn build` |
| 类型 + lint | `npm test` 或 `pwsh -File scripts/quality-gate.ps1` |
| 核心回归（需审计脚本） | `pwsh -File scripts/quality-gate.ps1 -WithSim` |
| 发布构建 | `pwsh -File scripts/dsh-release.ps1` |
| 测试安装 + 冒烟 | `pwsh -File scripts/dsh-release.ps1 -TestInstall -Smoke` |
| 正式安装 | `pwsh -File scripts/dsh-release.ps1 -Install` |
| 回滚 | `pwsh -File scripts/dsh-rollback.ps1` |
| CDP 冒烟 | `node scripts/dsh-smoke.mjs`（应用需带调试端口） |
| E2E（本地） | `npm run test:e2e:local`（需先 `npm run dev -- --port 5173 --host 127.0.0.1`） |

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/utils/memory.ts` | 动态出词 + SRS 写入（含 `pickDynamicWord`、`getLearningSummary`） |
| `src/utils/memoryLadder.ts` | 12 档阶梯、新词毕业档、影子调度估算 |
| `src/utils/srsRules.ts` | SRS 纯规则（到期、答错、掌握、时钟回拨、迁移映射） |
| `src/utils/autoLevel.ts` | 自动进阶状态/进度/升级/挂起/迁移 |
| `src/utils/learningPath.ts` | 13 级路径与词库合并加载 |
| `src/utils/sessionRequeue.ts` | 会话内错词重现队列 |
| `src/utils/memoryKey.ts` | memoryKey / 旧 key / 比较口径 |
| `src/utils/db/index.ts` | RecordDB schema、SRS 写库、旧 key 兼容 |
| `src/utils/db/data-export.ts` | 原子导入/导出 |
| `src/utils/db/temp-import-db.ts` | 临时导入库命名与残留清理 |
| `src/utils/telemetry.ts` | 遥测门控（桌面默认关闭） |
| `local-fork/electron/main.js` | Electron 主进程与安全守卫 |
| `scripts/dsh-release.ps1` | 发布构建/安装/冒烟 |
| `scripts/dsh-rollback.ps1` | 回滚 |
| `scripts/quality-gate.ps1` | 质量门禁 |
| `scripts/dsh-smoke.mjs` | CDP 冒烟 |
| `docs/Backup-Restore.md` | 备份/导出/恢复 |
| `docs/Electron-EOL.md` | Electron 运行时与 EOL |
